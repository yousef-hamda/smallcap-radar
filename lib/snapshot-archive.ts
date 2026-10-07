import {env} from 'cloudflare:workers';
import type {Snapshot} from './engine';

const db=()=>{const value=(env as any).DB;if(!value)throw Error('Archive database unavailable');return value;};
let ready:Promise<unknown>|undefined;
async function schema(){ready??=db().prepare('CREATE TABLE IF NOT EXISTS snapshot_archives (id TEXT PRIMARY KEY,payload_gzip BLOB NOT NULL,evaluation_gzip BLOB NOT NULL,archived_at TEXT NOT NULL)').run().catch((error:unknown)=>{ready=undefined;throw error;});await ready;}
async function encode(text:string){return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());}
async function decode(bytes:ArrayBuffer|number[]|Uint8Array){return new Response(new Blob([new Uint8Array(bytes as ArrayBuffer)]).stream().pipeThrough(new DecompressionStream('gzip'))).text();}

/** Inline identity/summary fields remain queryable. Original source records and
 * evaluation traces are losslessly compressed, never replaced by invented data. */
export async function restoreArchivedRow<T extends {id?:string;payload:string;evaluation:string}>(row:T):Promise<T> {
 const marker=JSON.parse(row.payload).__archiveId;if(!marker)return row;
 await schema();const archived=await db().prepare('SELECT payload_gzip,evaluation_gzip FROM snapshot_archives WHERE id=?').bind(marker).first() as any;
 if(!archived)throw Error('Historical source archive is missing');
 const [payload,evaluation]=await Promise.all([decode(archived.payload_gzip),decode(archived.evaluation_gzip)]);
 return {...row,payload,evaluation};
}
export async function archivedWriteStatements(id:string,payload:string,evaluation:string){
 await schema();
 const [payloadGzip,evaluationGzip]=await Promise.all([encode(payload),encode(evaluation)]);
 const summary=archiveInlineSummary(id,payload,evaluation);
 return [
  db().prepare('INSERT OR REPLACE INTO snapshot_archives(id,payload_gzip,evaluation_gzip,archived_at) VALUES(?,?,?,?)').bind(id,payloadGzip,evaluationGzip,new Date().toISOString()),
  db().prepare('UPDATE fundamental_snapshots SET payload=?,evaluation=? WHERE id=?').bind(summary.payload,summary.evaluation,id),
 ];
}
/** Queryable identity, grades and summary flags only. Every detailed API restores
 * the original compressed source/evaluation; inline summaries are never evidence. */
export function archiveInlineSummary(id:string,payload:string,evaluation:string) {
 const snapshot=JSON.parse(payload) as Snapshot,original=JSON.parse(evaluation),grade=original.opportunity;
 const strings=new Set(['symbol','name','nameAr','asOf','cik','securityType','listingStatus','exchange','website','sector','industry','confidence','deathSpiral']);
 const inline={...Object.fromEntries(Object.entries(snapshot).filter(([key,value])=>strings.has(key)||typeof value==='number'||typeof value==='boolean'||value===null)),__archiveId:id,__archiveSummaryVersion:2,sourceConflicts:snapshot.sourceConflicts,provenance:Object.fromEntries(Object.entries(snapshot.provenance??{}).filter(([key])=>key==='securityType'||key==='exchange'))};
 const fields=['strategy','version','hash','asOf','score','snapshotHash','evaluationHash','state','status','researchState','sourceEligible','rankingEligible','algorithmicCoveragePct','coveragePct','evidencedWeight','confidence','horizonMonths','riskTolerance'];
 const compact=grade?{...Object.fromEntries(fields.filter(key=>key in grade).map(key=>[key,grade[key]])),factors:(grade.factors??[]).map((factor:any)=>({...Object.fromEntries(['id','label','weight','score','points','complete','evidenced','proxy','confidence','coveragePct','algorithmicCoveragePct'].filter(key=>key in factor).map(key=>[key,factor[key]])),sources:[],calculation:{rubricId:factor.calculation?.rubricId??'archived-canonical',inputs:[{name:'archived canonical trace',value:grade.evaluationHash??'legacy'}]}})),checks:(grade.checks??[]).map((check:any)=>({id:check.id,status:check.status,role:check.role}))}:undefined;
 return {payload:JSON.stringify(inline),evaluation:JSON.stringify(compact?{opportunity:compact}:original)};
}
async function compactHistoricalSummaries(limit:number) {
 const key='maintenance:archive-summary-v2',cursor=await db().prepare('SELECT payload FROM raw_cache WHERE key=?').bind(key).first() as any;
 const rows=(await db().prepare('SELECT s.id,s.payload,s.evaluation FROM snapshot_archives a JOIN fundamental_snapshots s ON s.id=a.id WHERE a.id>? ORDER BY a.id LIMIT ?').bind(cursor?.payload??'',limit).all()).results as any[];
 const updates=[];for(const row of rows){if(JSON.parse(row.payload).__archiveSummaryVersion===2)continue;const value=archiveInlineSummary(row.id,row.payload,row.evaluation);updates.push(db().prepare('UPDATE fundamental_snapshots SET payload=?,evaluation=? WHERE id=?').bind(value.payload,value.evaluation,row.id));}
 if(rows.length)updates.push(db().prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(key,'lossless archive summary migration',new Date().toISOString(),rows.at(-1).id));
 if(updates.length)await db().batch(updates);return {compacted:updates.length-(rows.length?1:0),more:rows.length===limit};
}
export async function maintainHistoricalStorage(limit=50){
 await schema();
 const protectedRuns=(await db().prepare("SELECT id FROM strategy_runs WHERE status IN ('complete','partial') AND stage>=13 AND source LIKE '%· full' ORDER BY updated_at DESC,created_at DESC LIMIT 1").all()).results as any[];
 const recoverable=await db().prepare("SELECT id FROM strategy_runs WHERE status='failed' AND stage<13 AND source LIKE 'Bulk Quotes/%' AND updated_at>? ORDER BY updated_at DESC,created_at DESC LIMIT 1").bind(new Date(Date.now()-24*60*60_000).toISOString()).first() as any;
 const excluded=[...protectedRuns.map(row=>String(row.id)),...(recoverable?[String(recoverable.id)]:[])];
 const candidates=(await db().prepare(`SELECT s.id,s.payload,s.evaluation FROM (SELECT s.id FROM fundamental_snapshots s JOIN strategy_runs r ON r.id=s.run_id LEFT JOIN snapshot_archives a ON a.id=s.id WHERE r.status IN ('complete','partial','failed') AND (r.stage>=13 OR r.status='failed') AND a.id IS NULL ${excluded.length?`AND s.run_id NOT IN (${excluded.map(()=>'?').join(',')})`:''} ORDER BY s.id LIMIT ?) candidates JOIN fundamental_snapshots s ON s.id=candidates.id`).bind(...excluded,limit).all()).results as any[];
 for(const row of candidates)await db().batch(await archivedWriteStatements(row.id,row.payload,row.evaluation));
 // Terminal runs never resume provider/scoring cursors. These derived caches
 // are separate from saved source evidence, favorites and portfolio state.
 await db().batch([
  db().prepare("DELETE FROM bulk_fundamentals WHERE run_id<>? AND run_id IN (SELECT id FROM strategy_runs WHERE status='failed' OR (status IN ('complete','partial') AND stage>=13))").bind(recoverable?.id??''),
  db().prepare("DELETE FROM raw_cache WHERE key LIKE 'universe:%' AND EXISTS(SELECT 1 FROM strategy_runs r WHERE r.id<>? AND r.id=substr(raw_cache.key,10,36) AND (r.status='failed' OR (r.status IN ('complete','partial') AND r.stage>=13)))").bind(recoverable?.id??''),
 ]);
 const summaries=await compactHistoricalSummaries(limit);
 return {archived:candidates.length,compacted:summaries.compacted,more:candidates.length===limit||summaries.more};
}
