import { requestedRankRelease } from '@/lib/rank-release';
import { resolveCompanyBySymbol, companySnapshot, observedNasdaqCompanyDescription } from '@/lib/providers';
import { db, ensureSchema, readCanonicalCompany } from '@/lib/storage';
import { json, statusOf } from '@/lib/http';

import { reconcile } from '@/lib/reconcile';
import { secUserAgentCacheVersion } from '@/lib/sec-user-agent';
import { evaluateOpportunityDossier, opportunityDossierFromSnapshot } from '@/lib/opportunity-dossier';
import type {Snapshot} from '@/lib/engine';
import {translateToArabic} from '@/lib/translation';
import {createEphemeralCache} from '@/lib/ephemeral-cache';
const deepCache=createEphemeralCache<Snapshot>(30*60_000,32);

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
      // Keep the archived rating snapshot unchanged. A current issuer
      // explanation is display-only and carries its own observation date.
      const missingDescription=!canonical.snapshot.description||canonical.snapshot.description.startsWith('الوصف غير متاح');
      const observed=missingDescription?await observedNasdaqCompanyDescription(symbol):null;
      const translated=observed?await translateToArabic(observed.description,3_600):null;
      return json({...canonical,cached:true,ratingSource:'saved-production-universe',profileDescription:observed?{description:observed.description,descriptionAr:translated?.text,source:observed.source}:null});
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
