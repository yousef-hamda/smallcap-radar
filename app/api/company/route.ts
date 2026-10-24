import { requestedRankRelease } from '@/lib/rank-release';
import { resolveCompanyBySymbol, companySnapshot, historicalMarketData, observedNasdaqCompanyDescription, type HistoricalResult } from '@/lib/providers';
import { db, ensureSchema, readCanonicalCompany } from '@/lib/storage';
import { json, statusOf } from '@/lib/http';

import { reconcile } from '@/lib/reconcile';
import { secUserAgentCacheVersion } from '@/lib/sec-user-agent';
import { evaluateOpportunityDossier, opportunityDossierFromSnapshot } from '@/lib/opportunity-dossier';
import type {Snapshot} from '@/lib/engine';
import {translateToArabic} from '@/lib/translation';
import {createEphemeralCache} from '@/lib/ephemeral-cache';
const deepCache=createEphemeralCache<Snapshot>(30*60_000,32);
const chartHistoryCache=createEphemeralCache<HistoricalResult>(15*60_000,32);

async function displayHistory(symbol:string,asOf:string){
  const result=await chartHistoryCache.get(`${symbol}:${asOf.slice(0,10)}`,()=>historicalMarketData(symbol,asOf,1900));
  const cutoff=Date.parse(asOf),bars=new Map<string,NonNullable<Snapshot['history']>[number]>();
  for(const bar of result.history){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(bar.date)||!Number.isFinite(bar.close)||bar.close<=0||Date.parse(`${bar.date}T21:00:00Z`)>cutoff)continue;
    const prior=bars.get(bar.date);
    if(prior&&prior.close!==bar.close)throw Error('تعارض في إغلاقات التاريخ السعري');
    bars.set(bar.date,bar);
  }
  const history=[...bars.values()].sort((a,b)=>a.date.localeCompare(b.date));
  const periodEnd=history.at(-1)?.date;
  if(!periodEnd)throw Error('لا توجد جلسات مكتملة في التاريخ السعري');
  const stale=result.source.includes('fallback')||cutoff-Date.parse(`${periodEnd}T21:00:00Z`)>7*86_400_000;
  return {history,source:{source:result.source,url:result.url,periodEnd,availableAt:result.availableAt,retrievedAt:result.retrievedAt,currency:'USD',confidence:result.source.includes('fallback')?'low':'medium' as const,rightsStatus:'unknown' as const,tag:'display-only completed daily history; saved rating unchanged'},stale};
}

export async function GET(request: Request) {
  try {
    const params=new URL(request.url).searchParams;
    const symbol = params.get('symbol')?.trim().toUpperCase() ?? '';
    if (!/^[A-Z0-9.^-]{1,16}$/.test(symbol)) return json({ error: 'رمز غير صالح' }, 400);
    await ensureSchema();
    const pin=requestedRankRelease(params);
    const canonical=await readCanonicalCompany(symbol,pin.runId,pin.releaseToken);
    if(pin.runId&&!canonical)return json({error:'الشركة غير موجودة في إصدار الترتيب المطلوب'},404);
    if(canonical){
      // Keep the archived rating snapshot unchanged. A current issuer
      // explanation is display-only and carries its own observation date.
      const includeDescription=params.get('includeDescription')!=='0';
      const missingDescription=!canonical.snapshot.description||canonical.snapshot.description.startsWith('الوصف غير متاح');
      const [profileDescription,chart]=await Promise.all([
        includeDescription&&missingDescription?(async()=>{try{const observed=await observedNasdaqCompanyDescription(symbol);if(!observed)return null;const translated=await translateToArabic(observed.description,3_600);return {description:observed.description,descriptionAr:translated?.text,source:observed.source};}catch{return null;}})():Promise.resolve(null),
        params.get('includeHistory')==='1'?displayHistory(symbol,new Date().toISOString()).catch(()=>null):Promise.resolve(null),
      ]);
      const snapshot=chart?{...canonical.snapshot,history:chart.history,provenance:{...canonical.snapshot.provenance,history:chart.source}}:canonical.snapshot;
      const chartHistory=chart?{source:chart.source.source,availableAt:chart.source.availableAt,retrievedAt:chart.source.retrievedAt,periodEnd:chart.source.periodEnd,stale:chart.stale}:null;
      return json({...canonical,snapshot,cached:true,ratingSource:'saved-production-universe',profileDescription,chartHistory,historyUnavailable:params.get('includeHistory')==='1'&&!chart});
    }
    // Version the deep cache whenever the enrichment contract changes so a
    // previous partial response cannot mask newly available fields.
    const cacheKey = `deep:${secUserAgentCacheVersion()}:${symbol}`;
    const cached = await db().prepare('SELECT retrieved_at,payload FROM raw_cache WHERE key=?').bind(cacheKey).first() as any;
    let cachedSnapshot:Snapshot|null=null;
    try{if(cached)cachedSnapshot=JSON.parse(cached.payload) as Snapshot;}catch{/* ignore a corrupted legacy cache row */}
    if(cachedSnapshot&&Date.now()-Date.parse(cached.retrieved_at)<30*60_000)
      return json({snapshot:cachedSnapshot,evaluation:evaluateOpportunityDossier(cachedSnapshot,opportunityDossierFromSnapshot(cachedSnapshot)),cached:true});
    const previousRow = await db().prepare('SELECT payload FROM fundamental_snapshots WHERE symbol=? ORDER BY as_of DESC LIMIT 1').bind(symbol).first() as any;
    let previous:Snapshot|null=null;
    try{previous=previousRow?.payload?JSON.parse(previousRow.payload) as Snapshot:null;}catch{/* ignore a corrupted historical row */}
    const company = await resolveCompanyBySymbol(symbol)||(previous?{ticker:symbol,name:previous.name,cik:Number(previous.cik)||0,exchange:previous.exchange||'',sector:previous.sector,industry:previous.industry,price:previous.price??undefined,marketCap:previous.marketCap??undefined}:null);
    if (!company) return json({ error: 'الشركة غير موجودة في الدليل' }, 404);
    try{
      const snapshot=await deepCache.get(cacheKey,async()=>reconcile(await companySnapshot(company,{includeOpportunityResearch:true}),previous));
      return json({snapshot,evaluation:evaluateOpportunityDossier(snapshot,opportunityDossierFromSnapshot(snapshot)),cached:false});
    }catch(error){
      // A dated legacy observation is more useful than a blank profile when
      // the upstream provider is unavailable. It is never silently redated.
      if(cachedSnapshot)return json({snapshot:cachedSnapshot,evaluation:evaluateOpportunityDossier(cachedSnapshot,opportunityDossierFromSnapshot(cachedSnapshot)),cached:true,stale:true});
      throw error;
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'تعذّر تحميل التحقق العميق' }, statusOf(error,503));
  }
}
