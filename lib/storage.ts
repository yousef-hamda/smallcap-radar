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
  d.prepare("CREATE TABLE IF NOT EXISTS opportunity_rankings (run_id TEXT NOT NULL,symbol TEXT NOT NULL,score REAL NOT NULL,evaluation_hash TEXT NOT NULL,rank_position INTEGER NOT NULL,rubric_hash TEXT NOT NULL,PRIMARY KEY(run_id,symbol))"),
  d.prepare("CREATE INDEX IF NOT EXISTS opportunity_rank_position_idx ON opportunity_rankings(run_id,rank_position)"),
  d.prepare("CREATE TABLE IF NOT EXISTS opportunity_rating_versions (run_id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0)"),
  d.prepare("CREATE TABLE IF NOT EXISTS opportunity_rank_versions (run_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,rubric_hash TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS opportunity_evaluation_leases (run_id TEXT PRIMARY KEY,owner TEXT NOT NULL,lease_until INTEGER NOT NULL)"),
  ...['INSERT','UPDATE','DELETE'].map(operation=>d.prepare(`CREATE TRIGGER IF NOT EXISTS opportunity_rating_${operation.toLowerCase()} AFTER ${operation} ON fundamental_snapshots BEGIN INSERT INTO opportunity_rating_versions(run_id,revision) VALUES(${operation==='DELETE'?'OLD':'NEW'}.run_id,1) ON CONFLICT(run_id) DO UPDATE SET revision=revision+1; END`)),
  d.prepare("CREATE INDEX IF NOT EXISTS snapshot_run_idx ON fundamental_snapshots(run_id)"),
  d.prepare("CREATE INDEX IF NOT EXISTS snapshot_run_symbol_idx ON fundamental_snapshots(run_id,symbol)"),
  d.prepare("CREATE INDEX IF NOT EXISTS snapshot_symbol_date_idx ON fundamental_snapshots(symbol,as_of)"),
  d.prepare("CREATE TABLE IF NOT EXISTS watchlist (symbol TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS personal_watchlist (owner TEXT NOT NULL, symbol TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(owner,symbol))"),
  d.prepare("CREATE TABLE IF NOT EXISTS raw_cache (key TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL, retrieved_at TEXT NOT NULL, payload TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS diag (id TEXT PRIMARY KEY NOT NULL, run_id TEXT, stage TEXT NOT NULL, created_at TEXT NOT NULL, message TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS experiment_registry (id TEXT PRIMARY KEY NOT NULL, hypothesis TEXT NOT NULL, parameters TEXT NOT NULL, created_at TEXT NOT NULL, dataset_version TEXT NOT NULL, result TEXT, p_value REAL, adjusted_p REAL, status TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS holdout_sets (firm_id TEXT PRIMARY KEY NOT NULL, membership TEXT NOT NULL, salt_hash TEXT NOT NULL, consumed_at TEXT)"),
  d.prepare("CREATE TABLE IF NOT EXISTS backtest_runs (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, strategy_hash TEXT NOT NULL, dataset_version TEXT NOT NULL, parameters TEXT NOT NULL, metrics TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL DEFAULT '', subscription TEXT NOT NULL, created_at TEXT NOT NULL, last_success_at TEXT, failure_count INTEGER NOT NULL DEFAULT 0)"),
  d.prepare("CREATE TABLE IF NOT EXISTS portfolio_transactions (id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, symbol TEXT NOT NULL, company_name TEXT NOT NULL, side TEXT NOT NULL, quantity REAL NOT NULL, price REAL NOT NULL, fees REAL NOT NULL DEFAULT 0, trade_date TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS portfolio_revisions (owner TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL DEFAULT 0)"),
  d.prepare("CREATE TABLE IF NOT EXISTS radar_accounts (id TEXT PRIMARY KEY NOT NULL, username TEXT UNIQUE NOT NULL, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
  d.prepare("CREATE TABLE IF NOT EXISTS radar_sessions (token_hash TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at INTEGER NOT NULL, FOREIGN KEY (account_id) REFERENCES radar_accounts(id))"),
  d.prepare("CREATE TABLE IF NOT EXISTS recovery_bundles (id TEXT PRIMARY KEY NOT NULL, token_hash TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, claimed_at TEXT, claimed_by TEXT)"),
  d.prepare("CREATE INDEX IF NOT EXISTS idx_portfolio_owner_date ON portfolio_transactions(owner,trade_date,id)"),
  d.prepare("CREATE INDEX IF NOT EXISTS idx_portfolio_owner_symbol_date ON portfolio_transactions(owner,symbol,trade_date,id)"),
  d.prepare("CREATE INDEX IF NOT EXISTS idx_radar_sessions_account ON radar_sessions(account_id)"),
  d.prepare("CREATE INDEX IF NOT EXISTS idx_radar_sessions_expiry ON radar_sessions(expires_at)")
  ,d.prepare("CREATE TABLE IF NOT EXISTS bulk_fundamentals (run_id TEXT NOT NULL, cik INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,cik))")
 ]);
 const columns=(await d.prepare("PRAGMA table_info(strategy_runs)").all()).results as any[];
 if(!columns.some(c=>c.name==='retry_queue'))await d.prepare("ALTER TABLE strategy_runs ADD COLUMN retry_queue TEXT NOT NULL DEFAULT '[]'").run();
 if(!columns.some(c=>c.name==='notification_sent_at'))await d.prepare("ALTER TABLE strategy_runs ADD COLUMN notification_sent_at TEXT").run();
 if(!columns.some(c=>c.name==='universe_total'))await d.prepare("ALTER TABLE strategy_runs ADD COLUMN universe_total INTEGER NOT NULL DEFAULT 0").run();
 if(!columns.some(c=>c.name==='screened_out'))await d.prepare("ALTER TABLE strategy_runs ADD COLUMN screened_out INTEGER NOT NULL DEFAULT 0").run();
 for(const name of ['quote_coverage','sec_requests','sec_success','sec_failed','fundamental_coverage'])if(!columns.some(c=>c.name===name))await d.prepare(`ALTER TABLE strategy_runs ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`).run();
 const pushColumns=(await d.prepare("PRAGMA table_info(push_subscriptions)").all()).results as any[];
 if(!pushColumns.some(c=>c.name==='owner'))await d.prepare("ALTER TABLE push_subscriptions ADD COLUMN owner TEXT NOT NULL DEFAULT ''").run();
 const compacted=await d.prepare("SELECT id FROM diag WHERE stage='compact-history-v1' LIMIT 1").first();
 if(!compacted){
  await d.prepare("UPDATE fundamental_snapshots SET payload=json_remove(payload,'$.history') WHERE instr(payload,'\"history\"')>0").run();
  await d.prepare("INSERT INTO diag(id,stage,created_at,message) VALUES(?,?,?,?)").bind(crypto.randomUUID(),'compact-history-v1',new Date().toISOString(),'Removed historical bars from durable radar rows; detailed history remains on-demand.').run();
 }
 await d.prepare("UPDATE strategy_runs SET status='failed',error='تغيّرت نسخة الاستراتيجية؛ ابدأ فحصًا جديدًا.',lease_until=0,updated_at=? WHERE status IN ('running','partial') AND stage<13 AND strategy_hash<>?").bind(new Date().toISOString(),currentHash()).run();
 })().catch(e=>{schemaPromise=null;throw e});
 return schemaPromise;
}
export const currentHash=()=>`${OPPORTUNITY_SPEC.id}:${opportunitySpecHash()}`;
export async function readRankReleaseIdentity(runId:string,expectedToken?:string) {
 const row=await db().prepare('SELECT v.revision,v.rubric_hash,COALESCE(r.revision,0) AS current_revision FROM opportunity_rank_versions v LEFT JOIN opportunity_rating_versions r ON r.run_id=v.run_id WHERE v.run_id=?').bind(runId).first() as any;
 if(!row)throw Object.assign(Error('النسخة المحفوظة غير جاهزة؛ حدّث القائمة.'),{status:409});
 const token=`${runId}:${Number(row.revision)}:${row.rubric_hash}`;
 if(expectedToken&&(expectedToken!==token||Number(row.revision)!==Number(row.current_revision)||row.rubric_hash!==opportunitySpecHash()))throw Object.assign(Error('تغيّرت نسخة التقييم؛ حدّث القائمة قبل تحميل المزيد أو فتح الملف.'),{status:409});
 return {runId,revision:Number(row.revision),rubricHash:String(row.rubric_hash),token};
}
export async function readState(options:{strategy?:'opportunity'|'favorites';opportunityState?:'ranked'|'needs-research'|'excluded'|'all';limit?:number;offset?:number;owner?:string;query?:string;runId?:string;releaseToken?:string;view?:'compact'}={}){await ensureSchema();const d=db();const cacheKey=JSON.stringify([currentHash(),opportunitySpecHash(),options.strategy||'opportunity',options.opportunityState||'ranked',options.owner||'',options.query||'',options.limit??150,options.offset??0,options.runId,options.releaseToken,options.view]);
 if(options.runId&&options.releaseToken)await readRankReleaseIdentity(options.runId,options.releaseToken);
 const cached=stateCache.get(cacheKey);if(cached&&cached.expiresAt>Date.now())return cached.value;if(cached)stateCache.delete(cacheKey);const active=await d.prepare("SELECT * FROM strategy_runs WHERE strategy_hash=? ORDER BY created_at DESC LIMIT 1").bind(currentHash()).first();
 // A quick sample may be newer than a full scan. It must not silently replace
 // the user's main result set; prefer the newest full-market snapshot whenever
 // one has produced rows, then fall back to the newest available run.
 // Keep an active scan visible in `run`, but never replace the user's usable
 // result set with its still-enriching (and therefore often empty) rows.
 // Prefer the newest completed/partial market run; only fall back to running
 // when no finished result exists yet (first-ever scan).
 const finished=await d.prepare("SELECT * FROM strategy_runs r WHERE status IN ('complete','partial') AND (stage>=13 OR source='import') AND EXISTS(SELECT 1 FROM fundamental_snapshots s WHERE s.run_id=r.id) ORDER BY CASE WHEN source LIKE '%· full' THEN 0 ELSE 1 END, CASE WHEN status='complete' THEN 0 ELSE 1 END, created_at DESC LIMIT 1").first();
 const running=await d.prepare("SELECT * FROM strategy_runs WHERE status='running' AND processed>0 AND strategy_hash=? ORDER BY CASE WHEN source LIKE '%· full' THEN 0 ELSE 1 END, CASE WHEN status='complete' THEN 0 ELSE 1 END, created_at DESC LIMIT 1").bind(currentHash()).first();
 const fallback=finished?null:await d.prepare("SELECT * FROM strategy_runs r WHERE status IN ('complete','partial') AND (stage>=13 OR source='import') AND EXISTS(SELECT 1 FROM fundamental_snapshots s WHERE s.run_id=r.id) ORDER BY CASE WHEN source LIKE '%· full' THEN 0 ELSE 1 END, CASE WHEN status='complete' THEN 0 ELSE 1 END, created_at DESC LIMIT 1").first();
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
 let summaryRow=currentEvaluation?runSummaryCache.get(String(latest.id)):null;
 if(currentEvaluation&&!summaryRow){
 summaryRow=await d.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN json_extract(evaluation, '$.opportunity.state')='ranked' THEN 1 ELSE 0 END) AS opportunityRanked, SUM(CASE WHEN json_extract(evaluation, '$.opportunity.state')='needs-research' THEN 1 ELSE 0 END) AS opportunityNeedsResearch, SUM(CASE WHEN json_extract(evaluation, '$.opportunity.state')='excluded' THEN 1 ELSE 0 END) AS opportunityExcluded, SUM(CASE WHEN EXISTS(SELECT 1 FROM json_each(evaluation,'$.opportunity.factors') f WHERE json_extract(f.value,'$.evidenced')=1) THEN 1 ELSE 0 END) AS opportunityWithEvidence, SUM(CASE WHEN EXISTS(SELECT 1 FROM json_each(evaluation,'$.opportunity.factors') f WHERE json_type(f.value,'$.score') IS NULL OR json_type(f.value,'$.score') NOT IN ('integer','real')) THEN 1 ELSE 0 END) AS missingFactorScores, SUM(CASE WHEN json_type(evaluation,'$.opportunity.score') IN ('integer','real') THEN 0 ELSE 1 END) AS missingFinalGrades FROM fundamental_snapshots WHERE run_id=?`).bind(latest.id).first() as any;
 const incomplete=(await d.prepare(`SELECT json_extract(f.value,'$.id') AS id,SUM(CASE WHEN json_extract(f.value,'$.complete')=1 THEN 0 ELSE 1 END) AS count FROM fundamental_snapshots s,json_each(s.evaluation,'$.opportunity.factors') f WHERE s.run_id=? GROUP BY json_extract(f.value,'$.id')`).bind(latest.id).all()).results as any[];
  summaryRow.opportunityFactorIncomplete=Object.fromEntries(OPPORTUNITY_SPEC.factors.map(factor=>[factor.id,Number(incomplete.find(row=>row.id===factor.id)?.count??summaryRow.total)]));
  const blockedChecks=(await d.prepare(`SELECT json_extract(c.value,'$.id') AS id,json_extract(c.value,'$.status') AS status,json_extract(c.value,'$.role') AS role,COUNT(*) AS count FROM fundamental_snapshots s,json_each(s.evaluation,'$.opportunity.checks') c WHERE s.run_id=? AND json_extract(c.value,'$.status') IN ('FAIL','UNKNOWN') GROUP BY json_extract(c.value,'$.id'),json_extract(c.value,'$.status'),json_extract(c.value,'$.role')`).bind(latest.id).all()).results as any[];
  summaryRow.opportunityEligibilityBlockers=Object.fromEntries(blockedChecks.map(row=>[`${row.id}:${row.status}`,{status:row.status,role:row.role,count:Number(row.count)}]));
  runSummaryCache.set(String(latest.id),summaryRow);
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
  if (!search && (requested==='all'||requested==='ranked')) {
   // Rank keys drive the page. LIMIT is applied before any large JSON payload
   // is joined; the outer order sorts only the requested page, not the universe.
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
 let coverageRow=latest?runCoverageCache.get(String(latest.id)):null;
 if(latest&&!coverageRow){coverageRow=await d.prepare(`SELECT COUNT(*) AS total,
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
  FROM fundamental_snapshots WHERE run_id=?`).bind(latest.id).first() as any;runCoverageCache.set(String(latest.id),coverageRow);}
 const coverage=coverageRow?{runId:latest.id,total:Number(coverageRow.total||0),fields:Object.fromEntries(['price','marketCap','revenue','netIncome','fcf','cash','debt','medianDollarVolume20d','return12m','low52w','ma30w','dilution'].map(key=>[key,Number(coverageRow[key]||0)]))}:null;
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
 const value={release,run:active?{...active,universe:undefined,retry_queue:undefined,retryPending:JSON.parse(active.retry_queue||'[]').length,stale}:null,dataRunId:latest?.id,dataRun:latest?{...latest,universe:undefined,retry_queue:undefined,stale}:null,snapshots:pageRows.map((r:any)=>compact(r.payload)),storedEvaluations:evaluatedRows,rankPositions:pageRows.map((row:any)=>row.rank_position??null),favorites:fav.map((r:any)=>r.symbol),portfolioCount,coverage,summary:{total:Number(summaryRow?.total||0),sortedCount:Number(summaryRow?.total||0),missingFactorScores:Number(summaryRow?.missingFactorScores||0),missingFinalGrades:Number(summaryRow?.missingFinalGrades||0),opportunityRanked:Number(summaryRow?.opportunityRanked||0),opportunityNeedsResearch:Number(summaryRow?.opportunityNeedsResearch||0),opportunityExcluded:Number(summaryRow?.opportunityExcluded||0),opportunityWithEvidence:Number(summaryRow?.opportunityWithEvidence||0),opportunityFactorIncomplete:summaryRow?.opportunityFactorIncomplete??Object.fromEntries(OPPORTUNITY_SPEC.factors.map(factor=>[factor.id,Number(summaryRow?.total||0)])),opportunityEligibilityBlockers:summaryRow?.opportunityEligibilityBlockers??{},stale},page:{strategy,limit,offset,hasMore:rows.length>limit}};
 rememberState(cacheKey,value);return value;}
export async function readAudit(){await ensureSchema();const d=db();const latest=await d.prepare("SELECT * FROM strategy_runs WHERE status IN ('complete','partial') ORDER BY created_at DESC LIMIT 1").first() as any;const logs=latest?(await d.prepare('SELECT stage,created_at,message FROM diag WHERE run_id=? ORDER BY created_at DESC LIMIT 500').bind(latest.id).all()).results:[];const state=await readState({strategy:'opportunity',opportunityState:'all',limit:1});return {strategyHash:currentHash(),opportunitySpecHash:opportunitySpecHash(),run:state.run,dataRun:state.dataRun,summary:state.summary,favorites:state.favorites,logs};}
export function insertSnapshot(runId:string,s:Snapshot){invalidateStateCache();const reviewed=applyFinancingRisk(alignSnapshotFinancials(s));return db().prepare('INSERT OR REPLACE INTO fundamental_snapshots(id,run_id,symbol,as_of,payload,evaluation) VALUES (?,?,?,?,?,?)').bind(`${runId}:${s.symbol}`,runId,s.symbol,reviewed.asOf,JSON.stringify(reviewed),JSON.stringify({opportunity:evaluateSnapshotOpportunity(reviewed)}));}
export async function createRun(source:string,total=0,universe:any[]=[],status='running'){await ensureSchema();invalidateStateCache();const id=crypto.randomUUID(),now=new Date().toISOString();await db().prepare('INSERT INTO strategy_runs (id,created_at,updated_at,status,source,total,universe,strategy_hash) VALUES(?,?,?,?,?,?,?,?)').bind(id,now,now,status,source,total,JSON.stringify(universe),currentHash()).run();return id;}
export async function log(runId:string,stage:string,message:string){await db().prepare('INSERT INTO diag(id,run_id,stage,created_at,message) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),runId,stage,new Date().toISOString(),message).run()}


const evaluationRepairs = new Map<string, Promise<void>>();
/** Repair every saved run independently of scan lifecycle. Concurrent readers
 * share the repair; a failed batch is retried on the next request. */
export async function ensureRunEvaluations(runId:string) {
 const pending=evaluationRepairs.get(runId);if(pending)return pending;
 const work=(async()=>{
  const d=db();
  const version=await d.prepare("SELECT v.revision,v.rubric_hash,COALESCE(r.revision,0) AS current_revision FROM opportunity_rank_versions v LEFT JOIN opportunity_rating_versions r ON r.run_id=v.run_id WHERE v.run_id=?").bind(runId).first() as any;
  if(version&&version.rubric_hash===opportunitySpecHash()&&Number(version.revision)===Number(version.current_revision))return;
  const owner=crypto.randomUUID(),deadline=Date.now()+180_000;
  let acquired=false;
  while(Date.now()<deadline){
   const now=Date.now();
   const lease=await d.prepare('INSERT INTO opportunity_evaluation_leases(run_id,owner,lease_until) VALUES(?,?,?) ON CONFLICT(run_id) DO UPDATE SET owner=excluded.owner,lease_until=excluded.lease_until WHERE opportunity_evaluation_leases.lease_until<? RETURNING owner').bind(runId,owner,now+180_000,now).first() as any;
   if(lease?.owner===owner){acquired=true;break;}
   await new Promise(resolve=>setTimeout(resolve,500));
   const ready=await d.prepare('SELECT v.revision,v.rubric_hash,COALESCE(r.revision,0) AS current_revision FROM opportunity_rank_versions v LEFT JOIN opportunity_rating_versions r ON r.run_id=v.run_id WHERE v.run_id=?').bind(runId).first() as any;
   if(ready&&ready.rubric_hash===opportunitySpecHash()&&Number(ready.revision)===Number(ready.current_revision))return;
  }
  if(!acquired)throw Object.assign(Error('التقييم قيد إعادة الحساب؛ حاول مجددًا.'),{status:409});
  try{
  let expectedRevision=Number((await d.prepare('SELECT revision FROM opportunity_rating_versions WHERE run_id=?').bind(runId).first() as any)?.revision??0);
  const classes=(await d.prepare("SELECT json_extract(payload,'$.cik') AS cik,COUNT(*) AS count FROM fundamental_snapshots WHERE run_id=? AND json_extract(payload,'$.securityType')='common' GROUP BY json_extract(payload,'$.cik')").bind(runId).all()).results as any[];
  const classCounts=new Map(classes.map(row=>[Number(row.cik),Number(row.count)]));
  const runScope=await d.prepare('SELECT source FROM strategy_runs WHERE id=?').bind(runId).first() as any;
  const completeListingScope=String(runScope?.source??'').endsWith('· full');
  const peerRows:PeerObservation[]=[];let peerAfter='';
  while(true){
   const rows=(await d.prepare('SELECT id,symbol,payload,evaluation FROM fundamental_snapshots WHERE run_id=? AND symbol>? ORDER BY symbol COLLATE BINARY ASC LIMIT 100').bind(runId,peerAfter).all()).results as any[];
   if(!rows.length)break;
   for(const rawRow of rows){const restored=await restoreArchivedRow(rawRow);const observation=peerObservation(JSON.parse(restored.payload));if(observation)peerRows.push(observation);}
   peerAfter=rows.at(-1).symbol;
  }
  const peers=uniqueIssuerPeers(peerRows);
  let afterSymbol='';
  while(true){
   const rows=(await d.prepare('SELECT id,symbol,payload,evaluation FROM fundamental_snapshots WHERE run_id=? AND symbol>? ORDER BY symbol COLLATE BINARY ASC LIMIT 100').bind(runId,afterSymbol).all()).results as any[];
   if(!rows.length)break;
   const writes=[];let changed=0;
   for(const rawRow of rows){
    const archived=!!JSON.parse(rawRow.payload).__archiveId;
    const row=await restoreArchivedRow(rawRow);
    let saved:unknown;try{saved=JSON.parse(row.evaluation)?.opportunity}catch{/* repair invalid JSON */}
    const snapshot=applyFinancingRisk(alignSnapshotFinancials(JSON.parse(row.payload)));
    if(completeListingScope&&Number.isSafeInteger(snapshot.cik)&&Number(snapshot.cik)>0)snapshot.issuerCommonListingCount=classCounts.get(Number(snapshot.cik))??0;
    snapshot.peerContext=peerContext(snapshot,peers);
    if(!isCurrentOpportunityEvaluation(saved)||saved.asOf!==snapshot.asOf||saved.snapshotHash!==opportunitySnapshotHash(snapshot)){
     const evaluation=evaluateSnapshotOpportunity(snapshot);changed++;
     if(!isCurrentOpportunityEvaluation(evaluation))throw Error(`Invalid complete evaluation for ${row.symbol}`);
     if(archived)writes.push(...await archivedWriteStatements(row.id,JSON.stringify(snapshot),JSON.stringify({opportunity:evaluation})));
     else writes.push(d.prepare('UPDATE fundamental_snapshots SET payload=?,evaluation=? WHERE id=?').bind(JSON.stringify(snapshot),JSON.stringify({opportunity:evaluation}),row.id));
    }
   }
   if(writes.length)await d.batch(writes);
   expectedRevision+=changed;
   await d.prepare('UPDATE opportunity_evaluation_leases SET lease_until=? WHERE run_id=? AND owner=?').bind(Date.now()+180_000,runId,owner).run();
   afterSymbol=rows.at(-1).symbol;
  }
  // Publish all rank positions together after every evaluation batch succeeds.
  await d.batch([
   d.prepare('DELETE FROM opportunity_rankings WHERE run_id=? AND COALESCE((SELECT revision FROM opportunity_rating_versions WHERE run_id=?),0)=?').bind(runId,runId,expectedRevision),
   d.prepare("INSERT INTO opportunity_rankings(run_id,symbol,score,evaluation_hash,rank_position,rubric_hash) SELECT run_id,symbol,json_extract(evaluation,'$.opportunity.score'),json_extract(evaluation,'$.opportunity.evaluationHash'),ROW_NUMBER() OVER (ORDER BY json_extract(evaluation,'$.opportunity.score') DESC,symbol COLLATE BINARY ASC),? FROM fundamental_snapshots WHERE run_id=? AND COALESCE((SELECT revision FROM opportunity_rating_versions WHERE run_id=?),0)=?").bind(opportunitySpecHash(),runId,runId,expectedRevision),
   d.prepare("INSERT OR REPLACE INTO opportunity_rank_versions(run_id,revision,rubric_hash) SELECT ?,?,? WHERE COALESCE((SELECT revision FROM opportunity_rating_versions WHERE run_id=?),0)=?").bind(runId,expectedRevision,opportunitySpecHash(),runId,expectedRevision),
  ]);
  const published=await d.prepare('SELECT v.revision,v.rubric_hash,COALESCE(r.revision,0) AS current_revision FROM opportunity_rank_versions v LEFT JOIN opportunity_rating_versions r ON r.run_id=v.run_id WHERE v.run_id=?').bind(runId).first() as any;
  if(!published||Number(published.revision)!==expectedRevision||Number(published.current_revision)!==expectedRevision||published.rubric_hash!==opportunitySpecHash())throw Object.assign(Error('تغيرت البيانات أثناء الحساب؛ حدّث النتائج.'),{status:409});
  invalidateStateCache();
  }finally{await d.prepare('UPDATE opportunity_evaluation_leases SET lease_until=0 WHERE run_id=? AND owner=?').bind(runId,owner).run();}
 })().finally(()=>evaluationRepairs.delete(runId));
 evaluationRepairs.set(runId,work);return work;
}

/** The same completed full universe selection used by radar and profiles. */
export async function readCanonicalCompany(symbol:string,runId?:string,releaseToken?:string) {
 await ensureSchema();const d=db();
 const run=runId?await d.prepare("SELECT id FROM strategy_runs WHERE id=? AND status IN ('complete','partial') AND (stage>=13 OR source='import')").bind(runId).first() as any:await d.prepare("SELECT id FROM strategy_runs r WHERE status IN ('complete','partial') AND (stage>=13 OR source='import') AND EXISTS(SELECT 1 FROM fundamental_snapshots s WHERE s.run_id=r.id) ORDER BY CASE WHEN source LIKE '%· full' THEN 0 ELSE 1 END, CASE WHEN status='complete' THEN 0 ELSE 1 END, created_at DESC LIMIT 1").first() as any;
 if(runId&&!run)throw Object.assign(Error('جولة التقييم المطلوبة غير متاحة.'),{status:409});
 if(!run)return null;
 await ensureRunEvaluations(run.id);
 const release=await readRankReleaseIdentity(String(run.id),releaseToken);
 const row=await d.prepare("SELECT s.symbol,s.payload,s.evaluation,r.rank_position FROM fundamental_snapshots s JOIN opportunity_rankings r ON r.run_id=s.run_id AND r.symbol=s.symbol WHERE s.run_id=? AND s.symbol=?").bind(run.id,symbol).first() as any;
 if(!row)return null;
 const restored=await restoreArchivedRow(row);
 return {snapshot:JSON.parse(restored.payload) as Snapshot,evaluation:JSON.parse(restored.evaluation).opportunity as OpportunityEvaluation,release,ranking:{runId:run.id,position:Number(row.rank_position)}};
}
