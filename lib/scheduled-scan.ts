import {readCompleteDirectory} from './directory-cache';
import {maintainHistoricalStorage} from './snapshot-archive';
import {db,ensureSchema,currentHash,ensureRunEvaluations} from './storage';
import {processScanBatch,startScan} from './scanner';

/** One bounded tick; durable scanner leases arbitrate scheduler, browser and batons. */
export async function scheduledScanTick(now=Date.now(),capacity?:{reusableBytes:number;filesystemFreeBytes:number}) {
 await ensureSchema();
 const recoverable=await db().prepare("SELECT id FROM strategy_runs WHERE strategy_hash=? AND status='failed' AND stage=0 AND error LIKE 'Complete official listing inventory unavailable:%' ORDER BY updated_at DESC LIMIT 1").bind(currentHash()).first() as any;
 if(recoverable&&await readCompleteDirectory())await db().prepare("UPDATE strategy_runs SET status='running',error=NULL,retry_queue='[]',lease_until=0,updated_at=? WHERE id=? AND status='failed' AND stage=0").bind(new Date(now).toISOString(),recoverable.id).run();
 const maintenance=await maintainHistoricalStorage();
 const active=await db().prepare("SELECT id FROM strategy_runs WHERE strategy_hash=? AND source LIKE 'Bulk Quotes/%' AND status IN ('running','partial') AND stage<13 ORDER BY updated_at DESC,created_at DESC LIMIT 1").bind(currentHash()).first() as any;
 let id=active?.id;
 if(!id) {
  const availableBytes=(capacity?.reusableBytes??0)+(capacity?.filesystemFreeBytes??0);
  if(maintenance.more&&availableBytes<512*1024*1024)return {maintenance};
  if(capacity&&(availableBytes<512*1024*1024||capacity.filesystemFreeBytes<32*1024*1024))return {maintenance,pausedForCapacity:true};
  const latest=await db().prepare("SELECT id,created_at,updated_at,status FROM strategy_runs WHERE strategy_hash=? AND status IN ('complete','partial','failed') AND source LIKE 'Bulk Quotes/%' AND source LIKE '%· full' ORDER BY updated_at DESC,created_at DESC LIMIT 1").bind(currentHash()).first() as any;
  const refreshDelay=latest?.status==='failed'?30*60_000:24*60*60_000;
  if(latest&&now-Date.parse(latest.updated_at||latest.created_at)<refreshDelay)return {idle:true,nextDueAt:new Date(Date.parse(latest.updated_at||latest.created_at)+refreshDelay).toISOString()};
  id=(await startScan('full')).id;
 }
 const result=await processScanBatch(String(id));
 if(result.done&&['complete','partial'].includes(result.run.status))await ensureRunEvaluations(String(id));
 return result;
}
