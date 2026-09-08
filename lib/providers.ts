import type { Snapshot, Provenance, InsiderPurchase } from './engine';
import { SPECS } from './engine';
import { NON_TRADABLE_NAME } from './strategy-spec';
import { ma30Weeks } from './research';
import { observations, latestInstant, trailingAnnual, provenance, REVENUE_TAGS } from './sec';
import bundledUniverse from './universe.generated.json';
import quickCache from './quick-cache.generated.json';

export type Company = { cik: number; name: string; ticker: string; exchange: string; price?: number; marketCap?: number; volume?: number; averageVolume10d?: number; return52w?: number; low52w?: number; high52w?: number; ma50d?: number; ma200d?: number; sector?: string; industry?: string; quoteSource?: string; quoteAvailableAt?: string };
type NasdaqRow = { symbol: string; name?: string; lastsale?: string; marketCap?: string; volume?: string; sector?: string; industry?: string };
type CachedQuick = { history: NonNullable<Snapshot['history']>; financials: Record<string, number>; provenance: Record<string, Provenance>; issues: string[] };

const NASDAQ_SCREENER = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=5000&download=true';
export const quickSymbols = Object.keys(quickCache.symbols);
const browserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const secAgent = 'SmallCapRadar/2.1 research-contact:yousef-hamda@users.noreply.github.com';
const submissionsUrlFor = (cik: number|string) => `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`;
const numeric = (value: unknown) => { const parsed = Number(String(value ?? '').replace(/[$,%+,]/g, '').trim()); return Number.isFinite(parsed) ? parsed : null };
export const yahooPercentAsRatio = (value: unknown) => Number.isFinite(value) ? Number(value) / 100 : undefined;
const responseCache = new Map<string, { expiresAt: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
const providerIssues: string[] = [];
const recordProviderIssue = (message: string) => { providerIssues.push(message.slice(0, 500)); if (providerIssues.length > 50) providerIssues.shift(); };
export const consumeProviderIssues = () => providerIssues.splice(0, providerIssues.length);

export function companyBySymbol(symbol: string): Company | null {
  return (bundledUniverse.companies as Company[]).find((company) => company.ticker === symbol.toUpperCase()) ?? null;
}

function requestHeaders(url: string): Record<string, string> {
  return new URL(url).hostname.endsWith('sec.gov')
    ? { 'User-Agent': secAgent, Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' }
    : { 'User-Agent': browserAgent, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.nasdaq.com/' };
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
export async function fetchJson(url: string, timeoutMs = 8_000, ttlMs = 30_000) {
  const now = Date.now(), cached = responseCache.get(url);
  if (cached && cached.expiresAt > now) return cached.value;
  const existing = inflight.get(url);
  if (existing) return existing;
  const request = (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, { headers: requestHeaders(url), signal: AbortSignal.timeout(timeoutMs) });
        if (response.ok) {
          const value = await response.json();
          responseCache.set(url, { expiresAt: Date.now() + ttlMs, value });
          if (responseCache.size > 500) responseCache.delete(responseCache.keys().next().value as string);
          return value;
        }
        lastError = Error(`${new URL(url).hostname}: HTTP ${response.status}`);
        if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) break;
        const retryAfter = Number(response.headers.get('retry-after') || 0);
        await wait(Math.max(retryAfter * 1000, 250 * 2 ** attempt));
      } catch (error) {
        lastError = error;
        if (attempt < 2) await wait(250 * 2 ** attempt);
      }
    }
    const message = lastError instanceof Error ? lastError.message : 'provider request failed';
    recordProviderIssue(`${new URL(url).hostname}: ${message}`);
    throw lastError instanceof Error ? lastError : Error(message);
  })();
  inflight.set(url, request);
  try { return await request; } finally { inflight.delete(url); }
}

function quotePatch(row?: NasdaqRow) {
  if (!row) return {};
  const price = numeric(row.lastsale), marketCap = numeric(row.marketCap), volume = numeric(row.volume);
  return { ...(price != null && price > 0 ? { price } : {}), ...(marketCap != null && marketCap > 0 ? { marketCap } : {}), ...(volume != null && volume >= 0 ? { volume } : {}), ...(row.sector ? { sector: row.sector } : {}), ...(row.industry ? { industry: row.industry } : {}) };
}

export async function universe(): Promise<Company[]> {
  const base = (bundledUniverse.companies as Company[]).map((company) => ({ ...company, quoteSource: 'bundled official dated snapshot', quoteAvailableAt: bundledUniverse.generatedAt }));
  let nasdaq = base;
  try {
    const latest = await fetchJson(NASDAQ_SCREENER) as { data?: { rows?: NasdaqRow[] } };
    const quotes = new Map((latest.data?.rows ?? []).map((row) => [row.symbol, row]));
    nasdaq = base.map((company) => quotes.has(company.ticker) ? ({ ...company, ...quotePatch(quotes.get(company.ticker)), quoteSource: 'Nasdaq screener live', quoteAvailableAt: new Date().toISOString() }) : company);
  } catch (error) { recordProviderIssue(`Nasdaq screener: ${error instanceof Error ? error.message : 'provider request failed'}`); }
  return yahooBulkQuotes(nasdaq);
}

async function yahooAuth() {
  const first = await fetch('https://fc.yahoo.com/', { redirect: 'manual', headers: { 'User-Agent': browserAgent, Accept: '*/*' }, signal: AbortSignal.timeout(8_000) });
  const rawCookie = first.headers.get('set-cookie');
  if (!rawCookie) throw Error('Yahoo cookie unavailable');
  const cookie = rawCookie.split(';', 1)[0];
  const crumbResponse = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': browserAgent, Cookie: cookie, Accept: 'text/plain' }, signal: AbortSignal.timeout(8_000) });
  if (!crumbResponse.ok) throw Error(`Yahoo crumb HTTP ${crumbResponse.status}`);
  const crumb = (await crumbResponse.text()).trim();
  if (!crumb || crumb.includes('<')) throw Error('Yahoo crumb invalid');
  return { cookie, crumb };
}

async function yahooCompanyProfile(symbol: string) {
  try {
    const auth = await yahooAuth();
    const modules = 'assetProfile,calendarEvents,earningsHistory,earningsTrend,financialData';
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(auth.crumb)}`;
    const response = await fetch(url, { headers: { 'User-Agent': browserAgent, Cookie: auth.cookie, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw Error(`Yahoo profile HTTP ${response.status}`);
    return (await response.json() as any)?.quoteSummary?.result?.[0] ?? null;
  } catch (error) {
    recordProviderIssue(`Yahoo profile ${symbol}: ${error instanceof Error ? error.message : 'provider request failed'}`);
    return null;
  }
}

async function enrichWithYahooProfile(snapshot: Snapshot, symbol: string, now: string) {
  const profile = await yahooCompanyProfile(symbol);
  const asset = profile?.assetProfile;
  if (asset?.longBusinessSummary) snapshot.description = asset.longBusinessSummary;
  if (asset?.sector) snapshot.sector = asset.sector;
  if (asset?.industry) snapshot.industry = asset.industry;
  if (Number.isFinite(asset?.fullTimeEmployees)) snapshot.employees = asset.fullTimeEmployees;
  const financialData = profile?.financialData;
  const profileTarget = financialData?.targetMeanPrice?.raw;
  if (Number.isFinite(profileTarget)) { snapshot.targetMean = profileTarget; snapshot.analystTarget = profileTarget; snapshot.provenance.analystTarget = { source: 'Yahoo Finance quoteSummary financialData', url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/analysis`, periodEnd: now.slice(0, 10), availableAt: now, retrievedAt: now, currency: 'USD', confidence: 'medium' }; }
  for (const [field, key] of [['targetLow','targetLowPrice'],['targetHigh','targetHighPrice'],['analystCount','numberOfAnalystOpinions']] as const) {
    const value = profile?.financialData?.[key]?.raw;
    if (Number.isFinite(value)) (snapshot as any)[field] = value;
  }
  const earningsHistory = (profile?.earningsHistory?.history ?? []).filter((row:any) => row?.quarter?.fmt || row?.quarter?.raw).slice(-6);
  snapshot.surprises = earningsHistory.map((row:any) => ({ quarter: row.quarter?.fmt || String(row.quarter?.raw || '').slice(0,10), surprisePct: row.surprisePercent?.raw == null ? null : row.surprisePercent.raw * 100, actual: row.epsActual?.raw, estimate: row.epsEstimate?.raw }));
  const next = profile?.calendarEvents?.earnings?.earningsDate?.[0]?.fmt;
  if (next) snapshot.nextEarnings = next;
  const latestEarnings = earningsHistory.at(-1)?.quarter?.fmt;
  if (latestEarnings) snapshot.lastEarnings = latestEarnings;
  if (snapshot.surprises?.length) { const latest = snapshot.surprises.at(-1)?.surprisePct; snapshot.lastEarningsStatus = latest == null ? 'غير معروف' : latest >= 0 ? 'إيجابي' : 'سلبي'; }
  return snapshot;
}

async function yahooBulkQuotes(companies: Company[]): Promise<Company[]> {
  try {
    const auth = await yahooAuth();
    const chunks: Company[][] = [];
    for (let index = 0; index < companies.length; index += 250) chunks.push(companies.slice(index, index + 250));
    const quoteMap = new Map<string, any>();
    for (let index = 0; index < chunks.length; index += 8) {
      const group = chunks.slice(index, index + 8);
      const payloads = await Promise.all(group.map(async (chunk) => {
        const symbols = chunk.map((company) => company.ticker).join(',');
        const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&crumb=${encodeURIComponent(auth.crumb)}`;
        const response = await fetch(url, { headers: { 'User-Agent': browserAgent, Cookie: auth.cookie, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw Error(`Yahoo quote HTTP ${response.status}`);
        return response.json() as Promise<{ quoteResponse?: { result?: any[] } }>;
      }));
      for (const payload of payloads) for (const quote of payload.quoteResponse?.result ?? []) quoteMap.set(quote.symbol, quote);
    }
    if (quoteMap.size < Math.min(100, companies.length / 2)) throw Error('Yahoo bulk coverage too low');
    return companies.map((company) => {
      const quote = quoteMap.get(company.ticker);
      if (!quote) return company;
      return {
        ...company,
        quoteSource: 'Yahoo bulk quote live',
        quoteAvailableAt: new Date().toISOString(),
        ...(Number.isFinite(quote.regularMarketPrice) ? { price: quote.regularMarketPrice } : {}),
        ...(Number.isFinite(quote.marketCap) ? { marketCap: quote.marketCap } : {}),
        ...(Number.isFinite(quote.regularMarketVolume) ? { volume: quote.regularMarketVolume } : {}),
        ...(Number.isFinite(quote.averageDailyVolume10Day) ? { averageVolume10d: quote.averageDailyVolume10Day } : {}),
        // Yahoo exposes this field in percentage points (for example 25.4 means
        // 25.4%), while the scoring engine consistently stores returns as ratios.
        ...(Number.isFinite(quote.fiftyTwoWeekChangePercent) ? { return52w: yahooPercentAsRatio(quote.fiftyTwoWeekChangePercent) } : {}),
        ...(Number.isFinite(quote.fiftyTwoWeekLow) ? { low52w: quote.fiftyTwoWeekLow } : {}),
        ...(Number.isFinite(quote.fiftyTwoWeekHigh) ? { high52w: quote.fiftyTwoWeekHigh } : {}),
        ...(Number.isFinite(quote.fiftyDayAverage) ? { ma50d: quote.fiftyDayAverage } : {}),
        ...(Number.isFinite(quote.twoHundredDayAverage) ? { ma200d: quote.twoHundredDayAverage } : {}),
        ...(quote.sector ? { sector: quote.sector } : {}),
        ...(quote.industry ? { industry: quote.industry } : {}),
      };
    });
  } catch (error) {
    recordProviderIssue(`Yahoo bulk quotes: ${error instanceof Error ? error.message : 'provider request failed'}`);
    return companies;
  }
}

function isoDate(date: string) { const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date); return match ? `${match[3]}-${match[1]}-${match[2]}` : '' }
function dateOffset(iso: string, days: number) { const date = new Date(iso); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10) }
function commonSecurity(name: string) { return !NON_TRADABLE_NAME.test(name) }

export async function historicalMarketData(symbol: string, asOf = new Date().toISOString()) {
  const cached = (quickCache.symbols as Record<string, CachedQuick>)[symbol];
  const to = asOf.slice(0, 10), from = dateOffset(asOf, -1900);
  if (cached?.history?.length) return { url: 'https://api.nasdaq.com/api/quote', history: cached.history.filter(row => row.date <= to) };
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=stocks&fromdate=${from}&todate=${to}&limit=5000`;
  const payload = await fetchJson(url) as { data?: { tradesTable?: { rows?: Array<Record<string, string>> } } };
  const history = (payload.data?.tradesTable?.rows ?? []).map((row) => ({ date: isoDate(row.date), close: numeric(row.close), open: numeric(row.open), high: numeric(row.high), low: numeric(row.low), volume: numeric(row.volume) }))
    .filter((row) => row.date && row.close != null && row.close > 0 && row.low != null && row.low > 0).sort((a, b) => a.date.localeCompare(b.date));
  return { url, history };
}

async function fetchInsiderPurchases(cik: number) {
  const submissionsUrl = submissionsUrlFor(cik);
  try {
    const payload = await fetchJson(submissionsUrl, 8_000) as { filings?: { recent?: { form?: string[]; accessionNumber?: string[]; primaryDocument?: string[]; filingDate?: string[] } } };
    const recent = payload.filings?.recent;
    if (!recent?.form || !recent.accessionNumber || !recent.primaryDocument) return [];
    const filings = recent.form.map((form, index) => ({ form, accession: recent.accessionNumber![index], document: recent.primaryDocument![index], filed: recent.filingDate?.[index] ?? '' })).filter(f => f.form === '4').slice(0, 8);
    const parsed: InsiderPurchase[] = [];
    const read = (tag: string, from: string) => from.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
    for (const filing of filings) {
      const accessionPath = filing.accession.replaceAll('-', '');
      const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionPath}/${filing.document}`;
      const xml = await fetch(url, { headers: requestHeaders(url), signal: AbortSignal.timeout(8_000) }).then(response => response.ok ? response.text() : '').catch(() => '');
      if (!xml) continue;
      const blocks = xml.match(new RegExp('<nonDerivativeTransaction[\\s\\S]*?<\\/nonDerivativeTransaction>', 'gi')) ?? [];
      const ownerBlock = xml.match(new RegExp('<reportingOwner>[\\s\\S]*?<\\/reportingOwner>', 'i'))?.[0] ?? '';
      const owner = read('rptOwnerName', ownerBlock) || 'مبلّغ داخلي غير مسمّى';
      for (const block of blocks) {
        if (read('transactionCode', block) !== 'P') continue;
        const dateBlock = block.match(new RegExp('<transactionDate[\\s\\S]*?<\\/transactionDate>', 'i'))?.[0] ?? '';
        const sharesBlock = block.match(new RegExp('<transactionShares[\\s\\S]*?<\\/transactionShares>', 'i'))?.[0] ?? '';
        const priceBlock = block.match(new RegExp('<transactionPricePerShare[\\s\\S]*?<\\/transactionPricePerShare>', 'i'))?.[0] ?? '';
        const date = read('value', dateBlock) || filing.filed;
        const shares = numeric(read('value', sharesBlock));
        const price = numeric(read('value', priceBlock));
        if (date && shares != null && price != null && shares > 0 && price >= 0) parsed.push({ owner, date, shares, price, value: shares * price, source: url });
      }
    }
    return parsed.slice(0, 20);
  } catch { return []; }
}

export async function companySnapshot(company: Company): Promise<Snapshot> {
  const now = new Date().toISOString(), symbol = company.ticker, cik = String(company.cik).padStart(10, '0'), issues: string[] = [];
  let history: NonNullable<Snapshot['history']> = [], historyUrl = NASDAQ_SCREENER;
  try {
    const result = await historicalMarketData(symbol, now); historyUrl = result.url;
    history = result.history.map((row) => ({ date: row.date, close: row.close!, open: row.open ?? undefined, high: row.high ?? undefined, low: row.low ?? undefined, volume: row.volume ?? undefined }));
  } catch (error) { issues.push(`تعذّر تحميل تاريخ Nasdaq: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`) }

  const last = history.at(-1), quoteDate = last?.date ?? bundledUniverse.generatedAt.slice(0, 10), quoteAvailableAt = last ? `${last.date}T21:00:00.000Z` : bundledUniverse.generatedAt;
  const quoteEvidence: Provenance = { source: last ? 'Nasdaq Historical (official)' : 'Nasdaq screener snapshot (official)', url: historyUrl, periodEnd: quoteDate, availableAt: quoteAvailableAt > now ? now : quoteAvailableAt, retrievedAt: now, currency: 'USD', confidence: last ? 'high' : 'medium' };
  const price = last?.close ?? company.price ?? null;
  const snapshot: Snapshot = { symbol, name: company.name, description: 'الوصف غير متاح من مصدر موثق لهذه اللقطة.', asOf: now, exchange: company.exchange, sector: company.sector, industry: company.industry, securityType: commonSecurity(company.name) ? 'common' : 'unknown', price, marketCap: company.marketCap ?? null, confidence: 'C', deathSpiral: 'unknown', provenance: {}, history, dataIssues: issues, research: { financials: false, valuation: false, analysts: false, sector: !!company.sector } };

  if (price != null) snapshot.provenance.price = quoteEvidence;
  if (snapshot.marketCap != null) snapshot.provenance.marketCap = { source: 'Nasdaq stock screener (official)', url: NASDAQ_SCREENER, periodEnd: bundledUniverse.generatedAt.slice(0, 10), availableAt: bundledUniverse.generatedAt, retrievedAt: now, currency: 'USD', confidence: 'medium' };
  const summaryPromise = fetchJson(`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/summary?assetclass=stocks`, 8_000).catch(() => null) as Promise<any>;
  const newsPromise = fetch(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`, { headers: { 'User-Agent': browserAgent, Accept: 'application/rss+xml,text/xml' }, signal: AbortSignal.timeout(8_000) }).then(r => r.ok ? r.text() : '').catch(() => '');
  const insiderPromise = fetchInsiderPurchases(company.cik);
  const [summaryResult, newsResult, insiderPurchases] = await Promise.all([summaryPromise, newsPromise, insiderPromise]);
  const summary = summaryResult?.data?.summaryData ?? {};
  const summaryValue = (key: string) => String(summary[key]?.value ?? '').trim();
  const target = numeric(summaryValue('OneYrTarget'));
  if (target != null) { snapshot.analystTarget = target; snapshot.targetMean = target; snapshot.provenance.analystTarget = { source: 'Nasdaq quote summary (official)', periodEnd: now.slice(0, 10), availableAt: now, retrievedAt: now, currency: 'USD', confidence: 'medium' }; }
  const range = summaryValue('FiftTwoWeekHighLow').match(/\$?([\d.]+)\s*\/\s*\$?([\d.]+)/);
  if (range) { snapshot.high52w ??= Number(range[1]); snapshot.low52w ??= Number(range[2]); }
  const summarySector = summaryValue('Sector'), summaryIndustry = summaryValue('Industry');
  if (summarySector) snapshot.sector = summarySector;
  if (summaryIndustry) snapshot.industry = summaryIndustry;
  const strip = (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  snapshot.news = [...newsResult.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8).map(match => { const item = match[1]; const read = (tag: string) => strip(item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] ?? ''); return { title: read('title'), link: read('link'), publishedAt: read('pubDate'), source: 'Yahoo Finance RSS' }; }).filter(item => item.title);
  snapshot.insiderPurchases = insiderPurchases;
  snapshot.insiderBuyValue = insiderPurchases.reduce((total, purchase) => total + purchase.value, 0) || null;
  if (snapshot.insiderBuyValue != null) snapshot.provenance.insiderBuyValue = { source: 'SEC Form 4 open-market purchases (code P)', url: submissionsUrlFor(cik), periodEnd: insiderPurchases[0]?.date ?? now.slice(0, 10), availableAt: now, retrievedAt: now, currency: 'USD', confidence: 'high' };
  if (history.length >= 20) {
    const values = history.slice(-20).map((row) => row.close * (row.volume ?? Number.NaN)).filter(Number.isFinite).sort((a, b) => a - b);
    if (values.length === 20) { snapshot.medianDollarVolume20d = (values[9] + values[10]) / 2; snapshot.provenance.medianDollarVolume20d = quoteEvidence }
  }
  const yearStart = Date.parse(quoteDate) - 365 * 86_400_000, year = history.filter((row) => Date.parse(row.date) >= yearStart), prior = history.filter((row) => Date.parse(row.date) <= yearStart).at(-1);
  if (prior && Date.parse(prior.date) >= yearStart - 7 * 86_400_000 && price) { snapshot.return12m = price / prior.close - 1; snapshot.provenance.return12m = quoteEvidence }
  if (year.length >= 240) { snapshot.low52w = Math.min(...year.map((row) => row.low ?? row.close)); snapshot.high52w = Math.max(...year.map((row) => row.high ?? row.close)); snapshot.provenance.low52w = quoteEvidence; snapshot.provenance.high52w = quoteEvidence }
  snapshot.ma30w = ma30Weeks(history, now); if (snapshot.ma30w) snapshot.provenance.ma30w = quoteEvidence;
  if (snapshot.marketCap != null && (snapshot.marketCap < SPECS.core.marketCap.min || snapshot.marketCap > SPECS.core.marketCap.max)) return snapshot;

  const cached = (quickCache.symbols as Record<string, CachedQuick>)[symbol];
  if (cached) {
    Object.assign(snapshot as unknown as Record<string, unknown>, cached.financials);
    Object.assign(snapshot.provenance, cached.provenance);
    const operational = snapshot as Snapshot & { ocf?: number; capex?: number };
    delete operational.ocf; delete operational.capex;
    if (snapshot.marketCap && snapshot.revenue && snapshot.revenue > 0) {
      snapshot.ps = snapshot.marketCap / snapshot.revenue;
      snapshot.provenance.ps = { ...snapshot.provenance.revenue, source: 'Derived: market cap / SEC cached revenue', availableAt: [snapshot.provenance.marketCap.availableAt, snapshot.provenance.revenue.availableAt].sort().at(-1)!, confidence: 'low' };
    }
    await enrichWithYahooProfile(snapshot, symbol, now);
    snapshot.research = { financials: !!snapshot.revenue, valuation: snapshot.evSales != null || snapshot.ps != null, analysts: snapshot.analystTarget != null, sector: !!snapshot.sector };
    return snapshot;
  }

  const factsUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  let facts: Record<string, unknown>;
  try { facts = ((await fetchJson(factsUrl)) as { facts: Record<string, unknown> }).facts }
  catch (error) { snapshot.dataIssues?.push(`تعذّر جلب البيانات المالية من SEC: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`); return snapshot }

  const shares = latestInstant(observations(facts, ['EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding'], 'shares'), now);
  if (shares && price && Date.parse(now) - Date.parse(shares.end) < 120 * 86_400_000) {
    snapshot.marketCap = shares.val * price;
    snapshot.provenance.marketCap = { ...provenance(shares, factsUrl, now), source: 'Derived: SEC reported shares × Nasdaq price', availableAt: [provenance(shares, factsUrl, now).availableAt, quoteEvidence.availableAt].sort().at(-1)!, confidence: 'low' };
  }
  const revenueRows = observations(facts, REVENUE_TAGS).filter(row => Date.parse(row.filed+'T23:59:59Z') <= Date.parse(now));
  const quarterly = revenueRows.filter(row => row.start && ['10-Q','10-Q/A'].includes(row.form)).map(row => ({ ...row, days: (Date.parse(row.end)-Date.parse(row.start!))/864e5 })).filter(row => row.days >= 70 && row.days <= 115).sort((a,b) => a.end.localeCompare(b.end) || b.filed.localeCompare(a.filed));
  const seenQuarters = new Set<string>();
  snapshot.revenueTrend = quarterly.reverse().filter(row => { if (seenQuarters.has(row.end)) return false; seenQuarters.add(row.end); return true; }).slice(0, 6).reverse().map(row => ({ quarter: row.end.slice(0, 7), value: row.val, periodEnd: row.end }));
  if (snapshot.revenueTrend.length > 0) snapshot.provenance.revenueTrend = { source: 'SEC EDGAR XBRL quarterly revenue', url: factsUrl, periodEnd: snapshot.revenueTrend.at(-1)!.periodEnd || now.slice(0, 10), availableAt: now, retrievedAt: now, currency: 'USD', tag: 'quarterly revenue', confidence: 'high' };
  for (const [key, tags] of Object.entries({ revenue: REVENUE_TAGS, netIncome: ['NetIncomeLoss', 'ProfitLoss'], ocf: ['NetCashProvidedByUsedInOperatingActivities'], capex: ['PaymentsToAcquirePropertyPlantAndEquipment'] })) {
    const annual = trailingAnnual(observations(facts, tags), now);
    if (annual) { (snapshot as unknown as Record<string, unknown>)[key] = annual.val; snapshot.provenance[key] = provenance(annual, factsUrl, now); if (['20-F', '40-F'].includes(annual.form)) snapshot.foreignFiler = true }
  }
  const operational = snapshot as Snapshot & { ocf?: number; capex?: number };
  if (operational.ocf != null && operational.capex != null && snapshot.provenance.ocf.periodEnd === snapshot.provenance.capex.periodEnd) {
    snapshot.fcf = operational.ocf - operational.capex;
    snapshot.provenance.fcf = { ...snapshot.provenance.ocf, tag: 'OperatingCashFlow − PaymentsToAcquirePropertyPlantAndEquipment', availableAt: [snapshot.provenance.ocf.availableAt, snapshot.provenance.capex.availableAt].sort().at(-1)! };
  }
  delete operational.ocf; delete operational.capex;
  if (snapshot.marketCap && snapshot.revenue && snapshot.revenue > 0) {
    snapshot.ps = snapshot.marketCap / snapshot.revenue;
    snapshot.provenance.ps = { ...snapshot.provenance.revenue, source: 'Derived: market cap / SEC revenue', availableAt: [snapshot.provenance.marketCap.availableAt, snapshot.provenance.revenue.availableAt].sort().at(-1)!, confidence: 'low' };
  }
  await enrichWithYahooProfile(snapshot, symbol, now);
  snapshot.research = { financials: !!snapshot.revenue, valuation: snapshot.evSales != null || snapshot.ps != null, analysts: snapshot.analystTarget != null, sector: !!snapshot.sector };
  return snapshot;
}
