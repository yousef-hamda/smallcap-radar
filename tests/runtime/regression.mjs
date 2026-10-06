import test from 'node:test';
import assert from 'node:assert/strict';
import {sqlite,env as runtimeEnv} from './env.mjs';
import {scanProgress} from '../../.test-build/scan-progress.mjs';
import {visitor} from '../../.test-build/visitor.mjs';
import {body as parseBody} from '../../.test-build/http.mjs';
import {numeric,parseNews,fetchJson} from '../../.test-build/providers.mjs';
import {reconcile} from '../../.test-build/reconcile.mjs';
import {setHistoryResult,setOpportunityResearchResult,setUniverse,setBulkQuoteTransform,universeCalls,setIntradayResult,opportunityCalls,resetOpportunityCalls} from './providers.mjs';
import {evaluateStrategy} from '../../.test-build/engine.mjs';
import {proxyOpportunityEvidence} from '../../.test-build/opportunity-proxies.mjs';
import {fixtures} from '../../.test-build/fixtures.mjs';
import {ensureSchema,db,currentHash,readState,insertSnapshot,invalidateStateCache,readResearchConflictCount,migrateCompatibleAcquisitionRuns} from '../../.test-build/storage.mjs';
import {processScanBatch,startScan,historyCandidate,preliminaryCandidates} from '../../.test-build/scanner.mjs';
import {GET,POST} from '../../.test-build/radar-api.mjs';
import {GET as recoverGET} from '../../.test-build/recover-api.mjs';
import {GET as reportGET} from '../../.test-build/scan-report-api.mjs';
import {GET as companyGET} from '../../.test-build/company-api.mjs';
import {GET as exportGET} from '../../.test-build/export-api.mjs';
import {reserveProviderRequest} from '../../.test-build/provider-quota.mjs';
import {publishDirectoryRatings} from '../../.test-build/directory-rating.mjs';
import {scheduledScanTick} from '../../.test-build/scheduled-scan.mjs';
import {archivedWriteStatements,restoreArchivedRow} from '../../.test-build/snapshot-archive.mjs';
import {GET as favoriteQuotesGET} from '../../.test-build/favorite-quotes-api.mjs';
import {GET as chartGET} from '../../.test-build/chart-api.mjs';
import worker from '../../.test-build/worker.mjs';
import {validPushSubscription} from '../../.test-build/push-validation.mjs';
import {createECDH,randomBytes} from 'node:crypto';
import {fetchBulkFundamentals} from '../../.test-build/bulk.mjs';
import {importSchema} from '../../.test-build/validation.mjs';
import {apiJson} from '../../.test-build/client-json.mjs';
import {calculatePortfolio,buildPerformanceSeries,validateLedger} from '../../.test-build/portfolio.mjs';
import {GET as portfolioGET,POST as portfolioPOST,PUT as portfolioPUT,DELETE as portfolioDELETE} from '../../.test-build/portfolio-api.mjs';
import {GET as portfolioHistoryGET} from '../../.test-build/portfolio-history-api.mjs';
import {GET as portfolioLogoGET} from '../../.test-build/portfolio-logo-api.mjs';
import {GET as accountGET,POST as accountPOST} from '../../.test-build/account-api.mjs';
import webpush from 'web-push';
import {secUserAgent,secUserAgentCacheVersion} from '../../.test-build/sec-user-agent.mjs';
await ensureSchema();
const base=fixtures[0];
process.env.SEC_USER_AGENT??='SmallCapRadar/2.2 (contact: tests@example.com)';
test('qualitative opportunity proxies produce auditable bounded grades without claiming full coverage',()=>{
 const now='2200-01-01T00:00:00.000Z';
 const snapshot={...base,asOf:now,evSales:2,revenueGrowth:0.2,grossMargin:0.4,operatingMarginTrend:0.03,cash:100,debt:50,dilution:0.02,price:12,low52w:8,high52w:16,ma30w:10,return12m:0.15,nextEarnings:'2200-02-01',provenance:Object.fromEntries(['evSales','revenueGrowth','grossMargin','operatingMarginTrend','cash','debt','dilution','price','low52w','high52w','ma30w','return12m'].map(key=>[key,{source:'SEC EDGAR Company Facts',url:'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000000.json',periodEnd:now.slice(0,10),availableAt:now,retrievedAt:now,rightsStatus:'public-domain',confidence:'high'}]))};
 const evidence=proxyOpportunityEvidence(snapshot);
 for(const id of ['valuation','competitivePosition','downsideRisk','technicalTiming']){assert(evidence[id]);assert(Number(evidence[id].score)>=0&&Number(evidence[id].score)<=10);assert(evidence[id].calculation?.rubricId===`${id}-model-v5-opportunity`);}
 assert.equal(evidence.valuation.coveragePct,25);assert.equal(evidence.valuation.confidence,'low');
});
test('an empty database is not mislabeled as a stale snapshot',async()=>{const state=await readState({strategy:'opportunity'});assert.equal(state.dataRun,null);assert.equal(state.summary.stale,false);});
test('a running scan with partial rows does not replace the last completed full scan across rubric versions',async()=>{
 const old='2200-01-01T00:00:00.000Z',active='2201-01-01T00:00:00.000Z';
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,processed,stage,strategy_hash) VALUES('prior-complete',?,?,'complete','Bulk Quotes/SEC Frames · full',1,1,13,'prior-rubric')").bind(old,old).run();
 await insertSnapshot('prior-complete',{...base,symbol:'PRIOR'}).run();
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,processed,stage,strategy_hash) VALUES('new-running',?,?,'running','Bulk Quotes/SEC Frames · full',1,1,10,?)").bind(active,active,currentHash()).run();
 await insertSnapshot('new-running',{...base,symbol:'INCOMPLETE',opportunityResearch:undefined}).run();
 invalidateStateCache();const state=await readState({strategy:'opportunity',opportunityState:'all',limit:10});
 assert.equal(state.run.id,'new-running');assert.equal(state.dataRunId,'prior-complete');assert.equal(state.summary.stale,true);
 assert.deepEqual(state.snapshots.map(snapshot=>snapshot.symbol),['PRIOR']);
 await insertSnapshot('new-running',{...base,symbol:'INCOMPLETE',opportunityResearch:undefined}).run();
 invalidateStateCache();
 const originalPrepare=runtimeEnv.DB.prepare;
 runtimeEnv.DB.prepare=sql=>{
  if(/^SELECT id,symbol,payload,evaluation FROM fundamental_snapshots/.test(sql))throw Error('unrelated scan write invalidated completed-run ranking cache');
  return originalPrepare(sql);
 };
 try{const unchanged=await readState({strategy:'opportunity',opportunityState:'all',limit:10});assert.equal(unchanged.dataRunId,'prior-complete');}
 finally{runtimeEnv.DB.prepare=originalPrepare;}
 await db().prepare("UPDATE strategy_runs SET status='complete',stage=13 WHERE id='new-running'").run();
 invalidateStateCache();const completed=await readState({strategy:'opportunity',opportunityState:'all',limit:10});
 assert.equal(completed.dataRunId,'new-running');assert.equal(completed.summary.stale,false);
 assert.deepEqual(completed.snapshots.map(snapshot=>snapshot.symbol),['INCOMPLETE']);
 await db().prepare("DELETE FROM fundamental_snapshots WHERE run_id IN ('prior-complete','new-running')").run();
 await db().prepare("DELETE FROM strategy_runs WHERE id IN ('prior-complete','new-running')").run();invalidateStateCache();
});
test('legacy scoring snapshots are re-evaluated in bounded batches and preserve their visible evidence queue',async()=>{
 const now='2201-01-01T00:00:00.000Z';await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,processed,stage,strategy_hash) VALUES('legacy-rating',?,?,'complete','Legacy full scan',2,2,13,'retired-opportunity-hash')").bind(now,now).run();
 await insertSnapshot('legacy-rating',{...base,symbol:'LEGACY-B'}).run();await insertSnapshot('legacy-rating',{...base,symbol:'LEGACY-A'}).run();
 invalidateStateCache();const result=await readState({strategy:'opportunity',opportunityState:'needs-research',limit:1});
 assert.equal(result.summary.stale,true);assert.equal(result.summary.total,2);assert.equal(result.summary.opportunityRanked,2);assert.equal(result.snapshots.length,1);assert.equal(result.snapshots[0].symbol,'LEGACY-A');assert.equal(result.page.hasMore,true);
 const persisted=await db().prepare("SELECT evaluation FROM fundamental_snapshots WHERE run_id='legacy-rating' AND symbol='LEGACY-A'").first();
 assert.equal(JSON.parse(persisted.evaluation).opportunity.hash,result.storedEvaluations[0].opportunity.hash);
 invalidateStateCache();const resumed=await readState({strategy:'opportunity',opportunityState:'needs-research',limit:1});
 assert.equal(resumed.storedEvaluations[0].opportunity.hash,result.storedEvaluations[0].opportunity.hash);assert.equal(resumed.storedEvaluations[0].opportunity.score,result.storedEvaluations[0].opportunity.score);
 await db().prepare("DELETE FROM fundamental_snapshots WHERE run_id='legacy-rating'").run();await db().prepare("DELETE FROM strategy_runs WHERE id='legacy-rating'").run();invalidateStateCache();
});
test('large legacy evaluator backfill persists current-hash rows across keyset batches',async()=>{
 const now='2202-01-01T00:00:00.000Z',count=501;
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,processed,stage,strategy_hash) VALUES('legacy-backfill',?,?,'complete','Legacy full scan',?,?,13,'retired-opportunity-hash')").bind(now,now,count,count).run();
 for(let start=0;start<count;start+=100){const batch=[];for(let index=start;index<Math.min(count,start+100);index++){const symbol=`MIGRATE-${String(index).padStart(4,'0')}`,snapshot={...base,symbol,asOf:now};batch.push(db().prepare('INSERT INTO fundamental_snapshots(id,run_id,symbol,as_of,payload,evaluation) VALUES(?,?,?,?,?,?)').bind(`legacy-backfill:${symbol}`,'legacy-backfill',symbol,now,JSON.stringify(snapshot),JSON.stringify({opportunity:{hash:'retired-opportunity-hash'}})));}await db().batch(batch);}
 const originalPrepare=runtimeEnv.DB.prepare;
 runtimeEnv.DB.prepare=sql=>{
  if(/^SELECT payload,evaluation FROM fundamental_snapshots WHERE run_id=\? AND/.test(sql)&&!/LIMIT/.test(sql))throw Error('stale scan attempted an unbounded payload read');
  return originalPrepare(sql);
 };
 let first;
 try{invalidateStateCache();first=await readState({strategy:'opportunity',opportunityState:'needs-research',limit:1});}
 finally{runtimeEnv.DB.prepare=originalPrepare;}
 assert.equal(first.summary.total,count);assert.equal(first.snapshots[0].symbol,'MIGRATE-0000');assert.equal(first.page.hasMore,true);
 const persisted=await db().prepare("SELECT evaluation FROM fundamental_snapshots WHERE run_id='legacy-backfill' AND symbol='MIGRATE-0500'").first();
 assert.equal(JSON.parse(persisted.evaluation).opportunity.hash,first.storedEvaluations[0].opportunity.hash);
 invalidateStateCache();const restarted=await readState({strategy:'opportunity',opportunityState:'needs-research',limit:1});
 assert.equal(restarted.summary.total,count);assert.equal(restarted.storedEvaluations[0].opportunity.hash,first.storedEvaluations[0].opportunity.hash);
 await db().prepare("DELETE FROM fundamental_snapshots WHERE run_id='legacy-backfill'").run();await db().prepare("DELETE FROM strategy_runs WHERE id='legacy-backfill'").run();invalidateStateCache();
});
const run=(patch={})=>({id:'test',status:'running',source:'Bulk Quotes/SEC Frames v7 · full',stage:0,offset:0,total:100,processed:0,failed:0,retryPending:0,...patch});
test('SEC identity accepts a reachable-contact override and rejects unsafe or noreply values',()=>{
 assert.equal(secUserAgent('SmallCapRadar/2.2 (contact: data-admin@example.com)'),'SmallCapRadar/2.2 (contact: data-admin@example.com)');
 assert.equal(secUserAgent('SmallCapRadar/2.2  '),null);
 assert.equal(secUserAgent('SmallCapRadar (contact: user@users.noreply.github.com)'),null);
 assert.equal(secUserAgent('SmallCapRadar/2.2 (contact: user@example.com)\r\nInjected: yes'),null);
 assert.equal(secUserAgent(`SmallCapRadar (${ 'x'.repeat(257) }@example.com)`),null);
 assert.equal(secUserAgent('  '),null);
});
test('SEC profile-cache generations use an explicit non-sensitive operator revision',()=>{
 const previous=process.env.SEC_USER_AGENT,previousRevision=process.env.SEC_USER_AGENT_CACHE_REVISION;
 try{delete process.env.SEC_USER_AGENT;const unconfigured=secUserAgentCacheVersion();assert.match(unconfigured,/unconfigured/);process.env.SEC_USER_AGENT='SmallCapRadar/2.2 (contact: data-admin@example.com)';process.env.SEC_USER_AGENT_CACHE_REVISION='1';const first=secUserAgentCacheVersion();assert.equal(first,'v27-configured-1');process.env.SEC_USER_AGENT='SmallCapRadar/2.2 (contact: another@example.com)';assert.equal(secUserAgentCacheVersion(),first);process.env.SEC_USER_AGENT_CACHE_REVISION='2';assert.notEqual(secUserAgentCacheVersion(),first);process.env.SEC_USER_AGENT='SmallCapRadar (contact: user@users.noreply.github.com)';assert.equal(secUserAgentCacheVersion(),unconfigured);}
 finally{if(previous===undefined)delete process.env.SEC_USER_AGENT;else process.env.SEC_USER_AGENT=previous;if(previousRevision===undefined)delete process.env.SEC_USER_AGENT_CACHE_REVISION;else process.env.SEC_USER_AGENT_CACHE_REVISION=previousRevision;}
});
test('company profile serves current-generation cached SEC history and exposes the Opportunity acquisition gap without internal cache metadata',async()=>{
 const now=new Date().toISOString(),snapshot={...base,opportunityResearch:{earnings:{providerStatus:'unavailable',providerMessage:'HTTP 403',coverage:{annualPeriodsFound:0,quarterlyPeriodsFound:0,selectedUnit:'USD'},annual:[],quarterly:[],missing:['SEC Company Facts unavailable'],conflicts:[],limitations:['Standard SEC tags only'],readyForScoring:false},financialStrength:{providerStatus:'unavailable',metrics:{},missing:['SEC Company Facts unavailable'],conflicts:[],limitations:['Standard debt maturity coverage is partial'],readyForScoring:false}}};
 await db().prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(`deep:${secUserAgentCacheVersion()}:${snapshot.symbol}`,'test',now,JSON.stringify(snapshot)).run();
 const response=await companyGET(new Request(`https://radar.test/api/company?symbol=${snapshot.symbol}`));assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.cached,true);assert.deepEqual(payload.snapshot.opportunityResearch,snapshot.opportunityResearch);assert.equal(Object.hasOwn(payload.snapshot,'__cacheKey'),false);
 const earnings=payload.evaluation.factors.find(factor=>factor.id==='earningsQuality');assert.equal(earnings.score,0);assert.equal(earnings.proxy,true);assert.equal(earnings.evidenced,false);assert.match(earnings.rationale,/SEC Company Facts status is unavailable.*HTTP 403/);
 const financial=payload.evaluation.factors.find(factor=>factor.id==='financialStrength');assert.equal(financial.score,0);assert.equal(financial.proxy,true);assert.equal(financial.evidenced,false);assert.match(financial.rationale,/0\/6 available; provider status unavailable/);
});
test('configured SEC identity retries instead of presenting a generic-identity cached profile',async()=>{
 const now=new Date().toISOString(),previous=process.env.SEC_USER_AGENT,snapshot={...base,symbol:'TEST'};
 await db().prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind('deep:v11:TEST','generic-identity',now,JSON.stringify(snapshot)).run();
 process.env.SEC_USER_AGENT='SmallCapRadar/2.2 (contact: data-admin@example.com)';
 try{const response=await companyGET(new Request('https://radar.test/api/company?symbol=TEST'));assert.equal(response.status,503);}
 finally{if(previous===undefined)delete process.env.SEC_USER_AGENT;else process.env.SEC_USER_AGENT=previous;await db().prepare("DELETE FROM raw_cache WHERE key='deep:v11:TEST'").run();}
});
test('old profile generations without current insider coverage metadata are refreshed',async()=>{
 const now=new Date().toISOString(),snapshot={...base,symbol:'TEST'};
 await db().prepare('INSERT INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind('deep:v13:TEST','old-profile-schema',now,JSON.stringify(snapshot)).run();
 const response=await companyGET(new Request('https://radar.test/api/company?symbol=TEST'));
 assert.equal(response.status,503,'an old cached payload must not masquerade as a profile with the new diligence coverage contract');
 await db().prepare("DELETE FROM raw_cache WHERE key='deep:v13:TEST'").run();
});
test('saving a favorite resolves the latest v15 company cache before older profile generations',async()=>{
 const now=new Date().toISOString(),ownerSnapshot={...base,symbol:'V11FAV',opportunityResearch:{earnings:{providerStatus:'unavailable',providerMessage:'HTTP 403',coverage:{annualPeriodsFound:0,quarterlyPeriodsFound:0,selectedUnit:'USD'},annual:[],quarterly:[],missing:['SEC Company Facts unavailable'],conflicts:[],limitations:[],readyForScoring:false}}};
 await db().prepare('INSERT INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind('deep:v10:V11FAV','old-test',now,JSON.stringify({...ownerSnapshot,name:'old-cache'})).run();
 await db().prepare('INSERT INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind('deep:v11:V11FAV','new-test',now,JSON.stringify(ownerSnapshot)).run();
 await db().prepare('INSERT INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind('deep:v21:V11FAV','configured-sec-test',now,JSON.stringify({...ownerSnapshot,name:'configured-cache'})).run();
 const response=await POST(new Request('https://radar.test/api/radar',{method:'POST',headers:{origin:'https://radar.test','content-type':'application/json'},body:JSON.stringify({action:'favorite',symbol:'V11FAV',saved:true})}));
 assert.equal(response.status,200);const payload=await response.json();assert.deepEqual(payload.favorites,['V11FAV']);
 const saved=await db().prepare('SELECT payload FROM personal_watchlist WHERE symbol=?').bind('V11FAV').first();assert.equal(JSON.parse(saved.payload).name,'configured-cache');assert.equal(JSON.parse(saved.payload).opportunityResearch.earnings.providerStatus,'unavailable');await db().prepare('DELETE FROM personal_watchlist WHERE symbol=?').bind('V11FAV').run();await db().prepare("DELETE FROM raw_cache WHERE key='deep:v21:V11FAV'").run();
});
test('protected recovery restores one durable run and a one-time favorite claim',async()=>{
 const claimToken='a'.repeat(48),origin='https://example.test';
 const unauthorized=await POST(new Request(`${origin}/api/radar`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action:'restore',records:[base],final:true})}));assert.equal(unauthorized.status,401);
 const restored=await POST(new Request(`${origin}/api/radar`,{method:'POST',headers:{origin,'content-type':'application/json','x-radar-recovery':'TEST-ONLY-RECOVERY-SECRET'},body:JSON.stringify({action:'restore',records:[base],final:true,claimToken,favoriteSymbols:[base.symbol]})}));assert.equal(restored.status,200);assert.equal((await restored.json()).recovered,1);
 const claimed=await recoverGET(new Request(`${origin}/api/recover?token=${claimToken}`));assert.equal(claimed.status,302);assert.match(claimed.headers.get('set-cookie')||'',/radar-visitor=/);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM personal_watchlist').get().count,1);
 assert.equal((await recoverGET(new Request(`${origin}/api/recover?token=${claimToken}`))).status,410);
});
test('JSON body parsing enforces the byte limit even without Content-Length',async()=>{
 const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"value":"'));controller.enqueue(new Uint8Array(32).fill(97));controller.enqueue(new TextEncoder().encode('"}'));controller.close();}});
 const request=new Request('https://example.test/api',{method:'POST',body:stream,duplex:'half'});
 await assert.rejects(()=>parseBody(request,20),error=>error.status===413);
 const valid=new Request('https://example.test/api',{method:'POST',body:'{"value":"موثق"}'});assert.deepEqual(await parseBody(valid,100),{value:'موثق'});
});
test('progress is monotonic through history and sourced Opportunity SEC enrichment',()=>{
 const sequence=[run(),run({stage:4}),run({stage:4,offset:16}),run({stage:5}),run({stage:5,offset:50}),run({stage:9}),run({stage:9,offset:100}),run({stage:10}),run({stage:10,offset:99}),run({stage:10,offset:100}),run({stage:11,total:100}),run({stage:11,offset:99,total:100}),run({stage:13,offset:100,status:'complete'})].map(s=>scanProgress(s).percent);
 assert(sequence.every((n,i)=>i===0||n>=sequence[i-1]));assert.equal(sequence.at(-1),100);assert(sequence.slice(0,-1).every(n=>n<100));
 assert(scanProgress(run({stage:5,offset:1,total:100})).percent>scanProgress(run({stage:5,total:100})).percent);
 assert.match(scanProgress(run({stage:11,total:10})).phase,/SEC/);
});
test('failed, empty and active retry runs never claim 100%',()=>{
 for(const r of [null,run({stage:10,offset:100,status:'failed'}),run({stage:13,offset:100,retryPending:1}),run({stage:4,total:0})])assert(scanProgress(r).percent<100);
});
test('terminal partial completes work at 100 while explicitly retaining missing-data status',()=>{
 const r=scanProgress(run({stage:13,offset:100,status:'partial',failed:26}));assert.equal(r.percent,100);assert.equal(r.active,false);assert.match(r.phase,/نقص/);
 assert.equal(scanProgress(run({stage:10,offset:100,status:'partial',retryPending:1})).active,true);
});
test('missing numeric provider fields stay null, while actual zero is zero',()=>{for(const n of [null,undefined,'','  ','N/A','--',NaN,Infinity,false,{},[]])assert.equal(numeric(n),null);assert.equal(numeric('$1,234.50'),1234.5);assert.equal(numeric('0'),0)});
test('ten-day volume proxy cannot reject a historical candidate',()=>{
 const s={...base,securityType:'common',marketCap:100e6,price:10,return12m:-.5,low52w:5,averageVolume10d:0};assert(historyCandidate(s));assert(historyCandidate({...s,averageVolume10d:undefined}));
});
test('unified scan collection is independent of retired category capitalization bands',()=>{
 const listed=[{ticker:'MICRO',name:'Micro Co',cik:1,marketCap:1e6,price:0.5},{ticker:'MEGA',name:'Mega Co',cik:2,marketCap:5e12,price:400},{ticker:'NOQUOTE',name:'No Quote Co',cik:3,marketCap:1e8},{ticker:'ETF',name:'Synthetic ETF',cik:4,marketCap:1e8,price:20}];
 listed.push({ticker:'NO-CIK',name:'Listed without SEC link',cik:0});
 const candidates=preliminaryCandidates(listed);assert.deepEqual(candidates.map(row=>row.ticker),['MICRO','MEGA','NOQUOTE','ETF','NO-CIK']);
 assert(historyCandidate({...base,securityType:'common',marketCap:5e12,price:400}));
 assert(historyCandidate({...base,securityType:'common',symbol:'NOQUOTE',marketCap:null,price:null}));
 assert(historyCandidate({...base,securityType:'unknown',symbol:'UNRESOLVED'}),'unresolved identity remains available for research history');
});
test('source conflict prevents both screening and final qualification',()=>{for(const strategy of ['core','bounce']){const e=evaluateStrategy(strategy,{...base,sourceConflicts:['injected conflict']});assert.equal(e.screeningQualified,false);assert.equal(e.status,'UNKNOWN');assert.equal(e.finalRanked,false)}});
test('visitor isolation and cookie flags',()=>{
 const a=visitor(new Request('https://radar.test')),b=visitor(new Request('https://radar.test'));assert.notEqual(a.owner,b.owner);assert.match(a.cookie,/HttpOnly; SameSite=Lax; Secure/);assert.equal(visitor(new Request('https://radar.test',{headers:{cookie:a.cookie.split(';')[0]}})).owner,a.owner);
});
test('account sync moves anonymous wallet data and keeps it available on another device',async()=>{
 const anonymous=visitor(new Request('https://radar.test')),cookie=anonymous.cookie.split(';')[0],now=new Date().toISOString();
 sqlite.prepare('INSERT INTO portfolio_revisions(owner,revision) VALUES(?,0)').run(anonymous.owner);
 sqlite.prepare('INSERT INTO portfolio_transactions(id,owner,symbol,company_name,side,quantity,price,fees,trade_date,note,metadata,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('sync-account-tx',anonymous.owner,'TEST','Synthetic','buy',2,10,0,'2026-01-01','', '{}',now,now);
 sqlite.prepare('INSERT INTO personal_watchlist(owner,symbol,created_at,payload) VALUES(?,?,?,?)').run(anonymous.owner,'TEST',now,JSON.stringify(base));
 const origin='https://radar.test',signup=await accountPOST(new Request(`${origin}/api/account`,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({action:'signup',username:'sync-test-user',password:'strong-password-123'})}));
 assert.equal(signup.status,200);const setCookies=signup.headers.get('set-cookie')||'';assert.match(setCookies,/radar-session=/);const session=setCookies.match(/radar-session=[^;]+/)?.[0];assert(session);
 const accountId=sqlite.prepare('SELECT id FROM radar_accounts WHERE username=?').get('sync-test-user').id,owner=`account:${accountId}`;
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM portfolio_transactions WHERE owner=?').get(owner).count,1);assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM personal_watchlist WHERE owner=?').get(owner).count,1);
 const secondDevice=await accountGET(new Request(`${origin}/api/account`,{headers:{cookie:session}}));assert.equal(secondDevice.status,200);assert.equal((await secondDevice.json()).account.username,'sync-test-user');
});
test('portfolio average cost, partial sale, fees and realized profit are deterministic',()=>{
 const tx=(id,side,quantity,price,fees,tradeDate)=>({id,symbol:'TEST',companyName:'Synthetic',side,quantity,price,fees,tradeDate,createdAt:`${tradeDate}T12:00:00Z`,updatedAt:`${tradeDate}T12:00:00Z`});
 const transactions=[tx('1','buy',10,10,1,'2026-01-01'),tx('2','buy',10,20,1,'2026-01-02'),tx('3','sell',5,30,1,'2026-01-03')];
 const value=calculatePortfolio(transactions,{TEST:{symbol:'TEST',name:'Synthetic',price:25,dailyChange:.02,asOf:'2026-01-04'}});
 assert.equal(value.positions[0].quantity,15);assert.equal(value.positions[0].averageCost,15.1);assert.equal(value.positions[0].dailyChange,.02);assert.equal(value.summary.realizedPnl,73.5);assert.equal(value.summary.unrealizedPnl,148.5);assert.equal(value.summary.totalPnl,222);
 assert.throws(()=>validateLedger([...transactions,tx('4','sell',16,25,0,'2026-01-04')]),/لا يمكن بيع/);
});
test('portfolio full close and reopen resets cost basis instead of leaking an old average',()=>{
 const row=(id,side,quantity,price,tradeDate)=>({id,symbol:'TEST',companyName:'Synthetic',side,quantity,price,fees:0,tradeDate,createdAt:tradeDate,updatedAt:tradeDate});
 const value=calculatePortfolio([row('1','buy',10,10,'2026-01-01'),row('2','sell',10,12,'2026-01-02'),row('3','buy',5,20,'2026-01-03')],{TEST:{symbol:'TEST',name:'Synthetic',price:22,dailyChange:null,asOf:'2026-01-04'}});
 assert.equal(value.positions[0].averageCost,20);assert.equal(value.summary.realizedPnl,20);assert.equal(value.summary.unrealizedPnl,10);
});
test('portfolio history refuses to fabricate a continuous line from stale or missing prices',()=>{
 const transaction={id:'1',symbol:'TEST',companyName:'Synthetic',side:'buy',quantity:2,price:10,fees:0,tradeDate:'2026-01-01',createdAt:'2026-01-01',updatedAt:'2026-01-01'};
 const complete=buildPerformanceSeries([transaction],{TEST:[{date:'2026-01-01',close:10},{date:'2026-01-02',close:12}]},'2026-01-02');assert.equal(complete.points.at(-1).returnPct,.2);
 const missing=buildPerformanceSeries([transaction],{},'2026-02-01');assert.deepEqual(missing.incompleteSymbols,['TEST']);assert.equal(missing.points.length,1);
});
test('portfolio calculations remain responsive for 10,000 ledger rows',t=>{
 const transactions=Array.from({length:10000},(_,index)=>({id:String(index),symbol:`P${index%100}`,companyName:`Position ${index%100}`,side:'buy',quantity:1,price:10+(index%25),fees:.01,tradeDate:`2026-01-${String(index%28+1).padStart(2,'0')}`,createdAt:`2026-01-01T00:00:${String(index%60).padStart(2,'0')}Z`,updatedAt:'2026-01-01T00:00:00Z'}));
 const quotes=Object.fromEntries(Array.from({length:100},(_,index)=>[`P${index}`,{symbol:`P${index}`,name:`Position ${index}`,price:25,dailyChange:.01,asOf:'2026-09-20T00:00:00Z'}]));
 const start=performance.now(),value=calculatePortfolio(transactions,quotes),elapsed=performance.now()-start;
 assert.equal(value.positions.length,100);assert.equal(value.positions.reduce((sum,row)=>sum+row.quantity,0),10000);assert(elapsed<2000);t.diagnostic(`10,000 ledger rows: ${elapsed.toFixed(1)} ms`);
});
test('stage9 persists rows and hands every in-range category row to history scoring',async()=>{
 await db().prepare('INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,universe,stage,strategy_hash) VALUES(?,?,?,?,?,?,?,?,?)').bind('scan-test','2026-09-08T00:00:00Z','2026-09-08T00:00:00Z','running','Bulk Quotes/SEC Frames v7 · full',1,JSON.stringify([{ticker:'TEST',name:'Synthetic test only',cik:99,exchange:'Nasdaq',marketCap:1e9,price:10}]),9,currentHash()).run();
 const result=await processScanBatch('scan-test');assert.equal(result.done,false);assert.equal(result.run.stage,10);assert.equal(result.run.offset,0);assert.equal(result.run.total,1);assert.equal(result.run.processed,1);assert.equal(result.run.status,'running');
 assert.equal((await db().prepare("SELECT COUNT(*) AS n FROM fundamental_snapshots WHERE run_id='scan-test'").first()).n,1);
 const initialEvaluation=JSON.parse((await db().prepare("SELECT evaluation FROM fundamental_snapshots WHERE run_id='scan-test'").first()).evaluation);assert.equal(initialEvaluation.opportunity.strategy,'UNIFIED_OPPORTUNITY');assert.equal(initialEvaluation.opportunity.researchState,'needs-research');assert.equal(initialEvaluation.opportunity.sourceEligible,false);
 const now=new Date().toISOString(),today=now.slice(0,10),previous=new Date(Date.parse(now)-86400000).toISOString().slice(0,10);setHistoryResult({history:[{date:previous,open:10,high:10,low:10,close:10,volume:1000},{date:today,open:11,high:11,low:11,close:11,volume:1000}],splits:[],source:'TEST_ONLY',url:'https://example.test',availableAt:now,retrievedAt:now});
 try { const researchStage=await processScanBatch('scan-test');assert.equal(researchStage.done,false);assert.equal(researchStage.run.stage,11);assert.equal(researchStage.run.total,1,'issuer-linked financial research is attempted even when liquidity is below the safety floor');const final=await processScanBatch('scan-test');assert.equal(final.done,true);assert.equal(final.run.stage,13);assert.equal(final.run.processed,1);assert.equal(final.run.status,'complete');const stored=JSON.parse((await db().prepare("SELECT payload FROM fundamental_snapshots WHERE run_id='scan-test'").first()).payload);assert.equal(stored.price,11);assert.ok(Math.abs(stored.dailyChange-.1)<1e-12);assert.match(stored.provenance.dailyChange.tag,/completed close/);assert.equal(stored.opportunityResearch.earnings.providerStatus,'retrieved');const opportunity=await GET(new Request('https://radar.test/api/radar'));assert.equal(opportunity.status,200);const body=await opportunity.json();assert.equal(body.page.strategy,'opportunity','the API defaults to the unified category');assert.equal(body.summary.opportunityRanked,1);assert.equal(body.summary.opportunityNeedsResearch,0);assert.equal(body.snapshots.length,1,'scanner-only data has a final numeric grade with separate evidence diagnostics');const oldAlias=await GET(new Request('https://radar.test/api/radar?strategy=core'));assert.equal((await oldAlias.json()).page.strategy,'opportunity','retired category requests are mapped to the unified category');const research=await GET(new Request('https://radar.test/api/radar?strategy=opportunity&state=needs-research'));assert.equal((await research.json()).snapshots[0].symbol,'TEST'); }
 finally { setHistoryResult(null); }
});
test('Company Facts recovery stage advances when the durable Frames row is already complete',async()=>{
 const company={ticker:'FACTS-STAGE',name:'Synthetic facts stage',cik:654321,exchange:'Nasdaq',marketCap:100e6,price:10};
 await db().prepare('INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,universe,stage,strategy_hash) VALUES(?,?,?,?,?,?,?,?,?)').bind('facts-stage','2026-09-11T00:00:00Z','2026-09-11T00:00:00Z','running','Bulk Quotes/SEC Frames + Company Facts v10 · full',1,'paged-v1',5,currentHash()).run();
 await db().prepare('INSERT INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind('universe:facts-stage:candidates:0','test','2026-09-11T00:00:00Z',JSON.stringify([company])).run();
 const fact=(key)=>({cik:company.cik,start:key==='revenue'?'2025-01-01':undefined,end:'2025-12-31',val:key==='revenue'?100:1,filed:'2026-02-01',form:'10-K',tag:key,priority:0,url:'https://data.sec.gov/test'});
 const instant=(key)=>({...fact(key),start:undefined,end:'2026-06-30'});
 await db().prepare('INSERT INTO bulk_fundamentals(run_id,cik,payload) VALUES(?,?,?)').bind('facts-stage',company.cik,JSON.stringify({revenue:fact('revenue'),netIncome:fact('netIncome'),ocf:fact('ocf'),capex:fact('capex'),shares:instant('shares'),priorShares:{...instant('priorShares'),end:'2025-06-30'},cash:instant('cash'),debtCurrent:instant('debtCurrent'),debtNoncurrent:instant('debtNoncurrent')})).run();
 const result=await processScanBatch('facts-stage');assert.equal(result.run.stage,9);assert.equal(result.run.offset,0);assert.equal(result.run.sec_requests,0);
});
test('newest finished full universe remains canonical despite partial provider coverage',async()=>{
 await db().prepare("UPDATE strategy_runs SET processed=0 WHERE id='scan-test'").run();invalidateStateCache();assert.equal((await readState()).dataRunId,'scan-test');
 const created=new Date(Date.now()+86400000).toISOString(),id='partial-test';
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,universe_total,stage,strategy_hash) VALUES(?,?,?,'partial','Bulk Quotes/SEC Frames · full',2,2,13,?)").bind(id,created,created,currentHash()).run();
 try{
  await insertSnapshot(id,{...base,symbol:'PARTIAL-A'}).run();await insertSnapshot(id,{symbol:'PARTIAL-Z',name:'Missing provider data',asOf:base.asOf,securityType:'unknown',provenance:{}}).run();
  invalidateStateCache();const current=await readState({limit:10});assert.equal(current.dataRunId,id);assert.equal(current.summary.opportunityRanked,2);assert.equal(current.summary.missingFinalGrades,0);
  const report=await(await reportGET(new Request('https://radar.test/api/scan-report?runId='+id))).json();assert.equal(report.counts.passed,2);
  for(const [index,snapshot]of current.snapshots.entries()){
   const expected=current.storedEvaluations[index].opportunity;
   const company=await(await companyGET(new Request('https://radar.test/api/company?symbol='+snapshot.symbol))).json();assert.deepEqual(company.evaluation,expected);assert.equal(company.ranking.runId,id);assert.equal(company.ranking.position,current.rankPositions[index]);
   const row=report.rows.find(row=>row.symbol===snapshot.symbol);assert.deepEqual(row.evaluation,expected);assert.equal(row.rank,current.rankPositions[index]);
  }
 }finally{await db().prepare('DELETE FROM fundamental_snapshots WHERE run_id=?').bind(id).run();await db().prepare('DELETE FROM strategy_runs WHERE id=?').bind(id).run();invalidateStateCache();}
});
test('API personal favorites start at zero, writes are idempotent and isolated',async()=>{
 await db().prepare("INSERT INTO watchlist(symbol,created_at) VALUES('OLD_SHARED','2026-01-01')").run();
 const initial=await GET(new Request('https://radar.test/api/radar'));assert.equal(initial.status,200);const cookie=initial.headers.get('set-cookie').split(';')[0];assert.deepEqual((await initial.json()).favorites,[]);
 const directSnapshot={...base,symbol:'DIRECTFAV'};
 const mutation=(saved)=>POST(new Request('https://radar.test/api/radar',{method:'POST',headers:{origin:'https://radar.test',cookie,'content-type':'application/json'},body:JSON.stringify({action:'favorite',symbol:'DIRECTFAV',saved,...(saved?{snapshot:directSnapshot}:{})})}));
 for(let i=0;i<2;i++){const r=await mutation(true);assert.equal(r.status,200);assert.deepEqual((await r.json()).favorites,['DIRECTFAV']);}
 const own=await GET(new Request('https://radar.test/api/radar?strategy=favorites',{headers:{cookie}}));assert.equal((await own.json()).snapshots[0].symbol,'DIRECTFAV');
 const stranger=await GET(new Request('https://radar.test/api/radar?strategy=favorites'));assert.deepEqual((await stranger.json()).favorites,[]);
 for(let i=0;i<2;i++)assert.deepEqual(await (await mutation(false)).json(),{favorites:[]});
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM watchlist').get().n,1);
});
test('API rejects cross-origin and malformed favorite writes',async()=>{
 const cross=await POST(new Request('https://radar.test/api/radar',{method:'POST',headers:{origin:'https://other.test'},body:'{}'}));assert.equal(cross.status,403);
 const invalid=await POST(new Request('https://radar.test/api/radar',{method:'POST',headers:{origin:'https://radar.test'},body:JSON.stringify({action:'favorite',symbol:'BAD!',saved:true})}));assert.equal(invalid.status,400);
});
test('radar cards reuse the canonical completed-session value from a refreshed profile',async()=>{
 const owner='overlay-owner',now=new Date().toISOString(),snapshot={...base,symbol:'CANONICAL',price:5,dailyChange:-.02,provenance:{...base.provenance,price:{...base.provenance.price,tag:'Yahoo bulk quote live'},dailyChange:{...base.provenance.price,tag:'Yahoo bulk quote live'}}},deep={...snapshot,asOf:now,price:12,dailyChange:.25,provenance:{...snapshot.provenance,price:{...base.provenance.price,tag:'last completed session close'},dailyChange:{...base.provenance.price,tag:'last completed close / previous completed close - 1'}}};
 await db().prepare('INSERT INTO personal_watchlist(owner,symbol,created_at,payload) VALUES(?,?,?,?)').bind(owner,'CANONICAL',now,JSON.stringify(snapshot)).run();
 await db().prepare('INSERT INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind('deep:v9:CANONICAL','test',now,JSON.stringify({...deep,price:8,dailyChange:.3})).run();
 await db().prepare('INSERT INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind('deep:v10:CANONICAL','test',now,JSON.stringify({...deep,price:9,dailyChange:.4})).run();
 await db().prepare('INSERT INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind('deep:v11:CANONICAL','test',now,JSON.stringify(deep)).run();
 const result=await readState({strategy:'favorites',owner});assert.equal(result.snapshots[0].price,12);assert.equal(result.snapshots[0].dailyChange,.25);assert.match(result.snapshots[0].provenance.dailyChange.tag,/completed close/);assert.equal(Object.hasOwn(result.snapshots[0],'__cacheKey'),false);
});
test('favorite quote refresh returns the cached completed-session pair used by profile cards',async()=>{
 const now=new Date().toISOString(),quote={symbol:'FAVQUOTE',price:22,dailyChange:.1,periodEnd:'2026-09-28',provenance:{price:{source:'test',periodEnd:'2026-09-28',tag:'last completed session close'},dailyChange:{source:'test',periodEnd:'2026-09-28',tag:'last completed close / previous completed close - 1'}}};
 await db().prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind('favorite-quote:v1:FAVQUOTE','test',now,JSON.stringify(quote)).run();
 const response=await favoriteQuotesGET(new Request('https://radar.test/api/favorite-quotes?symbols=FAVQUOTE'));assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.quotes.FAVQUOTE.price,22);assert.equal(payload.quotes.FAVQUOTE.dailyChange,.1);assert.equal(payload.errors.length,0);
});
test('portfolio API persists isolated trades, validates balances and supports update/delete',async()=>{
 const initial=await portfolioGET(new Request('https://radar.test/api/portfolio'));assert.equal(initial.status,200);const cookie=initial.headers.get('set-cookie').split(';')[0];assert.deepEqual((await initial.json()).transactions,[]);
 const call=(handler,method,body,origin='https://radar.test')=>handler(new Request('https://radar.test/api/portfolio',{method,headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(body)}));
 const buy={symbol:'TEST',side:'buy',quantity:10,price:10,fees:1,tradeDate:'2026-01-01',note:'synthetic test'};
 const saved=await call(portfolioPOST,'POST',buy);assert.equal(saved.status,200);const savedPayload=await saved.json();assert.equal(savedPayload.positions[0].quantity,10);assert.equal(savedPayload.positions[0].averageCost,10.1);
 assert(!('snapshot' in savedPayload.quotes.TEST));assert(JSON.stringify(savedPayload).length<200000);
 const stranger=await portfolioGET(new Request('https://radar.test/api/portfolio'));assert.deepEqual((await stranger.json()).transactions,[]);
 const oversell=await call(portfolioPOST,'POST',{...buy,side:'sell',quantity:11,price:12,tradeDate:'2026-01-02'});assert.equal(oversell.status,409);
 const id=savedPayload.transactions[0].id;
 const updated=await call(portfolioPUT,'PUT',{...buy,id,quantity:8,price:11});assert.equal(updated.status,200);assert.equal((await updated.json()).positions[0].quantity,8);
 assert.equal((await call(portfolioPOST,'POST',buy,'https://evil.test')).status,403);
 const removed=await call(portfolioDELETE,'DELETE',{id});assert.equal(removed.status,200);assert.deepEqual((await removed.json()).transactions,[]);
});
test('portfolio search is bounded and uses the current official listing directory',async()=>{
 const response=await portfolioGET(new Request('https://radar.test/api/portfolio?q=TEST'));assert.equal(response.status,200);assert.equal((await response.json()).results[0].symbol,'TEST');
 assert.equal((await portfolioGET(new Request('https://radar.test/api/portfolio?q='+encodeURIComponent('X'.repeat(101))))).status,400);
});
test('portfolio history endpoint persists owner scope and returns sourced aggregate points',async()=>{
 const initial=await portfolioGET(new Request('https://radar.test/api/portfolio'));const cookie=initial.headers.get('set-cookie').split(';')[0];
 const saved=await portfolioPOST(new Request('https://radar.test/api/portfolio',{method:'POST',headers:{origin:'https://radar.test',cookie,'content-type':'application/json'},body:JSON.stringify({symbol:'TEST',side:'buy',quantity:2,price:10,fees:0,tradeDate:'2026-01-01',note:''})}));assert.equal(saved.status,200);
 setHistoryResult({history:[{date:'2026-01-01',close:10},{date:'2026-01-02',close:12}],splits:[],source:'TEST_HISTORY',url:'https://example.test/history',availableAt:'2026-01-02T22:00:00Z',retrievedAt:'2026-01-03T00:00:00Z'});
 try{
  const response=await portfolioHistoryGET(new Request('https://radar.test/api/portfolio-history',{headers:{cookie}}));assert.equal(response.status,200);const payload=await response.json();assert(payload.points.length>=2);assert.equal(payload.points.find(point=>point.date==='2026-01-02').returnPct,.2);assert.equal(payload.sources[0].source,'TEST_HISTORY');
  const stranger=await portfolioHistoryGET(new Request('https://radar.test/api/portfolio-history'));assert.deepEqual((await stranger.json()).points,[]);
 }finally{setHistoryResult(null);}
});
test('portfolio logo endpoint rejects malformed symbols before any provider call',async()=>{
 const response=await portfolioLogoGET(new Request('https://radar.test/api/portfolio-logo?symbol=BAD!'));assert.equal(response.status,400);assert.equal(await response.text(),'Invalid symbol');
});
test('scan report retains every scored listing and validates paging',async()=>{
 const url='https://radar.test/api/scan-report?runId=scan-test&strategy=opportunity';
 const response=await reportGET(new Request(url));assert.equal(response.status,200);
 const payload=await response.json();assert.equal(payload.counts.total,1);assert.equal(payload.rows[0].symbol,'TEST');assert(payload.blockers.length>0);assert.equal(payload.counts.passed,1);assert.equal(payload.page.hasMore,false);
 assert.equal((await reportGET(new Request(url+'&offset=-1'))).status,400);
 assert.equal((await reportGET(new Request(url.replace('opportunity','bounce')))).status,400);
 assert.equal((await reportGET(new Request(url.replace('scan-test','absent')))).status,404);
 assert.equal((await reportGET(new Request(url+'&offset=25'))).status,200);
});
test('historical scan report counts the same saved rubric states it displays',async()=>{
 const created='2026-01-01T00:00:00.000Z';
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,processed,stage,strategy_hash) VALUES('report-retired',?,?,'complete','retired full scan',2,2,13,'retired-rubric')").bind(created,created).run();
 await insertSnapshot('report-retired',{...base,symbol:'RETIRED-A'}).run();
 await insertSnapshot('report-retired',{...base,symbol:'RETIRED-B'}).run();
 const conflictRow=await db().prepare("SELECT payload FROM fundamental_snapshots WHERE run_id='report-retired' AND symbol='RETIRED-B'").first();
 const conflictSnapshot=JSON.parse(conflictRow.payload);conflictSnapshot.opportunityResearch={earnings:{conflicts:['competing revenue concepts']}};
 await db().prepare("UPDATE fundamental_snapshots SET payload=? WHERE run_id='report-retired' AND symbol='RETIRED-B'").bind(JSON.stringify(conflictSnapshot)).run();
 for(const [symbol,state] of [['RETIRED-A','needs-research'],['RETIRED-B','excluded']]){
  const row=await db().prepare('SELECT evaluation FROM fundamental_snapshots WHERE run_id=? AND symbol=?').bind('report-retired',symbol).first();
  const saved=JSON.parse(row.evaluation);saved.opportunity.hash='retired-rubric';saved.opportunity.state=state;
  await db().prepare('UPDATE fundamental_snapshots SET evaluation=? WHERE run_id=? AND symbol=?').bind(JSON.stringify(saved),'report-retired',symbol).run();
 }
 const response=await reportGET(new Request('https://radar.test/api/scan-report?runId=report-retired&strategy=opportunity'));
 assert.equal(response.status,200);const report=await response.json();
 assert.deepEqual(report.counts,{total:2,passed:2,failed:0,unknown:0,withEvidence:0,stale:true});
 assert.deepEqual(report.rows.map(row=>row.evaluation.state),['ranked','ranked']);
 assert.equal(report.blockers.find(blocker=>blocker.id==='sec-concept-conflict')?.count,1);
 await db().prepare("DELETE FROM fundamental_snapshots WHERE run_id='report-retired'").run();
 await db().prepare("DELETE FROM strategy_runs WHERE id='report-retired'").run();
 invalidateStateCache();
});
test('opportunity scan report ranks missing-factor models with explicit source gaps',async()=>{
 const response=await reportGET(new Request('https://radar.test/api/scan-report?runId=scan-test&strategy=opportunity'));
 assert.equal(response.status,200);const payload=await response.json();
 assert.equal(payload.counts.total,1);assert.equal(payload.counts.passed,1);assert.equal(payload.counts.unknown,0);
 assert.equal(payload.rows[0].evaluation.researchState,'needs-research');assert.equal(payload.rows[0].evaluation.sourceEligible,false);
 assert.equal(payload.blockers.filter(blocker=>!blocker.id.startsWith('eligibility-')&&!blocker.id.startsWith('evidence-')).length,8);
 assert(payload.blockers.every(blocker=>blocker.status==='UNKNOWN'&&blocker.count===1));
 assert.deepEqual(payload.blockers.filter(blocker=>blocker.id.startsWith('eligibility-')).map(blocker=>blocker.id).sort(),['eligibility-liquidity-unknown','eligibility-market-cap-unknown','eligibility-price-unknown','eligibility-security-unknown']);
});
test('client API parser translates HTML route failures instead of leaking JSON syntax errors',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response('<!DOCTYPE html><title>error</title>',{status:503,headers:{'content-type':'text/html'}});
  await assert.rejects(apiJson('/api/test'),error=>/HTML بدل JSON/.test(error.message)&&!/Unexpected token/.test(error.message));
  globalThis.fetch=async()=>Response.json({ok:true});assert.deepEqual(await apiJson('/api/test'),{ok:true});
 }finally{globalThis.fetch=original;}
});
test('intraday chart API validates symbols, returns JSON and reuses its short cache',async()=>{
 assert.equal((await chartGET(new Request('https://radar.test/api/chart?symbol=BAD!'))).status,400);
 assert.equal((await chartGET(new Request('https://radar.test/api/chart?symbol=NONE'))).status,404);
 const first=await chartGET(new Request('https://radar.test/api/chart?symbol=TEST'));assert.equal(first.status,200);assert.equal((await first.json()).points.length,2);
 setIntradayResult(Error('provider should not be called while cached'));
 try{const cached=await chartGET(new Request('https://radar.test/api/chart?symbol=TEST'));const payload=await cached.json();assert.equal(cached.status,200);assert.equal(payload.cached,true);}finally{setIntradayResult({points:[{t:1,c:10},{t:2,c:11}],baseline:9,changePct:2/9,baselineLabel:'TEST',source:'TEST_ONLY',availableAt:'2026-09-08T00:00:00Z'});}
});
test('live lease prevents a duplicate batch',async()=>{await db().prepare("UPDATE strategy_runs SET status='running',stage=10,offset=0,lease_until=? WHERE id='scan-test'").bind(Date.now()+60000).run();const r=await processScanBatch('scan-test');assert.equal(r.busy,true);assert.equal(r.done,false)});

test('provider outage finishes partial, preserves row and never manufactures history',async()=>{
 const company={ticker:'OUTAGE',name:'Synthetic outage fixture',cik:101,exchange:'Nasdaq',marketCap:100e6,price:10};
 await db().prepare('INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,universe,stage,strategy_hash) VALUES(?,?,?,?,?,?,?,?,?)').bind('outage','2026-09-10','2026-09-10','running','Bulk Quotes/SEC Frames v7 · full',1,JSON.stringify([company]),10,currentHash()).run();
 await insertSnapshot('outage',{...base,symbol:'OUTAGE',marketCap:100e6,price:10,return12m:-.5,low52w:5,ma30w:null,medianDollarVolume20d:null}).run();
 for(let attempt=0;attempt<2;attempt++){const retry=await processScanBatch('outage');assert.equal(retry.done,false);assert.equal(retry.run.retryPending,1);assert.equal(retry.run.failed,1);}
 const transition=await processScanBatch('outage');assert.equal(transition.run.stage,11);assert.equal(transition.done,false);
 const result=await processScanBatch('outage');assert.equal(result.run.status,'partial');assert.equal(result.run.failed,1);assert.equal(result.done,true);assert.equal(result.run.retryPending,0);
 const row=await db().prepare("SELECT payload,evaluation FROM fundamental_snapshots WHERE id='outage:OUTAGE'").first();
 assert.match(row.payload,/Injected provider outage/);assert.equal(JSON.parse(row.evaluation).opportunity.researchState,'needs-research');
});

test('local evaluation benchmarks at 2000, 10000 and 15000 synthetic companies',t=>{
 for(const size of [2000,10000,15000]){
  const start=performance.now();let count=0;
  for(let i=0;i<size;i++){const s={...base,symbol:`SYNTHETIC${i}`};if(evaluateStrategy('bounce',s).status)count++;}
  const elapsed=performance.now()-start;assert.equal(count,size);assert(elapsed<15000);t.diagnostic(`${size}: ${elapsed.toFixed(1)} ms (local engine only; excludes providers and browser)`);
 }
});
test('full history stage can qualify marketable candidates while unverified factors remain UNKNOWN',async()=>{
 const now=new Date().toISOString(),date=days=>new Date(Date.parse(now)-days*864e5).toISOString().slice(0,10);
 const history=[];
 for(let days=550;days>=1;days--){const day=date(days);const weekday=new Date(day).getUTCDay();if(weekday===0||weekday===6)continue;const close=days>250?26:days<5?12:8;history.push({date:day,close,open:close,high:close,low:close,volume:100000});}
 const latest=history.at(-1).date;
 const p={...base.provenance.price,availableAt:now,retrievedAt:now,periodEnd:latest};
 const shares={...p,periodStart:date(400),periodEnd:date(30)};
 const snapshot={...base,symbol:'REBOUND',asOf:now,marketCap:100e6,price:12,return12m:-.5,low52w:8,ma30w:null,medianDollarVolume20d:null,splitAdjusted:false,shareCountRatio:1.05,dilution:.05,deathSpiral:'unknown',riskEvidence:undefined,provenance:{...base.provenance,price:p,marketCap:p,dilution:shares,shareCountRatio:shares}};
 await db().prepare('INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,universe,stage,strategy_hash) VALUES(?,?,?,?,?,?,?,?,?)').bind('rebound-evidence',now,now,'running','Bulk Quotes/SEC Frames v9 · full',1,JSON.stringify([{ticker:'REBOUND'}]),10,currentHash()).run();
 await insertSnapshot('rebound-evidence',snapshot).run();
 setHistoryResult({history,splits:[],source:'SYNTHETIC TEST ONLY',url:'https://example.test/splits',retrievedAt:now,availableAt:now});
 try{
  const transition=await processScanBatch('rebound-evidence');assert.equal(transition.done,false);assert.equal(transition.run.stage,11);
  const result=await processScanBatch('rebound-evidence');assert.equal(result.done,true);
  const stored=sqlite.prepare("SELECT payload,evaluation FROM fundamental_snapshots WHERE run_id='rebound-evidence'").get();
  const e=JSON.parse(stored.evaluation);assert.equal(e.opportunity.researchState,'needs-research');assert(e.opportunity.factors.some(factor=>!factor.evidenced));
  assert.equal(JSON.parse(stored.payload).splitAdjusted,true);assert.equal(JSON.parse(stored.payload).history,undefined);
 }finally{setHistoryResult(null);}
});

test('history retries recover without double-counting failures or retaining stale errors',async()=>{
 const company={ticker:'OUTAGE',cik:101};
 await db().prepare("UPDATE strategy_runs SET stage=10,status='running',offset=1,failed=1,retry_queue=? WHERE id='outage'").bind(JSON.stringify([{company,attempt:1}])).run();
 const now=new Date().toISOString();
 setHistoryResult({history:[{date:now.slice(0,10),close:10,volume:100}],source:'TEST_ONLY',url:'https://example.test',availableAt:now,retrievedAt:now});
 try{
  const transition=await processScanBatch('outage');assert.equal(transition.run.stage,11);assert.equal(transition.done,false);
  const r=await processScanBatch('outage');assert.equal(r.done,true);assert.equal(r.run.failed,0);assert.equal(r.run.status,'complete');assert.equal(r.run.error,null);
  const row=await db().prepare("SELECT payload,evaluation FROM fundamental_snapshots WHERE id='outage:OUTAGE'").first();assert(!row.payload.includes('Injected provider outage'));assert.equal(JSON.parse(row.evaluation).opportunity.researchState,'needs-research');
 }finally{setHistoryResult(null);}
});
test('history completion queues all CIK-linked common stocks for SEC research and recovered SEC retries complete cleanly',async()=>{
 const now=new Date().toISOString(),companies=[
  {ticker:'SEC-ELIGIBLE',cik:1001},{ticker:'SEC-ALIAS',cik:1001},{ticker:'SEC-LOW-LIQUIDITY',cik:1002},{ticker:'SEC-NO-CIK'},{ticker:'SEC-NO-QUOTE',cik:1004}
 ];
 const snapshots=companies.map((company,index)=>({...base,symbol:company.ticker,cik:company.cik,asOf:now,securityType:index===3?'etf':'common',price:index===4?null:10,marketCap:index===4?null:50e6,medianDollarVolume20d:index===2?149_999:index===4?null:150_000,provenance:{...base.provenance}}));
 await db().prepare('INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,universe,stage,strategy_hash) VALUES(?,?,?,?,?,?,?,?,?)').bind('opportunity-queue','2026-09-20','2026-09-20','running','Bulk Quotes/SEC Frames + Opportunity SEC v12 · full',5,'paged-v1',10,currentHash()).run();
 await db().prepare('INSERT INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind('universe:opportunity-queue:history:0','test',now,JSON.stringify(companies)).run();
 const previousDay=new Date(Date.parse(now)-86_400_000).toISOString().slice(0,10);
 await db().prepare('INSERT INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(`scan-history:v3:SEC-ELIGIBLE:${previousDay}`,'test',now,JSON.stringify({history:[]})).run();
 for(const snapshot of snapshots)await insertSnapshot('opportunity-queue',snapshot).run();
 setHistoryResult({history:[{date:now.slice(0,10),close:10,volume:100}],splits:[],source:'TEST_ONLY',url:'https://example.test',availableAt:now,retrievedAt:now});
 setOpportunityResearchResult(new Error('transient SEC outage'));resetOpportunityCalls();
 try{
  const prepared=await processScanBatch('opportunity-queue');assert.equal(prepared.run.stage,11);assert.equal(prepared.run.total,3);
  assert.equal(await db().prepare('SELECT key FROM raw_cache WHERE key=?').bind(`scan-history:v3:SEC-ELIGIBLE:${previousDay}`).first(),null);
  assert(await db().prepare('SELECT key FROM raw_cache WHERE key=?').bind(`scan-history:v3:SEC-ELIGIBLE:${now.slice(0,10)}`).first());
  const queue=await db().prepare("SELECT payload FROM raw_cache WHERE key='universe:opportunity-queue:opportunity:0'").first();assert.deepEqual(JSON.parse(queue.payload).map(row=>row.tickers),[['SEC-ALIAS','SEC-ELIGIBLE'],['SEC-LOW-LIQUIDITY'],['SEC-NO-QUOTE']]);
  const failedAttempt=await processScanBatch('opportunity-queue');assert.equal(failedAttempt.done,false);assert.equal(failedAttempt.run.retryPending,3);
  setOpportunityResearchResult({providerStatus:'retrieved',retryable:false});
  const recovered=await processScanBatch('opportunity-queue');assert.equal(recovered.done,true);assert.equal(recovered.run.status,'complete');assert.equal(recovered.run.retryPending,0);assert.equal(opportunityCalls,6);assert.equal(recovered.run.sec_requests,12,'each first attempt and retry performs Company Facts plus submissions metadata lookup');
  const alias=await db().prepare("SELECT payload FROM fundamental_snapshots WHERE run_id='opportunity-queue' AND symbol='SEC-ALIAS'").first();assert.equal(JSON.parse(alias.payload).opportunityResearch.earnings.providerStatus,'retrieved');
 }finally{setHistoryResult(null);setOpportunityResearchResult({providerStatus:'retrieved',retryable:false});}
});
test('stage11 fetches one SEC Company Facts response per issuer and persists it to each common-stock listing',async()=>{
 const now=new Date().toISOString(),snapshot={...base,symbol:'SEC-RESEARCH',cik:1855612,asOf:now,securityType:'common',price:10,marketCap:50e6,medianDollarVolume20d:500_000,provenance:{...base.provenance}};
 await db().prepare('INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,universe,stage,strategy_hash) VALUES(?,?,?,?,?,?,?,?,?)').bind('sec-research','2026-09-20','2026-09-20','running','Bulk Quotes/SEC Frames + Opportunity SEC v12 · full',1,'paged-v1',11,currentHash()).run();
 await db().prepare('INSERT INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind('universe:sec-research:opportunity:0','test',now,JSON.stringify([{ticker:snapshot.symbol,cik:snapshot.cik}])).run();
 await insertSnapshot('sec-research',snapshot).run();setOpportunityResearchResult({providerStatus:'retrieved',retryable:false});
 try{const result=await processScanBatch('sec-research');assert.equal(result.done,true);assert.equal(result.run.stage,13);assert.equal(result.run.sec_requests,2);const stored=sqlite.prepare("SELECT payload,evaluation FROM fundamental_snapshots WHERE run_id='sec-research'").get();const payload=JSON.parse(stored.payload);assert.equal(payload.opportunityResearch.earnings.providerStatus,'retrieved');assert.equal(payload.opportunityResearch.financialStrength.providerStatus,'retrieved');const evaluation=JSON.parse(stored.evaluation).opportunity;assert.equal(evaluation.researchState,'needs-research');assert.equal(evaluation.sourceEligible,false);assert(evaluation.factors.find(f=>f.id==='earningsQuality').rationale.includes('Synthetic runtime provider fixture'));}
 finally{setOpportunityResearchResult({providerStatus:'retrieved',retryable:false});}
});
test('SEC research stage resumes across eight-row pages and records a stable 403 without retrying',async()=>{
 const now=new Date().toISOString(),companies=Array.from({length:9},(_,index)=>({ticker:`SEC403${index}`,cik:2000+index}));
 await db().prepare('INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,universe,stage,strategy_hash) VALUES(?,?,?,?,?,?,?,?,?)').bind('sec-403-pages','2026-09-20','2026-09-20','running','Bulk Quotes/SEC Frames + Opportunity SEC v12 · full',companies.length,'paged-v1',11,currentHash()).run();
 await db().prepare('INSERT INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind('universe:sec-403-pages:opportunity:0','test',now,JSON.stringify(companies)).run();
 for(const company of companies)await insertSnapshot('sec-403-pages',{...base,symbol:company.ticker,cik:company.cik,asOf:now,securityType:'common',price:10,marketCap:50e6,medianDollarVolume20d:500_000,provenance:{...base.provenance}}).run();
 setOpportunityResearchResult({providerStatus:'unavailable',retryable:false,error:'HTTP 403'});resetOpportunityCalls();
 try{
  const first=await processScanBatch('sec-403-pages');assert.equal(first.done,false);assert.equal(first.run.offset,8);assert.equal(first.run.retryPending,0);assert.equal(first.run.sec_requests,16);assert.equal(opportunityCalls,8);
  const final=await processScanBatch('sec-403-pages');assert.equal(final.done,true);assert.equal(final.run.stage,13);assert.equal(final.run.status,'partial');assert.equal(final.run.retryPending,0);assert.equal(final.run.sec_failed,9);assert.equal(final.run.sec_requests,18);assert.equal(opportunityCalls,9);assert.match(final.run.error,/SEC/);
 }finally{setOpportunityResearchResult({providerStatus:'retrieved',retryable:false});}
});
test('SEC research stage records mismatched-issuer payloads as validation failures, not successful coverage',async()=>{
 const now=new Date().toISOString(),company={ticker:'SECIDENTITY',cik:2888};
 await db().prepare('INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,universe,stage,strategy_hash) VALUES(?,?,?,?,?,?,?,?,?)').bind('sec-invalid-identity','2026-09-20','2026-09-20','running','Bulk Quotes/SEC Frames + Opportunity SEC v12 · full',1,'paged-v1',11,currentHash()).run();
 await db().prepare('INSERT INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind('universe:sec-invalid-identity:opportunity:0','test',now,JSON.stringify([company])).run();
 await insertSnapshot('sec-invalid-identity',{...base,symbol:company.ticker,cik:company.cik,asOf:now,securityType:'common',price:10,marketCap:50e6,medianDollarVolume20d:500_000,provenance:{...base.provenance}}).run();
 setOpportunityResearchResult({providerStatus:'invalid',retryable:false,error:'SEC issuer CIK mismatch'});
 try{
  const result=await processScanBatch('sec-invalid-identity');
  assert.equal(result.done,true);assert.equal(result.run.status,'partial');assert.equal(result.run.sec_success,0);assert.equal(result.run.sec_failed,1);assert.match(result.run.error,/SEC/);
  const stored=await db().prepare("SELECT payload,evaluation FROM fundamental_snapshots WHERE run_id='sec-invalid-identity'").first();
  assert.equal(JSON.parse(stored.payload).opportunityResearch.earnings.providerStatus,'invalid');
  const evaluation=JSON.parse(stored.evaluation).opportunity;assert.equal(evaluation.researchState,'needs-research');assert.equal(evaluation.sourceEligible,false);
 }finally{setOpportunityResearchResult({providerStatus:'retrieved',retryable:false});}
});
test('concurrent quick/full starts share one durable run before any network call',async()=>{
  await db().prepare("UPDATE strategy_runs SET stage=13,status='complete',lease_until=0 WHERE status='running'").run();
 await db().prepare("UPDATE strategy_runs SET created_at='2000-01-01',updated_at='2000-01-01' WHERE status IN ('complete','partial')").run();
 const before=universeCalls;
 const results=await Promise.all([startScan('full'),startScan('quick'),startScan('full')]);
 assert.equal(new Set(results.map(r=>r.id)).size,1);assert.equal(results[0].stage,0);assert.equal(universeCalls,before);
 setUniverse([{ticker:'INIT',name:'Synthetic initialized company',price:10,marketCap:100e6,cik:123}]);
 const initialized=await processScanBatch(results[0].id);assert.equal(initialized.done,false);assert.equal(initialized.run.total,1);assert.equal(initialized.run.stage,1);
 const quoted=await processScanBatch(results[0].id);assert.equal(quoted.run.stage,4);assert.equal(quoted.run.total,1);
 await db().prepare("UPDATE strategy_runs SET stage=13,status='complete' WHERE id=?").bind(results[0].id).run();setUniverse([]);
});
test('initialization outage retries after restart and terminates after three attempts',async()=>{
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,strategy_hash) VALUES('init-outage','2000-01-01','2000-01-01','running','Bulk Quotes/SEC Frames v7 · full',?)").bind(currentHash()).run();
 for(let i=0;i<3;i++){
  const r=await processScanBatch('init-outage');assert.equal(r.done,i===2);assert.equal(r.run.status,i===2?'failed':'running');assert.equal(r.run.stage,0);
 }
});
test('missing quote checkpoint terminates after bounded retries instead of sticking',async()=>{
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,universe,stage,strategy_hash) VALUES('missing-quotes','2030-01-01','2030-01-01','running','Bulk Quotes/SEC Frames v7 · full',1000,'paged-v1',1,?)").bind(currentHash()).run();
 for(let i=0;i<3;i++){const result=await processScanBatch('missing-quotes');assert.equal(result.done,i===2);assert.equal(result.run.status,i===2?'failed':'running');}
});
test('exhausted SEC checkpoint recovery resets score cursor before continuing',async()=>{
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,universe,stage,offset,strategy_hash) VALUES('missing-ciks','2030-01-02','2030-01-02','running','Bulk Quotes/SEC Frames v7 · full',1,'paged-v1',4,8,?)").bind(currentHash()).run();
 for(let i=0;i<3;i++){const result=await processScanBatch('missing-ciks');if(i===2){assert.equal(result.run.stage,9);assert.equal(result.run.offset,0);}}
});
test('status API ignores incompatible active runs from previous strategy hashes',async()=>{
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,universe,stage,strategy_hash) VALUES('old-hash-active','2031-01-01','2031-01-01','running','Bulk Quotes/SEC Frames v6 · full',1,'[]',4,'old-hash')").run();
 const payload=await (await GET(new Request('https://radar.test/api/radar?status=1'))).json();assert.notEqual(payload.run?.id,'old-hash-active');
});
test('status polling is compact and does not send snapshots or the universe',async()=>{
 const response=await GET(new Request('https://radar.test/api/radar?status=1'));const raw=await response.text(),data=JSON.parse(raw);
 assert.equal(response.status,200);assert(raw.length<2000);assert(!('snapshots'in data));assert(!('universe'in data.run));
});
test('company lookup query uses the symbol/date index',()=>{
 const plan=sqlite.prepare('EXPLAIN QUERY PLAN SELECT payload FROM fundamental_snapshots WHERE symbol=? ORDER BY as_of DESC LIMIT 1').all('TEST');
 assert(plan.some(row=>row.detail.includes('snapshot_symbol_date_idx')));
});
test('source reconciliation compares matching periods and preserves prior conflicts',()=>{
 const p=(period)=>({source:'TEST',periodEnd:period,availableAt:'2026-01-01',retrievedAt:'2026-01-02'});
 const current={...base,asOf:'2026-09-08',revenue:100,sourceConflicts:['existing issue'],provenance:{revenue:p('2025-12-31')}};
 const previous={...base,revenue:200,provenance:{revenue:p('2024-12-31')}};
 assert.deepEqual(reconcile(current,previous).sourceConflicts,['existing issue']);
 previous.provenance.revenue=p('2025-12-31');assert.equal(reconcile(current,previous).sourceConflicts.length,2);
 const missing={...current,revenue:null};previous.provenance.revenue.availableAt='2027-01-01';assert.equal(reconcile(missing,previous).revenue,null);
 previous.provenance.revenue.availableAt='2026-01-01';assert.equal(reconcile(missing,previous).revenue,200);assert.equal(missing.revenue,null);
});
test('RSS normalization excludes future news, unsafe links and duplicates, retaining CDATA text',()=>{
 const item=(date,link='https://news.example/article')=>`<item><title><![CDATA[Real &amp; sourced]]></title><link>${link}</link><pubDate>${date}</pubDate></item>`;
 const xml=item('Mon, 07 Sep 2026 14:00:00 GMT')+item('Mon, 07 Sep 2026 14:00:00 GMT')+item('Tue, 08 Sep 2026 14:00:00 GMT','https://news.example/future')+item('bad','https://news.example/bad')+item('Mon, 07 Sep 2026 14:00:00 GMT','javascript:alert(1)');
 const items=parseNews(xml,'2026-09-08T00:00:00Z');assert.equal(items.length,1);assert.equal(items[0].title,'Real & sourced');assert.equal(items[0].publishedAt,'2026-09-07T14:00:00.000Z');
});
test('long Retry-After is honored across calls without immediate provider hammering',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'120'}});};
 try{for(let i=0;i<2;i++)await assert.rejects(fetchJson('https://rate-limit.test/facts'),/rate limited/);assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test('push ownership, same-origin, key validation, delivery acceptance and expired cleanup',async()=>{
 const vapid=webpush.generateVAPIDKeys(),client=createECDH('prime256v1');client.generateKeys();
 const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test-only',keys:{p256dh:client.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
 assert(validPushSubscription(subscription));
 for(const endpoint of ['https://127.0.0.1/test','https://fcm.googleapis.com.attacker.test','http://fcm.googleapis.com/test','https://user@fcm.googleapis.com/test'])assert(!validPushSubscription({...subscription,endpoint}));
 assert(!validPushSubscription({...subscription,keys:{...subscription.keys,auth:'bad'}}));
 const env={VAPID_PUBLIC_KEY:vapid.publicKey,VAPID_PRIVATE_KEY:vapid.privateKey};
 const send=(path,payload,cookie,origin='https://radar.test')=>worker.fetch(new Request('https://radar.test'+path,{method:'POST',headers:{...(origin?{origin}:{}),...(cookie?{cookie}:{}),'content-type':'application/json'},body:JSON.stringify(payload)}),env,{waitUntil:()=>{}});
 assert.equal((await send('/api/push/subscribe',subscription,null,null)).status,403);
 const registered=await send('/api/push/subscribe',subscription);assert.equal(registered.status,200);const cookie=registered.headers.get('set-cookie').split(';')[0];
 assert.equal((await send('/api/push/subscribe',subscription)).status,403);
 assert.equal((await send('/api/push/test',{endpoint:subscription.endpoint})).status,404);
 const original=globalThis.fetch;let status=201,calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(options.redirect,'error');assert(options.body.length>0);return new Response('',{status});};
 try{
  assert.equal((await send('/api/push/test',{endpoint:subscription.endpoint},cookie)).status,200);
  status=410;assert.equal((await send('/api/push/test',{endpoint:subscription.endpoint},cookie)).status,410);
  assert.equal((await send('/api/push/test',{endpoint:subscription.endpoint},cookie)).status,404);assert.equal(calls,2);
 }finally{globalThis.fetch=original;}
});

test('SEC pages checkpoint and classify the optional boundary correctly',async()=>{
 const original=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return Response.json({data:[{cik:999999,end:'2025-12-31',val:100}]});};
 try{
  let initial=new Map(),offset=0,success=0,optional=0;
  for(let page=0;page<4;page++){
   const result=await fetchBulkFundamentals([999999],new Date('2026-09-08T00:00:00Z'),{offset,limit:4,initial});
   assert.equal(result.nextOffset,offset+4);assert.equal(result.done,page===3);initial=result.fundamentals;offset=result.nextOffset;success+=result.success;optional+=result.optionalSuccess;
  }
  assert.equal(requests,16);assert.equal(success,13);assert.equal(optional,3);assert(initial.has(999999));
 }finally{globalThis.fetch=original;}
});
test('import preserves share ratio and enrichment, rejecting unrecognized fields instead of silently dropping them',()=>{
 const value={...base,shareCountRatio:1.02,cash:1,debt:0,targetMean:12,news:[{title:'TEST ONLY',link:'https://example.test/story',publishedAt:base.asOf}]};
 const parsed=importSchema.parse([value])[0];assert.equal(parsed.shareCountRatio,1.02);assert.equal(parsed.cash,1);assert.equal(parsed.news[0].title,'TEST ONLY');
 assert.equal(importSchema.safeParse([{...value,unexpectedSecret:'TEST'}]).success,false);
});
test('15000 directory rows use bounded durable pages and resume quote progress',async()=>{
 const companies=Array.from({length:15000},(_,i)=>({ticker:`SYN${i}`,name:'Synthetic company only',cik:i+1,exchange:'NYSE',price:5,marketCap:100e6}));
 setUniverse(companies);
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,strategy_hash) VALUES('large-directory','2000-01-01','2000-01-01','running','Bulk Quotes/SEC Frames v7 · full',?)").bind(currentHash()).run();
 try{
  const initialized=await processScanBatch('large-directory');assert.equal(initialized.run.total,15000);assert.equal(initialized.run.stage,1);
  const max=sqlite.prepare("SELECT MAX(length(payload)) AS bytes,COUNT(*) AS pages FROM raw_cache WHERE key LIKE 'universe:large-directory:quotes:%'").get();assert.equal(max.pages,150);assert(max.bytes<1_000_000);
  for(let chunk=0;chunk<188;chunk++)await publishDirectoryRatings(initialized.run,100);
  const ratings=await readState({runId:'large-directory:ratings-v5',limit:1});assert.equal(ratings.summary.total,15000);assert.equal(ratings.summary.opportunityRanked,15000);assert.equal(ratings.summary.missingFactorScores,0);assert.equal(ratings.summary.missingFinalGrades,0);assert.equal(ratings.storedEvaluations[0].opportunity.factors.length,8);assert.equal(ratings.rankPositions[0],1);assert.notEqual(ratings.run.id,ratings.dataRunId,'complete directory publication does not hide ongoing acquisition');
  for(let page=0;page<150;page++){const result=await processScanBatch('large-directory');assert.equal(result.run.stage,page===149?4:1);if(page<149)assert.equal(result.run.offset,(page+1)*100);}
  assert.equal(sqlite.prepare("SELECT universe FROM strategy_runs WHERE id='large-directory'").get().universe,'paged-v2');
  await db().prepare("UPDATE strategy_runs SET stage=9,offset=1200 WHERE id='large-directory'").run();
  const scored=await processScanBatch('large-directory');assert.equal(scored.run.offset,1400);assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM fundamental_snapshots WHERE run_id='large-directory'").get().n,200);
 }finally{setUniverse([]);}
});

test('unified opportunity pages keep incomplete companies in research and never rank them',async()=>{
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,processed,stage,strategy_hash) VALUES('ranked-order','2099-01-01','2099-01-01','complete','Bulk Quotes/SEC Frames v10 · full',7,7,13,?)").bind(currentHash()).run();
 await insertSnapshot('ranked-order',{...base,symbol:'RANK-HIGH',name:'High score fixture',marketCap:50e6,return12m:-.2,evSales:1,ps:1,revenueGrowth:.25,operatingMarginTrend:.12,insiderBuyValue:50000,cash:20e6,debt:1e6}).run();
 await insertSnapshot('ranked-order',{...base,symbol:'RANK-LOW',name:'Low score fixture',marketCap:1.8e9,return12m:-.6,evSales:9,ps:9,revenueGrowth:-.2,operatingMarginTrend:-.1,insiderBuyValue:0,cash:1e6,debt:50e6}).run();
 await insertSnapshot('ranked-order',{...base,symbol:'RANK-FAIL',name:'Failed gate fixture',marketCap:5e9,return12m:.4}).run();
 const asOf='2026-09-30T23:00:00Z';
 const annual=(year,revenue,income,cash,capex,rightsStatus='redistribution-permitted')=>{const end=`${year}-12-31`,source={source:'SEC Company Facts · runtime fixture',url:'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json',periodEnd:end,availableAt:`${Number(year)+1}-02-01T00:00:00Z`,retrievedAt:`${Number(year)+1}-02-02T00:00:00Z`,rightsStatus,confidence:'high'};const value=n=>({value:n,unit:'USD',source});return{start:`${year}-01-01`,end,metrics:{revenue:value(revenue),netIncome:value(income),operatingCashFlow:value(cash),capitalExpenditure:value(capex)}}};
 const researched=(symbol,values,rights='redistribution-permitted')=>insertSnapshot('ranked-order',{...base,symbol,asOf,opportunityResearch:{earnings:{providerStatus:'retrieved',coverage:{annualPeriodsFound:values.length,quarterlyPeriodsFound:0,selectedUnit:'USD'},annual:values.map((values,index)=>annual(String(2023+index),...values,rights)),quarterly:[],missing:[],conflicts:[],limitations:[],readyForScoring:false},financialStrength:{providerStatus:'retrieved',industryModel:'industrial-operating-company',metrics:{},missing:[],conflicts:[],limitations:[],readyForScoring:false}}});
 await researched('RANK-STRONG',[[100,10,14,4],[120,18,22,5],[150,30,40,8]]).run();
 await researched('RANK-GROWTH',[[100,20,24,8],[150,30,35,10],[225,45,55,15]]).run();
 await researched('RANK-LOSS',[[100,-5,0,3],[130,-4,2,3],[180,-2,4,4]]).run();
 await researched('RANK-UNVERIFIED',[[500,100,150,10],[600,120,180,10],[700,140,210,10]],'unknown').run();
 const ranked=await readState({strategy:'opportunity',opportunityState:'ranked',limit:10});assert.equal(ranked.summary.total,7);assert.equal(ranked.summary.opportunityRanked,7);assert.equal(ranked.snapshots.length,7);
 const first=await readState({strategy:'opportunity',opportunityState:'needs-research',limit:1});assert.equal(first.summary.opportunityRanked,7);assert.equal(first.snapshots.length,1);assert.equal(first.page.hasMore,true);
 const second=await readState({strategy:'opportunity',opportunityState:'needs-research',limit:10,offset:1});assert.equal(second.snapshots.length,6);
 const all=await readState({strategy:'opportunity',opportunityState:'needs-research',limit:10});assert.equal(all.snapshots.length,7);assert(all.snapshots.some(s=>s.symbol==='RANK-FAIL'));
 assert.deepEqual([...first.snapshots,...second.snapshots].map(s=>s.symbol),all.snapshots.map(s=>s.symbol));
 assert.ok(all.storedEvaluations.every((row,index)=>index===0||all.storedEvaluations[index-1].opportunity.score>=row.opportunity.score));
 assert.deepEqual(all.rankPositions,[1,2,3,4,5,6,7]);
});


test('radar preserves canonical scored quotes when a deep cache is newer',async()=>{
 const now='2101-01-01T00:00:00.000Z',symbols=Array.from({length:20},(_,index)=>`PAGE${index}`);
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,processed,stage,strategy_hash) VALUES('large-radar-page',? ,?,'complete','Bulk Quotes/SEC Frames v10 · full',20,20,13,?)").bind(now,now,currentHash()).run();
 for(const symbol of symbols)await insertSnapshot('large-radar-page',{...base,symbol,name:`Synthetic ${symbol}`}).run();
 const quote={price:17,dailyChange:.125,provenance:{price:{source:'test',periodEnd:'2026-09-30',tag:'last completed session close'},dailyChange:{source:'test',periodEnd:'2026-09-30',tag:'previous completed close'}}};
 await db().prepare('INSERT INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind('deep:v11:PAGE0','test',now,JSON.stringify({...quote,symbol:'PAGE0'})).run();
 const result=await readState({strategy:'opportunity',opportunityState:'needs-research',limit:20});
 assert.equal(result.snapshots.length,20);assert.equal(result.snapshots.find(snapshot=>snapshot.symbol==='PAGE0').dailyChange,base.dailyChange);assert.equal(result.snapshots.find(snapshot=>snapshot.symbol==='PAGE0').price,base.price);
});

test('latest scan report uses the same recomputed factor coverage as opportunity ranking',async()=>{
 const now=new Date().toISOString();
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,processed,stage,strategy_hash) VALUES('report-current',? ,?,'complete','Bulk Quotes/SEC Frames v10 · full',1,1,13,?)").bind('9999-12-31T00:00:00.000Z',now,currentHash()).run();
 const factSource={source:'SEC fixture',url:'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json',periodStart:'2025-07-01',periodEnd:'2026-06-30',availableAt:now,retrievedAt:now,currency:'USD',confidence:'high',rightsStatus:'redistribution-permitted'};
 await insertSnapshot('report-current',{...base,asOf:now,securityType:'common',symbol:'REPORT-CURRENT',name:'Synthetic report fixture',ps:2,price:10,marketCap:200,revenue:100,fcf:10,provenance:{marketCap:{...factSource,periodStart:undefined,periodEnd:now.slice(0,10)},ps:factSource,revenue:factSource,fcf:factSource,price:{...factSource,periodStart:undefined,periodEnd:now.slice(0,10)}}}).run();
 const stored=await db().prepare("SELECT evaluation FROM fundamental_snapshots WHERE run_id='report-current' AND symbol='REPORT-CURRENT'").first();
 const evaluation=JSON.parse(stored.evaluation),partial=evaluation.opportunity.factors[0];
 partial.evidenced=true;partial.complete=false;partial.score=7;partial.coveragePct=70;partial.points=partial.weight*.7;partial.sources=[{source:'SEC Company Facts · regression fixture',url:'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json',availableAt:now,periodEnd:now.slice(0,10),retrievedAt:now,rightsStatus:'redistribution-permitted'}];
 evaluation.opportunity.score=partial.points;evaluation.opportunity.coveragePct=partial.weight*.7;
 await db().prepare("UPDATE fundamental_snapshots SET evaluation=? WHERE run_id='report-current' AND symbol='REPORT-CURRENT'").bind(JSON.stringify(evaluation)).run();
 invalidateStateCache();
 const response=await reportGET(new Request('https://radar.test/api/scan-report?runId=report-current&strategy=opportunity'));
 assert.equal(response.status,200);const payload=await response.json();
 assert.equal(payload.run.id,'report-current');assert.equal(payload.counts.total,1);assert.equal(payload.counts.withEvidence,1);
 assert.equal(payload.rows[0].symbol,'REPORT-CURRENT');assert.equal(payload.blockers.filter(blocker=>!blocker.id.startsWith('eligibility-')&&!blocker.id.startsWith('evidence-')).length,8);
 const eligibility=payload.blockers.filter(blocker=>blocker.id.startsWith('eligibility-'));
 assert.equal(eligibility.length,payload.rows[0].evaluation.checks.filter(check=>check.role==='eligibility'&&check.status!=='PASS').length);assert(eligibility.every(blocker=>blocker.count===1&&blocker.status==='UNKNOWN'));
 for(const factor of payload.rows[0].evaluation.factors)assert.equal(payload.blockers.find(blocker=>blocker.id===factor.id)?.count,factor.complete?0:1);
 assert.equal(payload.rows[0].evaluation.factors[0].evidenced,true);assert.equal(payload.rows[0].evaluation.factors[0].complete,false);
});

test('all listings retain canonical saved grades, full-universe ranks, reports and profiles across reloads',async()=>{
 const id='acceptance-complete-universe',created='9999-12-31T23:59:59.999Z';
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,processed,stage,strategy_hash) VALUES(?,?,?,'complete','Acceptance · full',260,260,13,'old-rubric')").bind(id,created,created).run();
 const types=['common','adr','unit','warrant','right','unknown','preferred','fund','debt'];
 for(let index=0;index<260;index++){
  const symbol=`COMPLETE-${String(index).padStart(4,'0')}`;
  const snapshot={symbol,name:symbol,asOf:'2026-09-30T00:00:00Z',securityType:types[index%types.length],provenance:{}};
  if(index===1)snapshot.opportunityResearch={earnings:{conflicts:['Partial malformed historical section']}};
  await db().prepare('INSERT INTO fundamental_snapshots(id,run_id,symbol,as_of,payload,evaluation) VALUES(?,?,?,?,?,?)').bind(`${id}:${symbol}`,id,symbol,snapshot.asOf,JSON.stringify(snapshot),'{}').run();
 }
 invalidateStateCache();const symbols=[],evaluations=new Map();
 for(let offset=0;offset<260;offset+=37){
  const response=await GET(new Request(`https://radar.test/api/radar?limit=37&offset=${offset}`));assert.equal(response.status,200);const page=await response.json();
  assert.equal(page.summary.opportunityRanked,260);assert.equal(page.summary.opportunityNeedsResearch,0);assert.equal(page.summary.opportunityExcluded,0);
  page.snapshots.forEach((snapshot,index)=>{const evaluation=page.storedEvaluations[index].opportunity;assert.equal(evaluation.score,0);assert.equal(evaluation.factors.filter(factor=>typeof factor.score==='number').length,8);assert.equal(page.rankPositions[index],offset+index+1);symbols.push(snapshot.symbol);evaluations.set(snapshot.symbol,evaluation);});
 }
 assert.equal(new Set(symbols).size,260);assert.deepEqual(symbols,[...symbols].sort());
 for(const symbol of symbols){const response=await companyGET(new Request(`https://radar.test/api/company?symbol=${symbol}`));assert.equal(response.status,200);const company=await response.json();assert.deepEqual(company.evaluation,evaluations.get(symbol));assert.equal(company.ranking.position,symbols.indexOf(symbol)+1);}
 for(let offset=0;offset<260;offset+=25){const response=await reportGET(new Request(`https://radar.test/api/scan-report?runId=${id}&offset=${offset}`));assert.equal(response.status,200);const report=await response.json();assert.equal(report.counts.passed,260);report.rows.forEach((row,index)=>{assert.equal(row.rank,offset+index+1);assert.deepEqual(row.evaluation,evaluations.get(row.symbol));});}
 // Repair a current-version row with a null factor, and rebuild stable ranks.
 const corrupted=structuredClone(evaluations.get(symbols[100]));corrupted.factors[0].score=null;
 await db().prepare('UPDATE fundamental_snapshots SET evaluation=? WHERE run_id=? AND symbol=?').bind(JSON.stringify({opportunity:corrupted}),id,symbols[100]).run();
 invalidateStateCache();const repaired=await GET(new Request('https://radar.test/api/radar?limit=250'));const page=await repaired.json();assert.equal(page.summary.opportunityRanked,260);assert.deepEqual(page.storedEvaluations[100].opportunity,evaluations.get(symbols[100]));
 const searched=await GET(new Request(`https://radar.test/api/radar?q=${symbols[259]}`));const search=await searched.json();assert.equal(search.rankPositions[0],260);
 invalidateStateCache();const reload=await GET(new Request('https://radar.test/api/radar?limit=37'));assert.deepEqual((await reload.json()).storedEvaluations,page.storedEvaluations.slice(0,37));
 await db().prepare('INSERT INTO personal_watchlist(owner,symbol,created_at,payload) VALUES(?,?,?,?)').bind('complete-rating-owner',symbols[5],created,JSON.stringify({...base,symbol:symbols[5]})).run();
 invalidateStateCache();const favorites=await readState({strategy:'favorites',owner:'complete-rating-owner'});assert.deepEqual(favorites.storedEvaluations[0].opportunity,evaluations.get(symbols[5]));assert.equal(favorites.rankPositions[0],6);assert.equal(favorites.snapshots[0].asOf,'2026-09-30T00:00:00Z');
});

test('report conflict count avoids repeated full payload scans and follows snapshot mutations',async()=>{
 const runId='conflict-count-cache',now='2020-01-01T00:00:00.000Z';
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,processed,stage,strategy_hash) VALUES(?,?,?,'complete','Synthetic report cache · full',1,1,13,?)").bind(runId,now,now,currentHash()).run();
 await insertSnapshot(runId,{...base,symbol:'CONFLICT-CACHE'}).run();
 assert.equal(await readResearchConflictCount(runId),0);
 const originalPrepare=runtimeEnv.DB.prepare;
 runtimeEnv.DB.prepare=sql=>{if(sql.includes("json_array_length(payload,'$.opportunityResearch.earnings.conflicts')"))throw Error('report re-scanned cached full source payloads');return originalPrepare(sql);};
 try{assert.equal(await readResearchConflictCount(runId),0)}finally{runtimeEnv.DB.prepare=originalPrepare}
 await db().prepare('UPDATE fundamental_snapshots SET payload=? WHERE run_id=?').bind(JSON.stringify({...base,symbol:'CONFLICT-CACHE',opportunityResearch:{earnings:{conflicts:['conflicting revenue concepts']}}}),runId).run();
 assert.equal(await readResearchConflictCount(runId),1);
 await db().prepare('DELETE FROM fundamental_snapshots WHERE run_id=?').bind(runId).run();
 assert.equal(await readResearchConflictCount(runId),0);
});

test('publication pins pages, profiles, reports and complete export; rejects mutated releases',async()=>{
 const prior=await readState({limit:1});assert(prior.release);
 const pin=`runId=${prior.release.runId}&release=${prior.release.token}`;
 await db().prepare("UPDATE strategy_runs SET created_at='9998-12-31T23:59:59.999Z',updated_at='9998-12-31T23:59:59.999Z' WHERE id=?").bind(prior.dataRunId).run();
 const now='9999-12-31T23:59:59.999Z',id='release-new-full';
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,processed,stage,strategy_hash) VALUES(?,?,?,'complete','Release · full',1,1,13,?)").bind(id,now,now,currentHash()).run();
 await insertSnapshot(id,{...base,symbol:'NEW-RELEASE'}).run();invalidateStateCache();
 assert.equal((await readState({limit:1})).dataRunId,id);
 const pinned=await (await GET(new Request(`https://radar.test/api/radar?${pin}`))).json();assert.equal(pinned.dataRunId,prior.dataRunId);
 const symbol=prior.snapshots[0].symbol;
 const company=await (await companyGET(new Request(`https://radar.test/api/company?symbol=${symbol}&${pin}`))).json();
 assert.deepEqual(company.evaluation,prior.storedEvaluations[0].opportunity);assert.deepEqual(company.release,prior.release);
 const report=await (await reportGET(new Request(`https://radar.test/api/scan-report?${pin}`))).json();assert.deepEqual(report.release,prior.release);
 const response=await exportGET(new Request(`https://radar.test/api/export?kind=data&${pin}`));assert.equal(response.status,200);
 const exported=await response.json();assert.equal(exported.results.length,prior.summary.total);assert.equal(exported.results.length,260);
 exported.results.forEach((row,index)=>{assert.equal(row.rank,index+1);assert.equal(row.evaluation.score,0);});
 const plans=sqlite.prepare("EXPLAIN QUERY PLAN SELECT s.payload FROM (SELECT run_id,symbol,rank_position FROM opportunity_rankings INDEXED BY opportunity_rank_position_idx WHERE run_id=? ORDER BY rank_position LIMIT 25 OFFSET 100) r JOIN fundamental_snapshots s ON s.run_id=r.run_id AND s.symbol=r.symbol ORDER BY r.rank_position").all(prior.dataRunId);
 assert(plans.some(row=>row.detail.includes('opportunity_rank_position_idx')));assert(plans.some(row=>row.detail.includes('CO-ROUTINE r')));
 await db().prepare('UPDATE fundamental_snapshots SET payload=? WHERE run_id=? AND symbol=?').bind(JSON.stringify({...base,symbol}),prior.dataRunId,symbol).run();
 assert.equal((await GET(new Request(`https://radar.test/api/radar?${pin}`))).status,409);
 assert.equal((await companyGET(new Request(`https://radar.test/api/company?symbol=${symbol}&${pin}`))).status,409);
 assert.equal((await reportGET(new Request(`https://radar.test/api/scan-report?${pin}`))).status,409);
 assert.equal((await GET(new Request('https://radar.test/api/radar?release=unbound'))).status,400);
 await db().prepare('DELETE FROM fundamental_snapshots WHERE run_id=?').bind(id).run();await db().prepare('DELETE FROM strategy_runs WHERE id=?').bind(id).run();invalidateStateCache();
});

test('compact cards preserve canonical score identity while removing raw research payloads',async()=>{
 const complete=await readState({limit:10}),compact=await readState({limit:10,view:'compact'});
 assert.deepEqual(compact.release,complete.release);assert.deepEqual(compact.rankPositions,complete.rankPositions);
 for(let index=0;index<complete.snapshots.length;index++){
  assert.equal(compact.snapshots[index].opportunityResearch,undefined);assert(compact.snapshots[index].operatingSignals);
  const left=compact.storedEvaluations[index].opportunity,right=complete.storedEvaluations[index].opportunity;
  assert.equal(left.score,right.score);assert.equal(left.evaluationHash,right.evaluationHash);assert.equal(left.snapshotHash,right.snapshotHash);
  assert.deepEqual(left.factors.map(f=>[f.id,f.score,f.points]),right.factors.map(f=>[f.id,f.score,f.points]));
 }
});

test('shared provider reservations serialize independent callers and persist across module reloads',async()=>{
 const now=10000;const slots=await Promise.all(Array.from({length:12},()=>reserveProviderRequest('TEST-SEC',125,now)));
 assert.deepEqual([...slots].sort((a,b)=>a-b),Array.from({length:12},(_,i)=>i*125));
 const reloaded=await import('../../.test-build/provider-quota.mjs?restarted=1');assert.equal(await reloaded.reserveProviderRequest('TEST-SEC',125,now),1500);
});

test('unattended scan resumes a durable scoring cursor after a lease expires',async()=>{
 const id='scheduled-resume',created='9999-12-31T23:59:59.999Z';
 const companies=[{ticker:'AUTO-COMMON',cik:1,name:'Auto common',securityType:'common',price:10,marketCap:1000},{ticker:'AUTO-WARRANT',cik:1,name:'Auto warrant',securityType:'warrant',price:1,marketCap:100}];
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,stage,offset,universe,strategy_hash,lease_until) VALUES(?,?,?,'running','Bulk Quotes/Scheduled · full',2,9,0,?,?,?)").bind(id,created,created,JSON.stringify(companies),currentHash(),Date.now()+60000).run();
 const busy=await scheduledScanTick();assert.equal(busy.busy,true);assert.equal(busy.run.offset,0);
 await db().prepare('UPDATE strategy_runs SET lease_until=0 WHERE id=?').bind(id).run();
 const tick=await scheduledScanTick();assert.equal(tick.run.id,id);assert.equal(tick.run.stage,10);
 const rows=(await db().prepare('SELECT evaluation FROM fundamental_snapshots WHERE run_id=?').bind(id).all()).results;assert.equal(rows.length,2);assert(rows.every(row=>JSON.parse(row.evaluation).opportunity.factors.every(f=>Number.isFinite(f.score))));
 const unauthorized=await worker.fetch(new Request('https://radar.test/__radar-scheduled',{method:'POST'}),{}, {waitUntil:()=>{}});assert.equal(unauthorized.status,401);
 await db().prepare('DELETE FROM fundamental_snapshots WHERE run_id=?').bind(id).run();await db().prepare('DELETE FROM strategy_runs WHERE id=?').bind(id).run();
});

test('compressed history restores exact source/evaluation bytes and preserves report/profile parity',async()=>{
 const id='archive-acceptance',now='2020-01-01T00:00:00.000Z';
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,processed,stage,strategy_hash) VALUES(?,?,?,'complete','Historical · full',1,1,13,?)").bind(id,now,now,currentHash()).run();
 await insertSnapshot(id,{...base,symbol:'ARCHIVED',cik:400}).run();const original=await readState({runId:id,limit:1});
 const row=await db().prepare('SELECT id,payload,evaluation FROM fundamental_snapshots WHERE run_id=?').bind(id).first();
 const userCounts=await db().prepare('SELECT (SELECT COUNT(*) FROM personal_watchlist) AS favorites,(SELECT COUNT(*) FROM portfolio_transactions) AS transactions').first();
 await db().batch(await archivedWriteStatements(row.id,row.payload,row.evaluation));
 const inline=await db().prepare('SELECT id,payload,evaluation FROM fundamental_snapshots WHERE run_id=?').bind(id).first();assert(JSON.parse(inline.payload).__archiveId);
 const restored=await restoreArchivedRow(inline);assert.equal(restored.payload,row.payload);assert.equal(restored.evaluation,row.evaluation);
 invalidateStateCache();const after=await readState({runId:id,limit:1});assert.deepEqual(after.storedEvaluations,original.storedEvaluations);
 const company=await (await companyGET(new Request(`https://radar.test/api/company?symbol=ARCHIVED&runId=${id}`))).json();assert.deepEqual(company.evaluation,original.storedEvaluations[0].opportunity);
 const report=await (await reportGET(new Request(`https://radar.test/api/scan-report?runId=${id}`))).json();assert.deepEqual(report.rows[0].evaluation,company.evaluation);
 assert.deepEqual(await db().prepare('SELECT (SELECT COUNT(*) FROM personal_watchlist) AS favorites,(SELECT COUNT(*) FROM portfolio_transactions) AS transactions').first(),userCounts);
 await db().prepare('DELETE FROM fundamental_snapshots WHERE run_id=?').bind(id).run();await db().prepare('DELETE FROM strategy_runs WHERE id=?').bind(id).run();invalidateStateCache();
});

test('a source mutation during publication cannot publish a mixed revision or erase the prior ranks',async()=>{
 const id='publication-race',now='2020-01-01T00:00:00.000Z';
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,processed,stage,strategy_hash) VALUES(?,?,?,'complete','Race · full',1,1,13,?)").bind(id,now,now,currentHash()).run();
 await insertSnapshot(id,{...base,symbol:'RACE',cik:990}).run();const before=await readState({runId:id});
 await db().prepare("UPDATE fundamental_snapshots SET evaluation='{}' WHERE run_id=?").bind(id).run();
 const originalPrepare=runtimeEnv.DB.prepare;let mutated=false;
 runtimeEnv.DB.prepare=sql=>{
  if(!mutated&&sql.startsWith('INSERT INTO opportunity_rankings')){mutated=true;sqlite.prepare('UPDATE fundamental_snapshots SET payload=? WHERE run_id=?').run(JSON.stringify({...base,symbol:'RACE',cik:990,price:20}),id);}
  return originalPrepare(sql);
 };
 try{invalidateStateCache();await assert.rejects(readState({runId:id}),error=>error.status===409);}finally{runtimeEnv.DB.prepare=originalPrepare;}
 assert(mutated);assert.equal((await db().prepare('SELECT COUNT(*) AS n FROM opportunity_rankings WHERE run_id=?').bind(id).first()).n,1);
 invalidateStateCache();const repaired=await readState({runId:id});assert.notEqual(repaired.storedEvaluations[0].opportunity.snapshotHash,before.storedEvaluations[0].opportunity.snapshotHash);assert.equal(repaired.rankPositions[0],1);
 await db().prepare('DELETE FROM fundamental_snapshots WHERE run_id=?').bind(id).run();await db().prepare('DELETE FROM strategy_runs WHERE id=?').bind(id).run();invalidateStateCache();
});

test('production scheduler requires native capacity and never queries prohibited D1 PRAGMAs',async()=>{
 assert.throws(()=>db().prepare('PRAGMA freelist_count'),/not authorized/);
 const missing=await worker.fetch(new Request('https://radar.test/__radar-scheduled',{method:'POST',headers:{'X-Radar-Background':'capacity-secret'}}),{BACKGROUND_SCAN_SECRET:'capacity-secret',RAILWAY_VOLUME_MOUNT_PATH:'/app/data'},{waitUntil:()=>{}});assert.equal(missing.status,503);
 const malformed=await worker.fetch(new Request('https://radar.test/__radar-scheduled',{method:'POST',headers:{'X-Radar-Background':'capacity-secret','X-Radar-Reusable-Bytes':'-1','X-Radar-Filesystem-Free-Bytes':'Infinity'}}),{BACKGROUND_SCAN_SECRET:'capacity-secret',RAILWAY_VOLUME_MOUNT_PATH:'/app/data'},{waitUntil:()=>{}});assert.equal(malformed.status,503);
});


test('directory publication preserves dated issuer facts, retains missing CIKs and resumes an immutable full release',async()=>{
 const priorId='directory-prior',runId='directory-next',date=new Date(Date.now()-3600000).toISOString();
 await db().prepare("UPDATE strategy_runs SET created_at='2000-01-01',updated_at='2000-01-01'").run();invalidateStateCache();
 const old={...base,symbol:'KEEP-DATED',cik:777,securityType:'common',price:10,marketCap:100e6,provenance:{...base.provenance,price:{...base.provenance.price,source:'Nasdaq screener live',url:undefined},marketCap:{...base.provenance.marketCap,source:'Nasdaq screener live',url:undefined}}};
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,stage,strategy_hash) VALUES(?,?,?,'complete','Directory fixture · full',3,13,?)").bind(priorId,new Date(Date.now()-10800000).toISOString(),date,currentHash()).run();await insertSnapshot(priorId,old).run();await insertSnapshot(priorId,{...old,symbol:'CHANGED-ISSUER',cik:888,revenue:123}).run();await insertSnapshot(priorId,{...old,symbol:'NEW-NO-CIK',cik:undefined,securityType:'unknown',revenue:123}).run();
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,universe_total,stage,strategy_hash) VALUES(?,?,?,'running','Bulk Quotes/SEC Frames · full',3,3,1,?)").bind(runId,date,date,currentHash()).run();
 const olderFinished='directory-older-finished';await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,stage,strategy_hash) VALUES(?,?,?,'partial','Directory ratings · full',1,13,?)").bind(olderFinished,new Date(Date.now()-7200000).toISOString(),new Date(Date.now()-5400000).toISOString(),currentHash()).run();await insertSnapshot(olderFinished,{...old,revenue:123}).run();
 const directory=[{ticker:old.symbol,name:'same issuer',cik:777,securityType:'common',exchange:'NYSE',price:10,marketCap:100e6,priceSource:'Nasdaq screener live',priceAvailableAt:old.provenance.price.availableAt,marketCapSource:'Nasdaq screener live',marketCapAvailableAt:old.provenance.marketCap.availableAt},{ticker:'NEW-NO-CIK',name:'missing CIK',securityType:'unknown'},{ticker:'CHANGED-ISSUER',name:'another issuer',cik:999,securityType:'common'}];
 await db().prepare("INSERT INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)").bind(`universe:${runId}:quotes:0`,'fixture',date,JSON.stringify(directory)).run();
 const first=await publishDirectoryRatings({id:runId,strategy_hash:currentHash(),universe_total:3},1000,1);assert.equal(first.offset,1);assert.equal(first.done,false);
 assert.equal((await readState({limit:1})).dataRunId,priorId,'unfinished publication cannot replace the published release');
 const saved=JSON.parse((await db().prepare('SELECT payload FROM fundamental_snapshots WHERE run_id=? AND symbol=?').bind(first.id,old.symbol).first()).payload);
 assert.equal(saved.provenance.price.url,'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true');assert.equal(saved.provenance.marketCap.url,saved.provenance.price.url);assert.equal(saved.provenance.price.availableAt,old.provenance.price.availableAt,'repairing a source URL must not invent a newer quote date');
 assert.equal(saved.revenue,old.revenue);assert.deepEqual(saved.provenance.revenue,old.provenance.revenue);assert.notEqual(saved.asOf,old.asOf,'rating cut advances while factual dates remain unchanged');
 const finished=await publishDirectoryRatings({id:runId,strategy_hash:currentHash(),universe_total:3},1000,2);assert.equal(finished.done,true);
 const state=await readState({runId:first.id,limit:10});assert.equal(state.summary.total,3);assert.equal(state.summary.opportunityRanked,3);assert.deepEqual(new Set(state.snapshots.map(row=>row.symbol)),new Set(directory.map(row=>row.ticker)));
 for(const stored of state.storedEvaluations){assert.equal(stored.opportunity.factors.length,8);assert.ok(Number.isFinite(stored.opportunity.score));}
 for(const symbol of ['CHANGED-ISSUER','NEW-NO-CIK']){const snapshot=JSON.parse((await db().prepare('SELECT payload FROM fundamental_snapshots WHERE run_id=? AND symbol=?').bind(first.id,symbol).first()).payload);assert.equal(snapshot.revenue,undefined,'unmatched or missing CIK must not inherit issuer financials');}
 const pin='runId='+encodeURIComponent(first.id)+'&release='+encodeURIComponent(state.release.token);
 const response=await GET(new Request('https://radar.test/api/radar?'+pin+'&limit=2'));assert.equal(response.status,200);const page=await response.json();assert.equal(page.release.token,state.release.token);assert.equal(page.snapshots.length,2);
 const nextResponse=await GET(new Request('https://radar.test/api/radar?'+pin+'&offset=2'));assert.equal(nextResponse.status,200);const next=await nextResponse.json();assert.equal(next.snapshots.length,1);assert.equal(next.rankPositions[0],3);
 const companyResponse=await companyGET(new Request('https://radar.test/api/company?'+pin+'&symbol='+encodeURIComponent(page.snapshots[0].symbol)));assert.equal(companyResponse.status,200);assert.deepEqual((await companyResponse.json()).evaluation,page.storedEvaluations[0].opportunity);
 const reportResponse=await reportGET(new Request('https://radar.test/api/scan-report?'+pin));assert.equal(reportResponse.status,200);assert.equal((await reportResponse.json()).rows.length,3);
 const exportResponse=await exportGET(new Request('https://radar.test/api/export?'+pin));assert.equal(exportResponse.status,200);assert.equal((await exportResponse.json()).results.length,3);
 const status=await(await GET(new Request('https://radar.test/api/radar?status=1'))).json();assert.equal(status.run.id,state.run.id);assert.notEqual(status.run.id,first.id,'status polling preserves ongoing acquisition and loaded pages');
 const revision=state.release.revision;await publishDirectoryRatings({id:runId,strategy_hash:currentHash(),universe_total:3});assert.equal((await readState({runId:first.id})).release.revision,revision,'completed directory publication never mutates under acquisition ticks');
});


test('legacy quote checkpoints convert without dropping listings and long source URLs fit actual D1 bounds',async()=>{
 const id='long-quote-directory',now=new Date().toISOString(),companies=Array.from({length:1000},(_,index)=>({ticker:'LONG'+index,name:'TEST ONLY',cik:index+1,securityType:'common'}));
 const sourceUrl='https://query1.finance.yahoo.com/v7/finance/quote?symbols='+Array.from({length:250},(_,index)=>'SYMBOL'+String(index).padStart(12,'0')).join('%2C');
 assert.throws(()=>db().prepare('SELECT ?').bind('x'.repeat(2_000_001)),/SQLITE_TOOBIG/);
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,universe_total,universe,stage,strategy_hash) VALUES(?,?,?,'running','Bulk Quotes/SEC Frames · full',1000,1000,'paged-v1',1,?)").bind(id,now,now,currentHash()).run();
 await db().prepare('INSERT INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(`universe:${id}:quotes:0`,'test',now,JSON.stringify(companies)).run();
 setBulkQuoteTransform(rows=>rows.map(row=>({...row,price:10,priceUrl:sourceUrl,priceAvailableAt:now,marketCap:100e6,marketCapUrl:sourceUrl,marketCapAvailableAt:now})));
 try{
  const migrated=await processScanBatch(id);assert.equal((await db().prepare('SELECT universe FROM strategy_runs WHERE id=?').bind(id).first()).universe,'paged-v2');assert.equal(migrated.run.offset,0);
  for(let offset=0;offset<1000;offset+=80)await publishDirectoryRatings(migrated.run,100);
  for(let page=0;page<10;page++){const result=await processScanBatch(id);assert.equal(result.run.offset,page===9?0:(page+1)*100);assert.equal(result.run.stage,page===9?4:1);}
  const pages=(await db().prepare('SELECT payload FROM raw_cache WHERE key LIKE ? ORDER BY key').bind(`universe:${id}:quotes:%`).all()).results;
  assert.equal(pages.length,10);const records=pages.flatMap(row=>{assert.ok(Buffer.byteLength(row.payload)<2_000_000);return JSON.parse(row.payload);});assert.equal(records.length,1000);assert.equal(new Set(records.map(row=>row.ticker)).size,1000);assert.ok(records.every(row=>row.priceUrl===sourceUrl&&row.marketCapUrl===sourceUrl));
 }finally{setBulkQuoteTransform(null);}
});


test('finished enrichment supersedes its directory publication despite an earlier scan start',async()=>{
 const root='finish-after-directory',baseline=root+':ratings',cut='9999-12-31T23:59:59.999Z';
 await db().prepare("UPDATE strategy_runs SET updated_at='2000-01-01'").run();invalidateStateCache();
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,stage,strategy_hash) VALUES(?,'2001-01-01',?,'partial','Directory ratings · full',1,13,?)").bind(baseline,'9999-12-30',currentHash()).run();await insertSnapshot(baseline,{...base,symbol:'NEW-DIRECTORY'}).run();
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,stage,strategy_hash) VALUES(?,'2000-01-01',?,'complete','Bulk Quotes/SEC Frames · full',1,13,?)").bind(root,cut,currentHash()).run();await insertSnapshot(root,{...base,symbol:'ENRICHED-LATER'}).run();
 const current=await readState({limit:10});assert.equal(current.dataRunId,root);assert.equal(current.snapshots[0].symbol,'ENRICHED-LATER');const profile=await(await companyGET(new Request('https://radar.test/api/company?symbol=ENRICHED-LATER'))).json();assert.equal(profile.ranking.runId,root);assert.deepEqual(profile.evaluation,current.storedEvaluations[0].opportunity);
});


test('compatible pricing migration preserves active acquisition progress without accepting unknown strategies',async()=>{
 const id='compatible-acquisition',now=new Date().toISOString();
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,stage,offset,strategy_hash,retry_queue) VALUES(?,?,?,'running','Bulk Quotes/SEC Frames + Opportunity SEC v13 · full',7093,5,2256,'UNIFIED_OPPORTUNITY:ba63f113',?)").bind(id,now,now,JSON.stringify([{attempt:1}])).run();
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,strategy_hash) VALUES('incompatible-acquisition',?,?,'running','Bulk Quotes/SEC Frames + Opportunity SEC v13 · full','unknown-rubric')").bind(now,now).run();
 await migrateCompatibleAcquisitionRuns();const run=await db().prepare('SELECT * FROM strategy_runs WHERE id=?').bind(id).first();assert.equal(run.strategy_hash,currentHash());assert.equal(run.status,'running');assert.equal(run.stage,5);assert.equal(run.offset,2256);assert.equal(run.updated_at,now);assert.equal(run.retry_queue,'[{"attempt":1}]');
 assert.equal((await db().prepare("SELECT strategy_hash FROM strategy_runs WHERE id='incompatible-acquisition'").first()).strategy_hash,'unknown-rubric');
});


test('directory cache survives reload with original dates and rejects damaged bytes',async()=>{
 const {saveCompleteDirectory,readCompleteDirectory,completeDirectoryFiles}=await import('../../.test-build/directory-cache.mjs');
 const value={retrievedAt:'2026-10-06T01:00:00Z',rows:[{ticker:'CACHE',name:'Synthetic only',cik:0,exchange:'Texas Stock Exchange',securityType:'common',securityName:'Common Stock',directoryUrl:'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'}]};
 await saveCompleteDirectory(value);const {readCompleteDirectory:reloaded}=await import('../../.test-build/directory-cache.mjs?reload');assert.deepEqual(await reloaded(),value);
 assert.equal(completeDirectoryFiles('Symbol|Security Name|\nAAA|Common Stock\nFile Creation Time: 10062026|','ACT Symbol|Security Name|\nBBB|Common Stock\nFile Creation Time: 10062026|'),true);
 assert.equal(completeDirectoryFiles('Symbol|Security Name|\nAAA|Common Stock',''),false);
 await db().prepare("UPDATE listing_directory_cache SET content_hash='damaged'").run();assert.equal(await readCompleteDirectory(),null);
});

test('active inventory repair appends listings without losing provider cursor, retries or quotes',async()=>{
 const {reconcileAcquisitionDirectory}=await import('../../.test-build/directory-reconcile.mjs');
 const id='complete-membership-repair',now=new Date().toISOString(),old=[{ticker:'KEEP',name:'Synthetic common',cik:1,exchange:'NYSE',securityType:'common',price:3,priceAvailableAt:'2026-10-01T00:00:00Z'},{ticker:'ABSENT',name:'Synthetic absent',cik:2,exchange:'Nasdaq',securityType:'common'}];
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,universe_total,stage,offset,universe,strategy_hash,retry_queue) VALUES(?,?,?,'running','Bulk Quotes/SEC Frames + Opportunity SEC v13 · full',2,2,5,1,'paged-v2',?,'[{\"attempt\":2}]')").bind(id,now,now,currentHash()).run();
 for(const kind of ['quotes','candidates'])await db().prepare('INSERT INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(`universe:${id}:${kind}:0`,'fixture',now,JSON.stringify(old)).run();
 await db().prepare('INSERT INTO bulk_fundamentals(run_id,cik,payload) VALUES(?,?,?)').bind(id,1,'{"revenue":123}').run();
 setUniverse([{...old[0],exchange:'Texas Stock Exchange',price:9,directoryAvailableAt:now,listingStatus:'current'},{ticker:'ADDED',name:'Synthetic preferred',cik:0,exchange:'NYSE',securityType:'preferred',listingStatus:'current'}]);
 try{
  const original=await db().prepare('SELECT * FROM strategy_runs WHERE id=?').bind(id).first();assert.equal(await reconcileAcquisitionDirectory(original),true);
  const run=await db().prepare('SELECT * FROM strategy_runs WHERE id=?').bind(id).first();assert.equal(run.total,3);assert.equal(run.stage,5);assert.equal(run.offset,1);assert.equal(run.directory_version,1);assert.equal(run.retry_queue,original.retry_queue);
  const quote=JSON.parse((await db().prepare('SELECT payload FROM raw_cache WHERE key=?').bind(`universe:${id}:quotes:0`).first()).payload);assert.deepEqual(quote.map(row=>row.ticker),['KEEP','ABSENT','ADDED']);assert.equal(quote[0].price,3);assert.equal(quote[0].priceAvailableAt,old[0].priceAvailableAt);assert.equal(quote[0].exchange,'Texas Stock Exchange');assert.equal(quote[1].listingStatus,'not-confirmed-current');
  assert.equal((await db().prepare('SELECT payload FROM bulk_fundamentals WHERE run_id=? AND cik=1').bind(id).first()).payload,'{"revenue":123}');assert.equal(await reconcileAcquisitionDirectory(run),false);
  const published=await publishDirectoryRatings(run,100,80);assert.equal(published.done,true);const ranked=await readState({runId:id+':ratings-v5',limit:10});assert.equal(ranked.summary.total,3);assert.equal(ranked.summary.opportunityRanked,3);assert.equal(ranked.storedEvaluations.find((_,index)=>ranked.snapshots[index].symbol==='ABSENT').opportunity.score,0);
 }finally{setUniverse([]);}
});


test('history-phase inventory repair preserves its cursor and seeds appended numeric evaluations',async()=>{
 const {reconcileAcquisitionDirectory}=await import('../../.test-build/directory-reconcile.mjs');const id='history-membership-repair',now=new Date().toISOString(),company={ticker:'HISTORY-KEEP',name:'Synthetic only',cik:1,exchange:'NYSE',securityType:'common'};
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,universe_total,stage,offset,universe,strategy_hash,retry_queue) VALUES(?,?,?,'running','Bulk Quotes/SEC Frames + Opportunity SEC v13 · full',1,1,10,1,'paged-v2',?,'[]')").bind(id,now,now,currentHash()).run();
 await db().prepare('INSERT INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(`universe:${id}:quotes:0`,'fixture',now,JSON.stringify([company])).run();await insertSnapshot(id,{...base,symbol:company.ticker,cik:1}).run();
 setUniverse([{...company,listingStatus:'current'},{ticker:'HISTORY-NEW',name:'Synthetic new',cik:0,exchange:'NYSE',securityType:'preferred',listingStatus:'current'}]);
 try{const run=await db().prepare('SELECT * FROM strategy_runs WHERE id=?').bind(id).first();assert.equal(await reconcileAcquisitionDirectory(run),true);const updated=await db().prepare('SELECT * FROM strategy_runs WHERE id=?').bind(id).first();assert.equal(updated.stage,10);assert.equal(updated.offset,1);assert.equal(updated.total,2);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM fundamental_snapshots WHERE run_id=?').get(id).n,2);const newRow=JSON.parse(sqlite.prepare('SELECT evaluation FROM fundamental_snapshots WHERE run_id=? AND symbol=?').get(id,'HISTORY-NEW').evaluation).opportunity;assert.equal(newRow.factors.length,8);assert.equal(typeof newRow.score,'number');}
 finally{setUniverse([]);}
});

test('recoverable failed acquisitions retain source checkpoints during historical maintenance',async()=>{
 const {maintainHistoricalStorage}=await import('../../.test-build/snapshot-archive.mjs'),id=crypto.randomUUID(),now=new Date().toISOString();
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,stage,strategy_hash) VALUES(?,?,?,'failed','Bulk Quotes/SEC Frames + Opportunity SEC v14 · full',1,9,?)").bind(id,now,now,currentHash()).run();
 await db().prepare('INSERT INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(`universe:${id}:quotes:0`,'fixture',now,'[]').run();await db().prepare('INSERT INTO bulk_fundamentals(run_id,cik,payload) VALUES(?,?,?)').bind(id,1,'{"revenue":123}').run();await insertSnapshot(id,{...base,symbol:'RECOVERABLE'}).run();
 await maintainHistoricalStorage(10);
 assert.equal((await db().prepare('SELECT payload FROM raw_cache WHERE key=?').bind(`universe:${id}:quotes:0`).first()).payload,'[]');assert.equal((await db().prepare('SELECT payload FROM bulk_fundamentals WHERE run_id=?').bind(id).first()).payload,'{"revenue":123}');assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM snapshot_archives WHERE id=?').get(id+':RECOVERABLE').n,0);
});
