import {recordScanCapacity,MIN_SCAN_FILESYSTEM_BYTES} from './scan-capacity';
import {readCompleteDirectory} from './directory-cache';
import {maintainHistoricalStorage} from './snapshot-archive';
import {db,ensureSchema,currentHash,ensureRunEvaluations,publishResearchFitRankProjectionBatch} from './storage';
import {opportunitySpecHash} from './opportunity-spec';
import {processScanBatch,startScan} from './scanner';

/** One bounded tick; durable scanner leases arbitrate scheduler, browser and batons. */
export async function scheduledScanTick(now=Date.now(),capacity?:{reusableBytes:number;filesystemFreeBytes:number}) {
 await ensureSchema();
 if(capacity)await recordScanCapacity(capacity,now);
 // Archive compaction and cache eviction also write SQLite pages and a WAL.
 // Pause those writes at the same physical reserve as source acquisition.
 if(capacity&&capacity.filesystemFreeBytes<MIN_SCAN_FILESYSTEM_BYTES)return {pausedForCapacity:true};
 const recoverable=await db().prepare("SELECT id FROM strategy_runs WHERE strategy_hash=? AND status='failed' AND stage=0 AND error LIKE 'Complete official listing inventory unavailable:%' ORDER BY updated_at DESC LIMIT 1").bind(currentHash()).first() as any;
 if(recoverable&&await readCompleteDirectory())await db().prepare("UPDATE strategy_runs SET status='running',error=NULL,retry_queue='[]',lease_until=0,updated_at=? WHERE id=? AND status='failed' AND stage=0").bind(new Date(now).toISOString(),recoverable.id).run();
 const active=await db().prepare("SELECT id,lease_until,stage,offset,processed,total,status FROM strategy_runs WHERE strategy_hash=? AND source LIKE 'Bulk Quotes/%' AND status IN ('running','partial') AND stage<13 ORDER BY updated_at DESC,created_at DESC LIMIT 1").bind(currentHash()).first() as any;
 if(active&&Number(active.lease_until)>now)return {busy:true,run:active};
 // Publish the exact research-fit flags in small resumable slices before
 // maintenance or scan writes can compete for SQLite. Reads return 409 until
 // this projection is complete, rather than starting a full backfill inline.
 const projectionRun=await db().prepare("SELECT r.id FROM strategy_runs r JOIN opportunity_rank_versions v ON v.run_id=r.id WHERE r.status IN ('complete','partial') AND r.stage>=13 AND r.source LIKE '%· full' AND v.rubric_hash=? ORDER BY r.updated_at DESC,r.created_at DESC LIMIT 1").bind(opportunitySpecHash()).first() as any;
 const projectionPublication=projectionRun?await publishResearchFitRankProjectionBatch(String(projectionRun.id)):null;
 let id=active?.id;
 if(!active&&projectionPublication&&!projectionPublication.done)return {projectionPublication};
 // Keep archival writes out of active scan ticks; scan checkpoints and source
 // acquisition share the same single SQLite volume.
 const maintenance=active?null:await maintainHistoricalStorage();
 if(!id) {
  const availableBytes=(capacity?.reusableBytes??0)+(capacity?.filesystemFreeBytes??0);
  if(maintenance?.more&&availableBytes<512*1024*1024)return {maintenance};
  if(capacity&&(availableBytes<512*1024*1024||capacity.filesystemFreeBytes<512*1024*1024))return {maintenance,pausedForCapacity:true};
  const latest=await db().prepare("SELECT id,created_at,updated_at,status FROM strategy_runs WHERE strategy_hash=? AND status IN ('complete','partial','failed') AND source LIKE 'Bulk Quotes/%' AND source LIKE '%· full' ORDER BY updated_at DESC,created_at DESC LIMIT 1").bind(currentHash()).first() as any;
  const refreshDelay=latest?.status==='failed'?30*60_000:24*60*60_000;
  if(latest&&now-Date.parse(latest.updated_at||latest.created_at)<refreshDelay)return {idle:true,nextDueAt:new Date(Date.parse(latest.updated_at||latest.created_at)+refreshDelay).toISOString()};
  id=(await startScan('full')).id;
 }
 const result=await processScanBatch(String(id));
 if(result.done&&['complete','partial'].includes(result.run.status))await ensureRunEvaluations(String(id));
 return {...result,...(maintenance?{maintenance}:{}),...(projectionPublication?{projectionPublication}:{})};
}
