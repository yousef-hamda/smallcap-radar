import type { Snapshot, Provenance, InsiderPurchase } from './engine';
import { NON_TRADABLE_NAME } from './strategy-spec';
import { ma30Weeks } from './research';
import { observations, latestInstant, trailingAnnual, provenance, REVENUE_TAGS } from './sec';
import bundledUniverse from './universe.generated.json';
import quickCache from './quick-cache.generated.json';
import {enrichFinancials} from './financials';
import {parseYahooIntraday,type ChartPayload} from './chart-data';
import {parseOfficialDirectory} from './directory';

export type Company = { cik: number; name: string; ticker: string; exchange: string; price?: number; dailyChange?: number; marketCap?: number; volume?: number; averageVolume10d?: number; return52w?: number; low52w?: number; high52w?: number; ma50d?: number; ma200d?: number; sector?: string; industry?: string; quoteSource?: string; quoteAvailableAt?: string };
type NasdaqRow = { symbol: string; name?: string; lastsale?: string; marketCap?: string; volume?: string; sector?: string; industry?: string };
type CachedQuick = { history: NonNullable<Snapshot['history']>; financials: Record<string, number>; provenance: Record<string, Provenance>; issues: string[] };

const NASDAQ_SCREENER = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true';
const NASDAQ_LISTED='https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
const OTHER_LISTED='https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';
const SEC_TICKERS='https://www.sec.gov/files/company_tickers.json';
export const quickSymbols = Object.keys(quickCache.symbols);
const browserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36';
// SEC asks clients to identify themselves with a descriptive product name and
// a reachable contact.  The parenthesized form is accepted by SEC's edge from
// both local and Cloudflare Worker egress; the old colon-only form was answered
// with HTTP 403 by data.sec.gov in production.
const secAgent = 'SmallCapRadar/2.1 (contact: yousef-hamda@users.noreply.github.com)';
const submissionsUrlFor = (cik: number|string) => `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`;
export const numeric = (value: unknown) => { if(typeof value!=='number'&&typeof value!=='string')return null;const text=String(value).replace(/[$,%+,]/g,'').trim();if(!text)return null;const parsed=Number(text);return Number.isFinite(parsed)?parsed:null; };
export const yahooPercentAsRatio = (value: unknown) => Number.isFinite(value) ? Number(value) / 100 : undefined;
const responseCache = new Map<string, { expiresAt: number; value: unknown; bytes:number }>();
const cooldowns = new Map<string,number>();
const inflight = new Map<string, Promise<unknown>>();
const providerIssues: string[] = [];
const recordProviderIssue = (message: string) => { providerIssues.push(message.slice(0, 500)); if (providerIssues.length > 50) providerIssues.shift(); };
export const consumeProviderIssues = () => providerIssues.splice(0, providerIssues.length);

async function fetchText(url:string,timeoutMs=4000){
 const response=await fetch(url,{headers:requestHeaders(url),signal:AbortSignal.timeout(timeoutMs)});
 if(!response.ok)throw Error(`${new URL(url).hostname}: HTTP ${response.status}`);
 return response.text();
}

export function companyBySymbol(symbol: string): Company | null {
  return (bundledUniverse.companies as Company[]).find((company) => company.ticker === symbol.toUpperCase()) ?? null;
}

export function searchCompanies(query: string, limit = 12): Company[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return (bundledUniverse.companies as Company[])
    .filter(company => company.ticker.toLowerCase().includes(normalized) || company.name.toLowerCase().includes(normalized))
    .sort((a, b) => {
      const rank = (company: Company) => company.ticker.toLowerCase() === normalized ? 0 : company.ticker.toLowerCase().startsWith(normalized) ? 1 : company.name.toLowerCase().startsWith(normalized) ? 2 : 3;
      return rank(a) - rank(b) || a.ticker.localeCompare(b.ticker);
    })
    .slice(0, Math.max(1, Math.min(20, limit)));
}

function requestHeaders(url: string): Record<string, string> {
  return new URL(url).hostname.endsWith('sec.gov')
    ? { 'User-Agent': secAgent, Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' }
    : { 'User-Agent': browserAgent, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.nasdaq.com/' };
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
export async function fetchJson(url: string, timeoutMs = 8_000, ttlMs = 30_000, attempts = 3) {
  const now = Date.now(), cached = responseCache.get(url);
  if (cached && cached.expiresAt > now) return cached.value;
  const host=new URL(url).hostname;
  if((cooldowns.get(host)??0)>now)throw Error(`${host}: rate limited until ${new Date(cooldowns.get(host)!).toISOString()}`);
  const existing = inflight.get(url);
  if (existing) return existing;
  const request = (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await fetch(url, { headers: requestHeaders(url), signal: AbortSignal.timeout(timeoutMs) });
        if (response.ok) {
          const value = await response.json();
          // Large Company Facts responses must not fill the 128MB isolate.
          const bytes=JSON.stringify(value).length*2;
          for(const [key,row] of responseCache)if(row.expiresAt<=Date.now())responseCache.delete(key);
          if(bytes<=1_000_000)responseCache.set(url, { expiresAt: Date.now() + ttlMs, value, bytes });
          let used=[...responseCache.values()].reduce((n,row)=>n+row.bytes,0);
          while(used>8_000_000||responseCache.size>64){const key=responseCache.keys().next().value!;used-=responseCache.get(key)!.bytes;responseCache.delete(key);}
          return value;
        }
        lastError = Error(`${new URL(url).hostname}: HTTP ${response.status}`);
        if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) break;
        const retryHeader=response.headers.get('retry-after')||'0';
        const retryAfter=Number.isFinite(Number(retryHeader))?Number(retryHeader):Math.max(0,(Date.parse(retryHeader)-Date.now())/1000);
        if(retryAfter>5){cooldowns.set(host,Date.now()+retryAfter*1000);lastError=Error(`${host}: rate limited; retry after ${retryAfter}s`);break;}
        if(attempt+1<attempts)await wait(Math.min(5000,Math.max(retryAfter * 1000, 250 * 2 ** attempt)));
      } catch (error) {
        lastError = error;
        if (attempt+1 < attempts) await wait(250 * 2 ** attempt);
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

export async function universe(options?:{skipYahoo?:boolean}): Promise<Company[]> {
  const base = (bundledUniverse.companies as Company[]).map((company) => ({ ...company, quoteSource: 'bundled official dated snapshot', quoteAvailableAt: bundledUniverse.generatedAt }));
  const [latestResult,directoryResult]=await Promise.allSettled([
    fetchJson(NASDAQ_SCREENER,3_000) as Promise<{data?:{rows?:NasdaqRow[]}}>,
    Promise.all([fetchText(NASDAQ_LISTED),fetchText(OTHER_LISTED),fetchJson(SEC_TICKERS,5000,6*60*60_000)]).then(([nasdaq,other,sec])=>parseOfficialDirectory(nasdaq,other,sec as Record<string,any>)),
  ]);
  let directory:Company[]=base;
  if(directoryResult.status==='fulfilled'&&directoryResult.value.length){
    const old=new Map(base.map(company=>[company.ticker,company]));
    directory=directoryResult.value.map(company=>({...old.get(company.ticker),...company,quoteSource:old.get(company.ticker)?.quoteSource||'official live listing directory',quoteAvailableAt:old.get(company.ticker)?.quoteAvailableAt||new Date().toISOString()}));
  }else recordProviderIssue(`Official listing directory: ${directoryResult.status==='rejected'&&directoryResult.reason instanceof Error?directoryResult.reason.message:'empty response'}`);
  let nasdaq = directory;
  if(latestResult.status==='fulfilled'){
    const latest=latestResult.value;
    const quotes = new Map((latest.data?.rows ?? []).map((row) => [row.symbol, row]));
    nasdaq = directory.map(company=>{
      const patch=quotePatch(quotes.get(company.ticker));
      if(!Number.isFinite(patch.price)||!Number.isFinite(patch.marketCap))return company;
      return {...company,...patch,quoteSource:'Nasdaq screener live',quoteAvailableAt:new Date().toISOString()};
    });
  } else recordProviderIssue(`Nasdaq screener: ${latestResult.reason instanceof Error?latestResult.reason.message:'provider request failed'}`);
  return options?.skipYahoo?nasdaq:yahooBulkQuotes(nasdaq);
}

let authCache:{expiresAt:number;value:{cookie:string;crumb:string}}|null=null;
let authRequest:Promise<{cookie:string;crumb:string}>|null=null;
async function yahooAuth() {
  if(authCache&&authCache.expiresAt>Date.now())return authCache.value;
  if(authRequest)return authRequest;
  authRequest=loadYahooAuth().then(value=>{authCache={value,expiresAt:Date.now()+5*60_000};return value;}).finally(()=>{authRequest=null;});
  return authRequest;
}
async function loadYahooAuth() {
  const first = await fetch('https://fc.yahoo.com/', { redirect: 'manual', headers: { 'User-Agent': browserAgent, Accept: '*/*' }, signal: AbortSignal.timeout(4_000) });
  const rawCookie = first.headers.get('set-cookie');
  if (!rawCookie) throw Error('Yahoo cookie unavailable');
  const cookie = rawCookie.split(';', 1)[0];
  const crumbResponse = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': browserAgent, Cookie: cookie, Accept: 'text/plain' }, signal: AbortSignal.timeout(4_000) });
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
    const response = await fetch(url, { headers: { 'User-Agent': browserAgent, Cookie: auth.cookie, Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) });
    if (!response.ok) throw Error(`Yahoo profile HTTP ${response.status}`);
    return (await response.json() as any)?.quoteSummary?.result?.[0] ?? null;
  } catch (error) {
    recordProviderIssue(`Yahoo profile ${symbol}: ${error instanceof Error ? error.message : 'provider request failed'}`);
    return null;
  }
}

async function enrichWithYahooProfile(snapshot: Snapshot, symbol: string, now: string, profilePromise?:ReturnType<typeof yahooCompanyProfile>) {
  const profile = await (profilePromise??yahooCompanyProfile(symbol));
  const asset = profile?.assetProfile;
  if (asset?.longBusinessSummary) snapshot.description = asset.longBusinessSummary;
  if (typeof asset?.website === 'string' && /^https:\/\//i.test(asset.website)) snapshot.website = asset.website;
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
  const profileEvidence:Provenance={source:'Yahoo Finance quoteSummary',url:`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`,periodEnd:now.slice(0,10),availableAt:now,retrievedAt:now,confidence:'medium'};
  for(const key of ['description','website','sector','industry','employees','targetMean','targetLow','targetHigh','analystCount','nextEarnings','lastEarnings','surprises'] as const)if(snapshot[key]!=null&&profile)snapshot.provenance[key]={...profileEvidence,tag:key};
  return snapshot;
}

export async function yahooBulkQuotes(companies: Company[]): Promise<Company[]> {
  try {
    const auth = await yahooAuth();
    const chunks: Company[][] = [];
    for (let index = 0; index < companies.length; index += 250) chunks.push(companies.slice(index, index + 250));
    const quoteMap = new Map<string, any>();
    for (let index = 0; index < chunks.length; index += 8) {
      const group = chunks.slice(index, index + 8);
      const payloads = await Promise.allSettled(group.map(async (chunk) => {
        const symbols = chunk.map((company) => company.ticker).join(',');
        const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&crumb=${encodeURIComponent(auth.crumb)}`;
        const response = await fetch(url, { headers: { 'User-Agent': browserAgent, Cookie: auth.cookie, Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) });
        if (!response.ok) throw Error(`Yahoo quote HTTP ${response.status}`);
        return response.json() as Promise<{ quoteResponse?: { result?: any[] } }>;
      }));
      for (const payload of payloads) {
        if(payload.status==='fulfilled')for(const quote of payload.value.quoteResponse?.result??[])quoteMap.set(quote.symbol,quote);
        else recordProviderIssue(`Yahoo quote batch: ${payload.reason instanceof Error?payload.reason.message:'request failed'}`);
      }
    }
    if (quoteMap.size < Math.min(100, companies.length / 2)) recordProviderIssue('Yahoo bulk coverage low; retained successful chunks and dated fallback rows');
    return companies.map((company) => {
      const quote = quoteMap.get(company.ticker);
      // A quote is still useful when Yahoo omits market-cap metadata (common for
      // thinly traded or newly listed symbols).  Requiring both fields made a
      // valid live price fall back to the dated bundled snapshot.
      if (!quote||!Number.isFinite(quote.regularMarketPrice)) return company;
      return {
        ...company,
        quoteSource: 'Yahoo bulk quote live',
        quoteAvailableAt: Number.isFinite(quote.regularMarketTime)?new Date(quote.regularMarketTime*1000).toISOString():new Date().toISOString(),
        ...(Number.isFinite(quote.regularMarketPrice) ? { price: quote.regularMarketPrice } : {}),
        ...(Number.isFinite(quote.regularMarketChangePercent) ? {dailyChange:quote.regularMarketChangePercent/100}:{}),
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

export function parseYahooDaily(payload:any,asOf=new Date().toISOString()){
 const result=payload?.chart?.result?.[0];
 const timestamps=Array.isArray(result?.timestamp)?result.timestamp:[];
 const quote=result?.indicators?.quote?.[0]??{};
 const cutoff=Date.parse(asOf);
 const bars=new Map<string,NonNullable<Snapshot['history']>[number]>();
 for(let index=0;index<timestamps.length;index++){
  const timestamp=timestamps[index];
  if(!Number.isFinite(timestamp)||timestamp*1000>cutoff)continue;
  const date=new Date(timestamp*1000).toISOString().slice(0,10);
  // Daily quote OHLC is split-adjusted. adjclose additionally adjusts cash
  // dividends and must not be mixed with the current price/52-week range.
  const close=numeric(quote.close?.[index]);
  if(close==null||close<=0||Date.parse(`${date}T23:59:59Z`)>cutoff)continue;
  const value=(field:string)=>{const n=numeric(quote[field]?.[index]);return n!=null&&n>=0?n:undefined};
  bars.set(date,{date,close,open:value('open'),high:value('high'),low:value('low'),volume:value('volume')});
 }
 const history=[...bars.values()].sort((a,b)=>a.date.localeCompare(b.date));
 const splits:{date:string;factor:number}[]=[];
 let validEvents=!!result&&payload?.chart?.error==null;
 for(const event of Object.values(result?.events?.splits??{}) as any[]){
  const numerator=numeric(event.numerator),denominator=numeric(event.denominator);
  const ratioParts=String(event.splitRatio??'').split(':').map(Number);
  const factor=numerator!=null&&denominator!=null?numerator/denominator:ratioParts.length===2?ratioParts[0]/ratioParts[1]:NaN;
  if(!Number.isFinite(event.date)||!Number.isFinite(factor)||factor<=0){validEvents=false;continue;}
  const date=new Date(event.date*1000).toISOString().slice(0,10);
  if(Date.parse(`${date}T23:59:59Z`)>cutoff)continue;
  splits.push({date,factor});
 }
 return {history,splits:validEvents?splits.sort((a,b)=>a.date.localeCompare(b.date)):null};
}

export async function historicalMarketData(symbol: string, asOf = new Date().toISOString(), days = 1900) {
  const cached = (quickCache.symbols as Record<string, CachedQuick>)[symbol];
  const to = asOf.slice(0, 10), from = dateOffset(asOf, -days);
  const period1=Math.floor(Date.parse(`${from}T00:00:00Z`)/1000),period2=Math.floor(Date.parse(asOf)/1000)+86400;
  const yahooUrl=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
  try{
   const parsed=parseYahooDaily(await fetchJson(yahooUrl,3000,86_400_000,1),asOf);
   if(parsed.history.length)return {url:yahooUrl,...parsed,source:'Yahoo Finance chart API · adjusted daily history and split events',retrievedAt:asOf,availableAt:asOf};
  }catch(error){recordProviderIssue(`${symbol}: Yahoo daily history unavailable: ${error instanceof Error?error.message:String(error)}; trying Nasdaq`);}
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=stocks&fromdate=${from}&todate=${to}&limit=5000`;
  let payload: { data?: { tradesTable?: { rows?: Array<Record<string, string>> } } };
  try { payload = await fetchJson(url,3000,300_000,1) as typeof payload; }
  catch(error) {
   if(!cached?.history?.length)throw error;
   recordProviderIssue(`${symbol}: historical API unavailable; dated bundled history fallback`);
   return {url,history:cached.history.filter(row=>row.date>=from&&row.date<=to),splits:null,source:'Nasdaq historical · bundled dated fallback',retrievedAt:quickCache.generatedAt,availableAt:quickCache.generatedAt};
  }
  const history = (payload.data?.tradesTable?.rows ?? []).map((row) => ({ date: isoDate(row.date), close: numeric(row.close), open: numeric(row.open), high: numeric(row.high), low: numeric(row.low), volume: numeric(row.volume) }))
    .filter((row) => row.date && row.date<=to && row.date>=from && row.close != null && row.close > 0 && row.low != null && row.low > 0).sort((a, b) => a.date.localeCompare(b.date));
  if(!history.length)throw Error(`${symbol}: no historical sessions returned`);
  return { url, history, splits:null,source:'Nasdaq historical API · corporate actions unavailable',retrievedAt:asOf,availableAt:asOf };
}

export async function intradayMarketData(symbol:string,asOf=new Date().toISOString()):Promise<ChartPayload>{
 const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m&includePrePost=false&events=div%2Csplits`;
 const payload=await fetchJson(url,6000,60_000);
 const result=parseYahooIntraday(payload,asOf);
 if(result.points.length<2)throw Error(`${symbol}: لا تتوفر نقطتان لحظيتان موثقتان لهذه الجلسة`);
 return result;
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
    // Fetch bounded groups; eight consecutive request timeouts used to hold a
    // single company file open for more than a minute.
    for (let offset=0;offset<filings.length;offset+=4) await Promise.all(filings.slice(offset,offset+4).map(async filing => {
      const accessionPath = filing.accession.replaceAll('-', '');
      const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionPath}/${filing.document}`;
      const xml = await fetch(url, { headers: requestHeaders(url), signal: AbortSignal.timeout(8_000) }).then(response => response.ok ? response.text() : '').catch(() => '');
      if (!xml) {recordProviderIssue(`SEC Form 4 ${filing.accession}: document unavailable`);return;}
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
    }));
    return parsed.sort((a,b)=>b.date.localeCompare(a.date)||(a.source??'').localeCompare(b.source??'')||a.owner.localeCompare(b.owner)).slice(0, 20);
  } catch { return []; }
}

export async function companySnapshot(company: Company): Promise<Snapshot> {
  const now = new Date().toISOString(), symbol = company.ticker, cik = String(company.cik).padStart(10, '0'), issues: string[] = [];
  // Independent enrichment starts together. Every rejection is handled here,
  // even when another provider fails or the company is outside screening size.
  const factsUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  const factsPromise=fetchJson(factsUrl).then(value=>({value:value as {facts:Record<string,unknown>},error:null}),error=>({value:null,error}));
  const profilePromise=yahooCompanyProfile(symbol);
  const summaryPromise = fetchJson(`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/summary?assetclass=stocks`, 8_000).catch(error => {issues.push(`Nasdaq summary: ${error.message}`);return null;}) as Promise<any>;
  const newsPromise = fetch(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`, { headers: { 'User-Agent': browserAgent, Accept: 'application/rss+xml,text/xml' }, signal: AbortSignal.timeout(8_000) }).then(r => {if(!r.ok)throw Error(`HTTP ${r.status}`);return r.text();}).catch(error => {issues.push(`Yahoo news: ${error.message}`);return '';});
  const insiderPromise = fetchInsiderPurchases(company.cik);
  let history: NonNullable<Snapshot['history']> = [], historyUrl = NASDAQ_SCREENER,historySource='Nasdaq screener · bundled dated fallback',historyRetrievedAt=bundledUniverse.generatedAt;
  try {
    const result = await historicalMarketData(symbol, now); historyUrl = result.url;historySource=result.source;historyRetrievedAt=result.retrievedAt;
    history = result.history.map((row) => ({ date: row.date, close: row.close!, open: row.open ?? undefined, high: row.high ?? undefined, low: row.low ?? undefined, volume: row.volume ?? undefined }));
  } catch (error) { issues.push(`تعذّر تحميل تاريخ Nasdaq: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`) }

  const last = history.at(-1), quoteDate = last?.date ?? bundledUniverse.generatedAt.slice(0, 10), quoteAvailableAt = last ? `${last.date}T21:00:00.000Z` : bundledUniverse.generatedAt;
  const quoteEvidence: Provenance = { source: historySource, url: historyUrl, periodEnd: quoteDate, availableAt: quoteAvailableAt > now ? now : quoteAvailableAt, retrievedAt: historyRetrievedAt, currency: 'USD', confidence: historySource.includes('fallback')?'low':'medium' };
  const price = last?.close ?? company.price ?? null;
  const snapshot: Snapshot = { symbol, name: company.name, cik: company.cik, description: 'الوصف غير متاح من مصدر موثق لهذه اللقطة.', asOf: now, exchange: company.exchange, sector: company.sector, industry: company.industry, securityType: commonSecurity(company.name) ? 'common' : 'unknown', price, marketCap: company.marketCap ?? null, confidence: 'C', deathSpiral: 'unknown', provenance: {}, history, dataIssues: issues, research: { financials: false, valuation: false, analysts: false, sector: !!company.sector } };

  if (price != null) snapshot.provenance.price = quoteEvidence;
  if(history.length>1&&history.at(-2)!.close>0){snapshot.dailyChange=history.at(-1)!.close/history.at(-2)!.close-1;snapshot.provenance.dailyChange={...quoteEvidence,tag:'last close / previous close - 1'};}
  if(history.length)snapshot.provenance.history=quoteEvidence;
  if (snapshot.marketCap != null) snapshot.provenance.marketCap = { source: 'Nasdaq stock screener (official)', url: NASDAQ_SCREENER, periodEnd: bundledUniverse.generatedAt.slice(0, 10), availableAt: bundledUniverse.generatedAt, retrievedAt: now, currency: 'USD', confidence: 'medium' };
  const [summaryResult, newsResult, insiderPurchases] = await Promise.all([summaryPromise, newsPromise, insiderPromise]);
  const summary = summaryResult?.data?.summaryData ?? {};
  const summaryValue = (key: string) => String(summary[key]?.value ?? '').trim();
  const summaryEvidence:Provenance={source:'Nasdaq quote summary · observed',url:`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/summary?assetclass=stocks`,periodEnd:now.slice(0,10),availableAt:now,retrievedAt:now,confidence:'medium'};
  const currentCap=numeric(summaryValue('MarketCap'));
  if(currentCap!=null&&currentCap>0){snapshot.marketCap=currentCap;snapshot.provenance.marketCap={...summaryEvidence,currency:'USD'};}
  const target = numeric(summaryValue('OneYrTarget'));
  if (target != null) { snapshot.analystTarget = target; snapshot.provenance.analystTarget = { ...summaryEvidence,source: 'Nasdaq quote summary (official) · OneYrTarget, not a verified mean',currency:'USD' }; }
  const range = summaryValue('FiftTwoWeekHighLow').match(/\$?([\d.]+)\s*\/\s*\$?([\d.]+)/);
  if (range) { snapshot.high52w ??= Number(range[1]); snapshot.low52w ??= Number(range[2]);snapshot.provenance.high52w=summaryEvidence;snapshot.provenance.low52w=summaryEvidence; }
  const summarySector = summaryValue('Sector'), summaryIndustry = summaryValue('Industry');
  if (summarySector) snapshot.sector = summarySector;
  if (summaryIndustry) snapshot.industry = summaryIndustry;
  snapshot.news = parseNews(newsResult,now);
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
  const cached = (quickCache.symbols as Record<string, CachedQuick>)[symbol];
  const factsResult=await factsPromise;
  if (cached && !factsResult.value) {
    snapshot.dataIssues?.push('SEC Company Facts غير متاح؛ استُخدمت أساسيات احتياطية مؤرخة.');
    Object.assign(snapshot as unknown as Record<string, unknown>, cached.financials);
    Object.assign(snapshot.provenance, cached.provenance);
    const operational = snapshot as Snapshot & { ocf?: number; capex?: number };
    delete operational.ocf; delete operational.capex;
    if (snapshot.marketCap && snapshot.revenue && snapshot.revenue > 0) {
      snapshot.ps = snapshot.marketCap / snapshot.revenue;
      snapshot.provenance.ps = { ...snapshot.provenance.revenue, source: 'Derived: market cap / SEC cached revenue', availableAt: [snapshot.provenance.marketCap.availableAt, snapshot.provenance.revenue.availableAt].sort().at(-1)!, confidence: 'low' };
    }
    await enrichWithYahooProfile(snapshot, symbol, now, profilePromise);
    snapshot.research = { financials: !!snapshot.revenue, valuation: snapshot.evSales != null || snapshot.ps != null, analysts: snapshot.analystTarget != null, sector: !!snapshot.sector };
    return snapshot;
  }

  let facts: Record<string, unknown>;
  try { if(!factsResult.value?.facts)throw factsResult.error??Error('SEC facts unavailable');facts=factsResult.value.facts; }
  catch (error) {
    snapshot.dataIssues?.push(`تعذّر جلب البيانات المالية من SEC: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`);
    // SEC failure must not short-circuit independent deep-profile sources.
    // Keep missing financials as UNKNOWN while still attempting profile,
    // earnings and analyst data on demand.
    await enrichWithYahooProfile(snapshot, symbol, now, profilePromise);
    snapshot.research = { financials: false, valuation: snapshot.evSales != null || snapshot.ps != null, analysts: snapshot.analystTarget != null, sector: !!snapshot.sector };
    return snapshot;
  }

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
  for (const [key, tags] of Object.entries({ revenue: [...REVENUE_TAGS, 'Revenue'], netIncome: ['NetIncomeLoss', 'ProfitLoss'], ocf: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations', 'NetCashFlowsFromUsedInOperatingActivities'], capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquirePropertyPlantAndEquipmentContinuingOperations', 'PurchaseOfPropertyPlantAndEquipment'] })) {
    const annual = trailingAnnual(observations(facts, tags), now);
    if (annual) { (snapshot as unknown as Record<string, unknown>)[key] = annual.val; snapshot.provenance[key] = provenance(annual, factsUrl, now); if (['20-F', '40-F'].includes(annual.form)) snapshot.foreignFiler = true }
  }
  const operational = snapshot as Snapshot & { ocf?: number; capex?: number };
  if (operational.ocf != null && operational.capex != null && snapshot.provenance.ocf.periodEnd === snapshot.provenance.capex.periodEnd && snapshot.provenance.ocf.periodStart===snapshot.provenance.capex.periodStart) {
    snapshot.fcf = operational.ocf - Math.abs(operational.capex);
    snapshot.provenance.fcf = { ...snapshot.provenance.ocf, tag: 'OperatingCashFlow − PaymentsToAcquirePropertyPlantAndEquipment', availableAt: [snapshot.provenance.ocf.availableAt, snapshot.provenance.capex.availableAt].sort().at(-1)! };
  }
  delete operational.ocf; delete operational.capex;
  if (snapshot.marketCap && snapshot.revenue && snapshot.revenue > 0) {
    snapshot.ps = snapshot.marketCap / snapshot.revenue;
    snapshot.provenance.ps = { ...snapshot.provenance.revenue, source: 'Derived: market cap / SEC revenue', availableAt: [snapshot.provenance.marketCap.availableAt, snapshot.provenance.revenue.availableAt].sort().at(-1)!, confidence: 'low' };
  }
  await enrichWithYahooProfile(snapshot, symbol, now, profilePromise);
  snapshot.research = { financials: !!snapshot.revenue, valuation: snapshot.evSales != null || snapshot.ps != null, analysts: snapshot.analystTarget != null, sector: !!snapshot.sector };
  return enrichFinancials(snapshot,facts,factsUrl);
}

export function parseNews(xml:string,asOf:string) {
  const strip=(value:string)=>value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
  const seen=new Set<string>();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match=>{
    const read=(tag:string)=>strip(match[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,'i'))?.[1]??'');
    const date=Date.parse(read('pubDate'));
    return {title:read('title'),link:read('link'),publishedAt:Number.isFinite(date)?new Date(date).toISOString():'',source:'Yahoo Finance RSS'};
  }).filter(item=>{
    if(!item.title||!item.publishedAt||Date.parse(item.publishedAt)>Date.parse(asOf)||seen.has(item.link))return false;
    try{if(!['https:','http:'].includes(new URL(item.link).protocol))return false;}catch{return false;}
    seen.add(item.link);return true;
  }).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,8);
}
