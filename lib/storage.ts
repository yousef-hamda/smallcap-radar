import {env} from 'cloudflare:workers';
import {evaluateStrategy,specHash,type Snapshot} from './engine';
export const db=()=>{const d=(env as any).DB;if(!d)throw Error('قاعدة البيانات غير متاحة');return d;};
let schemaPromise:Promise<void>|null=null;
export async function ensureSchema(){
 if(schemaPromise)return schemaPromise;
 schemaPromise=(async()=>{const d=db();await d.batch([
  d.prepare("CREATE TABLE IF NOT EXISTS strategy_runs (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, stage INTEGER NOT NULL DEFAULT 0, offset INTEGER NOT NULL DEFAULT 0, processed INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, error TEXT, universe TEXT, strategy_hash TEXT NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0, retry_queue TEXT NOT NULL DEFAULT '[]', notification_sent_at TEXT)"),
  d.prepare("CREATE TABLE IF NOT EXISTS fundamental_snapshots (id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, symbol TEXT NOT NULL, as_of TEXT NOT NULL, payload TEXT NOT NULL, evaluation TEXT NOT NULL, FOREIGN KEY (run_id) REFERENCES strategy_runs(id))"),
  d.prepare("CREATE INDEX IF NOT EXISTS snapshot_run_idx ON fundamental_snapshots(run_id)"),
  d.prepare("CREATE TABLE IF NOT EXISTS watchlist (symbol TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS raw_cache (key TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL, retrieved_at TEXT NOT NULL, payload TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS diag (id TEXT PRIMARY KEY NOT NULL, run_id TEXT, stage TEXT NOT NULL, created_at TEXT NOT NULL, message TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS experiment_registry (id TEXT PRIMARY KEY NOT NULL, hypothesis TEXT NOT NULL, parameters TEXT NOT NULL, created_at TEXT NOT NULL, dataset_version TEXT NOT NULL, result TEXT, p_value REAL, adjusted_p REAL, status TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS holdout_sets (firm_id TEXT PRIMARY KEY NOT NULL, membership TEXT NOT NULL, salt_hash TEXT NOT NULL, consumed_at TEXT)"),
  d.prepare("CREATE TABLE IF NOT EXISTS backtest_runs (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, strategy_hash TEXT NOT NULL, dataset_version TEXT NOT NULL, parameters TEXT NOT NULL, metrics TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY NOT NULL, subscription TEXT NOT NULL, created_at TEXT NOT NULL, last_success_at TEXT, failure_count INTEGER NOT NULL DEFAULT 0)")
 ]);
 const columns=(await d.prepare("PRAGMA table_info(strategy_runs)").all()).results as any[];
 if(!columns.some(c=>c.name==='retry_queue'))await d.prepare("ALTER TABLE strategy_runs ADD COLUMN retry_queue TEXT NOT NULL DEFAULT '[]'").run();
 if(!columns.some(c=>c.name==='notification_sent_at'))await d.prepare("ALTER TABLE strategy_runs ADD COLUMN notification_sent_at TEXT").run();
 })().catch(e=>{schemaPromise=null;throw e});
 return schemaPromise;
}
export const currentHash=()=>`${specHash('core')}:${specHash('bounce')}`;
export async function readState(){await ensureSchema();const d=db();const active=await d.prepare("SELECT * FROM strategy_runs ORDER BY created_at DESC LIMIT 1").first();const latest=await d.prepare("SELECT * FROM strategy_runs WHERE status IN ('complete','partial','running') AND processed>0 ORDER BY created_at DESC LIMIT 1").first();const rows=latest?(await d.prepare('SELECT payload,evaluation FROM fundamental_snapshots WHERE run_id=? ORDER BY symbol').bind(latest.id).all()).results:[];const fav=(await d.prepare('SELECT symbol FROM watchlist ORDER BY created_at DESC').all()).results;return {run:active?{...active,universe:undefined,retry_queue:undefined,retryPending:JSON.parse(active.retry_queue||'[]').length,stale:(latest?.strategy_hash||active.strategy_hash)!==currentHash()}:null,dataRunId:latest?.id,dataRun:latest?{...latest,universe:undefined,retry_queue:undefined}:null,snapshots:rows.map((r:any)=>JSON.parse(r.payload)),storedEvaluations:rows.map((r:any)=>JSON.parse(r.evaluation)),favorites:fav.map((r:any)=>r.symbol)};}
export function insertSnapshot(runId:string,s:Snapshot){return db().prepare('INSERT OR REPLACE INTO fundamental_snapshots(id,run_id,symbol,as_of,payload,evaluation) VALUES (?,?,?,?,?,?)').bind(`${runId}:${s.symbol}`,runId,s.symbol,s.asOf,JSON.stringify(s),JSON.stringify({core:evaluateStrategy('core',s),bounce:evaluateStrategy('bounce',s)}));}
export async function createRun(source:string,total=0,universe:any[]=[],status='running'){await ensureSchema();const id=crypto.randomUUID(),now=new Date().toISOString();await db().prepare('INSERT INTO strategy_runs (id,created_at,updated_at,status,source,total,universe,strategy_hash) VALUES(?,?,?,?,?,?,?,?)').bind(id,now,now,status,source,total,JSON.stringify(universe),currentHash()).run();return id;}
export async function log(runId:string,stage:string,message:string){await db().prepare('INSERT INTO diag(id,run_id,stage,created_at,message) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),runId,stage,new Date().toISOString(),message).run()}
