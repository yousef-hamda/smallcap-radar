import {env} from 'cloudflare:workers';
import type {Snapshot} from './engine';
import type {OpportunityEvaluation} from './opportunity-engine';
import {applyFinancingRisk} from './financing-risk';
import {evaluateOpportunityDossier,opportunityDossierFromSnapshot} from './opportunity-dossier';
import {operatingCandidateOrderSql,operatingCandidateSignals} from './opportunity-candidates';
import {OPPORTUNITY_SPEC,opportunitySpecHash} from './opportunity-spec';
import {secUserAgentCacheVersion} from './sec-user-agent';
export const db=()=>{const d=(env as any).DB;if(!d)throw Error('قاعدة البيانات غير متاحة');return d;};
let schemaPromise:Promise<void>|null=null;
type StateCacheEntry={expiresAt:number;value:any};
const stateCache=new Map<string,StateCacheEntry>();
const STATE_CACHE_TTL=5_000;
const STATE_CACHE_LIMIT=64;
type LegacyEvaluationRow={id:string;symbol:string;name:string;state:string;score:number;coverage:number;eligible:boolean;positiveFcf:number;profitable:number;evidenceYears:number;growth:number|null;fcfMargin:number|null;profitMargin:number|null};
type LegacyEvaluationCache={expiresAt:number;summary:{total:number;opportunityRanked:number;opportunityNeedsResearch:number;opportunityExcluded:number;opportunityWithEvidence:number;opportunityFactorIncomplete:Record<string,number>;opportunityEligibilityBlockers:Record<string,{status:'FAIL'|'UNKNOWN';count:number}>};rows:LegacyEvaluationRow[]};
const legacyEvaluationCache=new Map<string,LegacyEvaluationCache>();
const LEGACY_EVALUATION_TTL=5*60_000;
function evaluateSnapshotOpportunity(snapshot:Snapshot){return evaluateOpportunityDossier(snapshot,opportunityDossierFromSnapshot(snapshot));}
export function invalidateStateCache(){stateCache.clear();legacyEvaluationCache.clear();}
function rememberState(key:string,value:any){
 if(stateCache.size>=STATE_CACHE_LIMIT)stateCache.delete(stateCache.keys().next().value!);
 stateCache.set(key,{expiresAt:Date.now()+STATE_CACHE_TTL,value});
}
export async function ensureSchema(){
 if(schemaPromise)return schemaPromise;
 schemaPromise=(async()=>{const d=db();await d.batch([
  d.prepare("CREATE TABLE IF NOT EXISTS strategy_runs (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, stage INTEGER NOT NULL DEFAULT 0, offset INTEGER NOT NULL DEFAULT 0, processed INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, universe_total INTEGER NOT NULL DEFAULT 0, screened_out INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, quote_coverage INTEGER NOT NULL DEFAULT 0, sec_requests INTEGER NOT NULL DEFAULT 0, sec_success INTEGER NOT NULL DEFAULT 0, sec_failed INTEGER NOT NULL DEFAULT 0, fundamental_coverage INTEGER NOT NULL DEFAULT 0, error TEXT, universe TEXT, strategy_hash TEXT NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0, retry_queue TEXT NOT NULL DEFAULT '[]', notification_sent_at TEXT)"),
  d.prepare("CREATE TABLE IF NOT EXISTS fundamental_snapshots (id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, symbol TEXT NOT NULL, as_of TEXT NOT NULL, payload TEXT NOT NULL, evaluation TEXT NOT NULL, FOREIGN KEY (run_id) REFERENCES strategy_runs(id))"),
  d.prepare("CREATE INDEX IF NOT EXISTS snapshot_run_idx ON fundamental_snapshots(run_id)"),
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
export async function readState(options:{strategy?:'opportunity'|'favorites';opportunityState?:'ranked'|'needs-research'|'excluded'|'all';limit?:number;offset?:number;owner?:string;query?:string}={}){await ensureSchema();const d=db();const cacheKey=JSON.stringify([currentHash(),opportunitySpecHash(),options.strategy||'opportunity',options.opportunityState||'ranked',options.owner||'',options.query||'',options.limit??150,options.offset??0]);const cached=stateCache.get(cacheKey);if(cached&&cached.expiresAt>Date.now())return cached.value;if(cached)stateCache.delete(cacheKey);const active=await d.prepare("SELECT * FROM strategy_runs WHERE strategy_hash=? ORDER BY created_at DESC LIMIT 1").bind(currentHash()).first();
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
 const strategy=options.strategy==='favorites'?'favorites':'opportunity';
 const limit=Math.max(1,Math.min(250,Math.floor(options.limit??150)));
 const offset=Math.max(0,Math.floor(options.offset??0));
 const fav=options.owner?(await d.prepare(strategy==='favorites'?'SELECT symbol,payload FROM personal_watchlist WHERE owner=? ORDER BY created_at DESC':'SELECT symbol FROM personal_watchlist WHERE owner=? ORDER BY created_at DESC').bind(options.owner).all()).results as any[]:[];
 // A favorite is durable user state, but its saved payload may predate the
 // latest market scan. Refresh the card quote from the selected full scan in
 // one bounded lookup so favorites and the strategy cards use the same
 // completed-session value without opening a deep profile for every favorite.
 const favoriteScanBySymbol=new Map<string,any>();
 const isCompletedPrice=(value:any)=>typeof value?.tag==='string'&&(/completed session close|last close/i.test(value.tag));
 const isCompletedChange=(value:any)=>typeof value?.tag==='string'&&/previous (completed )?close/i.test(value.tag);
 if(strategy==='favorites'&&latest&&fav.length){
  const symbols=[...new Set(fav.map(row=>String(row.symbol)).filter(Boolean))];
  for(let start=0;start<symbols.length;start+=80){
   const chunk=symbols.slice(start,start+80),result=await d.prepare(`SELECT symbol,payload FROM fundamental_snapshots WHERE run_id=? AND symbol IN (${chunk.map(()=>'?').join(',')})`).bind(latest.id,...chunk).all();
   for(const row of result.results as any[]){try{favoriteScanBySymbol.set(String(row.symbol),JSON.parse(String(row.payload)))}catch{/* ignore one corrupted optional row */}}
  }
 }
 const portfolioCount=options.owner?Number((await d.prepare("SELECT COUNT(*) AS count FROM (SELECT symbol FROM portfolio_transactions WHERE owner=? GROUP BY symbol HAVING SUM(CASE side WHEN 'buy' THEN quantity ELSE -quantity END)>0.00000001)").bind(options.owner).first() as any)?.count||0):0;
 let summaryRow=currentData?await d.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN json_extract(evaluation, '$.opportunity.state')='ranked' THEN 1 ELSE 0 END) AS opportunityRanked, SUM(CASE WHEN json_extract(evaluation, '$.opportunity.state')='needs-research' THEN 1 ELSE 0 END) AS opportunityNeedsResearch, SUM(CASE WHEN json_extract(evaluation, '$.opportunity.state')='excluded' THEN 1 ELSE 0 END) AS opportunityExcluded, SUM(CASE WHEN json_extract(evaluation, '$.opportunity.score')>0 THEN 1 ELSE 0 END) AS opportunityWithEvidence FROM fundamental_snapshots WHERE run_id=?`).bind(latest.id).first() as any: null;
 if(currentData){
 const incomplete=(await d.prepare(`SELECT json_extract(f.value,'$.id') AS id,SUM(CASE WHEN json_extract(f.value,'$.complete')=1 THEN 0 ELSE 1 END) AS count FROM fundamental_snapshots s,json_each(s.evaluation,'$.opportunity.factors') f WHERE s.run_id=? GROUP BY json_extract(f.value,'$.id')`).bind(latest.id).all()).results as any[];
  summaryRow.opportunityFactorIncomplete=Object.fromEntries(OPPORTUNITY_SPEC.factors.map(factor=>[factor.id,Number(incomplete.find(row=>row.id===factor.id)?.count??summaryRow.total)]));
  const blockedChecks=(await d.prepare(`SELECT json_extract(c.value,'$.id') AS id,json_extract(c.value,'$.status') AS status,COUNT(*) AS count FROM fundamental_snapshots s,json_each(s.evaluation,'$.opportunity.checks') c WHERE s.run_id=? AND json_extract(c.value,'$.status') IN ('FAIL','UNKNOWN') GROUP BY json_extract(c.value,'$.id'),json_extract(c.value,'$.status')`).bind(latest.id).all()).results as any[];
  summaryRow.opportunityEligibilityBlockers=Object.fromEntries(blockedChecks.map(row=>[`${row.id}:${row.status}`,{status:row.status,count:Number(row.count)}]));
 }
 const search=options.query?.trim().toLowerCase().slice(0,100)||'';
 // Re-evaluate every row with the current engine before ranking. Durable rows
 // can predate a scoring-version change; sorting the persisted evaluation would
 // otherwise leave old null scores and stale weights in front of the user.
 const query=latest&&strategy!=='favorites'?`SELECT payload,evaluation FROM fundamental_snapshots WHERE run_id=? AND (?='' OR instr(lower(symbol),?)>0 OR instr(lower(json_extract(payload,'$.name')),?)>0)`:null;
 const params=latest?[latest.id,search,search,search]:[];
 let databasePaged=false,queryForPage=query,queryParams=params;
 if(query&&currentData){
  // Current-run evaluations already have the active strategy hash. Filter,
  // sort, and page in SQLite rather than loading the full market universe into
  // the Worker for every page request.
  const requested=options.opportunityState??'ranked';
  const requestedOrder=requested==='needs-research'
   ? `COALESCE(json_extract(evaluation,'$.opportunity.score'),0) DESC, COALESCE(json_extract(evaluation,'$.opportunity.coveragePct'),0) DESC, ${operatingCandidateOrderSql()}`
   : `COALESCE(json_extract(evaluation,'$.opportunity.score'),-1) DESC, COALESCE(json_extract(evaluation,'$.opportunity.scoreCoverage'),json_extract(evaluation,'$.opportunity.coveragePct'),0) DESC, symbol ASC`;
  queryForPage+=` AND (?='all' OR json_extract(evaluation,'$.opportunity.state')=?) ORDER BY ${requestedOrder} LIMIT ? OFFSET ?`;
  queryParams=[...params,requested,requested,limit+1,offset];
  databasePaged=true;
 }
 let rows:any[]=queryForPage?(await d.prepare(queryForPage).bind(...queryParams).all()).results.map((r:any)=>{
  // A current run already stores the evaluation produced by this exact
  // strategy hash. Reusing it avoids parsing and scoring every company on
  // every page refresh; stale runs still take the conservative re-evaluation
  // path below.
  if(currentData&&typeof r.evaluation==='string')return {payload:r.payload,evaluation:r.evaluation};
  const s=applyFinancingRisk(JSON.parse(r.payload));return {payload:JSON.stringify(s),evaluation:JSON.stringify({opportunity:evaluateSnapshotOpportunity(s)})}
 }):[];
 // A scoring-version change must show the last completed run immediately. Re-score
 // it in bounded payload batches, sort compact keys, and fetch only the requested
 // page. Never materialize the entire multi-megabyte market snapshot in Worker memory.
 if(latest&&!currentData&&strategy!=='favorites'){
  let cached=legacyEvaluationCache.get(String(latest.id));
  if(cached&&cached.expiresAt<=Date.now()){legacyEvaluationCache.delete(String(latest.id));cached=undefined;}
  if(!cached){
   const totals={total:0,opportunityRanked:0,opportunityNeedsResearch:0,opportunityExcluded:0,opportunityWithEvidence:0,opportunityFactorIncomplete:Object.fromEntries(OPPORTUNITY_SPEC.factors.map(factor=>[factor.id,0])) as Record<string,number>,opportunityEligibilityBlockers:{} as Record<string,{status:'FAIL'|'UNKNOWN';count:number}>};
   const order:LegacyEvaluationRow[]=[];const batchSize=100;let batchOffset=0;
   while(true){
    const batch=(await d.prepare(`SELECT id,symbol,payload FROM fundamental_snapshots WHERE run_id=? ORDER BY symbol ASC LIMIT ? OFFSET ?`).bind(latest.id,batchSize,batchOffset).all()).results as any[];
    if(!batch.length)break;
    for(const row of batch){
     totals.total++;let snapshot:Snapshot,opportunity:OpportunityEvaluation;
     try{snapshot=applyFinancingRisk(JSON.parse(String(row.payload)));opportunity=evaluateSnapshotOpportunity(snapshot)}catch{totals.opportunityNeedsResearch++;continue}
     if(opportunity.state==='ranked')totals.opportunityRanked++;else if(opportunity.state==='excluded')totals.opportunityExcluded++;else totals.opportunityNeedsResearch++;
     if(opportunity.score>0)totals.opportunityWithEvidence++;
     for(const factor of opportunity.factors)if(!factor.complete)totals.opportunityFactorIncomplete[factor.id]=(totals.opportunityFactorIncomplete[factor.id]??0)+1;
     for(const check of opportunity.checks)if(check.status==='FAIL'||check.status==='UNKNOWN'){const key=`${check.id}:${check.status}`;const prior=totals.opportunityEligibilityBlockers[key];totals.opportunityEligibilityBlockers[key]={status:check.status,count:(prior?.count??0)+1};}
     const signals=operatingCandidateSignals(snapshot);order.push({id:String(row.id),symbol:String(row.symbol),name:String(snapshot.name||''),state:opportunity.state,score:opportunity.score,coverage:opportunity.coveragePct,eligible:signals.eligibleForOperatingQueue,positiveFcf:signals.positiveFcfYears,profitable:signals.profitableYears,evidenceYears:signals.yearsWithProfitEvidence+signals.yearsWithFcfEvidence,growth:signals.revenueGrowth,fcfMargin:signals.latestFcfMargin,profitMargin:signals.latestProfitMargin});
    }
    batchOffset+=batch.length;if(batch.length<batchSize)break;
   }
   const desc=(a:number|null,b:number|null)=>a==null?(b==null?0:1):b==null?-1:b-a;
   order.sort((a,b)=>b.score-a.score||b.coverage-a.coverage||Number(b.eligible)-Number(a.eligible)||b.positiveFcf-a.positiveFcf||b.profitable-a.profitable||b.evidenceYears-a.evidenceYears||desc(a.growth,b.growth)||desc(a.fcfMargin,b.fcfMargin)||desc(a.profitMargin,b.profitMargin)||a.symbol.localeCompare(b.symbol));
   cached={expiresAt:Date.now()+LEGACY_EVALUATION_TTL,summary:totals,rows:order};
   if(legacyEvaluationCache.size>=2)legacyEvaluationCache.delete(legacyEvaluationCache.keys().next().value!);
   legacyEvaluationCache.set(String(latest.id),cached);
  }
  summaryRow=cached.summary;
  const requested=options.opportunityState??'ranked';
  const order=cached.rows.filter(row=>(requested==='all'||row.state===requested)&&(!search||`${row.symbol} ${row.name}`.toLowerCase().includes(search)));

  const selected=order.slice(offset,offset+limit+1);
  rows=[];
  for(let start=0;start<selected.length;start+=80){
   const group=selected.slice(start,start+80),found=(await d.prepare(`SELECT id,payload FROM fundamental_snapshots WHERE id IN (${group.map(()=>'?').join(',')})`).bind(...group.map(row=>row.id)).all()).results as any[];
   const payloadById=new Map(found.map((row:any)=>[String(row.id),String(row.payload)]));
   for(const item of group){const payload=payloadById.get(item.id);if(!payload)continue;const snapshot=applyFinancingRisk(JSON.parse(payload)),opportunity=evaluateSnapshotOpportunity(snapshot);rows.push({payload:JSON.stringify(snapshot),evaluation:JSON.stringify({opportunity})});}
  }
  databasePaged=true;
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
 if(strategy!=='favorites'&&!databasePaged){
  // Category pages contain only proven members. Failed/unknown rows remain in
  // the immutable scan report so users can inspect every exclusion reason.
  rows=rows.filter((row:any)=>{const s=applyFinancingRisk(JSON.parse(row.payload));const saved=JSON.parse(row.evaluation).opportunity;const assessment=saved?.hash===opportunitySpecHash()?saved:evaluateSnapshotOpportunity(s);row.evaluation=JSON.stringify({...JSON.parse(row.evaluation),opportunity:assessment});const requested=options.opportunityState??'ranked';return requested==='all'||assessment.state===requested});
  if(!databasePaged)rows.sort((a:any,b:any)=>{const ae=JSON.parse(a.evaluation)[strategy],be=JSON.parse(b.evaluation)[strategy];const score=(e:any)=>e.score==null?Number.NEGATIVE_INFINITY:e.score;return score(be)-score(ae)||(be.scoreCoverage??be.coveragePct??0)-(ae.scoreCoverage??ae.coveragePct??0)||JSON.parse(a.payload).symbol.localeCompare(JSON.parse(b.payload).symbol)});
 }
 if(strategy==='favorites'){
  rows=fav.filter(r=>!search||`${r.symbol} ${JSON.parse(r.payload).name}`.toLowerCase().includes(search)).map(r=>{
   const saved=JSON.parse(r.payload),scanned=favoriteScanBySymbol.get(String(r.symbol)),savedPrice=saved.provenance?.price,scanPrice=scanned?.provenance?.price,scanChange=scanned?.provenance?.dailyChange;
   const refreshed={...saved,
    ...(scanned?.name?{name:scanned.name}:{}),...(scanned?.exchange?{exchange:scanned.exchange}:{}),...(Number.isFinite(scanned?.marketCap)?{marketCap:scanned.marketCap}:{}),
    ...(Number.isFinite(scanned?.price)&&isCompletedPrice(scanPrice)?{price:scanned.price,provenance:{...saved.provenance,price:scanPrice}}:{}),
    ...(Number.isFinite(scanned?.dailyChange)&&isCompletedChange(scanChange)?{dailyChange:scanned.dailyChange,provenance:{...saved.provenance,price:scanPrice??savedPrice,dailyChange:scanChange}}:{})
   };
   const s=applyFinancingRisk(refreshed);return {payload:JSON.stringify(s),evaluation:JSON.stringify({opportunity:evaluateSnapshotOpportunity(s)})}
  });
  rows=rows.slice(offset,offset+limit+1);
 }
 if(strategy!=='favorites'&&!databasePaged)rows=rows.slice(offset,offset+limit+1);
 const pageRows=rows.slice(0,limit);
 // A profile may have been refreshed after the durable scan row was written.
 // Use its canonical completed-session pair for the card response so an old
 // scan's live quote percentage cannot disagree with the profile the user just
 // opened. This is a read-time bridge; the next full scan persists the same
 // values in the durable row.
 const deepSymbols=[...new Set(pageRows.flatMap((row:any)=>{try{return [String(JSON.parse(row.payload).symbol)]}catch{return []}}))];
 const deepSessionBySymbol=new Map<string,any>();
 if(deepSymbols.length){
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
 const compact=(payload:string)=>{const parsed=JSON.parse(payload);const deep=deepSessionBySymbol.get(parsed.symbol)?.snapshot;if(deep&&Number.isFinite(deep.dailyChange)&&deep.provenance?.dailyChange){parsed.dailyChange=deep.dailyChange;if(Number.isFinite(deep.price))parsed.price=deep.price;parsed.provenance={...parsed.provenance,price:deep.provenance.price??parsed.provenance?.price,dailyChange:deep.provenance.dailyChange};}delete parsed.history;return parsed};
 const evaluatedRows=pageRows.map((row:any)=>{const result=JSON.parse(row.evaluation);if(result.opportunity?.hash===opportunitySpecHash())return result;const snapshot=applyFinancingRisk(JSON.parse(row.payload));return {...result,opportunity:evaluateSnapshotOpportunity(snapshot)}});
 const stale=!!latest&&!currentData;
 const value={run:active?{...active,universe:undefined,retry_queue:undefined,retryPending:JSON.parse(active.retry_queue||'[]').length,stale}:null,dataRunId:latest?.id,dataRun:latest?{...latest,universe:undefined,retry_queue:undefined,stale}:null,snapshots:pageRows.map((r:any)=>compact(r.payload)),storedEvaluations:evaluatedRows,favorites:fav.map((r:any)=>r.symbol),portfolioCount,coverage,summary:{total:Number(summaryRow?.total||0),opportunityRanked:Number(summaryRow?.opportunityRanked||0),opportunityNeedsResearch:Number(summaryRow?.opportunityNeedsResearch||0),opportunityExcluded:Number(summaryRow?.opportunityExcluded||0),opportunityWithEvidence:Number(summaryRow?.opportunityWithEvidence||0),opportunityFactorIncomplete:summaryRow?.opportunityFactorIncomplete??Object.fromEntries(OPPORTUNITY_SPEC.factors.map(factor=>[factor.id,Number(summaryRow?.total||0)])),opportunityEligibilityBlockers:summaryRow?.opportunityEligibilityBlockers??{},stale},page:{strategy,limit,offset,hasMore:rows.length>limit}};
 rememberState(cacheKey,value);return value;}
export async function readAudit(){await ensureSchema();const d=db();const latest=await d.prepare("SELECT * FROM strategy_runs WHERE status IN ('complete','partial') ORDER BY created_at DESC LIMIT 1").first() as any;const logs=latest?(await d.prepare('SELECT stage,created_at,message FROM diag WHERE run_id=? ORDER BY created_at DESC LIMIT 500').bind(latest.id).all()).results:[];const state=await readState({strategy:'opportunity',opportunityState:'all',limit:1});return {strategyHash:currentHash(),opportunitySpecHash:opportunitySpecHash(),run:state.run,dataRun:state.dataRun,summary:state.summary,favorites:state.favorites,logs};}
export function insertSnapshot(runId:string,s:Snapshot){invalidateStateCache();const reviewed=applyFinancingRisk(s);return db().prepare('INSERT OR REPLACE INTO fundamental_snapshots(id,run_id,symbol,as_of,payload,evaluation) VALUES (?,?,?,?,?,?)').bind(`${runId}:${s.symbol}`,runId,s.symbol,reviewed.asOf,JSON.stringify(reviewed),JSON.stringify({opportunity:evaluateSnapshotOpportunity(reviewed)}));}
export async function createRun(source:string,total=0,universe:any[]=[],status='running'){await ensureSchema();invalidateStateCache();const id=crypto.randomUUID(),now=new Date().toISOString();await db().prepare('INSERT INTO strategy_runs (id,created_at,updated_at,status,source,total,universe,strategy_hash) VALUES(?,?,?,?,?,?,?,?)').bind(id,now,now,status,source,total,JSON.stringify(universe),currentHash()).run();return id;}
export async function log(runId:string,stage:string,message:string){await db().prepare('INSERT INTO diag(id,run_id,stage,created_at,message) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),runId,stage,new Date().toISOString(),message).run()}
