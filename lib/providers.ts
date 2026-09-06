import type { Snapshot, Provenance } from './engine';
import { SPECS } from './engine';
import { ma30Weeks } from './research';
import { observations, latestInstant, trailingAnnual, provenance, REVENUE_TAGS } from './sec';
import bundledUniverse from './universe.generated.json';
import quickCache from './quick-cache.generated.json';

type Company = { cik: number; name: string; ticker: string; exchange: string; price?: number; marketCap?: number; volume?: number; sector?: string; industry?: string };
type NasdaqRow = { symbol: string; name?: string; lastsale?: string; marketCap?: string; volume?: string; sector?: string; industry?: string };
type CachedQuick = { history: NonNullable<Snapshot['history']>; financials: Record<string, number>; provenance: Record<string, Provenance>; issues: string[] };

const NASDAQ_SCREENER = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=5000&download=true';
export const quickSymbols = Object.keys(quickCache.symbols);
const browserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const secAgent = 'SmallCapRadar/2.1 research-contact:yousef-hamda@users.noreply.github.com';
const numeric = (value: unknown) => { const parsed = Number(String(value ?? '').replace(/[$,%+,]/g, '').trim()); return Number.isFinite(parsed) ? parsed : null };

function requestHeaders(url: string): Record<string, string> {
  return new URL(url).hostname.endsWith('sec.gov')
    ? { 'User-Agent': secAgent, Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' }
    : { 'User-Agent': browserAgent, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.nasdaq.com/' };
}

export async function fetchJson(url: string) {
  const response = await fetch(url, { headers: requestHeaders(url), signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw Error(`${new URL(url).hostname}: HTTP ${response.status}`);
  return response.json();
}

function quotePatch(row?: NasdaqRow) {
  if (!row) return {};
  const price = numeric(row.lastsale), marketCap = numeric(row.marketCap), volume = numeric(row.volume);
  return { ...(price != null && price > 0 ? { price } : {}), ...(marketCap != null && marketCap > 0 ? { marketCap } : {}), ...(volume != null && volume >= 0 ? { volume } : {}), ...(row.sector ? { sector: row.sector } : {}), ...(row.industry ? { industry: row.industry } : {}) };
}

export async function universe(): Promise<Company[]> {
  const base = (bundledUniverse.companies as Company[]).map((company) => ({ ...company }));
  try {
    const latest = await fetchJson(NASDAQ_SCREENER) as { data?: { rows?: NasdaqRow[] } };
    const quotes = new Map((latest.data?.rows ?? []).map((row) => [row.symbol, row]));
    return base.map((company) => ({ ...company, ...quotePatch(quotes.get(company.ticker)) }));
  } catch { return base }
}

function isoDate(date: string) { const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date); return match ? `${match[3]}-${match[1]}-${match[2]}` : '' }
function dateOffset(iso: string, days: number) { const date = new Date(iso); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10) }
function commonSecurity(name: string) { return !/\b(etf|fund|trust|warrant|right|unit|preferred|depositary|senior note|bond|debenture|limited partnership)\b|,\s*L\.P\./i.test(name) }

async function nasdaqHistory(symbol: string, asOf: string) {
  const cached = (quickCache.symbols as Record<string, CachedQuick>)[symbol];
  if (cached?.history?.length) return { url: 'https://api.nasdaq.com/api/quote', history: cached.history };
  const to = asOf.slice(0, 10), from = dateOffset(asOf, -550);
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=stocks&fromdate=${from}&todate=${to}&limit=5000`;
  const payload = await fetchJson(url) as { data?: { tradesTable?: { rows?: Array<Record<string, string>> } } };
  const history = (payload.data?.tradesTable?.rows ?? []).map((row) => ({ date: isoDate(row.date), close: numeric(row.close), open: numeric(row.open), high: numeric(row.high), low: numeric(row.low), volume: numeric(row.volume) }))
    .filter((row) => row.date && row.close != null && row.close > 0 && row.low != null && row.low > 0).sort((a, b) => a.date.localeCompare(b.date));
  return { url, history };
}

export async function companySnapshot(company: Company): Promise<Snapshot> {
  const now = new Date().toISOString(), symbol = company.ticker, cik = String(company.cik).padStart(10, '0'), issues: string[] = [];
  let history: NonNullable<Snapshot['history']> = [], historyUrl = NASDAQ_SCREENER;
  try {
    const result = await nasdaqHistory(symbol, now); historyUrl = result.url;
    history = result.history.map((row) => ({ date: row.date, close: row.close!, open: row.open ?? undefined, high: row.high ?? undefined, low: row.low ?? undefined, volume: row.volume ?? undefined }));
  } catch (error) { issues.push(`تعذّر تحميل تاريخ Nasdaq: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`) }

  const last = history.at(-1), quoteDate = last?.date ?? bundledUniverse.generatedAt.slice(0, 10), quoteAvailableAt = last ? `${last.date}T21:00:00.000Z` : bundledUniverse.generatedAt;
  const quoteEvidence: Provenance = { source: last ? 'Nasdaq Historical (official)' : 'Nasdaq screener snapshot (official)', url: historyUrl, periodEnd: quoteDate, availableAt: quoteAvailableAt > now ? now : quoteAvailableAt, retrievedAt: now, currency: 'USD', confidence: last ? 'high' : 'medium' };
  const price = last?.close ?? company.price ?? null;
  const snapshot: Snapshot = { symbol, name: company.name, asOf: now, exchange: company.exchange, securityType: commonSecurity(company.name) ? 'common' : 'unknown', price, marketCap: company.marketCap ?? null, confidence: 'C', deathSpiral: 'unknown', provenance: {}, history, dataIssues: issues, research: { financials: false, valuation: false, analysts: false, sector: !!company.sector } };

  if (price != null) snapshot.provenance.price = quoteEvidence;
  if (snapshot.marketCap != null) snapshot.provenance.marketCap = { source: 'Nasdaq stock screener (official)', url: NASDAQ_SCREENER, periodEnd: bundledUniverse.generatedAt.slice(0, 10), availableAt: bundledUniverse.generatedAt, retrievedAt: now, currency: 'USD', confidence: 'medium' };
  if (history.length >= 20) {
    const values = history.slice(-20).map((row) => row.close * (row.volume ?? Number.NaN)).filter(Number.isFinite).sort((a, b) => a - b);
    if (values.length === 20) { snapshot.medianDollarVolume20d = (values[9] + values[10]) / 2; snapshot.provenance.medianDollarVolume20d = quoteEvidence }
  }
  const yearStart = Date.parse(quoteDate) - 365 * 86_400_000, year = history.filter((row) => Date.parse(row.date) >= yearStart), prior = history.filter((row) => Date.parse(row.date) <= yearStart).at(-1);
  if (prior && Date.parse(prior.date) >= yearStart - 7 * 86_400_000 && price) { snapshot.return12m = price / prior.close - 1; snapshot.provenance.return12m = quoteEvidence }
  if (year.length >= 240) { snapshot.low52w = Math.min(...year.map((row) => row.low ?? row.close)); snapshot.provenance.low52w = quoteEvidence }
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
    snapshot.research = { financials: !!snapshot.revenue, valuation: false, analysts: false, sector: !!company.sector };
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
  snapshot.research = { financials: !!snapshot.revenue, valuation: false, analysts: false, sector: !!company.sector };
  return snapshot;
}
