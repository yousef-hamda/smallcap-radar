import {env} from 'cloudflare:workers';
import type {Snapshot} from './engine';
import {compactRadarEvaluation} from './compact-radar';
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
 const snapshot=JSON.parse(payload) as Snapshot;
 const inline={...snapshot,__archiveId:id,opportunityResearch:snapshot.opportunityResearch?{...snapshot.opportunityResearch,earnings:{...snapshot.opportunityResearch.earnings,annual:[],quarterly:[]},secFilings:undefined}:undefined,provenance:Object.fromEntries(Object.entries(snapshot.provenance??{}).map(([key,value])=>[key,{...value,dependencies:undefined}]))};
 delete inline.history;delete inline.news;delete inline.insiderPurchases;delete inline.peerContext;
 const original=JSON.parse(evaluation),opportunity=original.opportunity;
 const compact=opportunity?.thesis?compactRadarEvaluation(opportunity):original.opportunity?{...opportunity,factors:(opportunity.factors??[]).map((factor:any)=>({...factor,sources:[],calculation:factor.calculation?{...factor.calculation,inputs:[{name:'archived canonical trace',value:opportunity.evaluationHash??'legacy'}]}:undefined}))}:undefined;
 return [
  db().prepare('INSERT OR REPLACE INTO snapshot_archives(id,payload_gzip,evaluation_gzip,archived_at) VALUES(?,?,?,?)').bind(id,payloadGzip,evaluationGzip,new Date().toISOString()),
  db().prepare('UPDATE fundamental_snapshots SET payload=?,evaluation=? WHERE id=?').bind(JSON.stringify(inline),JSON.stringify(compact?{...original,opportunity:compact}:original),id),
 ];
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
 return {archived:candidates.length,more:candidates.length===limit};
}
