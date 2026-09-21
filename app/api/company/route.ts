import { companyBySymbol, companySnapshot } from '@/lib/providers';
import { db, ensureSchema } from '@/lib/storage';
import { json } from '@/lib/http';

import { reconcile } from '@/lib/reconcile';
import type {Snapshot} from '@/lib/engine';
const pending=new Map<string,Promise<Snapshot>>();

export async function GET(request: Request) {
  try {
    const symbol = new URL(request.url).searchParams.get('symbol')?.trim().toUpperCase() ?? '';
    if (!/^[A-Z0-9.^-]{1,16}$/.test(symbol)) return json({ error: 'رمز غير صالح' }, 400);
    await ensureSchema();
    // Version the deep cache whenever the enrichment contract changes so a
    // previous partial response cannot mask newly available fields.
    const cacheKey = `deep:v6:${symbol}`;
    const cached = await db().prepare('SELECT retrieved_at,payload FROM raw_cache WHERE key=?').bind(cacheKey).first() as any;
    if (cached && Date.now() - Date.parse(cached.retrieved_at) < 30 * 60_000) {
      try { return json({ snapshot: JSON.parse(cached.payload), cached: true }); }
      catch { await db().prepare('DELETE FROM raw_cache WHERE key=?').bind(cacheKey).run(); }
    }
    const previousRow = await db().prepare('SELECT payload FROM fundamental_snapshots WHERE symbol=? ORDER BY as_of DESC LIMIT 1').bind(symbol).first() as any;
    let previous:Snapshot|null=null;
    try{previous=previousRow?.payload?JSON.parse(previousRow.payload) as Snapshot:null;}catch{/* ignore a corrupted historical row */}
    const company = companyBySymbol(symbol)||(previous?{ticker:symbol,name:previous.name,cik:Number(previous.cik)||0,exchange:previous.exchange||'',sector:previous.sector,industry:previous.industry,price:previous.price??undefined,marketCap:previous.marketCap??undefined}:null);
    if (!company) return json({ error: 'الشركة غير موجودة في الدليل' }, 404);
    let work=pending.get(symbol);
    if(!work){
     work=(async()=>{
      const snapshot=await companySnapshot(company);
      const result = reconcile(snapshot, previous);
      await db().prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(cacheKey, 'Nasdaq history + SEC Company Facts', new Date().toISOString(), JSON.stringify(result)).run();
      return result;
     })().finally(()=>pending.delete(symbol));
     pending.set(symbol,work);
    }
    const snapshot=await work;
    return json({ snapshot, cached: false });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'تعذّر تحميل التحقق العميق' }, 503);
  }
}
