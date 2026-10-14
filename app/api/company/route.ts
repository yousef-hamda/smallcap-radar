import { requestedRankRelease } from '@/lib/rank-release';
import { resolveCompanyBySymbol, companySnapshot } from '@/lib/providers';
import { db, ensureSchema, readCanonicalCompany } from '@/lib/storage';
import { json, statusOf } from '@/lib/http';

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

export async function GET(request: Request) {
  try {
    const symbol = new URL(request.url).searchParams.get('symbol')?.trim().toUpperCase() ?? '';
    if (!/^[A-Z0-9.^-]{1,16}$/.test(symbol)) return json({ error: 'رمز غير صالح' }, 400);
    await ensureSchema();
    const params=new URL(request.url).searchParams;
    const pin=requestedRankRelease(params);
    const canonical=await readCanonicalCompany(symbol,pin.runId,pin.releaseToken);
    if(pin.runId&&!canonical)return json({error:'الشركة غير موجودة في إصدار الترتيب المطلوب'},404);
    if(canonical)return json({...canonical,cached:true,ratingSource:'saved-production-universe'});
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
