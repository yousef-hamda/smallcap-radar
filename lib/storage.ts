import {env} from 'cloudflare:workers';
import {evaluateStrategy,specHash,type Snapshot} from './engine';
export const db=()=>{const d=(env as any).DB;if(!d)throw Error('قاعدة البيانات غير متاحة');return d;};
let schemaPromise:Promise<void>|null=null;
export async function ensureSchema(){
 if(schemaPromise)return schemaPromise;
 schemaPromise=(async()=>{const d=db();await d.batch([
  d.prepare("CREATE TABLE IF NOT EXISTS strategy_runs (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, stage INTEGER NOT NULL DEFAULT 0, offset INTEGER NOT NULL DEFAULT 0, processed INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, universe_total INTEGER NOT NULL DEFAULT 0, screened_out INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, quote_coverage INTEGER NOT NULL DEFAULT 0, sec_requests INTEGER NOT NULL DEFAULT 0, sec_success INTEGER NOT NULL DEFAULT 0, sec_failed INTEGER NOT NULL DEFAULT 0, fundamental_coverage INTEGER NOT NULL DEFAULT 0, error TEXT, universe TEXT, strategy_hash TEXT NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0, retry_queue TEXT NOT NULL DEFAULT '[]', notification_sent_at TEXT)"),
  d.prepare("CREATE TABLE IF NOT EXISTS fundamental_snapshots (id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, symbol TEXT NOT NULL, as_of TEXT NOT NULL, payload TEXT NOT NULL, evaluation TEXT NOT NULL, FOREIGN KEY (run_id) REFERENCES strategy_runs(id))"),
  d.prepare("CREATE INDEX IF NOT EXISTS snapshot_run_idx ON fundamental_snapshots(run_id)"),
  d.prepare("CREATE TABLE IF NOT EXISTS watchlist (symbol TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS raw_cache (key TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL, retrieved_at TEXT NOT NULL, payload TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS diag (id TEXT PRIMARY KEY NOT NULL, run_id TEXT, stage TEXT NOT NULL, created_at TEXT NOT NULL, message TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS experiment_registry (id TEXT PRIMARY KEY NOT NULL, hypothesis TEXT NOT NULL, parameters TEXT NOT NULL, created_at TEXT NOT NULL, dataset_version TEXT NOT NULL, result TEXT, p_value REAL, adjusted_p REAL, status TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS holdout_sets (firm_id TEXT PRIMARY KEY NOT NULL, membership TEXT NOT NULL, salt_hash TEXT NOT NULL, consumed_at TEXT)"),
  d.prepare("CREATE TABLE IF NOT EXISTS backtest_runs (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, strategy_hash TEXT NOT NULL, dataset_version TEXT NOT NULL, parameters TEXT NOT NULL, metrics TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY NOT NULL, subscription TEXT NOT NULL, created_at TEXT NOT NULL, last_success_at TEXT, failure_count INTEGER NOT NULL DEFAULT 0)")
  ,d.prepare("CREATE TABLE IF NOT EXISTS bulk_fundamentals (run_id TEXT NOT NULL, cik INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,cik))")
 ]);
 const columns=(await d.prepare("PRAGMA table_info(strategy_runs)").all()).results as any[];
 if(!columns.some(c=>c.name==='retry_queue'))await d.prepare("ALTER TABLE strategy_runs ADD COLUMN retry_queue TEXT NOT NULL DEFAULT '[]'").run();
 if(!columns.some(c=>c.name==='notification_sent_at'))await d.prepare("ALTER TABLE strategy_runs ADD COLUMN notification_sent_at TEXT").run();
 if(!columns.some(c=>c.name==='universe_total'))await d.prepare("ALTER TABLE strategy_runs ADD COLUMN universe_total INTEGER NOT NULL DEFAULT 0").run();
 if(!columns.some(c=>c.name==='screened_out'))await d.prepare("ALTER TABLE strategy_runs ADD COLUMN screened_out INTEGER NOT NULL DEFAULT 0").run();
 for(const name of ['quote_coverage','sec_requests','sec_success','sec_failed','fundamental_coverage'])if(!columns.some(c=>c.name===name))await d.prepare(`ALTER TABLE strategy_runs ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`).run();
 const compacted=await d.prepare("SELECT id FROM diag WHERE stage='compact-history-v1' LIMIT 1").first();
 if(!compacted){
  await d.prepare("UPDATE fundamental_snapshots SET payload=json_remove(payload,'$.history') WHERE instr(payload,'\"history\"')>0").run();
  await d.prepare("INSERT INTO diag(id,stage,created_at,message) VALUES(?,?,?,?)").bind(crypto.randomUUID(),'compact-history-v1',new Date().toISOString(),'Removed historical bars from durable radar rows; detailed history remains on-demand.').run();
 }
 await d.prepare("UPDATE strategy_runs SET status='failed',error='تغيّرت نسخة الاستراتيجية؛ ابدأ فحصًا جديدًا.',lease_until=0,updated_at=? WHERE status IN ('running','partial') AND stage<13 AND strategy_hash<>?").bind(new Date().toISOString(),currentHash()).run();
 })().catch(e=>{schemaPromise=null;throw e});
 return schemaPromise;
}
export const currentHash=()=>`${specHash('core')}:${specHash('bounce')}`;
export async function readState(options:{strategy?:'core'|'bounce'|'favorites';limit?:number;offset?:number;owner?:string;query?:string}={}){await ensureSchema();const d=db();const active=await d.prepare("SELECT * FROM strategy_runs WHERE strategy_hash=? ORDER BY created_at DESC LIMIT 1").bind(currentHash()).first();
 // A quick sample may be newer than a full scan. It must not silently replace
 // the user's main result set; prefer the newest full-market snapshot whenever
 // one has produced rows, then fall back to the newest available run.
 // Keep an active scan visible in `run`, but never replace the user's usable
 // result set with its still-enriching (and therefore often empty) rows.
 // Prefer the newest completed/partial market run; only fall back to running
 // when no finished result exists yet (first-ever scan).
 const finished=await d.prepare("SELECT * FROM strategy_runs r WHERE status IN ('complete','partial') AND (stage>=13 OR source='import') AND EXISTS(SELECT 1 FROM fundamental_snapshots s WHERE s.run_id=r.id) AND strategy_hash=? ORDER BY CASE WHEN source LIKE '%· full' THEN 0 ELSE 1 END, CASE WHEN status='complete' THEN 0 ELSE 1 END, created_at DESC LIMIT 1").bind(currentHash()).first();
 const running=await d.prepare("SELECT * FROM strategy_runs WHERE status='running' AND processed>0 AND strategy_hash=? ORDER BY CASE WHEN source LIKE '%· full' THEN 0 ELSE 1 END, CASE WHEN status='complete' THEN 0 ELSE 1 END, created_at DESC LIMIT 1").bind(currentHash()).first();
 const fallback=finished||running?null:await d.prepare("SELECT * FROM strategy_runs r WHERE status IN ('complete','partial') AND (stage>=13 OR source='import') AND EXISTS(SELECT 1 FROM fundamental_snapshots s WHERE s.run_id=r.id) ORDER BY CASE WHEN source LIKE '%· full' THEN 0 ELSE 1 END, CASE WHEN status='complete' THEN 0 ELSE 1 END, created_at DESC LIMIT 1").first();
 const latest=finished||running||fallback;
 const currentData=!!latest&&latest.strategy_hash===currentHash();
 const strategy=options.strategy==='core'||options.strategy==='favorites'?options.strategy:'bounce';
 const limit=Math.max(1,Math.min(250,Math.floor(options.limit??150)));
 const offset=Math.max(0,Math.floor(options.offset??0));
 const fav=options.owner?(await d.prepare(strategy==='favorites'?'SELECT symbol,payload FROM personal_watchlist WHERE owner=? ORDER BY created_at DESC':'SELECT symbol FROM personal_watchlist WHERE owner=? ORDER BY created_at DESC').bind(options.owner).all()).results as any[]:[];
 const statusSql=(key:'core'|'bounce',status:string)=>`SUM(CASE WHEN json_extract(evaluation, '$.${key}.screeningQualified') = ${status==='PASS'?1:0} THEN 1 ELSE 0 END)`;
 let summaryRow=currentData?await d.prepare(`SELECT COUNT(*) AS total, ${statusSql('core','PASS')} AS coreQualified, ${statusSql('bounce','PASS')} AS bounceQualified, COUNT(*) AS coreRanked, COUNT(*) AS bounceRanked, SUM(CASE WHEN json_extract(evaluation, '$.core.status')='UNKNOWN' THEN 1 ELSE 0 END) AS coreUnknown, SUM(CASE WHEN json_extract(evaluation, '$.bounce.status')='UNKNOWN' THEN 1 ELSE 0 END) AS bounceUnknown, SUM(CASE WHEN json_extract(evaluation, '$.core.status')='FAIL' THEN 1 ELSE 0 END) AS coreFailed, SUM(CASE WHEN json_extract(evaluation, '$.bounce.status')='FAIL' THEN 1 ELSE 0 END) AS bounceFailed FROM fundamental_snapshots WHERE run_id=?`).bind(latest.id).first() as any: null;
 const search=options.query?.trim().toLowerCase().slice(0,100)||'';
 // Re-evaluate every row with the current engine before ranking. Durable rows
 // can predate a scoring-version change; sorting the persisted evaluation would
 // otherwise leave old null scores and stale weights in front of the user.
 const query=latest&&strategy!=='favorites'?`SELECT payload FROM fundamental_snapshots WHERE run_id=? AND (?='' OR instr(lower(symbol),?)>0 OR instr(lower(json_extract(payload,'$.name')),?)>0)`:null;
 const params=latest?[latest.id,search,search,search]:[];
 let rows:any[]=query?(await d.prepare(query).bind(...params).all()).results.map((r:any)=>{const s=JSON.parse(r.payload);return {payload:r.payload,evaluation:JSON.stringify({core:evaluateStrategy('core',s),bounce:evaluateStrategy('bounce',s)})}}):[];
 // A strategy-version change must not make the product look empty. Re-evaluate
 // the last completed snapshot with the current engine and label it stale until
 // a new scan replaces it. The prior data timestamp and run remain visible.
 if(latest&&!currentData){
  const all=search?(await d.prepare('SELECT payload FROM fundamental_snapshots WHERE run_id=?').bind(latest.id).all()).results as any[]:rows;
  const totals={total:all.length,coreQualified:0,bounceQualified:0,coreRanked:all.length,bounceRanked:all.length,coreUnknown:0,bounceUnknown:0,coreFailed:0,bounceFailed:0};
  for(const row of all){const s=JSON.parse(row.payload),core=evaluateStrategy('core',s),bounce=evaluateStrategy('bounce',s);if(core.status==='PASS')totals.coreQualified++;else if(core.status==='UNKNOWN')totals.coreUnknown++;else totals.coreFailed++;if(bounce.status==='PASS')totals.bounceQualified++;else if(bounce.status==='UNKNOWN')totals.bounceUnknown++;else totals.bounceFailed++;}
  summaryRow=totals;
 }
 const coverageRow=latest?await d.prepare(`SELECT COUNT(*) AS total,
  SUM(CASE WHEN json_type(payload,'$.price') IN ('integer','real') THEN 1 ELSE 0 END) AS price,
  SUM(CASE WHEN json_type(payload,'$.marketCap') IN ('integer','real') THEN 1 ELSE 0 END) AS marketCap,
  SUM(CASE WHEN json_type(payload,'$.revenue') IN ('integer','real') THEN 1 ELSE 0 END) AS revenue,
  SUM(CASE WHEN json_type(payload,'$.netIncome') IN ('integer','real') THEN 1 ELSE 0 END) AS netIncome,
  SUM(CASE WHEN json_type(payload,'$.fcf') IN ('integer','real') THEN 1 ELSE 0 END) AS fcf,
  SUM(CASE WHEN json_type(payload,'$.cash') IN ('integer','real') THEN 1 ELSE 0 END) AS cash,
  SUM(CASE WHEN json_type(payload,'$.debt') IN ('integer','real') THEN 1 ELSE 0 END) AS debt,
  SUM(CASE WHEN json_type(payload,'$.medianDollarVolume20d') IN ('integer','real') THEN 1 ELSE 0 END) AS medianDollarVolume20d,
  SUM(CASE WHEN json_type(payload,'$.return12m') IN ('integer','real') THEN 1 ELSE 0 END) AS return12m,
  SUM(CASE WHEN json_type(payload,'$.low52w') IN ('integer','real') THEN 1 ELSE 0 END) AS low52w,
  SUM(CASE WHEN json_type(payload,'$.ma30w') IN ('integer','real') THEN 1 ELSE 0 END) AS ma30w,
  SUM(CASE WHEN json_type(payload,'$.dilution') IN ('integer','real') THEN 1 ELSE 0 END) AS dilution
  FROM fundamental_snapshots WHERE run_id=?`).bind(latest.id).first() as any:null;
 const coverage=coverageRow?{runId:latest.id,total:Number(coverageRow.total||0),fields:Object.fromEntries(['price','marketCap','revenue','netIncome','fcf','cash','debt','medianDollarVolume20d','return12m','low52w','ma30w','dilution'].map(key=>[key,Number(coverageRow[key]||0)]))}:null;
 if(strategy!=='favorites')rows.sort((a:any,b:any)=>{const ae=JSON.parse(a.evaluation)[strategy],be=JSON.parse(b.evaluation)[strategy];const score=(e:any)=>e.score==null?Number.NEGATIVE_INFINITY:e.score;return score(be)-score(ae)||(be.scoreCoverage??0)-(ae.scoreCoverage??0)||JSON.parse(a.payload).symbol.localeCompare(JSON.parse(b.payload).symbol)});
 if(strategy==='favorites'){
  rows=fav.filter(r=>!search||`${r.symbol} ${JSON.parse(r.payload).name}`.toLowerCase().includes(search)).map(r=>{const s=JSON.parse(r.payload);return {payload:r.payload,evaluation:JSON.stringify({core:evaluateStrategy('core',s),bounce:evaluateStrategy('bounce',s)})}});
  rows.sort((a:any,b:any)=>{const ae=JSON.parse(a.evaluation).bounce,be=JSON.parse(b.evaluation).bounce;const score=(e:any)=>e.score==null?Number.NEGATIVE_INFINITY:e.score;return score(be)-score(ae)||(be.scoreCoverage??0)-(ae.scoreCoverage??0)||JSON.parse(a.payload).symbol.localeCompare(JSON.parse(b.payload).symbol)});
  rows=rows.slice(offset,offset+limit+1);
 }
 if(strategy!=='favorites')rows=rows.slice(offset,offset+limit+1);
 const compact=(payload:string)=>{const parsed=JSON.parse(payload);delete parsed.history;return parsed};
 const pageRows=rows.slice(0,limit);
 return {run:active?{...active,universe:undefined,retry_queue:undefined,retryPending:JSON.parse(active.retry_queue||'[]').length,stale:!currentData}:null,dataRunId:latest?.id,dataRun:latest?{...latest,universe:undefined,retry_queue:undefined,stale:!currentData}:null,snapshots:pageRows.map((r:any)=>compact(r.payload)),storedEvaluations:pageRows.map((r:any)=>JSON.parse(r.evaluation)),favorites:fav.map((r:any)=>r.symbol),coverage,summary:{total:Number(summaryRow?.total||0),coreQualified:Number(summaryRow?.coreQualified||0),bounceQualified:Number(summaryRow?.bounceQualified||0),coreRanked:Number(summaryRow?.coreRanked||0),bounceRanked:Number(summaryRow?.bounceRanked||0),coreUnknown:Number(summaryRow?.coreUnknown||0),bounceUnknown:Number(summaryRow?.bounceUnknown||0),coreFailed:Number(summaryRow?.coreFailed||0),bounceFailed:Number(summaryRow?.bounceFailed||0),stale:!currentData},page:{strategy,limit,offset,hasMore:rows.length>limit}};}
export async function readAudit(){await ensureSchema();const d=db();const latest=await d.prepare("SELECT * FROM strategy_runs WHERE status IN ('complete','partial') ORDER BY created_at DESC LIMIT 1").first() as any;const logs=latest?(await d.prepare('SELECT stage,created_at,message FROM diag WHERE run_id=? ORDER BY created_at DESC LIMIT 500').bind(latest.id).all()).results:[];const state=await readState({strategy:'bounce',limit:1});return {strategyHash:currentHash(),run:state.run,dataRun:state.dataRun,summary:state.summary,favorites:state.favorites,logs};}
export function insertSnapshot(runId:string,s:Snapshot){return db().prepare('INSERT OR REPLACE INTO fundamental_snapshots(id,run_id,symbol,as_of,payload,evaluation) VALUES (?,?,?,?,?,?)').bind(`${runId}:${s.symbol}`,runId,s.symbol,s.asOf,JSON.stringify(s),JSON.stringify({core:evaluateStrategy('core',s),bounce:evaluateStrategy('bounce',s)}));}
export async function createRun(source:string,total=0,universe:any[]=[],status='running'){await ensureSchema();const id=crypto.randomUUID(),now=new Date().toISOString();await db().prepare('INSERT INTO strategy_runs (id,created_at,updated_at,status,source,total,universe,strategy_hash) VALUES(?,?,?,?,?,?,?,?)').bind(id,now,now,status,source,total,JSON.stringify(universe),currentHash()).run();return id;}
export async function log(runId:string,stage:string,message:string){await db().prepare('INSERT INTO diag(id,run_id,stage,created_at,message) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),runId,stage,new Date().toISOString(),message).run()}
