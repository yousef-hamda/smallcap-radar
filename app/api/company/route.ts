import { requestedRankRelease } from '@/lib/rank-release';
import { resolveCompanyBySymbol, companySnapshot, historicalMarketData } from '@/lib/providers';
import { db, ensureSchema, readCanonicalCompany } from '@/lib/storage';
import { json, statusOf } from '@/lib/http';
import {decodeHistoryCache} from '@/lib/history-cache';

import { reconcile } from '@/lib/reconcile';
import { secUserAgentCacheVersion } from '@/lib/sec-user-agent';
import { evaluateOpportunityDossier, opportunityDossierFromSnapshot } from '@/lib/opportunity-dossier';
import type {Snapshot} from '@/lib/engine';
const pending=new Map<string,Promise<Snapshot>>();
const memory=new Map<string,{expiresAt:number;snapshot:Snapshot}>();
function remember(key:string,snapshot:Snapshot){
 memory.delete(key);memory.set(key,{expiresAt:Date.now()+30*60_000,snapshot});
 while(memory.size>32)memory.delete(memory.keys().next().value!);
}

// Published ratings remain pinned to their saved snapshot. Chart history is
// independently dated display data, loaded only when explicitly requested.
type CanonicalChart={history:NonNullable<Snapshot['history']>;source:string;availableAt:string;retrievedAt:string;stale:boolean};
async function canonicalChartHistory(symbol:string):Promise<CanonicalChart|null>{
 const now=new Date().toISOString(),cutoff=now.slice(0,10),prefix=`scan-history:v3:${symbol}:`;
 const validBars=(value:unknown):NonNullable<Snapshot['history']>=>{
  if(!value||typeof value!=='object'||!Array.isArray((value as {history?:unknown}).history))return [];
  return (value as {history:unknown[]}).history.filter((bar):bar is NonNullable<Snapshot['history']>[number]=>
   !!bar&&typeof bar==='object'&&/^\d{4}-\d{2}-\d{2}$/.test(String((bar as {date?:unknown}).date))
   &&String((bar as {date:string}).date)<=cutoff&&Number.isFinite((bar as {close?:unknown}).close)
   &&Number((bar as {close:number}).close)>0).sort((a,b)=>a.date.localeCompare(b.date));
 };
 let fallback:CanonicalChart|null=null;
 try{
  const rows=(await db().prepare('SELECT payload,retrieved_at,source FROM raw_cache WHERE key>=? AND key<? ORDER BY retrieved_at DESC LIMIT 3').bind(prefix,`${prefix}\uffff`).all()).results as Array<{payload:string;retrieved_at:string;source:string}>;
  for(const row of rows){
   try{
    const value=await decodeHistoryCache(String(row.payload)) as {history?:unknown;source?:string;availableAt?:string;retrievedAt?:string};
    const history=validBars(value);
    if(history.length<2)continue;
    const retrievedAt=value.retrievedAt||row.retrieved_at;
    fallback={history,source:value.source||row.source,availableAt:value.availableAt||`${history.at(-1)!.date}T21:00:00.000Z`,retrievedAt,stale:true};
    const recentSession=Date.now()-Date.parse(`${history.at(-1)!.date}T21:00:00.000Z`)<7*86_400_000;
    if(recentSession&&Date.now()-Math.min(Date.parse(row.retrieved_at),Date.parse(retrievedAt))<24*3_600_000)return {...fallback,stale:false};
    break;
   }
   catch{/* a damaged chart cache must not hide the saved company file */}
  }
 }catch{/* the saved company file remains available if chart-cache lookup fails */}
 try{
  const result=await historicalMarketData(symbol,now,1900),history=validBars(result);
  const retrievedAt=Date.parse(result.retrievedAt);
  const recentSession=history.length>=2&&Date.now()-Date.parse(`${history.at(-1)!.date}T21:00:00.000Z`)<7*86_400_000;
  return history.length>=2?{history,source:result.source,availableAt:result.availableAt,retrievedAt:result.retrievedAt,stale:!recentSession||!Number.isFinite(retrievedAt)||Date.now()-retrievedAt>=24*3_600_000}:fallback;
 }catch{return fallback;}
}

export async function GET(request: Request) {
  try {
    const symbol = new URL(request.url).searchParams.get('symbol')?.trim().toUpperCase() ?? '';
    if (!/^[A-Z0-9.^-]{1,16}$/.test(symbol)) return json({ error: 'رمز غير صالح' }, 400);
    await ensureSchema();
    const params=new URL(request.url).searchParams;
    const pin=requestedRankRelease(params);
    const canonical=await readCanonicalCompany(symbol,pin.runId,pin.releaseToken);
    if(pin.runId&&!canonical)return json({error:'الشركة غير موجودة في إصدار الترتيب المطلوب'},404);
    if(canonical){
      const chartHistory=params.get('includeHistory')==='1'?await canonicalChartHistory(symbol):null;
      const snapshot=chartHistory?{...canonical.snapshot,history:chartHistory.history}:canonical.snapshot;
      return json({...canonical,snapshot,chartHistory:chartHistory?{source:chartHistory.source,availableAt:chartHistory.availableAt,retrievedAt:chartHistory.retrievedAt,stale:chartHistory.stale}:null,cached:true,ratingSource:'saved-production-universe'});
    }
    // Version the deep cache whenever the enrichment contract changes so a
    // previous partial response cannot mask newly available fields.
    const cacheKey = `deep:${secUserAgentCacheVersion()}:${symbol}`;
    const cached = await db().prepare('SELECT retrieved_at,payload FROM raw_cache WHERE key=?').bind(cacheKey).first() as any;
    let cachedSnapshot:Snapshot|null=null;
    try{if(cached)cachedSnapshot=JSON.parse(cached.payload) as Snapshot;}catch{/* ignore corrupted legacy cache */}
    const hot=memory.get(cacheKey);
    if(hot&&hot.expiresAt>Date.now())return json({snapshot:hot.snapshot,evaluation:evaluateOpportunityDossier(hot.snapshot,opportunityDossierFromSnapshot(hot.snapshot)),cached:true});
    if(cachedSnapshot&&Date.now()-Date.parse(cached.retrieved_at)<30*60_000)return json({snapshot:cachedSnapshot,evaluation:evaluateOpportunityDossier(cachedSnapshot,opportunityDossierFromSnapshot(cachedSnapshot)),cached:true});
    const previousRow = await db().prepare('SELECT payload FROM fundamental_snapshots WHERE symbol=? ORDER BY as_of DESC LIMIT 1').bind(symbol).first() as any;
    let previous:Snapshot|null=null;
    try{previous=previousRow?.payload?JSON.parse(previousRow.payload) as Snapshot:null;}catch{/* ignore a corrupted historical row */}
    const company = await resolveCompanyBySymbol(symbol)||(previous?{ticker:symbol,name:previous.name,cik:Number(previous.cik)||0,exchange:previous.exchange||'',sector:previous.sector,industry:previous.industry,price:previous.price??undefined,marketCap:previous.marketCap??undefined}:null);
    if (!company) return json({ error: 'الشركة غير موجودة في الدليل' }, 404);
    try{
      let work=pending.get(symbol);
      if(!work){
       work=(async()=>reconcile(await companySnapshot(company,{includeOpportunityResearch:true}),previous))().finally(()=>pending.delete(symbol));
       pending.set(symbol,work);
      }
      const snapshot=await work;remember(cacheKey,snapshot);
      return json({ snapshot, evaluation:evaluateOpportunityDossier(snapshot,opportunityDossierFromSnapshot(snapshot)), cached: false });
    }catch(error){
      if(cachedSnapshot)return json({snapshot:cachedSnapshot,evaluation:evaluateOpportunityDossier(cachedSnapshot,opportunityDossierFromSnapshot(cachedSnapshot)),cached:true,stale:true});
      throw error;
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'تعذّر تحميل التحقق العميق' }, statusOf(error,503));
  }
}
