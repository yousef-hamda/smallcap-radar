import {restoreArchivedRow,archivedWriteStatements} from './snapshot-archive';
import {compactRadarSnapshot,compactRadarEvaluation} from './compact-radar';
import {env} from 'cloudflare:workers';
import type {Snapshot} from './engine';
import {opportunitySnapshotHash,isCurrentOpportunityEvaluation, type OpportunityEvaluation} from './opportunity-engine';
import {applyFinancingRisk} from './financing-risk';
import {evaluateOpportunityDossier,opportunityDossierFromSnapshot} from './opportunity-dossier';

import {OPPORTUNITY_SPEC,opportunitySpecHash} from './opportunity-spec';
import {secUserAgentCacheVersion} from './sec-user-agent';
import {peerObservation,peerContext,uniqueIssuerPeers,type PeerObservation} from './opportunity-peers';
import {alignSnapshotFinancials} from './financial-integrity';
export const db=()=>{const d=(env as any).DB;if(!d)throw Error('قاعدة البيانات غير متاحة');return d;};
let schemaPromise:Promise<void>|null=null;
async function ensureColumn(d:ReturnType<typeof db>,table:string,name:string,definition:string){
 const hasColumn=async()=>((await d.prepare(`PRAGMA table_info(${table})`).all()).results as any[]).some(column=>column.name===name);
 if(await hasColumn())return;
 try{await d.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();}
 catch(error){
  // Separate Worker isolates can both pass the initial PRAGMA check. If the
  // other isolate won the DDL race, treat the now-present column as success.
  if(!await hasColumn())throw error;
 }
}
type StateCacheEntry={expiresAt:number;value:any;bytes:number};
const stateCache=new Map<string,StateCacheEntry>();
const runSummaryCache=new Map<string,any>();
const runCoverageCache=new Map<string,any>();
const runResearchConflictCache=new Map<string,{revision:number;count:number}>();
const STATE_CACHE_TTL=5_000;
const STATE_CACHE_LIMIT=64;
const STATE_CACHE_BYTES=4*1024*1024;
function evaluateSnapshotOpportunity(snapshot:Snapshot){return evaluateOpportunityDossier(snapshot,opportunityDossierFromSnapshot(snapshot));}
export function invalidateStateCache(){stateCache.clear();runSummaryCache.clear();runCoverageCache.clear();runResearchConflictCache.clear();}

/** Report pagination must not reread the whole source payload set on each page.
 * Snapshot mutation triggers make the count cache safe across scans/imports. */
export async function readResearchConflictCount(runId:string){
 await ensureSchema();const d=db();
 const version=await d.prepare('SELECT revision FROM opportunity_rating_versions WHERE run_id=?').bind(runId).first() as any;
 const revision=Number(version?.revision??0),cached=runResearchConflictCache.get(runId);
 if(cached?.revision===revision)return cached.count;
 const row=await d.prepare("SELECT COUNT(*) AS count FROM fundamental_snapshots WHERE run_id=? AND COALESCE(json_array_length(payload,'$.opportunityResearch.earnings.conflicts'),0)>0").bind(runId).first() as any;
 const count=Number(row?.count??0);
 if(runResearchConflictCache.size>=8)runResearchConflictCache.delete(runResearchConflictCache.keys().next().value!);
 runResearchConflictCache.set(runId,{revision,count});return count;
}
function rememberState(key:string,value:any){
 const bytes=JSON.stringify(value).length*2;
 // Production payloads exceed 335 MB. Bound page-cache memory by bytes as
 // well as entry count so traversing the whole universe cannot fill the heap.
 if(bytes>STATE_CACHE_BYTES)return;
 let used=[...stateCache.values()].reduce((sum,entry)=>sum+entry.bytes,0);
 while(stateCache.size&&(stateCache.size>=STATE_CACHE_LIMIT||used+bytes>STATE_CACHE_BYTES)){
  const oldest=stateCache.keys().next().value!;used-=stateCache.get(oldest)!.bytes;stateCache.delete(oldest);
 }
 stateCache.set(key,{expiresAt:Date.now()+STATE_CACHE_TTL,value,bytes});
}
export async function ensureSchema(){
 if(schemaPromise)return schemaPromise;
 schemaPromise=(async()=>{const d=db();await d.batch([
  d.prepare("CREATE TABLE IF NOT EXISTS strategy_runs (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, stage INTEGER NOT NULL DEFAULT 0, offset INTEGER NOT NULL DEFAULT 0, processed INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, universe_total INTEGER NOT NULL DEFAULT 0, screened_out INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, quote_coverage INTEGER NOT NULL DEFAULT 0, sec_requests INTEGER NOT NULL DEFAULT 0, sec_success INTEGER NOT NULL DEFAULT 0, sec_failed INTEGER NOT NULL DEFAULT 0, fundamental_coverage INTEGER NOT NULL DEFAULT 0, error TEXT, universe TEXT, strategy_hash TEXT NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0, retry_queue TEXT NOT NULL DEFAULT '[]', notification_sent_at TEXT)"),
  d.prepare("CREATE TABLE IF NOT EXISTS fundamental_snapshots (id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, symbol TEXT NOT NULL, as_of TEXT NOT NULL, payload TEXT NOT NULL, evaluation TEXT NOT NULL, FOREIGN KEY (run_id) REFERENCES strategy_runs(id))"),
  d.prepare("CREATE TABLE IF NOT EXISTS opportunity_rankings (run_id TEXT NOT NULL,symbol TEXT NOT NULL,score REAL NOT NULL,evaluation_hash TEXT NOT NULL,rank_position INTEGER NOT NULL,rubric_hash TEXT NOT NULL,research_fit INTEGER NOT NULL DEFAULT 0,research_fit_financing_pass INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(run_id,symbol))"),
  d.prepare("CREATE INDEX IF NOT EXISTS opportunity_rank_position_idx ON opportunity_rankings(run_id,rank_position)"),
  d.prepare("CREATE TABLE IF NOT EXISTS opportunity_rank_projection_versions (run_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,rubric_hash TEXT NOT NULL,projection_version TEXT NOT NULL,cursor_rank_position INTEGER NOT NULL DEFAULT 0,complete INTEGER NOT NULL DEFAULT 0)"),
  d.prepare("CREATE TABLE IF NOT EXISTS opportunity_rank_projection_leases (run_id TEXT PRIMARY KEY,owner TEXT NOT NULL,lease_until INTEGER NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS opportunity_run_aggregates (run_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,rubric_hash TEXT NOT NULL,cursor_symbol TEXT NOT NULL DEFAULT '',complete INTEGER NOT NULL DEFAULT 0,summary_json TEXT NOT NULL DEFAULT '{}',coverage_json TEXT NOT NULL DEFAULT '{}',owner TEXT NOT NULL DEFAULT '',lease_until INTEGER NOT NULL DEFAULT 0)"),
  d.prepare("CREATE TABLE IF NOT EXISTS opportunity_rating_versions (run_id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0)"),
  d.prepare("CREATE TABLE IF NOT EXISTS opportunity_rank_versions (run_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,rubric_hash TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS opportunity_archive_write_guard (snapshot_id TEXT PRIMARY KEY NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS opportunity_evaluation_leases (run_id TEXT PRIMARY KEY,owner TEXT NOT NULL,lease_until INTEGER NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS opportunity_evaluation_jobs (run_id TEXT PRIMARY KEY,generation TEXT NOT NULL,input_revision INTEGER NOT NULL,expected_revision INTEGER NOT NULL,rubric_hash TEXT NOT NULL,phase TEXT NOT NULL,cursor TEXT NOT NULL DEFAULT '',owner TEXT NOT NULL DEFAULT '',lease_until INTEGER NOT NULL DEFAULT 0,batch_token TEXT NOT NULL DEFAULT '',error TEXT)"),
  d.prepare("CREATE TABLE IF NOT EXISTS opportunity_peer_candidates (run_id TEXT NOT NULL,generation TEXT NOT NULL,symbol TEXT NOT NULL,cik INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(run_id,generation,symbol))"),
  d.prepare("CREATE INDEX IF NOT EXISTS opportunity_peer_candidates_cik_idx ON opportunity_peer_candidates(run_id,generation,cik,symbol)"),
  d.prepare("CREATE TABLE IF NOT EXISTS opportunity_issuer_listing_counts (run_id TEXT NOT NULL,generation TEXT NOT NULL,cik INTEGER NOT NULL,listing_count INTEGER NOT NULL,PRIMARY KEY(run_id,generation,cik))"),
  d.prepare("CREATE TABLE IF NOT EXISTS opportunity_peer_observations (run_id TEXT NOT NULL,generation TEXT NOT NULL,cik INTEGER NOT NULL,symbol TEXT NOT NULL,sic INTEGER NOT NULL,end TEXT NOT NULL,revenue REAL NOT NULL,gross_margin REAL NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(run_id,generation,cik))"),
  d.prepare("CREATE INDEX IF NOT EXISTS opportunity_peer_lookup_v2_idx ON opportunity_peer_observations(run_id,generation,sic,julianday(end),revenue,cik)"),
  d.prepare('DROP TRIGGER IF EXISTS opportunity_rating_update'),
  d.prepare("CREATE TRIGGER IF NOT EXISTS opportunity_rating_update AFTER UPDATE ON fundamental_snapshots WHEN NOT EXISTS(SELECT 1 FROM opportunity_archive_write_guard WHERE snapshot_id=NEW.id) BEGIN INSERT INTO opportunity_rating_versions(run_id,revision) VALUES(NEW.run_id,1) ON CONFLICT(run_id) DO UPDATE SET revision=revision+1; END"),
  ...['INSERT','DELETE'].map(operation=>d.prepare(`CREATE TRIGGER IF NOT EXISTS opportunity_rating_${operation.toLowerCase()} AFTER ${operation} ON fundamental_snapshots BEGIN INSERT INTO opportunity_rating_versions(run_id,revision) VALUES(${operation==='DELETE'?'OLD':'NEW'}.run_id,1) ON CONFLICT(run_id) DO UPDATE SET revision=revision+1; END`)),
  d.prepare("CREATE INDEX IF NOT EXISTS snapshot_run_idx ON fundamental_snapshots(run_id)"),
  d.prepare("CREATE INDEX IF NOT EXISTS snapshot_run_symbol_idx ON fundamental_snapshots(run_id,symbol)"),
  d.prepare("CREATE INDEX IF NOT EXISTS snapshot_symbol_date_idx ON fundamental_snapshots(symbol,as_of)"),
  d.prepare("CREATE TABLE IF NOT EXISTS watchlist (symbol TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS personal_watchlist (owner TEXT NOT NULL, symbol TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(owner,symbol))"),
  d.prepare("CREATE TABLE IF NOT EXISTS raw_cache (key TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL, retrieved_at TEXT NOT NULL, payload TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS diag (id TEXT PRIMARY KEY NOT NULL, run_id TEXT, stage TEXT NOT NULL, created_at TEXT NOT NULL, message TEXT NOT NULL)"),
  d.prepare("CREATE INDEX IF NOT EXISTS idx_diag_created_at ON diag(created_at)"),
  d.prepare("CREATE TABLE IF NOT EXISTS experiment_registry (id TEXT PRIMARY KEY NOT NULL, hypothesis TEXT NOT NULL, parameters TEXT NOT NULL, created_at TEXT NOT NULL, dataset_version TEXT NOT NULL, result TEXT, p_value REAL, adjusted_p REAL, status TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS holdout_sets (firm_id TEXT PRIMARY KEY NOT NULL, membership TEXT NOT NULL, salt_hash TEXT NOT NULL, consumed_at TEXT)"),
  d.prepare("CREATE TABLE IF NOT EXISTS backtest_runs (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, strategy_hash TEXT NOT NULL, dataset_version TEXT NOT NULL, parameters TEXT NOT NULL, metrics TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL DEFAULT '', subscription TEXT NOT NULL, created_at TEXT NOT NULL, last_success_at TEXT, failure_count INTEGER NOT NULL DEFAULT 0)"),
  d.prepare("CREATE TABLE IF NOT EXISTS portfolio_transactions (id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, symbol TEXT NOT NULL, company_name TEXT NOT NULL, side TEXT NOT NULL, quantity REAL NOT NULL, price REAL NOT NULL, fees REAL NOT NULL DEFAULT 0, trade_date TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
  d.prepare("CREATE TRIGGER IF NOT EXISTS portfolio_anonymous_row_cap BEFORE INSERT ON portfolio_transactions WHEN NEW.owner>='visitor:' AND NEW.owner<'visitor;' AND (SELECT COUNT(*) FROM portfolio_transactions WHERE owner>='visitor:' AND owner<'visitor;')>=100000 BEGIN SELECT RAISE(ABORT,'anonymous portfolio storage limit reached'); END"),
  d.prepare("CREATE TABLE IF NOT EXISTS portfolio_revisions (owner TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL DEFAULT 0)"),
  d.prepare("CREATE TABLE IF NOT EXISTS radar_accounts (id TEXT PRIMARY KEY NOT NULL, username TEXT UNIQUE NOT NULL, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS radar_sessions (token_hash TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at INTEGER NOT NULL, FOREIGN KEY (account_id) REFERENCES radar_accounts(id))"),
  d.prepare("CREATE TABLE IF NOT EXISTS recovery_bundles (id TEXT PRIMARY KEY NOT NULL, token_hash TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, claimed_at TEXT, claimed_by TEXT)"),
  d.prepare("CREATE INDEX IF NOT EXISTS idx_portfolio_owner_date ON portfolio_transactions(owner,trade_date,id)"),
  d.prepare("CREATE INDEX IF NOT EXISTS idx_portfolio_owner_symbol_date ON portfolio_transactions(owner,symbol,trade_date,id)"),
  d.prepare("CREATE INDEX IF NOT EXISTS idx_radar_sessions_account ON radar_sessions(account_id)"),
  d.prepare("CREATE INDEX IF NOT EXISTS idx_radar_sessions_expiry ON radar_sessions(expires_at)")
  ,d.prepare("CREATE TABLE IF NOT EXISTS bulk_fundamentals (run_id TEXT NOT NULL, cik INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,cik))"),
  d.prepare("CREATE TABLE IF NOT EXISTS company_facts_outcomes (run_id TEXT NOT NULL,cik INTEGER NOT NULL,state TEXT NOT NULL,attempt INTEGER NOT NULL DEFAULT 0,last_error TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(run_id,cik))"),
  d.prepare("CREATE TABLE IF NOT EXISTS request_rate_limits (bucket TEXT PRIMARY KEY NOT NULL,requests INTEGER NOT NULL,expires_at INTEGER NOT NULL)")
 ]);
 for(const [name,definition] of Object.entries({
  directory_version:'directory_version INTEGER NOT NULL DEFAULT 0',
  retry_queue:"retry_queue TEXT NOT NULL DEFAULT '[]'",
  notification_sent_at:'notification_sent_at TEXT',
  universe_total:'universe_total INTEGER NOT NULL DEFAULT 0',
  screened_out:'screened_out INTEGER NOT NULL DEFAULT 0',
  quote_coverage:'quote_coverage INTEGER NOT NULL DEFAULT 0',
  sec_requests:'sec_requests INTEGER NOT NULL DEFAULT 0',
  sec_success:'sec_success INTEGER NOT NULL DEFAULT 0',
  sec_failed:'sec_failed INTEGER NOT NULL DEFAULT 0',
  frames_retry_count:'frames_retry_count INTEGER NOT NULL DEFAULT 0',
  fundamental_coverage:'fundamental_coverage INTEGER NOT NULL DEFAULT 0',
 }))await ensureColumn(d,'strategy_runs',name,definition);
 await ensureColumn(d,'opportunity_rankings','research_fit','research_fit INTEGER NOT NULL DEFAULT 0');
 await ensureColumn(d,'opportunity_rankings','research_fit_financing_pass','research_fit_financing_pass INTEGER NOT NULL DEFAULT 0');
 await ensureColumn(d,'opportunity_rank_projection_versions','cursor_rank_position','cursor_rank_position INTEGER NOT NULL DEFAULT 0');
 await ensureColumn(d,'opportunity_rank_projection_versions','complete','complete INTEGER NOT NULL DEFAULT 0');
 await ensureColumn(d,'opportunity_evaluation_jobs','error','error TEXT');
 await d.prepare("CREATE INDEX IF NOT EXISTS opportunity_research_fit_idx ON opportunity_rankings(run_id,research_fit,research_fit_financing_pass DESC,rank_position)").run();
 await ensureColumn(d,'push_subscriptions','owner',"owner TEXT NOT NULL DEFAULT ''");
 const compacted=await d.prepare("SELECT id FROM diag WHERE stage='compact-history-v1' LIMIT 1").first();
 if(!compacted){
  await d.prepare("UPDATE fundamental_snapshots SET payload=json_remove(payload,'$.history') WHERE instr(payload,'\"history\"')>0").run();
  await d.prepare("INSERT INTO diag(id,stage,created_at,message) VALUES(?,?,?,?)").bind(crypto.randomUUID(),'compact-history-v1',new Date().toISOString(),'Removed historical bars from durable radar rows; detailed history remains on-demand.').run();
 }
 await migrateCompatibleAcquisitionRuns();
 await d.prepare("UPDATE strategy_runs SET status='failed',error='تغيّرت نسخة الاستراتيجية؛ ابدأ فحصًا جديدًا.',lease_until=0,updated_at=? WHERE status IN ('running','partial') AND stage<13 AND strategy_hash<>?").bind(new Date().toISOString(),currentHash()).run();
 })().catch(e=>{schemaPromise=null;throw e});
 return schemaPromise;
}
/** 1.2.1-1.2.6 -> 1.3.0 preserves the audited v13/v14 acquisition stage formats.
 * Directory reconciliation appends missing listings without moving existing indices. */
export async function migrateCompatibleAcquisitionRuns() {
 await db().prepare("UPDATE strategy_runs SET strategy_hash=? WHERE strategy_hash IN ('UNIFIED_OPPORTUNITY:e723dd3c','UNIFIED_OPPORTUNITY:ba63f113','UNIFIED_OPPORTUNITY:91920a00','UNIFIED_OPPORTUNITY:42c3b090','UNIFIED_OPPORTUNITY:f7c5745f','UNIFIED_OPPORTUNITY:d21f9710') AND (source LIKE 'Bulk Quotes/SEC Frames + Opportunity SEC v13%' OR source LIKE 'Bulk Quotes/SEC Frames + Opportunity SEC v14%') AND status IN ('running','partial') AND stage<13").bind(currentHash()).run();
}
export const currentHash=()=>`${OPPORTUNITY_SPEC.id}:${opportunitySpecHash()}`;
export async function readRankReleaseIdentity(runId:string,expectedToken?:string) {
 const row=await db().prepare('SELECT v.revision,v.rubric_hash,COALESCE(r.revision,0) AS current_revision FROM opportunity_rank_versions v LEFT JOIN opportunity_rating_versions r ON r.run_id=v.run_id WHERE v.run_id=?').bind(runId).first() as any;
 if(!row)throw Object.assign(Error('النسخة المحفوظة غير جاهزة؛ حدّث القائمة.'),{status:409});
 const token=`${runId}:${Number(row.revision)}:${row.rubric_hash}`;
 if(expectedToken&&(expectedToken!==token||Number(row.revision)!==Number(row.current_revision)||row.rubric_hash!==opportunitySpecHash()))throw Object.assign(Error('تغيّرت نسخة التقييم؛ حدّث القائمة قبل تحميل المزيد أو فتح الملف.'),{status:409});
 return {runId,revision:Number(row.revision),rubricHash:String(row.rubric_hash),token};
}
/** A provisional research queue, never a second score or an eligibility gate.
 * Market-data rights can be unknown here; the saved PASS/UNKNOWN safety checks
 * remain visible and cannot be promoted by this filter. A current reviewed
 * financing PASS comes first; canonical rank then breaks ties. */
const RESEARCH_FIT_MAX_CAP=5_000_000_000;
const researchFitFinancingPassSql=`EXISTS(SELECT 1 FROM json_each(s.evaluation,'$.opportunity.checks') c WHERE json_extract(c.value,'$.id')='thesis-financing' AND json_extract(c.value,'$.status')='PASS')`;
const researchFitSql=`
 json_extract(s.payload,'$.listingStatus')='current'
 AND json_extract(s.payload,'$.securityType')='common'
 AND json_extract(s.payload,'$.marketCap')>0
 AND json_extract(s.payload,'$.marketCap')<=${RESEARCH_FIT_MAX_CAP}
 AND json_extract(s.payload,'$.price')>0
 AND json_extract(s.payload,'$.medianDollarVolume20d')>=150000
 AND json_extract(s.payload,'$.opportunityResearch.financialStrength.industryModel')='industrial-operating-company'
 AND CAST(json_extract(s.payload,'$.cik') AS INTEGER)>0
 AND COALESCE(json_array_length(s.payload,'$.sourceConflicts'),0)=0
 AND COALESCE(json_array_length(s.payload,'$.opportunityResearch.earnings.conflicts'),0)=0
 AND COALESCE(json_extract(s.payload,'$.deathSpiral'),'unknown') NOT IN ('severe','elevated')
 AND julianday(s.as_of)-julianday(json_extract(s.payload,'$.provenance.price.periodEnd')) BETWEEN 0 AND 7
 AND julianday(s.as_of)-julianday(json_extract(s.payload,'$.provenance.marketCap.periodEnd')) BETWEEN 0 AND 7
 AND julianday(s.as_of)-julianday(json_extract(s.payload,'$.provenance.medianDollarVolume20d.periodEnd')) BETWEEN 0 AND 7
 AND json_extract(s.payload,'$.provenance.price.url') LIKE 'https://%'
 AND json_extract(s.payload,'$.provenance.marketCap.url') LIKE 'https://%'
 AND json_extract(s.payload,'$.provenance.medianDollarVolume20d.url') LIKE 'https://%'
 AND julianday(json_extract(s.payload,'$.provenance.price.availableAt'))<=julianday(s.as_of)
 AND julianday(json_extract(s.payload,'$.provenance.marketCap.availableAt'))<=julianday(s.as_of)
 AND julianday(json_extract(s.payload,'$.provenance.medianDollarVolume20d.availableAt'))<=julianday(s.as_of)
 AND julianday(json_extract(s.payload,'$.provenance.price.retrievedAt'))<=julianday(s.as_of)
 AND julianday(json_extract(s.payload,'$.provenance.marketCap.retrievedAt'))<=julianday(s.as_of)
 AND julianday(json_extract(s.payload,'$.provenance.medianDollarVolume20d.retrievedAt'))<=julianday(s.as_of)
 AND json_extract(s.evaluation,'$.opportunity.factors[0].score')>0
 AND json_array_length(s.evaluation,'$.opportunity.factors[0].sources')>0
 AND json_extract(s.payload,'$.opportunityResearch.earnings.annual[#-1].metrics.revenue.value')>0
 AND json_extract(s.payload,'$.opportunityResearch.earnings.annual[#-1].metrics.revenue.unit')='USD'
 AND json_extract(s.payload,'$.opportunityResearch.earnings.annual[#-1].metrics.revenue.source.source') LIKE 'SEC Company Facts%'
 AND json_extract(s.payload,'$.opportunityResearch.earnings.annual[#-1].metrics.revenue.source.url')='https://data.sec.gov/api/xbrl/companyfacts/CIK' || printf('%010d',CAST(json_extract(s.payload,'$.cik') AS INTEGER)) || '.json'
 AND json_extract(s.payload,'$.opportunityResearch.earnings.annual[#-1].metrics.revenue.source.rightsStatus')='redistribution-permitted'
 AND json_extract(s.payload,'$.opportunityResearch.earnings.annual[#-1].metrics.revenue.source.currency')='USD'
 AND COALESCE(json_extract(s.payload,'$.opportunityResearch.earnings.annual[#-1].metrics.revenue.source.scope'),'consolidated')='consolidated'
 AND julianday(json_extract(s.payload,'$.opportunityResearch.earnings.annual[#-1].metrics.revenue.source.availableAt'))<=julianday(s.as_of)
 AND julianday(json_extract(s.payload,'$.opportunityResearch.earnings.annual[#-1].metrics.revenue.source.retrievedAt'))<=julianday(s.as_of)
 AND julianday(s.as_of)-julianday(json_extract(s.payload,'$.opportunityResearch.earnings.annual[#-1].end')) BETWEEN 0 AND 450
 AND EXISTS(SELECT 1 FROM json_each(s.evaluation,'$.opportunity.checks') c WHERE json_extract(c.value,'$.id')='security' AND json_extract(c.value,'$.status')='PASS')
 AND NOT EXISTS(SELECT 1 FROM json_each(s.evaluation,'$.opportunity.checks') c WHERE json_extract(c.value,'$.id') IN ('market-cap','liquidity','price') AND json_extract(c.value,'$.status')='FAIL')`;
const RESEARCH_FIT_PROJECTION_VERSION='research-fit-v1';
async function researchFitProjectionReady(runId:string){
 const row=await db().prepare(`SELECT p.revision,p.rubric_hash,p.projection_version,p.complete,v.revision AS rank_revision,v.rubric_hash AS rank_hash,COALESCE(r.revision,0) AS current_revision FROM opportunity_rank_projection_versions p JOIN opportunity_rank_versions v ON v.run_id=p.run_id LEFT JOIN opportunity_rating_versions r ON r.run_id=p.run_id WHERE p.run_id=?`).bind(runId).first() as any;
 return !!row&&Number(row.complete)===1&&row.projection_version===RESEARCH_FIT_PROJECTION_VERSION&&row.rubric_hash===opportunitySpecHash()&&row.rank_hash===opportunitySpecHash()&&Number(row.revision)===Number(row.rank_revision)&&Number(row.revision)===Number(row.current_revision);
}
/** Process one bounded rank-position slice. Cursor, derived flags and completion
 * marker commit together; interrupted slices resume from the last committed
 * rank. A lease is acquired and released for each scheduler tick. */
export async function publishResearchFitRankProjectionBatch(runId:string,batchSize=75){
 await ensureSchema();
 const size=Math.max(1,Math.min(100,Math.floor(Number.isFinite(batchSize)?batchSize:75)));
 const d=db(),owner=crypto.randomUUID(),now=Date.now();
 if(await researchFitProjectionReady(runId))return {runId,done:true,busy:false,processed:0,cursor:0,revision:null as number|null};
 const lease=await d.prepare('INSERT INTO opportunity_rank_projection_leases(run_id,owner,lease_until) VALUES(?,?,?) ON CONFLICT(run_id) DO UPDATE SET owner=excluded.owner,lease_until=excluded.lease_until WHERE opportunity_rank_projection_leases.lease_until<? RETURNING owner').bind(runId,owner,now+180_000,now).first() as any;
 if(lease?.owner!==owner)return {runId,done:false,busy:true,processed:0,cursor:null as number|null,revision:null as number|null};
 try{
  const release=await d.prepare('SELECT v.revision,v.rubric_hash,COALESCE(r.revision,0) AS current_revision FROM opportunity_rank_versions v LEFT JOIN opportunity_rating_versions r ON r.run_id=v.run_id WHERE v.run_id=?').bind(runId).first() as any;
  if(!release||release.rubric_hash!==opportunitySpecHash()||Number(release.revision)!==Number(release.current_revision))throw Object.assign(Error('تغيرت نسخة التقييم؛ حدّث النتائج.'),{status:409});
  const revision=Number(release.revision),rubric=opportunitySpecHash();
  let progress=await d.prepare('SELECT revision,rubric_hash,projection_version,cursor_rank_position,complete FROM opportunity_rank_projection_versions WHERE run_id=?').bind(runId).first() as any;
  const matching=progress&&Number(progress.revision)===revision&&progress.rubric_hash===rubric&&progress.projection_version===RESEARCH_FIT_PROJECTION_VERSION;
  if(!matching){
   await d.prepare('INSERT INTO opportunity_rank_projection_versions(run_id,revision,rubric_hash,projection_version,cursor_rank_position,complete) VALUES(?,?,?,?,0,0) ON CONFLICT(run_id) DO UPDATE SET revision=excluded.revision,rubric_hash=excluded.rubric_hash,projection_version=excluded.projection_version,cursor_rank_position=0,complete=0').bind(runId,revision,rubric,RESEARCH_FIT_PROJECTION_VERSION).run();
   progress={revision,rubric_hash:rubric,projection_version:RESEARCH_FIT_PROJECTION_VERSION,cursor_rank_position:0,complete:0};
  }
  if(Number(progress.complete)===1&&await researchFitProjectionReady(runId))return {runId,done:true,busy:false,processed:0,cursor:Number(progress.cursor_rank_position),revision};
  const cursor=Number(progress.cursor_rank_position)||0;
  const next=(await d.prepare('SELECT rank_position FROM opportunity_rankings WHERE run_id=? AND rank_position>? ORDER BY rank_position LIMIT ?').bind(runId,cursor,size+1).all()).results as any[];
  const page=next.slice(0,size),last=Number(page.at(-1)?.rank_position??cursor),done=next.length<=size;
  const guard='EXISTS(SELECT 1 FROM opportunity_rank_versions v LEFT JOIN opportunity_rating_versions rv ON rv.run_id=v.run_id WHERE v.run_id=? AND v.revision=? AND v.rubric_hash=? AND COALESCE(rv.revision,0)=?)';
  const statements:any[]=[];
  if(page.length){
   statements.push(d.prepare(`UPDATE opportunity_rankings AS r SET research_fit=COALESCE((SELECT CASE WHEN (${researchFitSql}) THEN 1 ELSE 0 END FROM fundamental_snapshots s WHERE s.run_id=r.run_id AND s.symbol=r.symbol),0),research_fit_financing_pass=COALESCE((SELECT CASE WHEN ${researchFitFinancingPassSql} THEN 1 ELSE 0 END FROM fundamental_snapshots s WHERE s.run_id=r.run_id AND s.symbol=r.symbol),0) WHERE r.run_id=? AND r.rank_position>? AND r.rank_position<=? AND ${guard}`).bind(runId,cursor,last,runId,revision,rubric,revision));
  }
  statements.push(d.prepare(`UPDATE opportunity_rank_projection_versions SET cursor_rank_position=?,complete=? WHERE run_id=? AND revision=? AND rubric_hash=? AND projection_version=? AND cursor_rank_position=? AND ${guard}`).bind(last,done?1:0,runId,revision,rubric,RESEARCH_FIT_PROJECTION_VERSION,cursor,runId,revision,rubric,revision));
  statements.push(d.prepare('UPDATE opportunity_rank_projection_leases SET lease_until=? WHERE run_id=? AND owner=?').bind(Date.now()+180_000,runId,owner));
  await d.batch(statements);
  progress=await d.prepare('SELECT revision,rubric_hash,projection_version,cursor_rank_position,complete FROM opportunity_rank_projection_versions WHERE run_id=?').bind(runId).first() as any;
  const stillCurrent=await researchFitProjectionReady(runId);
  if(!progress||Number(progress.cursor_rank_position)!==last||Number(progress.revision)!==revision||progress.rubric_hash!==rubric)throw Object.assign(Error('تغيرت البيانات أثناء تجهيز قائمة البحث؛ أعد المحاولة.'),{status:409});
  return {runId,done:stillCurrent,busy:false,processed:page.length,cursor:last,revision};
 }finally{await d.prepare('DELETE FROM opportunity_rank_projection_leases WHERE run_id=? AND owner=?').bind(runId,owner).run();}
}

/** Build exact run summary and coverage in bounded JSON-parsing slices. A
 * completed aggregate is published only for the exact saved rating revision. */
export async function publishRunAggregatesBatch(runId:string,batchSize=100){
 await ensureSchema();
 const size=Math.max(1,Math.min(200,Math.floor(Number.isFinite(batchSize)?batchSize:100))),d=db(),now=Date.now(),owner=crypto.randomUUID(),rubric=opportunitySpecHash();
 const version=await d.prepare('SELECT v.revision,v.rubric_hash,COALESCE(r.revision,0) AS current_revision FROM opportunity_rank_versions v LEFT JOIN opportunity_rating_versions r ON r.run_id=v.run_id WHERE v.run_id=?').bind(runId).first() as any;
 if(!version||version.rubric_hash!==rubric||Number(version.revision)!==Number(version.current_revision))return {runId,done:false,busy:false,processed:0,cursor:'',revision:null as number|null};
 const revision=Number(version.revision),lease=await d.prepare(`INSERT INTO opportunity_run_aggregates(run_id,revision,rubric_hash,cursor_symbol,complete,summary_json,coverage_json,owner,lease_until) VALUES(?,?,?,'',0,'{}','{}',?,?) ON CONFLICT(run_id) DO UPDATE SET revision=excluded.revision,rubric_hash=excluded.rubric_hash,cursor_symbol=CASE WHEN opportunity_run_aggregates.revision<>excluded.revision OR opportunity_run_aggregates.rubric_hash<>excluded.rubric_hash THEN '' ELSE opportunity_run_aggregates.cursor_symbol END,complete=CASE WHEN opportunity_run_aggregates.revision<>excluded.revision OR opportunity_run_aggregates.rubric_hash<>excluded.rubric_hash THEN 0 ELSE opportunity_run_aggregates.complete END,summary_json=CASE WHEN opportunity_run_aggregates.revision<>excluded.revision OR opportunity_run_aggregates.rubric_hash<>excluded.rubric_hash THEN '{}' ELSE opportunity_run_aggregates.summary_json END,coverage_json=CASE WHEN opportunity_run_aggregates.revision<>excluded.revision OR opportunity_run_aggregates.rubric_hash<>excluded.rubric_hash THEN '{}' ELSE opportunity_run_aggregates.coverage_json END,owner=excluded.owner,lease_until=excluded.lease_until WHERE opportunity_run_aggregates.revision<>excluded.revision OR opportunity_run_aggregates.rubric_hash<>excluded.rubric_hash OR (opportunity_run_aggregates.complete=0 AND opportunity_run_aggregates.lease_until<?) RETURNING owner`).bind(runId,revision,rubric,owner,now+180_000,now).first() as any;
 if(lease?.owner!==owner){const ready=await d.prepare('SELECT cursor_symbol,revision FROM opportunity_run_aggregates WHERE run_id=? AND revision=? AND rubric_hash=? AND complete=1').bind(runId,revision,rubric).first() as any;return {runId,done:!!ready,busy:!ready,processed:0,cursor:ready?.cursor_symbol??null,revision};}
 try{
  const progress=await d.prepare('SELECT cursor_symbol,summary_json,coverage_json FROM opportunity_run_aggregates WHERE run_id=? AND owner=? AND revision=? AND rubric_hash=?').bind(runId,owner,revision,rubric).first() as any;
  let state:any={summary:{total:0,opportunityRanked:0,opportunityNeedsResearch:0,opportunityExcluded:0,opportunityWithEvidence:0,missingFactorScores:0,missingFinalGrades:0,opportunityFactorIncomplete:Object.fromEntries(OPPORTUNITY_SPEC.factors.map(f=>[f.id,0])),opportunityEligibilityBlockers:{}},factorSeen:{},coverage:{total:0,fields:Object.fromEntries(['price','marketCap','revenue','netIncome','fcf','cash','debt','medianDollarVolume20d','return12m','low52w','ma30w','dilution'].map(key=>[key,0]))}};
  if(progress?.summary_json&&progress.summary_json!=='{}')try{state=JSON.parse(progress.summary_json)}catch{/* reset malformed aggregate progress */}
  let cursor=String(progress?.cursor_symbol??'');
  const next=(await d.prepare('SELECT symbol,payload,evaluation FROM fundamental_snapshots WHERE run_id=? AND symbol>? ORDER BY symbol COLLATE BINARY ASC LIMIT ?').bind(runId,cursor,size+1).all()).results as any[],rows=next.slice(0,size),done=next.length<=size;
  const coverageFields=Object.keys(state.coverage.fields);
  for(const row of rows){
   const payload=JSON.parse(String(row.payload)),opportunity=JSON.parse(String(row.evaluation))?.opportunity??{},factors=Array.isArray(opportunity.factors)?opportunity.factors:[],checks=Array.isArray(opportunity.checks)?opportunity.checks:[];
   state.summary.total++;state.coverage.total++;
   if(opportunity.state==='ranked')state.summary.opportunityRanked++;else if(opportunity.state==='needs-research')state.summary.opportunityNeedsResearch++;else if(opportunity.state==='excluded')state.summary.opportunityExcluded++;
   if(factors.some((factor:any)=>factor.evidenced===true||factor.evidenced===1))state.summary.opportunityWithEvidence++;
   if(factors.some((factor:any)=>typeof factor.score!=='number'))state.summary.missingFactorScores++;
   if(typeof opportunity.score!=='number')state.summary.missingFinalGrades++;
   for(const factor of factors){const id=String(factor.id??'');if(!id)continue;state.factorSeen[id]=(Number(state.factorSeen[id])||0)+1;if(factor.complete!==1&&factor.complete!==true)state.summary.opportunityFactorIncomplete[id]=(Number(state.summary.opportunityFactorIncomplete[id])||0)+1;}
   for(const check of checks){if(!['FAIL','UNKNOWN'].includes(String(check.status)))continue;const id=`${check.id??'null'}:${check.status}`,entry=state.summary.opportunityEligibilityBlockers[id]??{status:check.status,role:check.role??null,count:0};entry.count++;state.summary.opportunityEligibilityBlockers[id]=entry;}
   for(const key of coverageFields)if(typeof payload[key]==='number')state.coverage.fields[key]++;
  }
  for(const factor of OPPORTUNITY_SPEC.factors)if(!state.factorSeen[factor.id])state.summary.opportunityFactorIncomplete[factor.id]=state.summary.total;
  cursor=String(rows.at(-1)?.symbol??cursor);
  const update=await d.prepare('UPDATE opportunity_run_aggregates SET cursor_symbol=?,complete=?,summary_json=?,coverage_json=?,lease_until=? WHERE run_id=? AND owner=? AND revision=? AND rubric_hash=? AND EXISTS(SELECT 1 FROM opportunity_rank_versions v LEFT JOIN opportunity_rating_versions rv ON rv.run_id=v.run_id WHERE v.run_id=? AND v.revision=? AND v.rubric_hash=? AND COALESCE(rv.revision,0)=?) RETURNING run_id').bind(cursor,done?1:0,JSON.stringify(state),JSON.stringify({...state.coverage,runId}),Date.now()+180_000,runId,owner,revision,rubric,runId,revision,rubric,revision).first() as any;
  if(!update)throw Object.assign(Error('تغيّرت نسخة التقييم أثناء تجهيز ملخص البيانات؛ أعد المحاولة.'),{status:409});
  return {runId,done,busy:false,processed:rows.length,cursor,revision};
 }finally{await d.prepare("UPDATE opportunity_run_aggregates SET owner='',lease_until=0 WHERE run_id=? AND owner=?").bind(runId,owner).run();}
}
async function readRunAggregates(runId:string,revision:number){
 const row=await db().prepare('SELECT summary_json,coverage_json FROM opportunity_run_aggregates WHERE run_id=? AND revision=? AND rubric_hash=? AND complete=1').bind(runId,revision,opportunitySpecHash()).first() as any;
 if(!row)return null;
 try{const state=JSON.parse(row.summary_json);return {summary:state.summary,coverage:JSON.parse(row.coverage_json)}}catch{return null;}
}

export async function readState(options:{strategy?:'opportunity'|'favorites';opportunityState?:'ranked'|'needs-research'|'excluded'|'all';researchFit?:boolean;limit?:number;offset?:number;owner?:string;query?:string;runId?:string;releaseToken?:string;view?:'compact'}={}){await ensureSchema();const d=db();const cacheKey=JSON.stringify([currentHash(),opportunitySpecHash(),options.strategy||'opportunity',options.opportunityState||'ranked',options.researchFit===true,options.owner||'',options.query||'',options.limit??150,options.offset??0,options.runId,options.releaseToken,options.view]);
 if(options.runId&&options.releaseToken)await readRankReleaseIdentity(options.runId,options.releaseToken);
 const cached=stateCache.get(cacheKey);if(cached&&cached.expiresAt>Date.now())return cached.value;if(cached)stateCache.delete(cacheKey);const active=await d.prepare("SELECT * FROM strategy_runs WHERE strategy_hash=? ORDER BY CASE WHEN source LIKE 'Bulk Quotes/%' AND status IN ('running','partial') AND stage<13 THEN 0 ELSE 1 END,updated_at DESC,created_at DESC LIMIT 1").bind(currentHash()).first();
 // A quick sample may be newer than a full scan. It must not silently replace
 // the user's main result set; prefer the newest full-market snapshot whenever
 // one has produced rows, then fall back to the newest available run.
 // Keep an active scan visible in `run`, but never replace the user's usable
 // result set with its still-enriching (and therefore often empty) rows.
 // Prefer the newest completed/partial market run; only fall back to running
 // when no finished result exists yet (first-ever scan).
 const finished=await d.prepare("SELECT * FROM strategy_runs r WHERE status IN ('complete','partial') AND (stage>=13 OR source='import') AND EXISTS(SELECT 1 FROM fundamental_snapshots s WHERE s.run_id=r.id) ORDER BY CASE WHEN source LIKE '%· full' THEN 0 ELSE 1 END, updated_at DESC,created_at DESC LIMIT 1").first();
 const running=await d.prepare("SELECT * FROM strategy_runs WHERE status='running' AND processed>0 AND strategy_hash=? ORDER BY CASE WHEN source LIKE '%· full' THEN 0 ELSE 1 END, updated_at DESC,created_at DESC LIMIT 1").bind(currentHash()).first();
 const fallback=finished?null:await d.prepare("SELECT * FROM strategy_runs r WHERE status IN ('complete','partial') AND (stage>=13 OR source='import') AND EXISTS(SELECT 1 FROM fundamental_snapshots s WHERE s.run_id=r.id) ORDER BY CASE WHEN source LIKE '%· full' THEN 0 ELSE 1 END, updated_at DESC,created_at DESC LIMIT 1").first();
 const pinned=options.runId?await d.prepare("SELECT * FROM strategy_runs WHERE id=? AND status IN ('complete','partial') AND (stage>=13 OR source='import')").bind(options.runId).first():null;
 if(options.runId&&!pinned)throw Object.assign(Error('جولة التقييم المطلوبة غير متاحة كنسخة مكتملة.'),{status:409});
 const latest=pinned||finished||fallback||running;
 const currentData=!!latest&&latest.strategy_hash===currentHash();
 const strategy=options.strategy==='favorites'?'favorites':'opportunity';
 // A completed scan can predate the strategy run hash while every saved row
 // has already been rescored with the current factor rubric. Check the saved
 // evaluation hashes before choosing the expensive legacy backfill path. The
 // run remains stale as data; only its evaluation can be current.
 if(latest)await ensureRunEvaluations(String(latest.id));
 const release=latest?await readRankReleaseIdentity(String(latest.id),options.releaseToken):null;
 if(latest&&options.researchFit===true&&strategy==='opportunity'&&!await researchFitProjectionReady(String(latest.id)))throw Object.assign(Error('قائمة البحث قيد التجهيز؛ حاول مجددًا بعد قليل.'),{status:409,code:'projection_pending'});
 const currentEvaluation=!!latest;
 const limit=Math.max(1,Math.min(250,Math.floor(options.limit??150)));
 const offset=Math.max(0,Math.floor(options.offset??0));
 const fav=options.owner?(await d.prepare(strategy==='favorites'?'SELECT symbol,payload FROM personal_watchlist WHERE owner=? ORDER BY created_at DESC':'SELECT symbol FROM personal_watchlist WHERE owner=? ORDER BY created_at DESC').bind(options.owner).all()).results as any[]:[];
 // A favorite is durable user state, but its saved payload may predate the
 // latest market scan. Refresh the card quote from the selected full scan in
 // one bounded lookup so favorites and the strategy cards use the same
 // completed-session value without opening a deep profile for every favorite.
 const favoriteScanBySymbol=new Map<string,any>();
 const favoriteRatingBySymbol=new Map<string,{evaluation:any;rank:number}>();
 const isCompletedPrice=(value:any)=>typeof value?.tag==='string'&&(/completed session close|last close/i.test(value.tag));
 const isCompletedChange=(value:any)=>typeof value?.tag==='string'&&/previous (completed )?close/i.test(value.tag);
 if(strategy==='favorites'&&latest&&fav.length){
  const symbols=[...new Set(fav.map(row=>String(row.symbol)).filter(Boolean))];
  for(let start=0;start<symbols.length;start+=80){
   const chunk=symbols.slice(start,start+80),result=await d.prepare(`SELECT s.symbol,s.payload,s.evaluation,r.rank_position FROM fundamental_snapshots s LEFT JOIN opportunity_rankings r ON r.run_id=s.run_id AND r.symbol=s.symbol WHERE s.run_id=? AND s.symbol IN (${chunk.map(()=>'?').join(',')})`).bind(latest.id,...chunk).all();
   for(const row of result.results as any[]){try{favoriteScanBySymbol.set(String(row.symbol),JSON.parse(String(row.payload)));favoriteRatingBySymbol.set(String(row.symbol),{evaluation:JSON.parse(row.evaluation),rank:Number(row.rank_position)})}catch{/* ignore one corrupted optional row */}}
  }
 }
 const portfolioCount=options.owner?Number((await d.prepare("SELECT COUNT(*) AS count FROM (SELECT symbol FROM portfolio_transactions WHERE owner=? GROUP BY symbol HAVING SUM(CASE side WHEN 'buy' THEN quantity ELSE -quantity END)>0.00000001)").bind(options.owner).first() as any)?.count||0):0;
 const exactRowCount=latest?Number((await d.prepare('SELECT COUNT(*) AS total FROM fundamental_snapshots WHERE run_id=?').bind(latest.id).first() as any)?.total??0):0;
 const aggregateCacheKey=`${latest?.id??''}:${release?.revision??0}:${opportunitySpecHash()}`;
 const durableAggregates=currentEvaluation&&release?await readRunAggregates(String(latest.id),Number(release.revision)):null;
 let summaryRow=durableAggregates?.summary??(currentEvaluation&&exactRowCount<=500?runSummaryCache.get(aggregateCacheKey):null);
 if(currentEvaluation&&!summaryRow&&exactRowCount<=500){
 summaryRow=await d.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN json_extract(evaluation, '$.opportunity.state')='ranked' THEN 1 ELSE 0 END) AS opportunityRanked, SUM(CASE WHEN json_extract(evaluation, '$.opportunity.state')='needs-research' THEN 1 ELSE 0 END) AS opportunityNeedsResearch, SUM(CASE WHEN json_extract(evaluation, '$.opportunity.state')='excluded' THEN 1 ELSE 0 END) AS opportunityExcluded, SUM(CASE WHEN EXISTS(SELECT 1 FROM json_each(evaluation,'$.opportunity.factors') f WHERE json_extract(f.value,'$.evidenced')=1) THEN 1 ELSE 0 END) AS opportunityWithEvidence, SUM(CASE WHEN EXISTS(SELECT 1 FROM json_each(evaluation,'$.opportunity.factors') f WHERE json_type(f.value,'$.score') IS NULL OR json_type(f.value,'$.score') NOT IN ('integer','real')) THEN 1 ELSE 0 END) AS missingFactorScores, SUM(CASE WHEN json_type(evaluation,'$.opportunity.score') IN ('integer','real') THEN 0 ELSE 1 END) AS missingFinalGrades FROM fundamental_snapshots WHERE run_id=?`).bind(latest.id).first() as any;
 const incomplete=(await d.prepare(`SELECT json_extract(f.value,'$.id') AS id,SUM(CASE WHEN json_extract(f.value,'$.complete')=1 THEN 0 ELSE 1 END) AS count FROM fundamental_snapshots s,json_each(s.evaluation,'$.opportunity.factors') f WHERE s.run_id=? GROUP BY json_extract(f.value,'$.id')`).bind(latest.id).all()).results as any[];
  summaryRow.opportunityFactorIncomplete=Object.fromEntries(OPPORTUNITY_SPEC.factors.map(factor=>[factor.id,Number(incomplete.find(row=>row.id===factor.id)?.count??summaryRow.total)]));
  const blockedChecks=(await d.prepare(`SELECT json_extract(c.value,'$.id') AS id,json_extract(c.value,'$.status') AS status,json_extract(c.value,'$.role') AS role,COUNT(*) AS count FROM fundamental_snapshots s,json_each(s.evaluation,'$.opportunity.checks') c WHERE s.run_id=? AND json_extract(c.value,'$.status') IN ('FAIL','UNKNOWN') GROUP BY json_extract(c.value,'$.id'),json_extract(c.value,'$.status'),json_extract(c.value,'$.role')`).bind(latest.id).all()).results as any[];
  summaryRow.opportunityEligibilityBlockers=Object.fromEntries(blockedChecks.map(row=>[`${row.id}:${row.status}`,{status:row.status,role:row.role,count:Number(row.count)}]));
  runSummaryCache.set(aggregateCacheKey,summaryRow);
 }
 const search=options.query?.trim().toLowerCase().slice(0,100)||'';
 // Persist the current evaluator before ranking so reloads use the same grade. Durable rows
 // can predate a scoring-version change; sorting the persisted evaluation would
 // otherwise leave old null scores and stale weights in front of the user.
 const query=latest&&strategy!=='favorites'?`SELECT payload,evaluation FROM fundamental_snapshots WHERE run_id=? AND (?='' OR instr(lower(symbol),?)>0 OR instr(lower(json_extract(payload,'$.name')),?)>0)`:null;
 const params=latest?[latest.id,search,search,search]:[];
 let databasePaged=false,queryForPage=query,queryParams=params;
 if(query&&currentEvaluation){
  // Current-run evaluations already have the active strategy hash. Filter,
  // sort, and page in SQLite rather than loading the full market universe into
  // the Worker for every page request.
  const requested=options.opportunityState??'ranked';
  queryForPage=`WITH ranked AS (SELECT s.payload,s.evaluation,s.symbol,r.rank_position FROM fundamental_snapshots s JOIN opportunity_rankings r ON r.run_id=s.run_id AND r.symbol=s.symbol WHERE s.run_id=?) SELECT payload,evaluation,rank_position FROM ranked WHERE (?='' OR instr(lower(symbol),?)>0 OR instr(lower(json_extract(payload,'$.name')),?)>0)`;
  queryForPage+=` AND (?='all' OR json_extract(evaluation,'$.opportunity.state')=? OR json_extract(evaluation,'$.opportunity.researchState')=?) ORDER BY rank_position LIMIT ? OFFSET ?`;
  queryParams=[...params,requested,requested,requested,limit+1,offset];
  if(options.researchFit===true&&strategy==='opportunity'){
   queryForPage=`SELECT s.payload,s.evaluation,r.rank_position FROM opportunity_rankings r INDEXED BY opportunity_research_fit_idx JOIN fundamental_snapshots s ON s.run_id=r.run_id AND s.symbol=r.symbol WHERE r.run_id=? AND r.research_fit=1 AND (?='' OR instr(lower(s.symbol),?)>0 OR instr(lower(json_extract(s.payload,'$.name')),?)>0) ORDER BY r.research_fit_financing_pass DESC,r.rank_position LIMIT ? OFFSET ?`;
   queryParams=[latest.id,search,search,search,limit+1,offset];
  } else if (!search && (requested==='all'||requested==='ranked')) {
   // Every record has a canonical numeric rank; research eligibility is a
   // separate status and remains visible in each evaluation.
   queryForPage=`SELECT s.payload,s.evaluation,r.rank_position FROM (SELECT run_id,symbol,rank_position FROM opportunity_rankings INDEXED BY opportunity_rank_position_idx WHERE run_id=? ORDER BY rank_position LIMIT ? OFFSET ?) r JOIN fundamental_snapshots s ON s.run_id=r.run_id AND s.symbol=r.symbol ORDER BY r.rank_position`;
   queryParams=[latest.id,limit+1,offset];
  }
  databasePaged=true;
 }
 // Stale runs are re-evaluated by the bounded keyset loop below. Reading the
 // entire full-history payload set here first can exhaust the Worker heap.
 let rows:any[]=queryForPage&&currentEvaluation?(await d.prepare(queryForPage).bind(...queryParams).all()).results.map((r:any)=>{
  // A current run already stores the evaluation produced by this exact
  // strategy hash. Reusing it avoids parsing and scoring every company on
  // every page refresh; stale runs still take the conservative re-evaluation
  // path below.
  if(currentEvaluation&&typeof r.evaluation==='string')return {payload:r.payload,evaluation:r.evaluation,rank_position:r.rank_position};
  const s=applyFinancingRisk(JSON.parse(r.payload));return {payload:JSON.stringify(s),evaluation:JSON.stringify({opportunity:evaluateSnapshotOpportunity(s)})}
 }):[];
 let coverageRow=durableAggregates?.coverage??(latest&&exactRowCount<=500?runCoverageCache.get(aggregateCacheKey):null);
 if(latest&&!coverageRow&&exactRowCount<=500){coverageRow=await d.prepare(`SELECT COUNT(*) AS total,
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
  FROM fundamental_snapshots WHERE run_id=?`).bind(latest.id).first() as any;runCoverageCache.set(aggregateCacheKey,coverageRow);}
 const coverage=coverageRow?(coverageRow.fields?coverageRow:{runId:latest.id,total:Number(coverageRow.total||0),fields:Object.fromEntries(['price','marketCap','revenue','netIncome','fcf','cash','debt','medianDollarVolume20d','return12m','low52w','ma30w','dilution'].map(key=>[key,Number(coverageRow[key]||0)]))}):null;
 const aggregatesReady=!latest||!!summaryRow&&!!coverage;
 if(strategy!=='favorites'&&!databasePaged){
  // Category pages contain only proven members. Failed/unknown rows remain in
  // the immutable scan report so users can inspect every exclusion reason.
  rows=rows.filter((row:any)=>{const s=applyFinancingRisk(JSON.parse(row.payload));const saved=JSON.parse(row.evaluation).opportunity;const assessment=saved?.hash===opportunitySpecHash()?saved:evaluateSnapshotOpportunity(s);row.evaluation=JSON.stringify({...JSON.parse(row.evaluation),opportunity:assessment});const requested=options.opportunityState??'ranked';return requested==='all'||assessment.state===requested});
  if(!databasePaged)rows.sort((a:any,b:any)=>{const ae=JSON.parse(a.evaluation)[strategy],be=JSON.parse(b.evaluation)[strategy];const score=(e:any)=>e.score==null?Number.NEGATIVE_INFINITY:e.score;return score(be)-score(ae)||(be.scoreCoverage??be.coveragePct??0)-(ae.scoreCoverage??ae.coveragePct??0)||JSON.parse(a.payload).symbol.localeCompare(JSON.parse(b.payload).symbol)});
 }
 if(strategy==='favorites'){
  rows=fav.filter(r=>!search||`${r.symbol} ${JSON.parse(r.payload).name}`.toLowerCase().includes(search)).map(r=>{
   const saved=JSON.parse(r.payload),scanned=favoriteScanBySymbol.get(String(r.symbol)),savedPrice=saved.provenance?.price,scanPrice=scanned?.provenance?.price,scanChange=scanned?.provenance?.dailyChange;
   const refreshed={...(scanned??saved),
    ...(scanned?.name?{name:scanned.name}:{}),...(scanned?.exchange?{exchange:scanned.exchange}:{}),...(Number.isFinite(scanned?.marketCap)?{marketCap:scanned.marketCap}:{}),
    ...(Number.isFinite(scanned?.price)&&isCompletedPrice(scanPrice)?{price:scanned.price,provenance:{...saved.provenance,price:scanPrice}}:{}),
    ...(Number.isFinite(scanned?.dailyChange)&&isCompletedChange(scanChange)?{dailyChange:scanned.dailyChange,provenance:{...saved.provenance,price:scanPrice??savedPrice,dailyChange:scanChange}}:{})
   };
   const s=applyFinancingRisk(refreshed),canonical=favoriteRatingBySymbol.get(String(r.symbol));return {payload:JSON.stringify(s),evaluation:JSON.stringify(canonical?.evaluation??{opportunity:evaluateSnapshotOpportunity(s)}),rank_position:canonical?.rank??null}
  });
  rows=rows.slice(offset,offset+limit+1);
 }
 if(strategy!=='favorites'&&!databasePaged)rows=rows.slice(offset,offset+limit+1);
 const pageRows=rows.slice(0,limit);
 for(let index=0;index<pageRows.length;index++)pageRows[index]=await restoreArchivedRow(pageRows[index]);
 // A profile may have been refreshed after the durable scan row was written.
 // Use its canonical completed-session pair for the card response so an old
 // scan's live quote percentage cannot disagree with the profile the user just
 // opened. This is a read-time bridge; the next full scan persists the same
 // values in the durable row.
 const deepSymbols=[...new Set(pageRows.flatMap((row:any)=>{try{return [String(JSON.parse(row.payload).symbol)]}catch{return []}}))];
 const deepSessionBySymbol=new Map<string,any>();
 if(strategy==='favorites'&&deepSymbols.length){
  // Probe indexed primary keys newest-first. Scanning the multi-GB raw_cache
  // table with LIKE + json_each made radar reads slow as profiles accumulated.
  // Only unresolved symbols move to the next generation; each query binds at
  // most one key per page symbol, below even conservative D1 variable limits.
  const versions=[secUserAgentCacheVersion(),...Array.from({length:18},(_,index)=>`v${21-index}`)];
  let unresolved=deepSymbols;
  for(const version of versions){
   for(let start=0;start<unresolved.length;start+=80){
    const symbols=unresolved.slice(start,start+80),keys=symbols.map(symbol=>`deep:${version}:${symbol}`);
    if(!keys.length)continue;
    const found=(await d.prepare(`SELECT key,payload FROM raw_cache WHERE key IN (${keys.map(()=>'?').join(',')})`).bind(...keys).all()).results as any[];
    for(const row of found){try{const snapshot=JSON.parse(String(row.payload));const tag=String(snapshot?.provenance?.dailyChange?.tag||'');if(snapshot?.symbol&&Number.isFinite(snapshot.dailyChange)&&(tag.includes('previous close')||tag.includes('previous completed close')))deepSessionBySymbol.set(snapshot.symbol,{snapshot,key:String(row.key)})}catch{/* ignore malformed optional cache */}}
   }
   if(deepSessionBySymbol.size===deepSymbols.length)break;
   unresolved=deepSymbols.filter(symbol=>!deepSessionBySymbol.has(symbol));
  }
 }
 const compact=(payload:string)=>{const parsed=JSON.parse(payload);const deep=strategy==='favorites'?deepSessionBySymbol.get(parsed.symbol)?.snapshot:null;if(deep&&Number.isFinite(deep.dailyChange)&&deep.provenance?.dailyChange){parsed.dailyChange=deep.dailyChange;if(Number.isFinite(deep.price))parsed.price=deep.price;parsed.provenance={...parsed.provenance,price:deep.provenance.price??parsed.provenance?.price,dailyChange:deep.provenance.dailyChange};}delete parsed.history;return options.view==='compact'?compactRadarSnapshot(parsed):parsed};
 const fullEvaluatedRows=pageRows.map((row:any)=>{const result=JSON.parse(row.evaluation);if(result.opportunity?.hash===opportunitySpecHash())return result;const snapshot=applyFinancingRisk(JSON.parse(row.payload));return {...result,opportunity:evaluateSnapshotOpportunity(snapshot)}});
 const evaluatedRows=options.view==='compact'?fullEvaluatedRows.map((row:any)=>({...row,opportunity:compactRadarEvaluation(row.opportunity)})):fullEvaluatedRows;
 const stale=!!latest&&!currentData;
 const value={release,run:active?{...active,universe:undefined,retry_queue:undefined,retryPending:JSON.parse(active.retry_queue||'[]').length,stale}:null,dataRunId:latest?.id,dataRun:latest?{...latest,universe:undefined,retry_queue:undefined,stale}:null,snapshots:pageRows.map((r:any)=>compact(r.payload)),storedEvaluations:evaluatedRows,rankPositions:pageRows.map((row:any)=>row.rank_position??null),favorites:fav.map((r:any)=>r.symbol),portfolioCount,coverage,aggregatesReady,summary:{total:exactRowCount,sortedCount:exactRowCount,missingFactorScores:summaryRow?Number(summaryRow.missingFactorScores||0):latest?null:0,missingFinalGrades:summaryRow?Number(summaryRow.missingFinalGrades||0):latest?null:0,opportunityRanked:summaryRow?Number(summaryRow.opportunityRanked||0):latest?null:0,opportunityNeedsResearch:summaryRow?Number(summaryRow.opportunityNeedsResearch||0):latest?null:0,opportunityExcluded:summaryRow?Number(summaryRow.opportunityExcluded||0):latest?null:0,opportunityWithEvidence:summaryRow?Number(summaryRow.opportunityWithEvidence||0):latest?null:0,opportunityFactorIncomplete:summaryRow?.opportunityFactorIncomplete??null,opportunityEligibilityBlockers:summaryRow?.opportunityEligibilityBlockers??null,stale},page:{strategy,limit,offset,hasMore:rows.length>limit}};
 if(aggregatesReady)rememberState(cacheKey,value);return value;}
export async function readAudit(){await ensureSchema();const d=db();const latest=await d.prepare("SELECT * FROM strategy_runs WHERE status IN ('complete','partial') ORDER BY created_at DESC LIMIT 1").first() as any;const logs=latest?(await d.prepare('SELECT stage,created_at,message FROM diag WHERE run_id=? ORDER BY created_at DESC LIMIT 500').bind(latest.id).all()).results:[];const state=await readState({strategy:'opportunity',opportunityState:'all',limit:1});return {strategyHash:currentHash(),opportunitySpecHash:opportunitySpecHash(),run:state.run,dataRun:state.dataRun,summary:state.summary,favorites:state.favorites,logs};}
export function insertSnapshot(runId:string,s:Snapshot){invalidateStateCache();const reviewed=applyFinancingRisk(alignSnapshotFinancials(s));return db().prepare('INSERT OR REPLACE INTO fundamental_snapshots(id,run_id,symbol,as_of,payload,evaluation) VALUES (?,?,?,?,?,?)').bind(`${runId}:${s.symbol}`,runId,s.symbol,reviewed.asOf,JSON.stringify(reviewed),JSON.stringify({opportunity:evaluateSnapshotOpportunity(reviewed)}));}
export async function createRun(source:string,total=0,universe:any[]=[],status='running'){await ensureSchema();invalidateStateCache();const id=crypto.randomUUID(),now=new Date().toISOString();await db().prepare('INSERT INTO strategy_runs (id,created_at,updated_at,status,source,total,universe,strategy_hash) VALUES(?,?,?,?,?,?,?,?)').bind(id,now,now,status,source,total,JSON.stringify(universe),currentHash()).run();return id;}
export async function log(runId:string,stage:string,message:string){await db().prepare('INSERT INTO diag(id,run_id,stage,created_at,message) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),runId,stage,new Date().toISOString(),message).run()}


const evaluationBatchLimit=100;
function pendingEvaluationError(runId:string,progress?:any){const failed=progress?.phase==='failed';return Object.assign(Error(failed?'تعذّر تجهيز نسخة التقييم المحفوظة؛ يلزم فحص مصدر اللقطة المؤرشفة.':'التقييم قيد التجهيز؛ حاول مجددًا بعد قليل.'),{status:failed?503:409,code:failed?'evaluation_failed':'evaluation_pending',runId,phase:progress?.phase??'pending',cursor:progress?.cursor??''});}
async function currentEvaluationRelease(runId:string){
 return db().prepare('SELECT v.revision,v.rubric_hash,COALESCE(r.revision,0) AS current_revision FROM opportunity_rank_versions v LEFT JOIN opportunity_rating_versions r ON r.run_id=v.run_id WHERE v.run_id=?').bind(runId).first() as Promise<any>;
}
/** Read paths never perform a whole-run repair. The scheduler/publication worker
 * advances durable repair jobs in bounded slices and readers return retryable 409. */
export async function ensureRunEvaluations(runId:string){
 const release=await currentEvaluationRelease(runId);
 if(release&&release.rubric_hash===opportunitySpecHash()&&Number(release.revision)===Number(release.current_revision))return;
 const progress=await db().prepare('SELECT phase,cursor,error FROM opportunity_evaluation_jobs WHERE run_id=?').bind(runId).first();
 throw pendingEvaluationError(runId,progress);
}

/** Advance one durable evaluation-repair phase slice. Every transaction has at
 * most 100 statements and a source-revision gate; only the final phase publishes ranks. */
export async function advanceRunEvaluationsBatch(runId:string,batchSize=80){
 await ensureSchema();
 const size=Math.max(1,Math.min(evaluationBatchLimit,Math.floor(Number.isFinite(batchSize)?batchSize:80))),d=db(),rubric=opportunitySpecHash(),owner=crypto.randomUUID(),now=Date.now();
 let release=await currentEvaluationRelease(runId);
 if(release&&release.rubric_hash===rubric&&Number(release.revision)===Number(release.current_revision))return {runId,done:true,busy:false,phase:'published',cursor:''};
 const inputRevision=Number((await d.prepare('SELECT revision FROM opportunity_rating_versions WHERE run_id=?').bind(runId).first() as any)?.revision??0);
 const lease=await d.prepare("INSERT INTO opportunity_evaluation_jobs(run_id,generation,input_revision,expected_revision,rubric_hash,phase,cursor,owner,lease_until,batch_token) VALUES(?,?,?,?,?,'peers','',?,?,'') ON CONFLICT(run_id) DO UPDATE SET owner=excluded.owner,lease_until=excluded.lease_until WHERE opportunity_evaluation_jobs.lease_until<? RETURNING owner").bind(runId,crypto.randomUUID(),inputRevision,inputRevision,rubric,owner,now+180_000,now).first() as any;
 if(lease?.owner!==owner){const progress=await d.prepare('SELECT phase,cursor FROM opportunity_evaluation_jobs WHERE run_id=?').bind(runId).first() as any;return {runId,done:false,busy:true,phase:progress?.phase??'pending',cursor:progress?.cursor??''};}
 try{
  let job=await d.prepare('SELECT generation,input_revision,expected_revision,rubric_hash,phase,cursor,owner FROM opportunity_evaluation_jobs WHERE run_id=? AND owner=?').bind(runId,owner).first() as any;
  const actualRevision=Number((await d.prepare('SELECT revision FROM opportunity_rating_versions WHERE run_id=?').bind(runId).first() as any)?.revision??0);
  if(job.phase==='failed'&&job.rubric_hash===rubric&&Number(job.expected_revision)===actualRevision)return {runId,done:false,busy:false,failed:true,phase:'failed',cursor:String(job.cursor??'')};
  if(job.rubric_hash!==rubric||Number(job.expected_revision)!==actualRevision){
   const generation=crypto.randomUUID();
   await d.prepare("UPDATE opportunity_evaluation_jobs SET generation=?,input_revision=?,expected_revision=?,rubric_hash=?,phase='peers',cursor='',batch_token='' WHERE run_id=? AND owner=?").bind(generation,actualRevision,actualRevision,rubric,runId,owner).run();
   job={...job,generation,input_revision:actualRevision,expected_revision:actualRevision,rubric_hash:rubric,phase:'peers',cursor:''};
  }
  const generation=String(job.generation),phase=String(job.phase),cursor=String(job.cursor??''),expected=Number(job.expected_revision),batchToken=crypto.randomUUID();
  const gate=d.prepare('UPDATE opportunity_evaluation_jobs SET batch_token=? WHERE run_id=? AND generation=? AND owner=? AND phase=? AND cursor=? AND expected_revision=? AND COALESCE((SELECT revision FROM opportunity_rating_versions WHERE run_id=?),0)=?').bind(batchToken,runId,generation,owner,phase,cursor,expected,runId,expected);
  const checkpoint=(nextPhase:string,nextCursor:string,nextExpected=expected)=>d.prepare('UPDATE opportunity_evaluation_jobs SET phase=?,cursor=?,expected_revision=?,batch_token=\'\' WHERE run_id=? AND generation=? AND owner=? AND phase=? AND cursor=? AND expected_revision=? AND batch_token=? AND COALESCE((SELECT revision FROM opportunity_rating_versions WHERE run_id=?),0)=?').bind(nextPhase,nextCursor,nextExpected,runId,generation,owner,phase,cursor,expected,batchToken,runId,nextExpected);
  const gated= (sql:string,bindings:any[])=>d.prepare(sql).bind(...bindings,runId,generation,owner,batchToken);
  if(phase==='peers'){
   const rows=(await d.prepare('SELECT id,symbol,payload,evaluation FROM fundamental_snapshots WHERE run_id=? AND symbol>? ORDER BY symbol COLLATE BINARY ASC LIMIT ?').bind(runId,cursor,Math.min(size,98)).all()).results as any[];
   const observations:PeerObservation[]=[];
   for(const raw of rows){const restored=await restoreArchivedRow(raw);const observation=peerObservation(JSON.parse(restored.payload));if(observation)observations.push(observation);}
   const writes:any[]=[gate];
   for(const observation of observations)writes.push(gated('INSERT OR REPLACE INTO opportunity_peer_candidates(run_id,generation,symbol,cik,payload) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM opportunity_evaluation_jobs WHERE run_id=? AND generation=? AND owner=? AND batch_token=?)',[runId,generation,observation.symbol,observation.cik,JSON.stringify(observation)]));
   const done=rows.length<Math.min(size,98),nextCursor=done?'':String(rows.at(-1)?.symbol??cursor),nextPhase=done?'canonical':'peers';
   writes.push(checkpoint(nextPhase,nextCursor));await d.batch(writes);
  }else if(phase==='canonical'){
   const ciks=(await d.prepare('SELECT cik FROM opportunity_peer_candidates WHERE run_id=? AND generation=? AND cik>CAST(? AS INTEGER) GROUP BY cik ORDER BY cik LIMIT ?').bind(runId,generation,cursor,Math.min(size,98)).all()).results as any[];
   const candidatesByCik=new Map<number,PeerObservation[]>();
   if(ciks.length){
    const candidateRows=(await d.prepare(`SELECT cik,payload FROM opportunity_peer_candidates WHERE run_id=? AND generation=? AND cik IN (${ciks.map(()=>'?').join(',')}) ORDER BY cik,symbol COLLATE BINARY`).bind(runId,generation,...ciks.map(row=>row.cik)).all()).results as any[];
    for(const item of candidateRows){const list=candidatesByCik.get(Number(item.cik))??[];list.push(JSON.parse(item.payload));candidatesByCik.set(Number(item.cik),list);}
   }
   const canonical=[];
   for(const row of ciks){const unique=uniqueIssuerPeers(candidatesByCik.get(Number(row.cik))??[]);if(unique.length)canonical.push(unique[0]);}
   const writes:any[]=[gate];
   for(const peer of canonical)writes.push(gated('INSERT OR REPLACE INTO opportunity_peer_observations(run_id,generation,cik,symbol,sic,end,revenue,gross_margin,payload) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM opportunity_evaluation_jobs WHERE run_id=? AND generation=? AND owner=? AND batch_token=?)',[runId,generation,peer.cik,peer.symbol,peer.sic,peer.end,peer.revenue,peer.grossMargin,JSON.stringify(peer)]));
   const done=ciks.length<Math.min(size,98),nextCursor=done?'':String(ciks.at(-1)?.cik??cursor);
   const runScope=done?await d.prepare('SELECT source FROM strategy_runs WHERE id=?').bind(runId).first() as any:null;
   const nextPhase=done?(String(runScope?.source??'').endsWith('· full')?'issuer_counts':'evaluate'):'canonical';
   writes.push(checkpoint(nextPhase,nextCursor));await d.batch(writes);
  }else if(phase==='issuer_counts'){
   const countSize=Math.min(size,98),rows=(await d.prepare('SELECT symbol,payload FROM fundamental_snapshots WHERE run_id=? AND symbol>? ORDER BY symbol COLLATE BINARY ASC LIMIT ?').bind(runId,cursor,countSize).all()).results as any[];
   const counts=new Map<number,number>();
   for(const row of rows){let snapshot:any;try{snapshot=JSON.parse(row.payload)}catch{continue;}const cik=Number(snapshot.cik);if(snapshot.securityType==='common'&&Number.isSafeInteger(cik)&&cik>0)counts.set(cik,(counts.get(cik)??0)+1);}
   const writes:any[]=[gate];
   for(const [cik,count] of counts)writes.push(gated('INSERT INTO opportunity_issuer_listing_counts(run_id,generation,cik,listing_count) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM opportunity_evaluation_jobs WHERE run_id=? AND generation=? AND owner=? AND batch_token=?) ON CONFLICT(run_id,generation,cik) DO UPDATE SET listing_count=listing_count+excluded.listing_count',[runId,generation,cik,count]));
   const done=rows.length<countSize,nextCursor=done?'':String(rows.at(-1)?.symbol??cursor),nextPhase=done?'evaluate':'issuer_counts';
   writes.push(checkpoint(nextPhase,nextCursor));await d.batch(writes);
  }else if(phase==='evaluate'){
   // Archived rows need two guarded writes each; 49 keeps this phase below
   // D1's 100-statement transaction cap even when every target is archived.
   const evalSize=Math.min(49,size),rows=(await d.prepare('SELECT id,symbol,payload,evaluation FROM fundamental_snapshots WHERE run_id=? AND symbol>? ORDER BY symbol COLLATE BINARY ASC LIMIT ?').bind(runId,cursor,evalSize).all()).results as any[];
   const targets=[];
   for(const raw of rows){const restored=await restoreArchivedRow(raw);const snapshot=applyFinancingRisk(alignSnapshotFinancials(JSON.parse(restored.payload)));targets.push({raw,restored,snapshot,own:peerObservation(snapshot)});}
   const peerTargets=targets.map((target,index)=>target.own?{index,own:target.own}:null).filter(Boolean) as Array<{index:number;own:PeerObservation}>;
   const peersByTarget=new Map<number,PeerObservation[]>();
   const targetJson=JSON.stringify(peerTargets.map(target=>({index:target.index,cik:target.own.cik,sic:target.own.sic,end:target.own.end,revenue:target.own.revenue})));
   const found=(await d.prepare(`WITH target AS (SELECT json_extract(value,'$.index') AS idx,json_extract(value,'$.cik') AS cik,json_extract(value,'$.sic') AS sic,json_extract(value,'$.end') AS end,json_extract(value,'$.revenue') AS revenue FROM json_each(?)) SELECT target.idx,p.payload FROM target JOIN opportunity_peer_observations p ON p.run_id=? AND p.generation=? AND p.sic=target.sic AND p.cik<>target.cik AND p.revenue>=target.revenue/4 AND p.revenue<=target.revenue*4 AND ABS(julianday(p.end)-julianday(target.end))<=45 ORDER BY target.idx,p.cik`).bind(targetJson,runId,generation).all()).results as any[];
   for(const item of found){const list=peersByTarget.get(Number(item.idx))??[];list.push(JSON.parse(item.payload));peersByTarget.set(Number(item.idx),list);}
   const ciks=[...new Set(targets.map(target=>Number(target.snapshot.cik)).filter(cik=>Number.isSafeInteger(cik)&&cik>0))];
   const counts=ciks.length?(await d.prepare(`SELECT cik,listing_count AS count FROM opportunity_issuer_listing_counts WHERE run_id=? AND generation=? AND cik IN (${ciks.map(()=>'?').join(',')})`).bind(runId,generation,...ciks).all()).results as any[]:[];
   const classCounts=new Map(counts.map(row=>[Number(row.cik),Number(row.count)]));
   const runScope=await d.prepare('SELECT source FROM strategy_runs WHERE id=?').bind(runId).first() as any,completeListingScope=String(runScope?.source??'').endsWith('· full');
   const writes:any[]=[gate];let changed=0;
   for(const [index,target] of targets.entries()){
    const snapshot=target.snapshot;
    if(completeListingScope&&Number.isSafeInteger(snapshot.cik)&&Number(snapshot.cik)>0)snapshot.issuerCommonListingCount=classCounts.get(Number(snapshot.cik))??0;
    snapshot.peerContext=peerContext(snapshot,peersByTarget.get(index)??[]);
    let saved:unknown;try{saved=JSON.parse(target.restored.evaluation)?.opportunity}catch{/* repair invalid JSON */}
    if(!isCurrentOpportunityEvaluation(saved)||saved.asOf!==snapshot.asOf||saved.snapshotHash!==opportunitySnapshotHash(snapshot)){
     const evaluation=evaluateSnapshotOpportunity(snapshot);if(!isCurrentOpportunityEvaluation(evaluation))throw Error(`Invalid complete evaluation for ${target.raw.symbol}`);changed++;
     const guard={runId,generation,owner,batchToken};
     if(JSON.parse(target.raw.payload).__archiveId)writes.push(...await archivedWriteStatements(target.raw.id,JSON.stringify(snapshot),JSON.stringify({opportunity:evaluation}),guard));
     else writes.push(gated('UPDATE fundamental_snapshots SET payload=?,evaluation=? WHERE id=? AND EXISTS(SELECT 1 FROM opportunity_evaluation_jobs WHERE run_id=? AND generation=? AND owner=? AND batch_token=?)',[JSON.stringify(snapshot),JSON.stringify({opportunity:evaluation}),target.raw.id]));
    }
   }
   const done=rows.length<evalSize,nextCursor=done?'':String(rows.at(-1)?.symbol??cursor),nextPhase=done?'publish':'evaluate';
   writes.push(checkpoint(nextPhase,nextCursor,expected+changed));await d.batch(writes);
  }else if(phase==='publish'){
   const result=await d.batch([
    gate,
    d.prepare('DELETE FROM opportunity_rankings WHERE run_id=? AND EXISTS(SELECT 1 FROM opportunity_evaluation_jobs j WHERE j.run_id=? AND j.generation=? AND j.owner=? AND j.batch_token=? AND COALESCE((SELECT revision FROM opportunity_rating_versions WHERE run_id=?),0)=?)').bind(runId,runId,generation,owner,batchToken,runId,expected),
    d.prepare("INSERT INTO opportunity_rankings(run_id,symbol,score,evaluation_hash,rank_position,rubric_hash) SELECT run_id,symbol,json_extract(evaluation,'$.opportunity.score'),json_extract(evaluation,'$.opportunity.evaluationHash'),ROW_NUMBER() OVER (ORDER BY json_extract(evaluation,'$.opportunity.score') DESC,symbol COLLATE BINARY ASC),? FROM fundamental_snapshots WHERE run_id=? AND EXISTS(SELECT 1 FROM opportunity_evaluation_jobs j WHERE j.run_id=? AND j.generation=? AND j.owner=? AND j.batch_token=? AND COALESCE((SELECT revision FROM opportunity_rating_versions WHERE run_id=?),0)=?)").bind(rubric,runId,runId,generation,owner,batchToken,runId,expected),
    d.prepare("INSERT OR REPLACE INTO opportunity_rank_versions(run_id,revision,rubric_hash) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM opportunity_evaluation_jobs j WHERE j.run_id=? AND j.generation=? AND j.owner=? AND j.batch_token=? AND COALESCE((SELECT revision FROM opportunity_rating_versions WHERE run_id=?),0)=?)").bind(runId,expected,rubric,runId,generation,owner,batchToken,runId,expected),
    d.prepare("UPDATE opportunity_evaluation_jobs SET phase='complete',cursor='',owner='',lease_until=0,batch_token='' WHERE run_id=? AND generation=? AND owner=? AND batch_token=? AND expected_revision=? AND COALESCE((SELECT revision FROM opportunity_rating_versions WHERE run_id=?),0)=?").bind(runId,generation,owner,batchToken,expected,runId,expected),
   ]);
   void result;invalidateStateCache();
  }else if(phase==='complete')return {runId,done:true,busy:false,phase,cursor};
  else throw Error(`Unknown evaluation repair phase ${phase}`);
  const updated=await d.prepare('SELECT generation,expected_revision,rubric_hash,phase,cursor FROM opportunity_evaluation_jobs WHERE run_id=?').bind(runId).first() as any;
  release=await currentEvaluationRelease(runId);
  const published=release&&release.rubric_hash===rubric&&Number(release.revision)===Number(release.current_revision);
  if(published)return {runId,done:true,busy:false,phase:'published',cursor:''};
  if(!updated||updated.rubric_hash!==rubric||Number(updated.expected_revision)!==Number((await d.prepare('SELECT revision FROM opportunity_rating_versions WHERE run_id=?').bind(runId).first() as any)?.revision??0))return {runId,done:false,busy:false,phase:'restart',cursor:''};
  return {runId,done:false,busy:false,phase:String(updated.phase),cursor:String(updated.cursor??'')};
 }catch(error){
  const message=error instanceof Error?error.message:String(error),malformed=error instanceof SyntaxError||message.includes('Historical source archive is missing')||message.includes('incorrect header check')||message.includes('unexpected end of file');
  if(malformed){
   await d.prepare("UPDATE opportunity_evaluation_jobs SET phase='failed',error=?,owner='',lease_until=0,batch_token='' WHERE run_id=? AND owner=?").bind('Source snapshot or archive is malformed or unavailable',runId,owner).run();
   return {runId,done:false,busy:false,failed:true,phase:'failed',cursor:String((await d.prepare('SELECT cursor FROM opportunity_evaluation_jobs WHERE run_id=?').bind(runId).first() as any)?.cursor??'')};
  }
  throw error;
 }finally{await d.prepare("UPDATE opportunity_evaluation_jobs SET owner='',lease_until=0,batch_token='' WHERE run_id=? AND owner=?").bind(runId,owner).run();}
}

/** The same completed full universe selection used by radar and profiles. */
export async function readCanonicalCompany(symbol:string,runId?:string,releaseToken?:string) {
 await ensureSchema();const d=db();
 const run=runId?await d.prepare("SELECT id FROM strategy_runs WHERE id=? AND status IN ('complete','partial') AND (stage>=13 OR source='import')").bind(runId).first() as any:await d.prepare("SELECT id FROM strategy_runs r WHERE status IN ('complete','partial') AND (stage>=13 OR source='import') AND EXISTS(SELECT 1 FROM fundamental_snapshots s WHERE s.run_id=r.id) ORDER BY CASE WHEN source LIKE '%· full' THEN 0 ELSE 1 END, updated_at DESC,created_at DESC LIMIT 1").first() as any;
 if(runId&&!run)throw Object.assign(Error('جولة التقييم المطلوبة غير متاحة.'),{status:409});
 if(!run)return null;
 await ensureRunEvaluations(run.id);
 const release=await readRankReleaseIdentity(String(run.id),releaseToken);
 const row=await d.prepare("SELECT s.symbol,s.payload,s.evaluation,r.rank_position FROM fundamental_snapshots s JOIN opportunity_rankings r ON r.run_id=s.run_id AND r.symbol=s.symbol WHERE s.run_id=? AND s.symbol=?").bind(run.id,symbol).first() as any;
 if(!row)return null;
 const restored=await restoreArchivedRow(row);
 return {snapshot:JSON.parse(restored.payload) as Snapshot,evaluation:JSON.parse(restored.evaluation).opportunity as OpportunityEvaluation,release,ranking:{runId:run.id,position:Number(row.rank_position)}};
}
