import {completeDirectoryFiles,readCompleteDirectory,saveCompleteDirectory,previouslyTrackedCompanies} from './directory-cache';
import {readSecArtifact,recordSecArtifact,secArtifactCik} from './sec-artifact-cache';
import {persistFilingDocument} from './filing-observations';
import { reserveProviderRequest } from './provider-quota';
import type { Snapshot, Provenance, InsiderPurchase, SecFilingResearch } from './engine';
import { completedSessionQuote, ma30Weeks, reviewShareSplits } from './research';
import { observations, latestInstant, trailingAnnual, provenance, REVENUE_TAGS } from './sec';
import bundledUniverse from './universe.generated.json';
import quickCache from './quick-cache.generated.json';
import bundledFrames from './sec-frames.generated.json';
import {enrichFinancials} from './financials';
import {parseYahooIntraday,type ChartPayload} from './chart-data';
import {parseOfficialDirectory} from './directory';
import type {DirectoryCompany} from './directory';
import { translateSnapshotContent } from './translation';
import { applyFinancingRisk } from './financing-risk';
import { derivedEvidence } from './evidence';
import { buildSecEarningsQualityAssessment, buildSecFinancialStrengthInputs, classifySecCompanyFacts, classifySecIssuerModel } from './sec-opportunity';
import { buildTechnicalTimingResearch } from './opportunity-market';
import { secUserAgent } from './sec-user-agent';
import {alignSnapshotFinancials} from './financial-integrity';
import { convertEarningsPeriodsToUsd, convertFinancialMetricsToUsd, fetchEcbDailySeries, type EcbDailySeries } from './ecb-fx';

export type Company = { cik: number; name: string; ticker: string; exchange: string; securityType?:import('./directory').ListedSecurityType; securityName?:string; listingStatus?:'current'|'not-confirmed-current'; directoryUrl?:string; directoryAvailableAt?:string; price?: number; dailyChange?: number; intradayChange?: number; marketCap?: number; volume?: number; averageVolume10d?: number; return52w?: number; low52w?: number; high52w?: number; ma50d?: number; ma200d?: number; sector?: string; industry?: string; quoteSource?: string; quoteAvailableAt?: string; priceSource?:string; priceAvailableAt?:string; priceUrl?:string; marketCapSource?:string; marketCapAvailableAt?:string; marketCapUrl?:string };
type NasdaqRow = { symbol: string; name?: string; lastsale?: string; marketCap?: string; volume?: string; sector?: string; industry?: string };
type CachedQuick = { history: NonNullable<Snapshot['history']>; financials: Record<string, number>; provenance: Record<string, Provenance>; issues: string[] };
type MarketBar = NonNullable<Snapshot['history']>[number];
export type HistoricalResult = { url:string; history:MarketBar[]; splits:{date:string;factor:number}[]|null; source:string; retrievedAt:string; availableAt:string; meta?:any };

export const NASDAQ_SCREENER = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true';
const NASDAQ_LISTED='https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
const OTHER_LISTED='https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';
const SEC_TICKERS='https://www.sec.gov/files/company_tickers.json';
let listingDirectoryCache:{expiresAt:number;retrievedAt:string;rows:DirectoryCompany[];complete:boolean}|null=null;
let listingDirectoryFlight:Promise<{retrievedAt:string;rows:DirectoryCompany[];complete:boolean}>|null=null;
const CBOE_BASE='https://cdn.cboe.com/api/global/delayed_quotes';
const YAHOO_HOSTS=['query1.finance.yahoo.com','query2.finance.yahoo.com'] as const;
export const quickSymbols = Object.keys(quickCache.symbols);
const browserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36';
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
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitForProviderSlot(url: string) {
  const hostname=new URL(url).hostname;
  if (hostname!=='sec.gov'&&!hostname.endsWith('.sec.gov')) return;
  const delay=await reserveProviderRequest('SEC',SEC_REQUEST_INTERVAL_MS);
  if(delay>30_000)throw Error('SEC global request queue is saturated; retry from the durable checkpoint.');
  if(delay)await wait(delay);
}

async function providerFetch(url: string, init?: RequestInit) {
  const hostname=new URL(url).hostname;
  if ((hostname==='sec.gov'||hostname.endsWith('.sec.gov')) && !secUserAgent()) {
    throw Error('SEC request suppressed: SEC_USER_AGENT must contain a valid reachable contact email.');
  }
  await waitForProviderSlot(url);
  return fetch(url, init);
}

async function fetchText(url:string,timeoutMs=8000){
 const response=await providerFetch(url,{headers:{Accept:'text/plain'},signal:AbortSignal.timeout(timeoutMs)});
 if(!response.ok)throw Error(`${new URL(url).hostname}: HTTP ${response.status}`);
 return response.text();
}

async function fetchListingDirectory(){
 if(listingDirectoryCache&&listingDirectoryCache.expiresAt>Date.now())return listingDirectoryCache;
 if(listingDirectoryFlight)return listingDirectoryFlight;
 listingDirectoryFlight=Promise.allSettled([fetchText(NASDAQ_LISTED),fetchText(OTHER_LISTED),fetchJson(SEC_TICKERS,5000,6*60*60_000)])
  .then(results=>{
   const [nasdaqResult,otherResult,secResult]=results;
   if(nasdaqResult.status==='rejected')recordProviderIssue(`Nasdaq Trader listed directory: ${nasdaqResult.reason instanceof Error?nasdaqResult.reason.message:'provider request failed'}`);
   if(otherResult.status==='rejected')recordProviderIssue(`NYSE/NYSE American listed directory: ${otherResult.reason instanceof Error?otherResult.reason.message:'provider request failed'}`);
   if(secResult.status==='rejected')recordProviderIssue(`SEC ticker-to-CIK directory: ${secResult.reason instanceof Error?secResult.reason.message:'provider request failed'}`);
   if(nasdaqResult.status==='rejected'&&otherResult.status==='rejected')throw Error('Both official exchange listing directories are unavailable.');
   const nasdaq=nasdaqResult.status==='fulfilled'?nasdaqResult.value:'',other=otherResult.status==='fulfilled'?otherResult.value:'';
   const sec=secResult.status==='fulfilled'?secResult.value:{};
   const rows=parseOfficialDirectory(nasdaq,other,sec as Record<string,any>);
   if(!rows.length)throw Error('Official exchange listing directories contained no usable rows.');
   return {retrievedAt:new Date().toISOString(),rows,complete:completeDirectoryFiles(nasdaq,other)};
  })
  .then(value=>{listingDirectoryCache={...value,expiresAt:Date.now()+60*60_000};return value;})
  .finally(()=>{listingDirectoryFlight=null;});
 return listingDirectoryFlight;
}

async function currentListingDirectory(requireComplete=false){
 try{
  const value=await fetchListingDirectory();
  if(!requireComplete)return value;
  if(!value.complete)throw Error('One or both official listing files are incomplete; partial inventory cannot replace the full universe.');
  await saveCompleteDirectory(value);return value;
 }catch(error){
  if(!requireComplete)throw error;
  const cached=await readCompleteDirectory();
  if(!cached)throw error;
  recordProviderIssue('Full inventory uses the last checksum-verified complete directory with unchanged retrieval date.');
  return {...cached,complete:true};
 }
}

export function companyBySymbol(symbol: string): Company | null {
  return (bundledUniverse.companies as Company[]).find((company) => company.ticker === symbol.toUpperCase()) ?? null;
}

/** Resolve one issuer against the live exchange issue description before
 * scoring a company profile; bundled company-name text is not security proof. */
export async function resolveCompanyBySymbol(symbol:string):Promise<Company|null>{
 const ticker=symbol.trim().toUpperCase();
 const bundled=companyBySymbol(ticker);
 try{
  const directory=await currentListingDirectory();
  const listed=directory.rows.find(row=>row.ticker===ticker);
  if(listed)return {...bundled,...listed,directoryAvailableAt:directory.retrievedAt,cik:listed.cik||bundled?.cik||0};
 }catch(error){recordProviderIssue(`Official listing identity for ${ticker}: ${error instanceof Error?error.message:'provider request failed'}`)}
 return bundled;
}

export function searchCompanies(query: string, limit = 12): Company[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return rankCompanySearchResults(bundledUniverse.companies as Company[],normalized,limit);
}

function rankCompanySearchResults(companies:Company[],normalized:string,limit:number){
  return [...new Map(companies.filter(company=>company.ticker.toLowerCase().includes(normalized)||company.name.toLowerCase().includes(normalized)).map(company=>[company.ticker,company])).values()]
    .sort((a, b) => {
      const rank = (company: Company) => company.ticker.toLowerCase() === normalized ? 0 : company.ticker.toLowerCase().startsWith(normalized) ? 1 : company.name.toLowerCase().startsWith(normalized) ? 2 : 3;
      return rank(a) - rank(b) || a.ticker.localeCompare(b.ticker);
    })
    .slice(0, Math.max(1, Math.min(20, limit)));
}

/** Search the current official exchange directory so picker coverage is not
 * limited to the last generated bundle. Fall back to the dated bundle on
 * provider failure; the caller still gets useful results with known limits. */
export async function searchListedCompanies(query:string,limit=12):Promise<Company[]>{
 const normalized=query.trim().toLowerCase();
 if(!normalized)return [];
 try{
  const directory=await currentListingDirectory();
  const rows=directory.rows.map(row=>({...row,directoryAvailableAt:directory.retrievedAt}));
  return rankCompanySearchResults(rows,normalized,limit);
 }catch(error){
  recordProviderIssue(`Live company search directory: ${error instanceof Error?error.message:'provider request failed'}`);
  return searchCompanies(query,limit);
 }
}

function requestHeaders(url: string): Record<string, string> {
  const hostname=new URL(url).hostname;
  return hostname==='sec.gov'||hostname.endsWith('.sec.gov')
    ? { ...(secUserAgent()?{'User-Agent':secUserAgent()!}:{}), Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' }
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
    if(secArtifactCik(url)&&ttlMs>0){const durable=await readSecArtifact(url);if(durable)return durable;}
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await providerFetch(url, { headers: requestHeaders(url), signal: AbortSignal.timeout(timeoutMs) });
        if (response.ok) {
          const value = await response.json();
          if(secArtifactCik(url)&&Number((value as any)?.cik)===Number(secArtifactCik(url)))await recordSecArtifact(url,value);
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
    if(secArtifactCik(url))await recordSecArtifact(url,null,message);
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
    currentListingDirectory(true),
  ]);
  let directory:Company[]=[];
  if(directoryResult.status==='fulfilled'&&directoryResult.value.rows.length){
    const directoryAvailableAt=directoryResult.value.retrievedAt;
    const old=new Map(base.map(company=>[company.ticker,company]));
    directory=directoryResult.value.rows.map(company=>{
      const previous=old.get(company.ticker);
      return {...previous,...company,listingStatus:'current',cik:company.cik||previous?.cik||0,directoryAvailableAt,quoteSource:previous?.quoteSource||'official live listing directory',quoteAvailableAt:previous?.quoteAvailableAt||directoryAvailableAt};
    });
  }else throw Error(`Complete official listing inventory unavailable: ${directoryResult.status==='rejected'&&directoryResult.reason instanceof Error?directoryResult.reason.message:'empty response'}`);
  const currentSymbols=new Set(directory.map(company=>company.ticker));
  for(const company of await previouslyTrackedCompanies())if(!currentSymbols.has(company.ticker))directory.push({...company,listingStatus:'not-confirmed-current'});
  let nasdaq = directory;
  if(latestResult.status==='fulfilled'){
    const latest=latestResult.value;
    const quotes = new Map((latest.data?.rows ?? []).map((row) => [row.symbol, row]));
    nasdaq = directory.map(company=>{
      const patch=quotePatch(quotes.get(company.ticker));
      if(!Number.isFinite(patch.price)&&!Number.isFinite(patch.marketCap))return company;
      const availableAt=new Date().toISOString();
      return {...company,...patch,quoteSource:'Nasdaq screener live',quoteAvailableAt:availableAt,...(Number.isFinite(patch.price)?{priceSource:'Nasdaq screener live',priceAvailableAt:availableAt,priceUrl:NASDAQ_SCREENER}:{}),...(Number.isFinite(patch.marketCap)?{marketCapSource:'Nasdaq screener live',marketCapAvailableAt:availableAt,marketCapUrl:NASDAQ_SCREENER}:{})};
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
        const value=await response.json() as {quoteResponse?:{result?:any[]}};
        const publicUrl=new URL(url);publicUrl.searchParams.delete('crumb');
        for(const quote of value.quoteResponse?.result??[])quote.__sourceUrl=publicUrl.toString();
        return value;
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
        priceSource:'Yahoo bulk quote live',priceUrl:quote.__sourceUrl,
        priceAvailableAt:new Date(marketTime*1000).toISOString(),
        price: quote.regularMarketPrice,
        // This is a live/session-to-date move. It must not populate the
        // Snapshot.dailyChange field, whose contract is the last completed
        // close-to-close session used by radar cards and company profiles.
        intradayChange:Number.isFinite(quote.regularMarketChangePercent)&&quote.regularMarketChangePercent>-100?quote.regularMarketChangePercent/100:undefined,
        ...(Number.isFinite(quote.marketCap)&&quote.marketCap>0 ? { marketCap: quote.marketCap,marketCapSource:'Yahoo bulk quote live',marketCapUrl:quote.__sourceUrl,marketCapAvailableAt:new Date(marketTime*1000).toISOString() } : {}),
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
/** SEC ownership submissions commonly name the rendered XSL route. The raw
 * ownership XML is the same basename at the accession root. */
export function rawSecOwnershipDocument(document:string):string|null {
 if(/^[A-Za-z0-9][A-Za-z0-9._-]*\.xml$/i.test(document)&&!document.includes('..'))return document;
 const match=document.match(/^xslF345X\d{2}\/([A-Za-z0-9][A-Za-z0-9._-]*\.xml)$/i);
 return match&&!match[1].includes('..')?match[1]:null;
}
const validSecDate=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
function recentSubmissions(payload:any):RecentSecSubmission[]{
 const recent=payload?.filings?.recent;
 if(!Array.isArray(recent?.form)||!Array.isArray(recent?.accessionNumber)||!Array.isArray(recent?.primaryDocument)||!Array.isArray(recent?.filingDate))return [];
 const length=Math.min(recent.form.length,recent.accessionNumber.length,recent.primaryDocument.length,recent.filingDate.length);
 const rows:RecentSecSubmission[]=[];
 for(let index=0;index<length;index++){
  const form=recent.form[index],accession=recent.accessionNumber[index],document=recent.primaryDocument[index],filed=recent.filingDate[index],reportDate=recent.reportDate?.[index];
  if(typeof form!=='string'||typeof accession!=='string'||!/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/.test(accession)||typeof document!=='string'||!(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(document)||(['4','4/A','3','3/A','5','5/A'].includes(form)&&rawSecOwnershipDocument(document)))||document.includes('..')||!validSecDate(filed))continue;
  rows.push({form,accession,document,filed,...(typeof reportDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(reportDate)?{reportDate}:{})});
 }
 return rows;
}

const INSIDER_FORM4_WINDOW_DAYS=365;
// Fetch the full 12-month window for normal issuers. A high safety ceiling
// protects profile latency and provider budgets; exceeding it is disclosed as
// partial coverage rather than interpreted as no insider purchases.
const INSIDER_FORM4_FETCH_LIMIT=100;
const INSIDER_FORM4_MAX_DURATION_MS=12_000;
export function selectRecentForm4Filings(payload:any,asOf:string,limit=INSIDER_FORM4_FETCH_LIMIT){
 const end=asOf.slice(0,10),cutoff=dateOffset(end,-INSIDER_FORM4_WINDOW_DAYS);
 const recentRows=recentSubmissions(payload);
 const rows=recentRows.filter(row=>row.form==='4'&&/^\d{4}-\d{2}-\d{2}$/.test(row.filed)&&row.filed>=cutoff&&row.filed<=end).sort((a,b)=>b.filed.localeCompare(a.filed)||b.accession.localeCompare(a.accession));
 const selected=rows.slice(0,Math.max(0,limit));
 const allRecentDates=recentRows.map(row=>row.filed).filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&date<=end).sort();
 const rawRecent=payload?.filings?.recent;
 const validAccessions=new Set(recentRows.map(row=>row.accession));
 const malformedInWindow=Array.isArray(rawRecent?.form)&&rawRecent.form.some((form:string,index:number)=>['4','4/A'].includes(form)&&(!validSecDate(rawRecent.filingDate?.[index])||(rawRecent.filingDate[index]>=cutoff&&rawRecent.filingDate[index]<=end&&!validAccessions.has(rawRecent.accessionNumber?.[index]))));
 const submissionWindowComplete=allRecentDates.length>0&&allRecentDates[0]<=cutoff&&!malformedInWindow;
 const formWindowComplete=rows.length<=selected.length||selected.at(-1)?.filed===cutoff||!!selected.at(-1)&&selected.at(-1)!.filed<cutoff;
 return {selected,coverage:{windowStart:cutoff,windowEnd:end,availableForm4Count:rows.length,selectedForm4Count:selected.length,fetchedForm4Count:0,failedForm4Count:0,reviewedForm4Count:0,invalidForm4Count:0,unattemptedForm4Count:0,httpStatusCounts:{},submissionWindowComplete,state:'partial' as const,message:!submissionWindowComplete?'SEC recent-submission index does not prove it spans the full 12-month window.':!formWindowComplete?`More than ${limit} Form 4 filings were found; only the newest filings are fetched.`:'Form 4 coverage will be complete only after every in-window filing is fetched successfully.'}};
}

const OPPORTUNITY_FILING_FORMS=new Set(['10-K','10-K/A','10-Q','10-Q/A','8-K','6-K','20-F','20-F/A','40-F','40-F/A','S-1','S-1/A','S-3','S-3/A','DEF 14A','DEFA14A','13D','13D/A','13G','13G/A','144','4','4/A','8-A','424B1','424B2','424B3','424B4','424B5']);
export function parseSecFilingIndex(payload:any,cik:number,asOf:string,limit=60,retrievedAtInput?:string):SecFilingResearch{
 const retrievedAt=retrievedAtInput&&Number.isFinite(Date.parse(retrievedAtInput))?retrievedAtInput:new Date().toISOString(),asOfDate=typeof asOf==='string'?asOf.slice(0,10):'',validAsOf=validSecDate(asOfDate)&&Number.isFinite(Date.parse(asOf)),safeDate=validAsOf?asOfDate:retrievedAt.slice(0,10);
 const validCik=Number.isSafeInteger(cik)&&cik>0,source:Provenance={source:'SEC EDGAR submissions · recent filing index',...(validCik?{url:submissionsUrlFor(cik)}:{}),periodEnd:safeDate,availableAt:validAsOf?asOf:retrievedAt,retrievedAt,confidence:'high',rightsStatus:'unknown'};
 if(!validCik||!validAsOf)return {providerStatus:'invalid',items:[],source,limitations:['SEC submissions identity or as-of date is missing or malformed; filings are not attached.']};
 if(payload==null)return {providerStatus:'unavailable',items:[],source,limitations:['SEC submissions could not be acquired for this profile cut; an unavailable response must not be interpreted as an empty filing history.']};
 if(typeof payload!=='object'||Number(payload.cik)!==cik)return {providerStatus:'invalid',items:[],source,limitations:['SEC submissions identity is malformed or does not match this issuer; filings are not attached.']};
 const recent=payload.filings?.recent;
 if(!Array.isArray(recent?.form)||!Array.isArray(recent?.accessionNumber)||!Array.isArray(recent?.primaryDocument)||!Array.isArray(recent?.filingDate))return {providerStatus:'invalid',items:[],source,limitations:['SEC submissions recent-index structure is malformed; filings are not attached.']};
 const parallelLength=Math.min(recent.form.length,recent.accessionNumber.length,recent.primaryDocument.length,recent.filingDate.length),malformedRows=Math.max(0,parallelLength-recentSubmissions(payload).length);
 const rows=recentSubmissions(payload).filter(row=>OPPORTUNITY_FILING_FORMS.has(row.form)&&/^\d{4}-\d{2}-\d{2}$/.test(row.filed)&&row.filed<=safeDate).sort((a,b)=>b.filed.localeCompare(a.filed)||b.accession.localeCompare(a.accession));
 const items=rows.slice(0,Math.max(0,Math.min(100,limit))).map(row=>({form:row.form,filed:row.filed,...(row.reportDate?{reportDate:row.reportDate}:{}),accession:row.accession,title:`SEC filing: ${row.form} filed ${row.filed}`,url:`https://www.sec.gov/Archives/edgar/data/${cik}/${row.accession.replaceAll('-','')}/${row.document}`}));
 const indexEarliestFiled=recentSubmissions(payload).map(row=>row.filed).filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&date<=safeDate).sort()[0];
 const limitations=['This is the issuer’s bounded recent-submissions index; older filing-history files are not loaded here. Filing metadata does not establish the contents, binding status, future catalyst, or investment impact of a filing.'];
 if(malformedRows)limitations.push(`${malformedRows} malformed recent-index row${malformedRows===1?' was':'s were'} rejected; the surviving index is partial and cannot establish complete filing coverage.`);
 if(rows.length>items.length)limitations.push(`Only ${items.length} of ${rows.length} relevant recent filings are included in this profile.`);
 return {providerStatus:malformedRows?(items.length?'partial':'invalid'):items.length?'retrieved':'empty',...(indexEarliestFiled?{indexEarliestFiled}:{}),items,source,limitations};
}

const FORM_8K_ITEMS = new Set(['1.01','1.02','1.03','2.01','2.02','2.03','2.04','2.05','2.06','3.01','3.02','3.03','4.01','4.02','5.01','5.02','5.03','5.04','5.05','5.06','5.07','5.08','6.01','6.02','6.03','6.04','6.05','7.01','8.01','9.01']);
const FORM_8K_DOCUMENT_LIMIT = 4;
const FORM_8K_DOCUMENT_BUDGET_MS = 7_000;
const FORM_8K_DOCUMENT_BYTES = 512_000;
const FORM_8K_TOTAL_BYTES = 1_500_000;

/** Extract only section numbers explicitly mentioned by a filing body.
 * This is a review index, not a claim that the section is material or positive. */
export function parseSec8KItemReferences(html: string): string[] {
 if(typeof html!=='string'||!html||html.length>FORM_8K_DOCUMENT_BYTES||!/<(?:html|body|document|div|p|h[1-6])\b/i.test(html))return [];
 const text=html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|ix:header)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
  .replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&(?:#x([\da-f]{1,6})|#(\d{1,7}));?/gi,(_all,hex,decimal)=>{const code=hex?parseInt(hex,16):Number(decimal);return Number.isFinite(code)&&code>=32&&code<=0x10ffff?String.fromCodePoint(code):' ';})
  .replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
 const found=new Set<string>();
 for(const match of text.matchAll(/\bitem\s+(\d\.\d{2})\b/gi))if(FORM_8K_ITEMS.has(match[1]))found.add(match[1]);
 return [...found].sort((a,b)=>Number(a)-Number(b));
}

async function readLimitedText(response:Response,perDocumentLimit:number,remainingTotal:number):Promise<{text:string;truncated:boolean;bytes:number}>{
 const contentLength=Number(response.headers.get('content-length'));
 if(Number.isFinite(contentLength)&&contentLength>Math.min(perDocumentLimit,remainingTotal))return {text:'',truncated:true,bytes:0};
 if(!response.body){const text=await response.text();const bytes=new TextEncoder().encode(text).byteLength;return bytes>Math.min(perDocumentLimit,remainingTotal)?{text:'',truncated:true,bytes:0}:{text,truncated:false,bytes};}
 const reader=response.body.getReader(),decoder=new TextDecoder();let text='',bytes=0,truncated=false;
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>Math.min(perDocumentLimit,remainingTotal)){truncated=true;await reader.cancel();break;}text+=decoder.decode(part.value,{stream:true});}if(!truncated)text+=decoder.decode();}
 finally{reader.releaseLock();}
 return {text:truncated?'':text,truncated,bytes:truncated?0:bytes};
}

/** On-demand bounded scan of recent 8-K bodies. Captures referenced item
 * numbers only; analyst review remains mandatory before catalyst scoring. */
type Form8KItemIndex=NonNullable<SecFilingResearch['form8KItemIndex']>;
export async function fetchSec8KItemIndex(payload:any,cik:number,asOf:string,retrievedAtInput?:string):Promise<Form8KItemIndex>{
 const retrievedAt=retrievedAtInput&&Number.isFinite(Date.parse(retrievedAtInput))?retrievedAtInput:new Date().toISOString();
 const unavailable=(providerStatus:'unavailable'|'empty'|'partial'='unavailable',selectedDocuments=0,limitations:string[]=[])=>( {providerStatus,selectedDocuments,fetchedDocuments:0,failedDocuments:0,truncatedDocuments:0,items:[] as Array<{accession:string;filed:string;form:'8-K';url:string;referencedItemNumbers:string[]}>,limitations} );
 if(!Number.isSafeInteger(cik)||cik<=0||!validSecDate(asOf.slice(0,10))||Date.parse(retrievedAt)>Date.parse(asOf))return unavailable('unavailable',0,['Filing-body retrieval was skipped because issuer identity or timestamps were invalid.']);
 if(!secUserAgent())return unavailable('unavailable',0,['Filing-body retrieval was suppressed because SEC_USER_AGENT has no valid reachable contact.']);
 if(!payload||Number(payload.cik)!==cik||!Array.isArray(payload?.filings?.recent?.form))return unavailable('unavailable',0,['SEC submissions were unavailable or did not match the issuer.']);
 const cutoff=dateOffset(asOf.slice(0,10),-180),index=parseSecFilingIndex(payload,cik,asOf,100,retrievedAt);
 const recent8Ks=index.items.filter(item=>item.form==='8-K'&&item.filed>=cutoff),selected=recent8Ks.slice(0,FORM_8K_DOCUMENT_LIMIT);
 if(!selected.length)return unavailable('empty',0,['No recent domestic 8-K documents were selected from the validated submissions index.']);
 const items:Form8KItemIndex['items']=[];
 let fetchedDocuments=0,failedDocuments=0,truncatedDocuments=0,totalBytes=0;
 const deadline=Date.now()+FORM_8K_DOCUMENT_BUDGET_MS;
 for(const filing of selected){
  const remaining=deadline-Date.now();if(remaining<=0){failedDocuments+=selected.length-items.length-failedDocuments-truncatedDocuments;break;}
  try{
   const response=await providerFetch(filing.url,{headers:{...requestHeaders(filing.url),Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'},signal:AbortSignal.timeout(Math.min(5_000,remaining))});
   if(!response.ok){failedDocuments++;recordProviderIssue(`SEC 8-K ${filing.accession}: HTTP ${response.status}`);continue;}
   const body=await readLimitedText(response,FORM_8K_DOCUMENT_BYTES,FORM_8K_TOTAL_BYTES-totalBytes);
   if(body.truncated){truncatedDocuments++;continue;}
   if(!/<(?:html|document|ix:[a-z]+)/i.test(body.text)){failedDocuments++;recordProviderIssue(`SEC 8-K ${filing.accession}: response did not contain a recognizable filing document`);continue;}
   totalBytes+=body.bytes;fetchedDocuments++;
   const archived=await persistFilingDocument({cik,accession:filing.accession,url:filing.url,filed:filing.filed,retrievedAt:new Date().toISOString(),asOf,body:body.text});
   items.push({accession:filing.accession,filed:filing.filed,form:'8-K',url:filing.url,referencedItemNumbers:parseSec8KItemReferences(body.text),...archived});
  }catch(error){failedDocuments++;recordProviderIssue(`SEC 8-K ${filing.accession}: ${error instanceof Error?error.message:'document retrieval failed'}`);}
 }
 const unattempted=Math.max(0,selected.length-items.length-failedDocuments-truncatedDocuments);
 if(unattempted)failedDocuments+=unattempted;
 const limitations=['The bounded document scan extracts only 8-K item-number references. It does not summarize the filing, establish a binding obligation or catalyst, assess materiality, or support an investment score; open each SEC filing and review its exhibits.',...(index.limitations)];
 if(selected.length<recent8Ks.length)limitations.unshift(`Only the newest ${selected.length} of ${recent8Ks.length} recent 8-K filings were selected (maximum ${FORM_8K_DOCUMENT_LIMIT}).`);
 if(failedDocuments)limitations.push(`${failedDocuments} selected 8-K document(s) failed or remained unattempted within the ${FORM_8K_DOCUMENT_BUDGET_MS/1000}-second request budget.`);
 if(truncatedDocuments)limitations.push(`${truncatedDocuments} selected 8-K document(s) exceeded the bounded response-size limit and were not parsed.`);
 const providerStatus:Form8KItemIndex['providerStatus']=items.length===selected.length&&selected.length===recent8Ks.length?'retrieved':'partial';
 return {providerStatus,selectedDocuments:selected.length,fetchedDocuments,failedDocuments,truncatedDocuments,items,limitations};
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

export async function fetchInsiderPurchases(cik: number,asOf:string,submissionsInput?:any) {
  const submissionsUrl = submissionsUrlFor(cik);
  try {
    const payload = (submissionsInput ?? await fetchJson(submissionsUrl, 8_000)) as { filings?: { recent?: { form?: string[]; accessionNumber?: string[]; primaryDocument?: string[]; filingDate?: string[] } } };
    if(!payload||Number((payload as any).cik)!==cik)throw Error('SEC submissions issuer identity mismatch');
    const {selected:filings,coverage}=selectRecentForm4Filings(payload,asOf);
    const amendments=recentSubmissions(payload).filter(row=>row.form==='4/A'&&row.filed>=coverage.windowStart&&row.filed<=coverage.windowEnd);
    const completeFilingWindow=coverage.submissionWindowComplete&&coverage.availableForm4Count<=coverage.selectedForm4Count&&amendments.length===0;
    const parsed: InsiderPurchase[] = [];
    const read = (tag: string, from: string) => from.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
    // Fetch bounded groups; eight consecutive request timeouts used to hold a
    // single company file open for more than a minute.
    let fetchedForm4Count=0,failedForm4Count=0,reviewedForm4Count=0,invalidForm4Count=0,unattemptedForm4Count=0;
    const httpStatusCounts:Record<string,number>={};
    const deadline=Date.now()+INSIDER_FORM4_MAX_DURATION_MS;
    for (let offset=0;offset<filings.length;offset+=4) {
      if(Date.now()>=deadline){unattemptedForm4Count=filings.length-offset;break;}
      await Promise.all(filings.slice(offset,offset+4).map(async filing => {
      const accessionPath = filing.accession.replaceAll('-', '');
      const rawDocument=rawSecOwnershipDocument(filing.document);
      if(!rawDocument){invalidForm4Count++;return;}
      const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionPath}/${rawDocument}`;
      let responseStatus:number|undefined;
      const remaining=Math.max(1,deadline-Date.now());
      const xml = await providerFetch(url, { headers: requestHeaders(url), signal: AbortSignal.timeout(Math.min(8_000,remaining)) }).then(async response => {responseStatus=response.status;if(!response.ok)return '';return (await readLimitedText(response,512_000,512_000)).text;}).catch(() => '');
      if (!xml) {failedForm4Count++;if(responseStatus!=null)httpStatusCounts[String(responseStatus)]=(httpStatusCounts[String(responseStatus)]??0)+1;recordProviderIssue(`SEC Form 4 ${filing.accession}: ${responseStatus==null?'network failure':`HTTP ${responseStatus}`}`);return;}
      fetchedForm4Count++;
      if(!/<ownershipDocument(?:\s|>)/i.test(xml)||!/<\/ownershipDocument\s*>/i.test(xml)||!/<issuer(?:\s|>)/i.test(xml)||!/<reportingOwner(?:\s|>)/i.test(xml)){
        invalidForm4Count++;recordProviderIssue(`SEC Form 4 ${filing.accession}: HTTP ${responseStatus??200} body was not a valid ownershipDocument`);return;
      }
      const issuerBlock=xml.match(/<issuer>[\s\S]*?<\/issuer>/i)?.[0]??'';
      if(Number(read('issuerCik',issuerBlock))!==cik){invalidForm4Count++;recordProviderIssue('SEC Form 4 issuer identity mismatch');return;}
      const archived=await persistFilingDocument({cik,accession:filing.accession,url,filed:filing.filed,retrievedAt:new Date().toISOString(),asOf,body:xml});
      const blocks = xml.match(new RegExp('<nonDerivativeTransaction[\\s\\S]*?<\\/nonDerivativeTransaction>', 'gi')) ?? [];
      const ownerBlock = xml.match(new RegExp('<reportingOwner>[\\s\\S]*?<\\/reportingOwner>', 'i'))?.[0] ?? '';
      const owner = read('rptOwnerName', ownerBlock) || 'مبلّغ داخلي غير مسمّى';
      let filingValid=true;
      for (const block of blocks) {
        if (read('transactionCode', block) !== 'P') continue;
        if(read('transactionAcquiredDisposedCode',block)!=='A'){filingValid=false;continue;}
        const titleBlock=block.match(/<securityTitle>[\s\S]*?<\/securityTitle>/i)?.[0]??'';
        const securityTitle=read('value',titleBlock);
        if(!securityTitle){filingValid=false;continue;}
        if(!/\b(common|ordinary)\b/i.test(securityTitle)||/\b(preferred|warrant|option)\b/i.test(securityTitle))continue;
        const dateBlock = block.match(new RegExp('<transactionDate[\\s\\S]*?<\\/transactionDate>', 'i'))?.[0] ?? '';
        const sharesBlock = block.match(new RegExp('<transactionShares[\\s\\S]*?<\\/transactionShares>', 'i'))?.[0] ?? '';
        const priceBlock = block.match(new RegExp('<transactionPricePerShare[\\s\\S]*?<\\/transactionPricePerShare>', 'i'))?.[0] ?? '';
        const date = read('value', dateBlock) || filing.filed;
        const shares = numeric(read('value', sharesBlock));
        const price = numeric(read('value', priceBlock));
        if (validSecDate(date) && date>=coverage.windowStart && Date.parse(date+'T23:59:59Z')<=Date.parse(asOf) && shares != null && price != null && shares > 0 && price > 0) parsed.push({ owner, date, shares, price, value: shares * price, source: url,filed:filing.filed,contentHash:archived.contentHash });
        else filingValid=false;
      }
      if(filingValid)reviewedForm4Count++;else{invalidForm4Count++;recordProviderIssue(`SEC Form 4 ${filing.accession}: malformed code-P transaction fields`);}
      }));
    }
    const purchases=parsed.sort((a,b)=>b.date.localeCompare(a.date)||(a.source??'').localeCompare(b.source??'')||a.owner.localeCompare(b.owner)).slice(0, 20);
    if(!unattemptedForm4Count&&reviewedForm4Count+invalidForm4Count+failedForm4Count<filings.length)unattemptedForm4Count=filings.length-reviewedForm4Count-invalidForm4Count-failedForm4Count;
    const complete=completeFilingWindow&&reviewedForm4Count===filings.length&&invalidForm4Count===0&&failedForm4Count===0&&unattemptedForm4Count===0;
    const state:'complete'|'partial'=complete?'complete':'partial';
    const failureSummary=Object.entries(httpStatusCounts).map(([status,count])=>`HTTP ${status}: ${count}`).join(', ');
    const limitations:string[]=[];
    if(amendments.length)limitations.push('Form 4 amendments exist in this window; transaction revisions are not reconciled and monetary score credit is withheld.');
    if(!coverage.submissionWindowComplete)limitations.push('SEC recent-submission index does not prove coverage of the full 12-month window.');
    if(coverage.availableForm4Count>coverage.selectedForm4Count)limitations.push(`Only ${coverage.selectedForm4Count} of ${coverage.availableForm4Count} Form 4 filings were selected within the profile request limit.`);
    if(failedForm4Count)limitations.push(`${failedForm4Count} of ${filings.length} selected filing documents failed retrieval${failureSummary?` (${failureSummary})`:''}; absence of a visible code-P purchase is inconclusive.`);
    if(invalidForm4Count)limitations.push(`${invalidForm4Count} retrieved filing document(s) were malformed or could not be parsed; coverage is incomplete.`);
    if(unattemptedForm4Count)limitations.push(`The ${INSIDER_FORM4_MAX_DURATION_MS/1000}-second profile research budget ended with ${unattemptedForm4Count} selected filing document(s) not fetched; coverage is partial.`);
    if(!failedForm4Count&&!invalidForm4Count&&!unattemptedForm4Count&&reviewedForm4Count<filings.length)limitations.push(`${reviewedForm4Count} of ${filings.length} selected Form 4 filings passed document validation.`);
    const message=complete?'All Form 4 filings in the verified 12-month SEC index window were fetched and reviewed for code-P common-share purchases; code P alone does not distinguish public-market and private purchases.':limitations.join(' ');
    const observedPurchaseSources=[...new Map(parsed.map(item=>[item.source,{source:'SEC Form 4 code-P common-share transaction',url:item.source,contentHash:item.contentHash,accession:filings.find(filing=>item.source?.includes(filing.accession.replaceAll('-','')))?.accession,periodEnd:item.date,availableAt:item.filed&&item.filed<asOf.slice(0,10)?item.filed+'T23:59:59.000Z':asOf,retrievedAt:new Date().toISOString(),currency:'USD',confidence:'high' as const,rightsStatus:'redistribution-permitted' as const,parserVersion:'form4-common-purchases-v2'}])).values()];
    return {purchases,observedPurchaseSources,observedPurchaseValue:amendments.length?0:parsed.reduce((sum,item)=>sum+item.value,0),coverage:{...coverage,fetchedForm4Count,failedForm4Count,reviewedForm4Count,invalidForm4Count,unattemptedForm4Count,httpStatusCounts,state,message}};
  } catch(error) {
    const end=asOf.slice(0,10),windowStart=dateOffset(end,-INSIDER_FORM4_WINDOW_DAYS);
    return {purchases:[],observedPurchaseSources:[] as Provenance[],observedPurchaseValue:0,coverage:{state:'unavailable' as const,windowStart,windowEnd:end,availableForm4Count:0,selectedForm4Count:0,fetchedForm4Count:0,failedForm4Count:0,reviewedForm4Count:0,invalidForm4Count:0,unattemptedForm4Count:0,httpStatusCounts:{},submissionWindowComplete:false,message:`SEC insider filing lookup failed: ${error instanceof Error?error.message:'provider request failed'}`}};
  }
}

async function attachOpportunityEarnings(snapshot: Snapshot, facts: unknown, providerError?: unknown, benchmark?: HistoricalResult | null, splitAdjusted = false, submissions?: unknown, includeFilingIndex = false, form8KItemIndex?:Awaited<ReturnType<typeof fetchSec8KItemIndex>>) {
  // The network response arrives after the snapshot's initial quote cut. Stamp
  // the research cut only after acquisition so SEC retrievedAt is never forged
  // into the past or rejected as future evidence.
  let retrievedAt = new Date().toISOString();
  snapshot.asOf = retrievedAt;
  let reportedEarnings = buildSecEarningsQualityAssessment(Number(snapshot.cik), facts, snapshot.asOf, retrievedAt);
  let profileFxSeries: EcbDailySeries[] | null = null;
  let profileFxFailure: string | undefined;
  let result: typeof reportedEarnings & { currencyTranslation?: { state: 'complete' | 'partial' | 'unavailable'; sourceCurrency: string; targetCurrency: 'USD'; annualConvertedPeriods: number; quarterlyConvertedPeriods: number; annualWithheldPeriods: number; quarterlyWithheldPeriods: number; source: string; disclosure: string } } = reportedEarnings;
  if (includeFilingIndex && reportedEarnings.coverage.selectedUnit !== 'USD'
    && [...reportedEarnings.periods.annual, ...reportedEarnings.periods.quarterly].length) {
    const periods = [...reportedEarnings.periods.annual, ...reportedEarnings.periods.quarterly];
    const start = periods.map(period => period.start).sort()[0], end = periods.map(period => period.end).sort().at(-1)!;
    const fx = await fetchEcbDailySeries(reportedEarnings.coverage.selectedUnit, start, end, reason => { profileFxFailure = reason; });
    profileFxSeries = fx;
    retrievedAt = new Date().toISOString(); snapshot.asOf = retrievedAt;
    reportedEarnings = buildSecEarningsQualityAssessment(Number(snapshot.cik), facts, snapshot.asOf, retrievedAt);
    const annual = fx ? convertEarningsPeriodsToUsd(reportedEarnings.periods.annual, reportedEarnings.coverage.selectedUnit, fx, retrievedAt) : null;
    const quarterly = fx ? convertEarningsPeriodsToUsd(reportedEarnings.periods.quarterly, reportedEarnings.coverage.selectedUnit, fx, retrievedAt) : null;
    const annualConverted = annual?.periods ?? reportedEarnings.periods.annual;
    const quarterlyConverted = quarterly?.periods ?? reportedEarnings.periods.quarterly;
    const withheld = (annual?.withheldCount ?? reportedEarnings.periods.annual.length) + (quarterly?.withheldCount ?? reportedEarnings.periods.quarterly.length);
    const converted = (annual?.convertedCount ?? 0) + (quarterly?.convertedCount ?? 0);
    result = {
      ...reportedEarnings,
      periods: { annual: annualConverted, quarterly: quarterlyConverted },
      missing: fx && withheld === 0 ? reportedEarnings.missing.filter(item => !item.startsWith(`currency ${reportedEarnings.coverage.selectedUnit} is not converted`)) : reportedEarnings.missing,
      limitations: [fx
        ? `ترجمة أرباح ECB إلى USD: ${annual?.convertedCount ?? 0}/${reportedEarnings.periods.annual.length} سنة و${quarterly?.convertedCount ?? 0}/${reportedEarnings.periods.quarterly.length} ربع؛ العملة الأصلية ${reportedEarnings.coverage.selectedUnit}.`
        : `ترجمة أرباح ECB إلى USD غير متاحة (${profileFxFailure ?? 'rate-series-unavailable'}); العملة الأصلية ${reportedEarnings.coverage.selectedUnit}.`,
        ...reportedEarnings.limitations, fx
        ? 'التحويل إلى الدولار تقديري للمقارنة وليس قوائم بالدولار أصدرتها الشركة أو راجعها مدقق. التدفقات تستخدم متوسط أسعار ECB اليومية المتطابقة؛ وتبقى العملة الأصلية ومعدل التحويل وتواريخه موثقة لكل قيمة. لا تُستخدم القيم المحوّلة لتقييم القوة المالية.'
        : 'تعذّر التحقق من أسعار ECB اليومية؛ تبقى القيم ظاهرة بعملتها الأصلية من دون تحويل.'],
      currencyTranslation: {
        state: !fx ? 'unavailable' : withheld ? converted ? 'partial' : 'unavailable' : 'complete',
        sourceCurrency: reportedEarnings.coverage.selectedUnit,
        targetCurrency: 'USD',
        annualConvertedPeriods: annual?.convertedCount ?? 0,
        quarterlyConvertedPeriods: quarterly?.convertedCount ?? 0,
        annualWithheldPeriods: annual?.withheldCount ?? reportedEarnings.periods.annual.length,
        quarterlyWithheldPeriods: quarterly?.withheldCount ?? reportedEarnings.periods.quarterly.length,
        source: 'ECB Data Portal EXR daily spot reference rates',
        disclosure: 'تحويل تحليلي للمقارنة فقط؛ وليس قوائم مالية بالدولار أصدرتها الشركة أو راجعها مدقق.',
      },
    };
  }
  const issuerModel = classifySecIssuerModel(submissions, Number(snapshot.cik));
  const industryModel = issuerModel?.industryModel;
  if (issuerModel) snapshot.provenance.industryModel = {
    source: 'SEC EDGAR submissions · issuer SIC classification',
    url: submissionsUrlFor(Number(snapshot.cik)), periodEnd: snapshot.asOf.slice(0, 10),
    availableAt: snapshot.asOf, retrievedAt, tag: `SIC ${issuerModel.sic}: ${issuerModel.sicDescription}`,
    confidence: 'high', rightsStatus: 'unknown',
  };
  const financialStrength = buildSecFinancialStrengthInputs(Number(snapshot.cik), facts, snapshot.asOf, retrievedAt, reportedEarnings, industryModel);
  if (profileFxSeries && reportedEarnings.coverage.selectedUnit !== 'USD') {
    const translated = convertFinancialMetricsToUsd(financialStrength.metrics, reportedEarnings.coverage.selectedUnit, profileFxSeries, retrievedAt);
    financialStrength.metrics = translated.metrics;
    financialStrength.missing = financialStrength.missing.filter(item => !item.startsWith('financial-strength scoring: reported currency'));
    financialStrength.missing.push('القيم المالية المحوّلة لا تُحتسب بعد؛ راجع العملة الوظيفية للشركة، شروط التحويل والإفصاح في الملف الأصلي قبل استخدامها في تقييم القوة المالية.');
    financialStrength.limitations.push(`ترجمة أرصدة الميزانية والقيم المتراكمة إلى USD: ${translated.convertedCount} قيمة؛ ${translated.withheldCount} قيمة بقيت بعملتها المعلنة. أسعار ECB مساعدة للتحليل وليست ترجمة مدققة أو بديلاً عن أسعار الشركة.`);
  }
  financialStrength.limitations.unshift(issuerModel
    ? `${issuerModel.reason} SEC SIC ${issuerModel.sic}: ${issuerModel.sicDescription}.`
    : 'SEC submissions SIC classification is missing, malformed, or does not match this issuer; no solvency formula is selected.');
  const technicalTiming = buildTechnicalTimingResearch({
    history: snapshot.history,
    benchmarkHistory: benchmark?.history,
    historySource: snapshot.provenance.history,
    benchmarkSource: benchmark ? { source: benchmark.source, url: benchmark.url, periodEnd: benchmark.availableAt.slice(0, 10), availableAt: benchmark.availableAt, retrievedAt: benchmark.retrievedAt, currency: 'USD', confidence: 'medium', rightsStatus: 'unknown' } : undefined,
    splitAdjusted,
    asOf: snapshot.asOf,
    rightsStatus: 'unknown',
  });
  const sourcedRevenueQuarters = result.periods.quarterly.flatMap(period => {
    const revenue = period.metrics.revenue;
    return revenue?.unit === 'USD' ? [{ quarter: period.end.slice(0, 7), value: revenue.value, periodEnd: period.end, source: revenue.source }] : [];
  }).slice(-6);
  if (sourcedRevenueQuarters.length) {
    snapshot.revenueTrend = sourcedRevenueQuarters.map(({ quarter, value, periodEnd }) => ({ quarter, value, periodEnd }));
    const latest = sourcedRevenueQuarters.at(-1)!;
    snapshot.provenance.revenueTrend = { ...latest.source, source: 'SEC Company Facts · standalone quarterly revenue' };
  }
  const providerStatus = providerError ? 'unavailable' : classifySecCompanyFacts(facts, Number(snapshot.cik));
  snapshot.opportunityResearch = {
    earnings: {
      providerStatus,
      ...(providerError instanceof Error ? { providerMessage: providerError.message.slice(0, 160) } : {}),
      coverage: result.coverage,
      ...(result.currencyTranslation ? { currencyTranslation: result.currencyTranslation } : {}),
      annual: result.periods.annual,
      quarterly: result.periods.quarterly,
      missing: result.missing,
      conflicts: result.conflicts,
      limitations: result.limitations,
      readyForScoring: !!result.assessment,
    },
    financialStrength: {
      providerStatus: providerError ? 'unavailable' : classifySecCompanyFacts(facts, Number(snapshot.cik)),
      ...(financialStrength.industryModel ? { industryModel: financialStrength.industryModel } : {}),
      metrics: financialStrength.metrics,
      missing: financialStrength.missing,
      conflicts: financialStrength.conflicts,
      limitations: financialStrength.limitations,
      readyForScoring: !!financialStrength.assessment,
    },
    technicalTiming,
    ...(includeFilingIndex ? { secFilings: {...parseSecFilingIndex(submissions, Number(snapshot.cik), snapshot.asOf, 60, retrievedAt),...(form8KItemIndex?{form8KItemIndex}:{})} } : {}),
  };
  Object.assign(snapshot,alignSnapshotFinancials(snapshot));
}

/** Attach compact, identity-checked SEC research to an existing scan row. */
export async function enrichSnapshotsWithSecOpportunity(snapshots: Snapshot[], marketResearch?: { bySymbol?: Map<string, HistoricalResult>; benchmark?: HistoricalResult | null }): Promise<{
  providerStatus: 'retrieved' | 'unavailable' | 'empty' | 'invalid';
  retryable: boolean;
  requests: number;
  error?: string;
}> {
  if (!snapshots.length) return { providerStatus: 'invalid', retryable: false, requests:0, error: 'SEC snapshot batch is empty' };
  const cik = Number(snapshots[0].cik);
  if (!Number.isSafeInteger(cik) || cik <= 0 || snapshots.some(snapshot => Number(snapshot.cik) !== cik)) {
    await Promise.all(snapshots.map(async snapshot => {
      const stock = marketResearch?.bySymbol?.get(snapshot.symbol);
      if (stock) attachScanMarketResearch(snapshot, stock);
      await attachOpportunityEarnings(snapshot, null, Error('SEC issuer CIK is missing, invalid, or inconsistent'), marketResearch?.benchmark, stock?.source.includes('Yahoo Finance chart API') && stock.splits !== null);
      compactTechnicalResearch(snapshot);
    }));
    return { providerStatus: 'invalid', retryable: false, requests:0, error: 'SEC issuer CIK is missing, invalid, or inconsistent' };
  }
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`;
  try {
    const [facts, submissions] = await Promise.all([
      fetchJson(url, 8_000, 6 * 60 * 60_000, 2),
      fetchJson(submissionsUrlFor(cik), 8_000, 6 * 60 * 60_000, 2).catch(() => null),
    ]);
    const filingIndex=await fetchSec8KItemIndex(submissions,cik,new Date().toISOString());
    const insider=await fetchInsiderPurchases(cik,new Date().toISOString(),submissions);
    await Promise.all(snapshots.map(async snapshot => {
      const stock = marketResearch?.bySymbol?.get(snapshot.symbol);
      if (stock) attachScanMarketResearch(snapshot, stock);
      await attachOpportunityEarnings(snapshot, facts, undefined, marketResearch?.benchmark, stock?.source.includes('Yahoo Finance chart API') && stock.splits !== null, submissions,true,filingIndex);
      snapshot.insiderPurchases=insider.purchases; snapshot.insiderResearch=insider.coverage;
      if(insider.coverage.state==='complete'||insider.purchases.length){snapshot.insiderBuyValue=insider.observedPurchaseValue;snapshot.provenance.insiderBuyValue={source:'SEC ownership filings · observed code-P purchases',dependencies:insider.observedPurchaseSources,url:submissionsUrlFor(cik),periodEnd:snapshot.asOf.slice(0,10),availableAt:snapshot.asOf,retrievedAt:snapshot.asOf,currency:'USD',confidence:insider.coverage.state==='complete'?'high':'low',rightsStatus:'redistribution-permitted',tag:'Partial windows report observed buys only; no claim of complete absence.'};}
      compactTechnicalResearch(snapshot);
    }));
    const providerStatus = classifySecCompanyFacts(facts, cik);
    return { providerStatus, retryable: false, requests:2 };
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 180) : 'SEC Company Facts request failed';
    await Promise.all(snapshots.map(async snapshot => {
      const stock = marketResearch?.bySymbol?.get(snapshot.symbol);
      if (stock) attachScanMarketResearch(snapshot, stock);
      await attachOpportunityEarnings(snapshot, null, Error(detail), marketResearch?.benchmark, stock?.source.includes('Yahoo Finance chart API') && stock.splits !== null);
      compactTechnicalResearch(snapshot);
    }));
    return { providerStatus: 'unavailable', retryable: !/\bHTTP (400|401|403|404|405|422)\b/.test(detail), requests:2, error: detail };
  }
}

export function attachScanMarketResearch(snapshot: Snapshot, stock: HistoricalResult) {
  snapshot.history = stock.history;
  const last = stock.history.at(-1)?.date ?? stock.availableAt.slice(0, 10);
  snapshot.provenance.history = {
    source: stock.source, url: stock.url, periodEnd: last, availableAt: stock.availableAt,
    retrievedAt: stock.retrievedAt, currency: 'USD', confidence: stock.source.includes('bundled') ? 'low' : 'medium',
    rightsStatus: 'unknown', tag: 'scan daily market history; reuse rights not verified',
  };
  // Split-adjusted price history does not reconcile the SEC share-count change.
  // Require the event response to cover both reported share observation dates.
  if(stock.source.includes('Yahoo Finance chart API'))Object.assign(snapshot,reviewShareSplits(snapshot,stock.splits,stock.history[0]?.date??'',last,snapshot.provenance.history));
}

function compactTechnicalResearch(snapshot: Snapshot) {
  const research = snapshot.opportunityResearch?.technicalTiming;
  if (research) delete research.assessment;
  delete snapshot.history;
}

export async function enrichSnapshotWithSecOpportunity(snapshot: Snapshot) {
  return enrichSnapshotsWithSecOpportunity([snapshot]);
}

export async function companySnapshot(company: Company, options: { includeOpportunityResearch?: boolean } = {}): Promise<Snapshot> {
  const now = new Date().toISOString(), symbol = company.ticker, cik = String(company.cik).padStart(10, '0'), issues: string[] = [];
  // Independent enrichment starts together. Every rejection is handled here,
  // even when another provider fails or the company is outside screening size.
  const factsUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  const factsPromise=fetchJson(factsUrl).then(value=>({value:value as {cik?:number;facts:Record<string,unknown>},error:null}),error=>({value:null,error}));
  const benchmarkPromise=options.includeOpportunityResearch
    ? historicalMarketData('SPY',now).catch(error=>{issues.push(`SPY benchmark history: ${error instanceof Error?error.message:'provider request failed'}`);return null;})
    : Promise.resolve(null);
  const profilePromise=yahooCompanyProfile(symbol);
  const summaryPromise = fetchJson(`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/summary?assetclass=stocks`, 8_000).catch(error => {issues.push(`Nasdaq summary: ${error.message}`);return null;}) as Promise<any>;
  const newsPromise = fetch(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(yahooSymbol(symbol))}&region=US&lang=en-US`, { headers: { 'User-Agent': browserAgent, Accept: 'application/rss+xml,text/xml' }, signal: AbortSignal.timeout(8_000) }).then(r => {if(!r.ok)throw Error(`HTTP ${r.status}`);return r.text();}).catch(error => {issues.push(`Yahoo news: ${error.message}`);return '';});
  const googleNewsPromise = fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(`\"${symbol}\" stock`)}&hl=en-US&gl=US&ceid=US:en`, { headers: { 'User-Agent': browserAgent, Accept: 'application/rss+xml,text/xml' }, signal: AbortSignal.timeout(8_000) }).then(r => {if(!r.ok)throw Error(`HTTP ${r.status}`);return r.text();}).catch(error => {issues.push(`Google News RSS: ${error.message}`);return '';});
  const filingsPromise = fetchJson(submissionsUrlFor(company.cik),8_000).catch(error => {issues.push(`SEC submissions: ${error instanceof Error?error.message:'provider request failed'}`);return null;});
  const form8KItemIndexPromise=options.includeOpportunityResearch?filingsPromise.then(payload=>{const indexAsOf=new Date().toISOString();return fetchSec8KItemIndex(payload,company.cik,indexAsOf,indexAsOf).catch(error=>({providerStatus:'unavailable' as const,selectedDocuments:0,fetchedDocuments:0,failedDocuments:0,truncatedDocuments:0,items:[],limitations:[`Bounded SEC 8-K item scan failed: ${error instanceof Error?error.message:'provider request failed'}`]}));}):Promise.resolve(undefined);
  const insiderPromise = fetchInsiderPurchases(company.cik,now);
  let history: NonNullable<Snapshot['history']> = [], historyUrl = NASDAQ_SCREENER,historySource='Nasdaq screener · bundled dated fallback',historyRetrievedAt=bundledUniverse.generatedAt,chartMeta:any=null,historySplitAdjusted=false;
  try {
    const result = await historicalMarketData(symbol, now); historyUrl = result.url;historySource=result.source;historyRetrievedAt=result.retrievedAt;chartMeta=(result as any).meta??null;
    historySplitAdjusted=result.source.includes('Yahoo Finance chart API')&&result.splits!==null;
    history = result.history.map((row) => ({ date: row.date, close: row.close!, open: row.open ?? undefined, high: row.high ?? undefined, low: row.low ?? undefined, volume: row.volume ?? undefined }));
  } catch (error) { issues.push(`تعذّر تحميل تاريخ Nasdaq: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`) }

  const last = history.at(-1), quoteDate = last?.date ?? bundledUniverse.generatedAt.slice(0, 10), quoteAvailableAt = last ? `${last.date}T21:00:00.000Z` : bundledUniverse.generatedAt;
  const quoteEvidence: Provenance = { source: historySource, url: historyUrl, periodEnd: quoteDate, availableAt: quoteAvailableAt > now ? now : quoteAvailableAt, retrievedAt: historyRetrievedAt, currency: 'USD', confidence: historySource.includes('fallback')?'low':'medium', rightsStatus:'unknown' };
  const price = last?.close ?? company.price ?? null;
  const snapshot: Snapshot = { symbol, name: company.name, cik: company.cik, description: 'الوصف غير متاح من مصدر موثق لهذه اللقطة.', asOf: now, exchange: company.exchange, sector: company.sector, industry: company.industry, securityType: company.securityType??'unknown', listingStatus:company.listingStatus, price, marketCap: company.marketCap ?? null, confidence: 'C', deathSpiral: 'unknown', provenance: {}, history, dataIssues: issues, research: { financials: false, valuation: false, analysts: false, sector: !!company.sector } };
  if(company.directoryUrl&&company.directoryAvailableAt){
    const identity:Provenance={source:'Nasdaq Trader official symbol directory',url:company.directoryUrl,periodEnd:company.directoryAvailableAt.slice(0,10),availableAt:company.directoryAvailableAt,retrievedAt:now,tag:company.securityName||company.securityType||'listed issue description',confidence:'high',rightsStatus:'unknown'};
    snapshot.provenance.exchange=identity;
    snapshot.provenance.securityType=identity;
  }

  // Yahoo chart metadata is available without a crumb and supplies a useful
  // identity/quote fallback even when quoteSummary is blocked.
  if (chartMeta?.longName && !snapshot.name) snapshot.name=String(chartMeta.longName);
  if (!snapshot.exchange && chartMeta?.exchangeName) snapshot.exchange=String(chartMeta.exchangeName);
  const chartPrice=numeric(chartMeta?.regularMarketPrice);
  if (snapshot.price==null && chartPrice!=null && chartPrice>0) {
    snapshot.price=chartPrice;
    snapshot.provenance.price={source:'Yahoo Finance chart metadata',url:historyUrl,periodEnd:quoteDate,availableAt:quoteAvailableAt,retrievedAt:historyRetrievedAt,currency:'USD',confidence:'medium'};
  }

  const session=completedSessionQuote(history,now);
  if (price != null) snapshot.provenance.price = {...quoteEvidence,tag:'last completed session close'};
  if(session){snapshot.price=session.price;snapshot.dailyChange=session.dailyChange;snapshot.provenance.price={...quoteEvidence,periodEnd:session.periodEnd,tag:'last completed session close'};snapshot.provenance.dailyChange={...quoteEvidence,periodEnd:session.periodEnd,tag:'last completed close / previous completed close - 1'};}
  if(history.length)snapshot.provenance.history=quoteEvidence;
  if (snapshot.marketCap != null) {const availableAt=company.marketCapAvailableAt||company.quoteAvailableAt||bundledUniverse.generatedAt,source=company.marketCapSource||company.quoteSource||'Nasdaq stock screener';snapshot.provenance.marketCap = { source, url: NASDAQ_SCREENER, periodEnd: availableAt.slice(0, 10), availableAt, retrievedAt: now, currency: 'USD', confidence: source.includes('bundled') ? 'low' : 'medium' };}
  const [summaryResult, newsResult, googleNewsResult, insiderResult, filingsResult,form8KItemIndex] = await Promise.all([summaryPromise, newsPromise, googleNewsPromise, insiderPromise, filingsPromise,form8KItemIndexPromise]);
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
  const insiderPurchases=insiderResult.purchases;
  snapshot.insiderPurchases = insiderPurchases;
  snapshot.insiderResearch=insiderResult.coverage;
  snapshot.insiderBuyValue = insiderResult.coverage.state==='complete'||insiderPurchases.length?insiderResult.observedPurchaseValue:null;
  if (snapshot.insiderBuyValue != null) snapshot.provenance.insiderBuyValue = { source: 'SEC Form 4 common-share purchases (code P; market or private)',dependencies:insiderResult.observedPurchaseSources, url: submissionsUrlFor(cik), periodEnd: insiderPurchases[0]?.date ?? now.slice(0, 10), availableAt: now, retrievedAt: now, currency: 'USD', confidence: 'high' };
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
    if (options.includeOpportunityResearch) await attachOpportunityEarnings(snapshot, null, factsResult.error, await benchmarkPromise, historySplitAdjusted, filingsResult, true,form8KItemIndex);
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
    if (options.includeOpportunityResearch) await attachOpportunityEarnings(snapshot, null, factsResult.error, await benchmarkPromise, historySplitAdjusted, filingsResult, true,form8KItemIndex);
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
  for (const [key, tags] of Object.entries({ revenue: REVENUE_TAGS, netIncome: ['NetIncomeLoss', 'ProfitLoss'], ocf: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations', 'NetCashFlowsFromUsedInOperatingActivities', 'CashFlowsFromUsedInOperatingActivities'], capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquirePropertyPlantAndEquipmentContinuingOperations', 'PurchaseOfPropertyPlantAndEquipment', 'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'] })) {
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
  // Preserve the root CIK and facts envelope for issuer-identity validation;
  // the legacy fundamental parsers above intentionally consume `facts` only.
  if (options.includeOpportunityResearch) await attachOpportunityEarnings(snapshot, factsResult.value, undefined, await benchmarkPromise, historySplitAdjusted, filingsResult, true,form8KItemIndex);
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
