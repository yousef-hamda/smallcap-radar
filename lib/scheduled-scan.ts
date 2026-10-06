import {maintainHistoricalStorage} from './snapshot-archive';
import {db,ensureSchema,currentHash,ensureRunEvaluations} from './storage';
import {processScanBatch,startScan} from './scanner';

/** One bounded tick; durable scanner leases arbitrate scheduler, browser and batons. */
export async function scheduledScanTick(now=Date.now()) {
 await ensureSchema();
 const maintenance=await maintainHistoricalStorage();
 const active=await db().prepare("SELECT id FROM strategy_runs WHERE strategy_hash=? AND source LIKE 'Bulk Quotes/%' AND status IN ('running','partial') AND stage<13 ORDER BY created_at DESC LIMIT 1").bind(currentHash()).first() as any;
 let id=active?.id;
 if(!id) {
  const reusable=await db().prepare('PRAGMA freelist_count').first() as any;
  if(maintenance.more&&Number(reusable?.freelist_count??0)<131072)return {maintenance};
  const latest=await db().prepare("SELECT id,created_at,status FROM strategy_runs WHERE strategy_hash=? AND status IN ('complete','partial','failed') AND source LIKE 'Bulk Quotes/%' AND source LIKE '%· full' ORDER BY created_at DESC LIMIT 1").bind(currentHash()).first() as any;
  const refreshDelay=latest?.status==='failed'?30*60_000:24*60*60_000;
  if(latest&&now-Date.parse(latest.created_at)<refreshDelay)return {idle:true,nextDueAt:new Date(Date.parse(latest.created_at)+refreshDelay).toISOString()};
  id=(await startScan('full')).id;
 }
 const result=await processScanBatch(String(id));
 if(result.done&&['complete','partial'].includes(result.run.status))await ensureRunEvaluations(String(id));
 return result;
}
