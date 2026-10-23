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
 const fields=['strategy','version','hash','asOf','score','snapshotHash','evaluationHash','state','status','researchState','sourceEligible','rankingEligible','algorithmicCoveragePct','modelInputCoveragePct','coveragePct','evidencedWeight','confidence','horizonMonths','riskTolerance'];
 const compact=grade?{...Object.fromEntries(fields.filter(key=>key in grade).map(key=>[key,grade[key]])),factors:(grade.factors??[]).map((factor:any)=>({...Object.fromEntries(['id','label','weight','score','points','complete','evidenced','proxy','confidence','coveragePct','algorithmicCoveragePct','modelInputCoveragePct'].filter(key=>key in factor).map(key=>[key,factor[key]])),sources:[],calculation:{rubricId:factor.calculation?.rubricId??'archived-canonical',inputs:[{name:'archived canonical trace',value:grade.evaluationHash??'legacy'}]}})),checks:(grade.checks??[]).map((check:any)=>({id:check.id,status:check.status,role:check.role}))}:undefined;
 return {payload:JSON.stringify(inline),evaluation:JSON.stringify(compact?{opportunity:compact}:original)};
}
async function compactHistoricalSummaries(limit:number) {
 limit=Number.isFinite(limit)?Math.max(1,Math.min(100,Math.floor(limit))):50;
 const key='maintenance:archive-summary-v2',cursor=await db().prepare('SELECT payload FROM raw_cache WHERE key=?').bind(key).first() as any;
 const rows=(await db().prepare('SELECT s.id,s.payload,s.evaluation FROM snapshot_archives a JOIN fundamental_snapshots s ON s.id=a.id WHERE a.id>? ORDER BY a.id LIMIT ?').bind(cursor?.payload??'',limit).all()).results as any[];
 const updates=[];for(const row of rows){if(JSON.parse(row.payload).__archiveSummaryVersion===2)continue;const value=archiveInlineSummary(row.id,row.payload,row.evaluation);updates.push(db().prepare('UPDATE fundamental_snapshots SET payload=?,evaluation=? WHERE id=?').bind(value.payload,value.evaluation,row.id));}
 if(rows.length)updates.push(db().prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(key,'lossless archive summary migration',new Date().toISOString(),rows.at(-1).id));
 if(updates.length)await db().batch(updates);return {compacted:updates.length-(rows.length?1:0),more:rows.length===limit};
}
export async function maintainHistoricalStorage(limit=50){
 await schema();const boundedLimit=Number.isFinite(limit)?Math.max(1,Math.min(100,Math.floor(limit))):50,d=db(),cursorKey='maintenance:archive-candidate-v1',cleanupKey='maintenance:terminal-cache-cleanup-v2';
 const protectedRun=await d.prepare("SELECT id,updated_at FROM strategy_runs WHERE status IN ('complete','partial') AND stage>=13 AND source LIKE '%· full' ORDER BY updated_at DESC,created_at DESC LIMIT 1").first() as any;
 const terminalStats=await d.prepare("SELECT COUNT(*) AS count,MAX(updated_at) AS updated_at FROM strategy_runs WHERE status IN ('complete','partial','failed') AND (stage>=13 OR status='failed')").first() as any;
 const recoverable=await d.prepare("SELECT id,updated_at FROM strategy_runs WHERE status='failed' AND stage<13 AND source LIKE 'Bulk Quotes/%' AND updated_at>? ORDER BY updated_at DESC,created_at DESC LIMIT 1").bind(new Date(Date.now()-24*60*60_000).toISOString()).first() as any;
 const excluded=[...new Set([...(protectedRun?[String(protectedRun.id)]:[]),...(recoverable?[String(recoverable.id)]:[])])];
 // UUID snapshot IDs are not chronological. Invalidate the keyset whenever a
 // terminal run is added or updated so late-arriving rows cannot sit behind it.
 const fingerprint=JSON.stringify([Number(terminalStats?.count??0),terminalStats?.updated_at??'',protectedRun?.id??'',protectedRun?.updated_at??'',recoverable?.id??'',recoverable?.updated_at??'']);
 const stateRow=await d.prepare('SELECT payload FROM raw_cache WHERE key=?').bind(cursorKey).first() as any;
 let state:any;try{state=stateRow?JSON.parse(stateRow.payload):null}catch{state=null;}
 if(!state||state.fingerprint!==fingerprint||typeof state.cursor!=='string'||typeof state.exhausted!=='boolean'||typeof state.completedAt!=='number'||!Number.isFinite(state.completedAt)||state.exhausted&&Date.now()-state.completedAt>24*60*60_000)state={fingerprint,cursor:'',exhausted:false,completedAt:0};
 const cleanupRow=await d.prepare('SELECT payload FROM raw_cache WHERE key=?').bind(cleanupKey).first() as any;
 let cleanupState:any;try{cleanupState=cleanupRow?JSON.parse(cleanupRow.payload):null}catch{cleanupState=null;}
 const cleanupStateValid=cleanupState?.fingerprint===fingerprint&&typeof cleanupState.tables?.bulk?.runId==='string'&&Number.isSafeInteger(cleanupState.tables.bulk.cik)&&cleanupState.tables.bulk.cik>=0&&typeof cleanupState.tables.bulk.done==='boolean'&&typeof cleanupState.tables?.outcomes?.runId==='string'&&Number.isSafeInteger(cleanupState.tables.outcomes.cik)&&cleanupState.tables.outcomes.cik>=0&&typeof cleanupState.tables.outcomes.done==='boolean'&&typeof cleanupState.tables?.universe?.key==='string'&&typeof cleanupState.tables.universe.done==='boolean'&&typeof cleanupState.completedAt==='number'&&Number.isFinite(cleanupState.completedAt);
 const cleanupWasComplete=cleanupStateValid&&Object.values(cleanupState.tables).every((table:any)=>table.done)&&cleanupState.completedAt>0&&Date.now()-cleanupState.completedAt<=24*60*60_000;
 if(!cleanupStateValid||cleanupState.completedAt>0&&Date.now()-cleanupState.completedAt>24*60*60_000)cleanupState={fingerprint,tables:{bulk:{runId:'',cik:0,done:false},outcomes:{runId:'',cik:0,done:false},universe:{key:'',done:false}},completedAt:0};
 const cleanupLimit=Math.min(10,boundedLimit),cleanupStatements:any[]=[];let cleaned=0;
 for(const [name,table] of [['bulk','bulk_fundamentals'],['outcomes','company_facts_outcomes']] as const){
  const cursor=cleanupState.tables[name];if(cursor.done)continue;
  const rows=(await d.prepare(`SELECT b.rowid AS rowId,b.run_id AS runId,b.cik AS cik FROM ${table} b JOIN strategy_runs r ON r.id=b.run_id WHERE b.run_id<>? AND (b.run_id>? OR (b.run_id=? AND b.cik>?)) AND (r.status='failed' OR (r.status IN ('complete','partial') AND r.stage>=13)) ORDER BY b.run_id,b.cik LIMIT ?`).bind(recoverable?.id??'',cursor.runId,cursor.runId,cursor.cik,cleanupLimit).all()).results as any[];
  if(rows.length){const last=rows.at(-1);cursor.runId=String(last.runId);cursor.cik=Number(last.cik);cleanupStatements.push(...rows.map(row=>d.prepare(`DELETE FROM ${table} WHERE rowid=?`).bind(row.rowId)));cleaned+=rows.length;}
  cursor.done=rows.length<cleanupLimit;
 }
 if(!cleanupState.tables.universe.done){
  const cursor=cleanupState.tables.universe;
  const rows=(await d.prepare("SELECT c.rowid AS rowId,c.key AS key FROM raw_cache c WHERE c.key LIKE 'universe:%' AND c.key>? AND EXISTS(SELECT 1 FROM strategy_runs r WHERE r.id<>? AND r.id=substr(c.key,10,36) AND (r.status='failed' OR (r.status IN ('complete','partial') AND r.stage>=13))) ORDER BY c.key LIMIT ?").bind(cursor.key,recoverable?.id??'',cleanupLimit).all()).results as any[];
  if(rows.length){cursor.key=String(rows.at(-1).key);cleanupStatements.push(...rows.map(row=>d.prepare('DELETE FROM raw_cache WHERE rowid=?').bind(row.rowId)));cleaned+=rows.length;}
  cursor.done=rows.length<cleanupLimit;
 }
 const cleanupDone=Object.values(cleanupState.tables).every((table:any)=>table.done);
 if(cleanupDone&&!cleanupState.completedAt)cleanupState.completedAt=Date.now();
 if(cleaned||!cleanupWasComplete){cleanupStatements.push(d.prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(cleanupKey,'bounded terminal cache cleanup checkpoint',new Date().toISOString(),JSON.stringify(cleanupState)));await d.batch(cleanupStatements);}
 let candidates:any[]=[];
 if(!state.exhausted){
  candidates=(await d.prepare(`SELECT s.id,s.payload,s.evaluation FROM (SELECT s.id FROM fundamental_snapshots s JOIN strategy_runs r ON r.id=s.run_id LEFT JOIN snapshot_archives a ON a.id=s.id WHERE r.status IN ('complete','partial','failed') AND (r.stage>=13 OR r.status='failed') AND a.id IS NULL AND s.id>? ${excluded.length?`AND s.run_id NOT IN (${excluded.map(()=>'?').join(',')})`:''} ORDER BY s.id LIMIT ?) candidates JOIN fundamental_snapshots s ON s.id=candidates.id`).bind(state.cursor,...excluded,boundedLimit).all()).results as any[];
  for(let offset=0;offset<candidates.length;offset+=10){
   const statements=await Promise.all(candidates.slice(offset,offset+10).map(row=>archivedWriteStatements(row.id,row.payload,row.evaluation)));
   await d.batch(statements.flat());
  }
  if(candidates.length)state.cursor=String(candidates.at(-1).id);
  state.exhausted=candidates.length<boundedLimit;
  if(state.exhausted)state.completedAt=Date.now();
  await d.prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(cursorKey,'historical archive keyset checkpoint',new Date().toISOString(),JSON.stringify(state)).run();
 }
 const summaries=await compactHistoricalSummaries(boundedLimit);
 const diagnosticLimit=Math.min(10,boundedLimit),retentionCutoff=new Date(Date.now()-90*24*60*60_000).toISOString();
 const oldDiagnostics=(await d.prepare('SELECT rowid AS rowId FROM diag WHERE created_at<? ORDER BY created_at,rowid LIMIT ?').bind(retentionCutoff,diagnosticLimit).all()).results as any[];
 if(oldDiagnostics.length)await d.batch(oldDiagnostics.map(row=>d.prepare('DELETE FROM diag WHERE rowid=?').bind(row.rowId)));
 return {archived:candidates.length,compacted:summaries.compacted,cleaned,diagnosticsPruned:oldDiagnostics.length,more:!cleanupDone||!state.exhausted||summaries.more||oldDiagnostics.length===diagnosticLimit};
}
