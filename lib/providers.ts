import type { Snapshot, Provenance, InsiderPurchase } from './engine';
import { NON_TRADABLE_NAME } from './strategy-spec';
import { completedSessionQuote, ma30Weeks } from './research';
import { observations, latestInstant, trailingAnnual, provenance, REVENUE_TAGS } from './sec';
import bundledUniverse from './universe.generated.json';
import quickCache from './quick-cache.generated.json';
import bundledFrames from './sec-frames.generated.json';
import {enrichFinancials} from './financials';
import {parseYahooIntraday,type ChartPayload} from './chart-data';
import {parseOfficialDirectory} from './directory';
import { translateSnapshotContent } from './translation';
import { applyFinancingRisk } from './financing-risk';
import { derivedEvidence } from './evidence';

export type Company = { cik: number; name: string; ticker: string; exchange: string; price?: number; dailyChange?: number; intradayChange?: number; marketCap?: number; volume?: number; averageVolume10d?: number; return52w?: number; low52w?: number; high52w?: number; ma50d?: number; ma200d?: number; sector?: string; industry?: string; quoteSource?: string; quoteAvailableAt?: string; priceSource?:string; priceAvailableAt?:string; marketCapSource?:string; marketCapAvailableAt?:string };
type NasdaqRow = { symbol: string; name?: string; lastsale?: string; marketCap?: string; volume?: string; sector?: string; industry?: string };
type CachedQuick = { history: NonNullable<Snapshot['history']>; financials: Record<string, number>; provenance: Record<string, Provenance>; issues: string[] };
type MarketBar = NonNullable<Snapshot['history']>[number];
type HistoricalResult = { url:string; history:MarketBar[]; splits:{date:string;factor:number}[]|null; source:string; retrievedAt:string; availableAt:string; meta?:any };

const NASDAQ_SCREENER = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true';
const NASDAQ_LISTED='https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
const OTHER_LISTED='https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';
const SEC_TICKERS='https://www.sec.gov/files/company_tickers.json';
const CBOE_BASE='https://cdn.cboe.com/api/global/delayed_quotes';
const YAHOO_HOSTS=['query1.finance.yahoo.com','query2.finance.yahoo.com'] as const;
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

// SEC fair-access guidance caps automated traffic at 10 requests/second. Keep
// one queue for both data.sec.gov and filing documents, with headroom for
// retries and other requests from the same Worker isolate.
const SEC_REQUEST_INTERVAL_MS = 125;
let secRequestQueue: Promise<void> = Promise.resolve();
let nextSecRequestAt = 0;
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitForProviderSlot(url: string) {
  const hostname=new URL(url).hostname;
  if (hostname!=='sec.gov'&&!hostname.endsWith('.sec.gov')) return;
  const slot = secRequestQueue.then(async () => {
    const delay = Math.max(0, nextSecRequestAt - Date.now());
    if (delay) await wait(delay);
    nextSecRequestAt = Date.now() + SEC_REQUEST_INTERVAL_MS;
  });
  secRequestQueue = slot.catch(() => undefined);
  await slot;
}

async function providerFetch(url: string, init?: RequestInit) {
  await waitForProviderSlot(url);
  return fetch(url, init);
}

async function fetchText(url:string,timeoutMs=4000){
 const response=await providerFetch(url,{headers:requestHeaders(url),signal:AbortSignal.timeout(timeoutMs)});
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
  const hostname=new URL(url).hostname;
  return hostname==='sec.gov'||hostname.endsWith('.sec.gov')
    ? { 'User-Agent': secAgent, Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' }
    : { 'User-Agent': browserAgent, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.nasdaq.com/' };
}

function retryAfterMilliseconds(value: string | null) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}
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
        const response = await providerFetch(url, { headers: requestHeaders(url), signal: AbortSignal.timeout(timeoutMs) });
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
        const retryAfterMs=retryAfterMilliseconds(response.headers.get('retry-after'));
        if(retryAfterMs>5_000){cooldowns.set(host,Date.now()+retryAfterMs);lastError=Error(`${host}: rate limited; retry after ${Math.ceil(retryAfterMs/1000)}s`);break;}
        if(attempt+1<attempts)await wait(Math.min(5000,Math.max(retryAfterMs, 250 * 2 ** attempt)));
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
  const base = (bundledUniverse.companies as Company[]).map((company) => ({ ...company, quoteSource: 'bundled official dated snapshot', quoteAvailableAt: bundledUniverse.generatedAt,priceSource:'bundled official dated snapshot',priceAvailableAt:bundledUniverse.generatedAt,marketCapSource:'bundled official dated snapshot',marketCapAvailableAt:bundledUniverse.generatedAt }));
  const [latestResult,directoryResult]=await Promise.allSettled([
    fetchJson(NASDAQ_SCREENER,3_000) as Promise<{data?:{rows?:NasdaqRow[]}}>,
    Promise.all([fetchText(NASDAQ_LISTED),fetchText(OTHER_LISTED),fetchJson(SEC_TICKERS,5000,6*60*60_000)]).then(([nasdaq,other,sec])=>parseOfficialDirectory(nasdaq,other,sec as Record<string,any>)),
  ]);
  let directory:Company[]=base;
  if(directoryResult.status==='fulfilled'&&directoryResult.value.length){
    const old=new Map(base.map(company=>[company.ticker,company]));
    directory=directoryResult.value.map(company=>{
      const previous=old.get(company.ticker);
      return {...previous,...company,cik:company.cik||previous?.cik||0,quoteSource:previous?.quoteSource||'official live listing directory',quoteAvailableAt:previous?.quoteAvailableAt||new Date().toISOString()};
    });
  }else recordProviderIssue(`Official listing directory: ${directoryResult.status==='rejected'&&directoryResult.reason instanceof Error?directoryResult.reason.message:'empty response'}`);
  let nasdaq = directory;
  if(latestResult.status==='fulfilled'){
    const latest=latestResult.value;
    const quotes = new Map((latest.data?.rows ?? []).map((row) => [row.symbol, row]));
    nasdaq = directory.map(company=>{
      const patch=quotePatch(quotes.get(company.ticker));
      if(!Number.isFinite(patch.price)||!Number.isFinite(patch.marketCap))return company;
      const availableAt=new Date().toISOString();
      return {...company,...patch,quoteSource:'Nasdaq screener live',quoteAvailableAt:availableAt,priceSource:'Nasdaq screener live',priceAvailableAt:availableAt,marketCapSource:'Nasdaq screener live',marketCapAvailableAt:availableAt};
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

/** Yahoo represents US share-class dots with dashes (for example BRK.B). */
export const yahooSymbol = (symbol: string) => symbol.trim().toUpperCase().replaceAll('.', '-');

async function yahooChartPayload(symbol:string,query:string,timeoutMs=3_000){
 let last:unknown;
 for(const host of YAHOO_HOSTS){
  const url=`https://${host}/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?${query}`;
  try{return {payload:await fetchJson(url,timeoutMs,86_400_000,1),url};}
  catch(error){last=error;recordProviderIssue(`${symbol}: Yahoo chart ${host} failed: ${error instanceof Error?error.message:'provider request failed'}`);}
 }
 throw last instanceof Error?last:Error(`${symbol}: Yahoo chart unavailable`);
}

async function yahooCompanyProfile(symbol: string) {
  try {
    const auth = await yahooAuth();
    const modules = 'assetProfile,calendarEvents,earningsHistory,earningsTrend,financialData';
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol(symbol))}?modules=${modules}&crumb=${encodeURIComponent(auth.crumb)}`;
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
        const symbols = chunk.map((company) => yahooSymbol(company.ticker)).join(',');
        const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&crumb=${encodeURIComponent(auth.crumb)}`;
        const response = await fetch(url, { headers: { 'User-Agent': browserAgent, Cookie: auth.cookie, Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) });
        if (!response.ok) throw Error(`Yahoo quote HTTP ${response.status}`);
        return response.json() as Promise<{ quoteResponse?: { result?: any[] } }>;
      }));
      for (const payload of payloads) {
        if(payload.status==='fulfilled')for(const quote of payload.value.quoteResponse?.result??[])quoteMap.set(yahooSymbol(String(quote.symbol||'')),quote);
        else recordProviderIssue(`Yahoo quote batch: ${payload.reason instanceof Error?payload.reason.message:'request failed'}`);
      }
    }
    if (quoteMap.size < Math.min(100, companies.length / 2)) recordProviderIssue('Yahoo bulk coverage low; retained successful chunks and dated fallback rows');
    return companies.map((company) => {
      const quote = quoteMap.get(yahooSymbol(company.ticker));
      // A quote is still useful when Yahoo omits market-cap metadata (common for
      // thinly traded or newly listed symbols).  Requiring both fields made a
      // valid live price fall back to the dated bundled snapshot.
      if (!quote||!Number.isFinite(quote.regularMarketPrice)||quote.regularMarketPrice<=0) return company;
      const marketTime=Number(quote.regularMarketTime),validMarketTime=Number.isFinite(marketTime)&&marketTime>0&&marketTime*1000<=Date.now()+5*60_000;
      if(!validMarketTime)return company;
      return {
        ...company,
        quoteSource: 'Yahoo bulk quote live',
        quoteAvailableAt: new Date(marketTime*1000).toISOString(),
        priceSource:'Yahoo bulk quote live',
        priceAvailableAt:new Date(marketTime*1000).toISOString(),
        price: quote.regularMarketPrice,
        // This is a live/session-to-date move. It must not populate the
        // Snapshot.dailyChange field, whose contract is the last completed
        // close-to-close session used by radar cards and company profiles.
        intradayChange:Number.isFinite(quote.regularMarketChangePercent)&&quote.regularMarketChangePercent>-100?quote.regularMarketChangePercent/100:undefined,
        ...(Number.isFinite(quote.marketCap)&&quote.marketCap>0 ? { marketCap: quote.marketCap,marketCapSource:'Yahoo bulk quote live',marketCapAvailableAt:new Date(marketTime*1000).toISOString() } : {}),
        volume:Number.isFinite(quote.regularMarketVolume)&&quote.regularMarketVolume>=0?quote.regularMarketVolume:undefined,
        averageVolume10d:Number.isFinite(quote.averageDailyVolume10Day)&&quote.averageDailyVolume10Day>=0?quote.averageDailyVolume10Day:undefined,
        // Yahoo exposes this field in percentage points (for example 25.4 means
        // 25.4%), while the scoring engine consistently stores returns as ratios.
        return52w:Number.isFinite(quote.fiftyTwoWeekChangePercent)?yahooPercentAsRatio(quote.fiftyTwoWeekChangePercent):undefined,
        low52w:Number.isFinite(quote.fiftyTwoWeekLow)&&quote.fiftyTwoWeekLow>0?quote.fiftyTwoWeekLow:undefined,
        high52w:Number.isFinite(quote.fiftyTwoWeekHigh)&&quote.fiftyTwoWeekHigh>0?quote.fiftyTwoWeekHigh:undefined,
        ma50d:Number.isFinite(quote.fiftyDayAverage)&&quote.fiftyDayAverage>0?quote.fiftyDayAverage:undefined,
        ma200d:Number.isFinite(quote.twoHundredDayAverage)&&quote.twoHundredDayAverage>0?quote.twoHundredDayAverage:undefined,
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

function applyBundledFundamentals(snapshot:Snapshot,cik:number,now:string){
 const facts=(bundledFrames as any).fundamentals?.[String(cik)];
 if(!facts)return false;
 const url=(fact:any)=>fact?.url||'https://data.sec.gov/api/xbrl/frames';
 const evidence=(fact:any,key:string):Provenance=>({source:'SEC EDGAR Frames · bundled official dated snapshot',url:url(fact),periodStart:fact?.start,periodEnd:fact?.end||now.slice(0,10),availableAt:(bundledFrames as any).generatedAt,retrievedAt:now,currency:'USD',tag:fact?.tag||key,confidence:'low'});
 const assign=(key:keyof Snapshot,fact:any)=>{if(fact&&Number.isFinite(fact.val)){(snapshot as any)[key]=fact.val;snapshot.provenance[String(key)]=evidence(fact,String(key));}};
 assign('revenue',facts.revenue);assign('netIncome',facts.netIncome);assign('cash',facts.cash);
 if(facts.debtCurrent&&facts.debtNoncurrent&&facts.debtCurrent.end===facts.debtNoncurrent.end){snapshot.debt=facts.debtCurrent.val+facts.debtNoncurrent.val;snapshot.provenance.debt=derivedEvidence('SEC Frames bundled debt components',[evidence(facts.debtCurrent,'debtCurrent'),evidence(facts.debtNoncurrent,'debtNoncurrent')],now,'current + noncurrent debt')!;}
 if(facts.ocf&&facts.capex&&facts.ocf.end===facts.capex.end&&facts.ocf.start===facts.capex.start){snapshot.fcf=facts.ocf.val-Math.abs(facts.capex.val);snapshot.provenance.fcf=derivedEvidence('SEC Frames bundled cash flows',[evidence(facts.ocf,'ocf'),evidence(facts.capex,'capex')],now,'operating cash flow − capital expenditure')!;}
 if(snapshot.marketCap!=null&&snapshot.revenue!=null&&snapshot.revenue>0){snapshot.ps=snapshot.marketCap/snapshot.revenue;snapshot.provenance.ps=derivedEvidence('SEC Frames bundled revenue + live market cap',[snapshot.provenance.revenue,snapshot.provenance.marketCap],now,'market cap / revenue')!;}
 if(snapshot.marketCap!=null&&snapshot.revenue!=null&&snapshot.revenue>0&&snapshot.debt!=null&&snapshot.cash!=null){snapshot.evSales=(snapshot.marketCap+snapshot.debt-snapshot.cash)/snapshot.revenue;snapshot.provenance.evSales=derivedEvidence('SEC Frames bundled revenue, cash, debt + live market cap',[snapshot.provenance.revenue,snapshot.provenance.cash,snapshot.provenance.debt,snapshot.provenance.marketCap],now,'(market cap + debt − cash) / revenue')!;}
 if(facts.shares&&facts.priorShares&&facts.priorShares.val>0){snapshot.shareCountRatio=facts.shares.val/facts.priorShares.val;snapshot.dilution=snapshot.shareCountRatio-1;snapshot.splitAdjusted=false;snapshot.provenance.dilution=derivedEvidence('SEC Frames bundled share count comparison',[evidence(facts.shares,'shares'),evidence(facts.priorShares,'priorShares')],now,'current / prior − 1')!;snapshot.provenance.shareCountRatio=snapshot.provenance.dilution;}
 snapshot.dataIssues?.push('SEC Company Facts المباشر غير متاح؛ استُخدمت لقطة SEC Frames الرسمية المؤرخة من الإصدار.');
 return true;
}

type RecentSecSubmission={form:string;accession:string;document:string;filed:string;reportDate?:string};
function recentSubmissions(payload:any):RecentSecSubmission[]{
 const recent=payload?.filings?.recent;
 if(!recent?.form||!recent.accessionNumber||!recent.primaryDocument)return [];
 return recent.form.map((form:string,index:number):RecentSecSubmission=>({form,accession:recent.accessionNumber[index],document:recent.primaryDocument[index],filed:recent.filingDate?.[index]??'',reportDate:recent.reportDate?.[index]})).filter((row:RecentSecSubmission)=>row.accession&&row.document&&row.filed);
}

/** Convert the official SEC submissions index into dated filing items when a
 * third-party news feed is empty. Filing metadata is not presented as news
 * sentiment; it is a sourced company event that keeps the profile useful. */
export function parseSecFilingNews(payload:any,cik:number,asOf:string){
 const base=`https://www.sec.gov/Archives/edgar/data/${cik}`;
 return recentSubmissions(payload).filter(row=>['8-K','10-K','10-K/A','10-Q','10-Q/A','6-K','20-F','20-F/A','40-F','40-F/A'].includes(row.form)&&Date.parse(row.filed+'T23:59:59Z')<=Date.parse(asOf)).slice(0,12).map(row=>({title:`SEC filing: ${row.form} filed ${row.filed}`,link:`${base}/${row.accession.replaceAll('-','')}/${row.document}`,publishedAt:`${row.filed}T23:59:59Z`,source:'SEC EDGAR filings'}));
}

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
  const priceValue=(field:string)=>{const n=numeric(quote[field]?.[index]);return n!=null&&n>0?n:undefined};
  const volume=numeric(quote.volume?.[index]);
  let open=priceValue('open'),high=priceValue('high'),low=priceValue('low');
  if ((high!=null && high<Math.max(close,open??close,low??close)) || (low!=null && low>Math.min(close,open??close,high??close))) {
    open=undefined;high=undefined;low=undefined;
  }
  bars.set(date,{date,close,open,high,low,volume:volume!=null&&volume>=0?volume:undefined});
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

export function parseCboeDaily(payload:any,from:string,to:string):MarketBar[]{
 const rows:Array<{date:string;close:number|null;open?:number;high?:number;low?:number;volume?:number}>=(Array.isArray(payload?.data)?payload.data:[]).map((row:any)=>({date:String(row.date??''),close:numeric(row.close),open:numeric(row.open)??undefined,high:numeric(row.high)??undefined,low:numeric(row.low)??undefined,volume:numeric(row.volume)??undefined}));
 return rows.filter((row):row is {date:string;close:number;open?:number;high?:number;low?:number;volume?:number}=>/^\d{4}-\d{2}-\d{2}$/.test(row.date)&&row.date>=from&&row.date<=to&&row.close!=null&&row.close>0).sort((a,b)=>a.date.localeCompare(b.date));
}

export async function historicalMarketData(symbol: string, asOf = new Date().toISOString(), days = 1900):Promise<HistoricalResult> {
  const cached = (quickCache.symbols as Record<string, CachedQuick>)[symbol];
  const to = asOf.slice(0, 10), from = dateOffset(asOf, -days);
  const period1=Math.floor(Date.parse(`${from}T00:00:00Z`)/1000),period2=Math.floor(Date.parse(`${to}T00:00:00Z`)/1000)+86400;
  const yahooQuery=`period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
  try{
   const result=await yahooChartPayload(symbol,yahooQuery),parsed=parseYahooDaily(result.payload,asOf);
   if(parsed.history.length){
    const retrievedAt=new Date().toISOString(),lastDate=parsed.history.at(-1)!.date;
    return {url:result.url,...parsed,meta:result.payload?.chart?.result?.[0]?.meta,source:'Yahoo Finance chart API · split-adjusted daily history and split events',retrievedAt,availableAt:`${lastDate}T21:00:00.000Z`};
   }
  }catch(error){recordProviderIssue(`${symbol}: Yahoo daily history unavailable: ${error instanceof Error?error.message:String(error)}; trying Nasdaq`);}
  const cboeUrl=`${CBOE_BASE}/charts/historical/${encodeURIComponent(symbol.toUpperCase())}.json`;
  try {
   const payload=await fetchJson(cboeUrl,5_000,86_400_000,2) as {data?:Array<Record<string,unknown>>};
   const history=parseCboeDaily(payload,from,to);
   if(history.length){const retrievedAt=new Date().toISOString();return {url:cboeUrl,history,splits:null,source:'Cboe delayed historical API · independent no-key fallback',retrievedAt,availableAt:`${history.at(-1)!.date}T21:00:00.000Z`};}
   throw Error('Cboe returned no usable sessions');
  } catch(error) { recordProviderIssue(`${symbol}: Cboe historical unavailable: ${error instanceof Error?error.message:'provider request failed'}; trying Nasdaq`); }
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
  return { url, history:history as MarketBar[], splits:null,source:'Nasdaq historical API · corporate actions unavailable',retrievedAt:new Date().toISOString(),availableAt:`${history.at(-1)!.date}T21:00:00.000Z` };
}

export async function intradayMarketData(symbol:string,asOf=new Date().toISOString()):Promise<ChartPayload>{
 const response=await yahooChartPayload(symbol,'range=1d&interval=5m&includePrePost=false&events=div%2Csplits',6000);
 const parsed=parseYahooIntraday(response.payload,asOf);
 if(parsed.points.length<2)throw Error(`${symbol}: لا تتوفر نقطتان لحظيتان موثقتان لهذه الجلسة`);
 return parsed;
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
      const xml = await providerFetch(url, { headers: requestHeaders(url), signal: AbortSignal.timeout(8_000) }).then(response => response.ok ? response.text() : '').catch(() => '');
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
  const newsPromise = fetch(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(yahooSymbol(symbol))}&region=US&lang=en-US`, { headers: { 'User-Agent': browserAgent, Accept: 'application/rss+xml,text/xml' }, signal: AbortSignal.timeout(8_000) }).then(r => {if(!r.ok)throw Error(`HTTP ${r.status}`);return r.text();}).catch(error => {issues.push(`Yahoo news: ${error.message}`);return '';});
  const googleNewsPromise = fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(`\"${symbol}\" stock`)}&hl=en-US&gl=US&ceid=US:en`, { headers: { 'User-Agent': browserAgent, Accept: 'application/rss+xml,text/xml' }, signal: AbortSignal.timeout(8_000) }).then(r => {if(!r.ok)throw Error(`HTTP ${r.status}`);return r.text();}).catch(error => {issues.push(`Google News RSS: ${error.message}`);return '';});
  const filingsPromise = fetchJson(submissionsUrlFor(company.cik),8_000).catch(error => {issues.push(`SEC submissions: ${error instanceof Error?error.message:'provider request failed'}`);return null;});
  const insiderPromise = fetchInsiderPurchases(company.cik);
  let history: NonNullable<Snapshot['history']> = [], historyUrl = NASDAQ_SCREENER,historySource='Nasdaq screener · bundled dated fallback',historyRetrievedAt=bundledUniverse.generatedAt,chartMeta:any=null;
  try {
    const result = await historicalMarketData(symbol, now); historyUrl = result.url;historySource=result.source;historyRetrievedAt=result.retrievedAt;chartMeta=(result as any).meta??null;
    history = result.history.map((row) => ({ date: row.date, close: row.close!, open: row.open ?? undefined, high: row.high ?? undefined, low: row.low ?? undefined, volume: row.volume ?? undefined }));
  } catch (error) { issues.push(`تعذّر تحميل تاريخ Nasdaq: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`) }

  const last = history.at(-1), quoteDate = last?.date ?? bundledUniverse.generatedAt.slice(0, 10), quoteAvailableAt = last ? `${last.date}T21:00:00.000Z` : bundledUniverse.generatedAt;
  const quoteEvidence: Provenance = { source: historySource, url: historyUrl, periodEnd: quoteDate, availableAt: quoteAvailableAt > now ? now : quoteAvailableAt, retrievedAt: historyRetrievedAt, currency: 'USD', confidence: historySource.includes('fallback')?'low':'medium' };
  const price = last?.close ?? company.price ?? null;
  const snapshot: Snapshot = { symbol, name: company.name, cik: company.cik, description: 'الوصف غير متاح من مصدر موثق لهذه اللقطة.', asOf: now, exchange: company.exchange, sector: company.sector, industry: company.industry, securityType: commonSecurity(company.name) ? 'common' : 'unknown', price, marketCap: company.marketCap ?? null, confidence: 'C', deathSpiral: 'unknown', provenance: {}, history, dataIssues: issues, research: { financials: false, valuation: false, analysts: false, sector: !!company.sector } };

  // Yahoo chart metadata is available without a crumb and supplies a useful
  // identity/quote fallback even when quoteSummary is blocked.
  if (chartMeta?.longName && !snapshot.name) snapshot.name=String(chartMeta.longName);
  if (!snapshot.exchange && chartMeta?.exchangeName) snapshot.exchange=String(chartMeta.exchangeName);
  const chartPrice=numeric(chartMeta?.regularMarketPrice);
  if (snapshot.price==null && chartPrice!=null && chartPrice>0) {
    snapshot.price=chartPrice;
    snapshot.provenance.price={source:'Yahoo Finance chart metadata',url:historyUrl,periodEnd:quoteDate,availableAt:quoteAvailableAt,retrievedAt:historyRetrievedAt,currency:'USD',confidence:'medium'};
  }

  const session=completedSessionQuote(history);
  if (price != null) snapshot.provenance.price = {...quoteEvidence,tag:'last completed session close'};
  if(session){snapshot.price=session.price;snapshot.dailyChange=session.dailyChange;snapshot.provenance.price={...quoteEvidence,periodEnd:session.periodEnd,tag:'last completed session close'};snapshot.provenance.dailyChange={...quoteEvidence,periodEnd:session.periodEnd,tag:'last completed close / previous completed close - 1'};}
  if(history.length)snapshot.provenance.history=quoteEvidence;
  if (snapshot.marketCap != null) {const availableAt=company.marketCapAvailableAt||company.quoteAvailableAt||bundledUniverse.generatedAt,source=company.marketCapSource||company.quoteSource||'Nasdaq stock screener';snapshot.provenance.marketCap = { source, url: NASDAQ_SCREENER, periodEnd: availableAt.slice(0, 10), availableAt, retrievedAt: now, currency: 'USD', confidence: source.includes('bundled') ? 'low' : 'medium' };}
  const [summaryResult, newsResult, googleNewsResult, insiderPurchases, filingsResult] = await Promise.all([summaryPromise, newsPromise, googleNewsPromise, insiderPromise, filingsPromise]);
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
  const rssNews=parseNews(newsResult,now,'Yahoo Finance RSS');
  const fallbackNews=rssNews.length?[]:parseNews(googleNewsResult,now,'Google News RSS');
  const filingNews=parseSecFilingNews(filingsResult,company.cik,now);
  snapshot.news=[...rssNews,...fallbackNews,...filingNews].filter((item,index,array)=>array.findIndex(other=>other.link===item.link)===index).sort((a,b)=>(b.publishedAt??'').localeCompare(a.publishedAt??'')).slice(0,8);
  if(snapshot.news.length){const newsSource=rssNews.length?'Yahoo Finance RSS':fallbackNews.length?'Google News RSS':'SEC EDGAR filing index';snapshot.provenance.news={source:`${newsSource}${filingNews.length?' + SEC EDGAR filing index':''}`,url:rssNews.length?'https://feeds.finance.yahoo.com/':fallbackNews.length?'https://news.google.com/rss/':'https://www.sec.gov/edgar/searchedgar/companysearch',periodEnd:snapshot.news[0].publishedAt?.slice(0,10)||now.slice(0,10),availableAt:snapshot.news[0].publishedAt||now,retrievedAt:now,confidence:rssNews.length?'medium':fallbackNews.length?'low':'high'};}
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
    return translateSnapshotContent(applyFinancingRisk(snapshot));
  }

  let facts: Record<string, unknown>;
  try { if(!factsResult.value?.facts)throw factsResult.error??Error('SEC facts unavailable');facts=factsResult.value.facts; }
  catch (error) {
    snapshot.dataIssues?.push(`تعذّر جلب البيانات المالية من SEC: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`);
    // SEC failure must not short-circuit independent deep-profile sources.
    // Keep missing financials as UNKNOWN while still attempting profile,
    // earnings and analyst data on demand.
    const bundledRecovered=applyBundledFundamentals(snapshot,company.cik,now);
    await enrichWithYahooProfile(snapshot, symbol, now, profilePromise);
    snapshot.research = { financials: bundledRecovered||!!snapshot.revenue, valuation: snapshot.evSales != null || snapshot.ps != null, analysts: snapshot.analystTarget != null, sector: !!snapshot.sector };
    return translateSnapshotContent(applyFinancingRisk(snapshot));
  }

  const shares = latestInstant(observations(facts, ['EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding'], 'shares'), now);
  // SEC shares can represent all common classes while this quote represents
  // one listed class. Use the product only as a missing-cap fallback; never
  // overwrite a provider's security-level market capitalization.
  if (snapshot.marketCap == null && shares && price && Date.parse(now) - Date.parse(shares.end) < 120 * 86_400_000) {
    snapshot.marketCap = shares.val * price;
    snapshot.provenance.marketCap = { ...provenance(shares, factsUrl, now), source: 'Derived: SEC reported shares × Nasdaq price', availableAt: [provenance(shares, factsUrl, now).availableAt, quoteEvidence.availableAt].sort().at(-1)!, confidence: 'low' };
  }
  const revenueRows = observations(facts, REVENUE_TAGS).filter(row => Date.parse(row.filed+'T23:59:59Z') <= Date.parse(now));
  const quarterly = revenueRows.filter(row => row.start && ['10-Q','10-Q/A'].includes(row.form)).map(row => ({ ...row, days: (Date.parse(row.end)-Date.parse(row.start!))/864e5 })).filter(row => row.days >= 70 && row.days <= 115).sort((a,b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
  const seenQuarters = new Set<string>();
  const selectedQuarters=quarterly.filter(row => { if (seenQuarters.has(row.end)) return false; seenQuarters.add(row.end); return true; }).slice(0, 6).reverse();
  snapshot.revenueTrend = selectedQuarters.map(row => ({ quarter: row.end.slice(0, 7), value: row.val, periodEnd: row.end }));
  if (snapshot.revenueTrend.length > 0) snapshot.provenance.revenueTrend = { source: 'SEC EDGAR XBRL quarterly revenue', url: factsUrl, periodEnd: snapshot.revenueTrend.at(-1)!.periodEnd || now.slice(0, 10), availableAt: `${selectedQuarters.map(row=>row.filed).sort().at(-1)}T23:59:59Z`, retrievedAt: now, currency: 'USD', tag: 'quarterly revenue', confidence: 'high' };
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
  return translateSnapshotContent(applyFinancingRisk(enrichFinancials(snapshot,facts,factsUrl)));
}

export function parseNews(xml:string,asOf:string,defaultSource='Yahoo Finance RSS') {
  const strip=(value:string)=>value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
  const seen=new Set<string>();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match=>{
    const read=(tag:string)=>strip(match[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,'i'))?.[1]??'');
    const date=Date.parse(read('pubDate'));
    return {title:read('title'),link:read('link'),publishedAt:Number.isFinite(date)?new Date(date).toISOString():'',source:read('source')||defaultSource};
  }).filter(item=>{
    if(!item.title||!item.publishedAt||Date.parse(item.publishedAt)>Date.parse(asOf)||seen.has(item.link))return false;
    try{if(!['https:','http:'].includes(new URL(item.link).protocol))return false;}catch{return false;}
    seen.add(item.link);return true;
  }).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,8);
}
