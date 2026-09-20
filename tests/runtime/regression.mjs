import test from 'node:test';
import assert from 'node:assert/strict';
import {sqlite} from './env.mjs';
import {scanProgress} from '../../.test-build/scan-progress.mjs';
import {visitor} from '../../.test-build/visitor.mjs';
import {body as parseBody} from '../../.test-build/http.mjs';
import {numeric,parseNews,fetchJson} from '../../.test-build/providers.mjs';
import {reconcile} from '../../.test-build/reconcile.mjs';
import {setHistoryResult,setUniverse,universeCalls,setIntradayResult} from './providers.mjs';
import {evaluateStrategy} from '../../.test-build/engine.mjs';
import {fixtures} from '../../.test-build/fixtures.mjs';
import {ensureSchema,db,currentHash,readState,insertSnapshot} from '../../.test-build/storage.mjs';
import {processScanBatch,startScan,bounceHistoryCandidate,historyCandidate} from '../../.test-build/scanner.mjs';
import {GET,POST} from '../../.test-build/radar-api.mjs';
import {GET as reportGET} from '../../.test-build/scan-report-api.mjs';
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
import webpush from 'web-push';
await ensureSchema();
const base=fixtures[0];
const run=(patch={})=>({id:'test',status:'running',source:'Bulk Quotes/SEC Frames v7 · full',stage:0,offset:0,total:100,processed:0,failed:0,retryPending:0,...patch});
test('JSON body parsing enforces the byte limit even without Content-Length',async()=>{
 const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"value":"'));controller.enqueue(new Uint8Array(32).fill(97));controller.enqueue(new TextEncoder().encode('"}'));controller.close();}});
 const request=new Request('https://example.test/api',{method:'POST',body:stream,duplex:'half'});
 await assert.rejects(()=>parseBody(request,20),error=>error.status===413);
 const valid=new Request('https://example.test/api',{method:'POST',body:'{"value":"موثق"}'});assert.deepEqual(await parseBody(valid,100),{value:'موثق'});
});
test('progress is monotonic and moves during Company Facts recovery',()=>{
 const sequence=[run(),run({stage:4}),run({stage:4,offset:16}),run({stage:5}),run({stage:5,offset:50}),run({stage:9}),run({stage:9,offset:100}),run({stage:10}),run({stage:10,offset:99}),run({stage:10,offset:100}),run({stage:13,offset:100,status:'complete'})].map(s=>scanProgress(s).percent);
 assert(sequence.every((n,i)=>i===0||n>=sequence[i-1]));assert.equal(sequence.at(-1),100);assert(sequence.slice(0,-1).every(n=>n<100));
 assert(scanProgress(run({stage:5,offset:1,total:100})).percent>scanProgress(run({stage:5,total:100})).percent);
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
 const s={...base,securityType:'common',marketCap:100e6,price:10,return12m:-.5,low52w:5,averageVolume10d:0};assert(bounceHistoryCandidate(s));assert(historyCandidate(s));assert(historyCandidate({...s,averageVolume10d:undefined}));
});
test('source conflict prevents both screening and final qualification',()=>{for(const strategy of ['core','bounce']){const e=evaluateStrategy(strategy,{...base,sourceConflicts:['injected conflict']});assert.equal(e.screeningQualified,false);assert.equal(e.status,'UNKNOWN');assert.equal(e.finalRanked,false)}});
test('visitor isolation and cookie flags',()=>{
 const a=visitor(new Request('https://radar.test')),b=visitor(new Request('https://radar.test'));assert.notEqual(a.owner,b.owner);assert.match(a.cookie,/HttpOnly; SameSite=Lax; Secure/);assert.equal(visitor(new Request('https://radar.test',{headers:{cookie:a.cookie.split(';')[0]}})).owner,a.owner);
});
test('portfolio average cost, partial sale, fees and realized profit are deterministic',()=>{
 const tx=(id,side,quantity,price,fees,tradeDate)=>({id,symbol:'TEST',companyName:'Synthetic',side,quantity,price,fees,tradeDate,createdAt:`${tradeDate}T12:00:00Z`,updatedAt:`${tradeDate}T12:00:00Z`});
 const transactions=[tx('1','buy',10,10,1,'2026-01-01'),tx('2','buy',10,20,1,'2026-01-02'),tx('3','sell',5,30,1,'2026-01-03')];
 const value=calculatePortfolio(transactions,{TEST:{symbol:'TEST',name:'Synthetic',price:25,dailyChange:.02,asOf:'2026-01-04'}});
 assert.equal(value.positions[0].quantity,15);assert.equal(value.positions[0].averageCost,15.1);assert.equal(value.summary.realizedPnl,73.5);assert.equal(value.summary.unrealizedPnl,148.5);assert.equal(value.summary.totalPnl,222);
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
 const now=new Date().toISOString();setHistoryResult({history:[{date:now.slice(0,10),open:10,high:10,low:10,close:10,volume:1000}],splits:[],source:'TEST_ONLY',url:'https://example.test',availableAt:now,retrievedAt:now});
 try { const final=await processScanBatch('scan-test');assert.equal(final.done,true);assert.equal(final.run.stage,13);assert.equal(final.run.processed,1);assert.equal(final.run.status,'complete'); }
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
test('completed result with legacy processed=0 remains selectable; partial never replaces it',async()=>{
 await db().prepare("UPDATE strategy_runs SET processed=0 WHERE id='scan-test'").run();assert.equal((await readState()).dataRunId,'scan-test');
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,stage,strategy_hash) VALUES('partial-test','2026-09-09','2026-09-09','partial','Bulk Quotes/SEC Frames v7 · full',1,13,?)").bind(currentHash()).run();await insertSnapshot('partial-test',{...base,symbol:'PARTIAL'}).run();assert.equal((await readState()).dataRunId,'scan-test');
});
test('API personal favorites start at zero, writes are idempotent and isolated',async()=>{
 await db().prepare("INSERT INTO watchlist(symbol,created_at) VALUES('OLD_SHARED','2026-01-01')").run();
 const initial=await GET(new Request('https://radar.test/api/radar'));assert.equal(initial.status,200);const cookie=initial.headers.get('set-cookie').split(';')[0];assert.deepEqual((await initial.json()).favorites,[]);
 const mutation=(saved)=>POST(new Request('https://radar.test/api/radar',{method:'POST',headers:{origin:'https://radar.test',cookie,'content-type':'application/json'},body:JSON.stringify({action:'favorite',symbol:'TEST',saved})}));
 for(let i=0;i<2;i++){const r=await mutation(true);assert.equal(r.status,200);assert.deepEqual((await r.json()).favorites,['TEST']);}
 const own=await GET(new Request('https://radar.test/api/radar?strategy=favorites',{headers:{cookie}}));assert.equal((await own.json()).snapshots[0].symbol,'TEST');
 const stranger=await GET(new Request('https://radar.test/api/radar?strategy=favorites'));assert.deepEqual((await stranger.json()).favorites,[]);
 for(let i=0;i<2;i++)assert.deepEqual(await (await mutation(false)).json(),{favorites:[]});
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM watchlist').get().n,1);
});
test('API rejects cross-origin and malformed favorite writes',async()=>{
 const cross=await POST(new Request('https://radar.test/api/radar',{method:'POST',headers:{origin:'https://other.test'},body:'{}'}));assert.equal(cross.status,403);
 const invalid=await POST(new Request('https://radar.test/api/radar',{method:'POST',headers:{origin:'https://radar.test'},body:JSON.stringify({action:'favorite',symbol:'BAD!',saved:true})}));assert.equal(invalid.status,400);
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
test('portfolio search is bounded and uses the official bundled directory',async()=>{
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
test('scan report retains rejected and unknown rows, validates paging and never promotes them',async()=>{
 const url='https://radar.test/api/scan-report?runId=scan-test&strategy=core';
 const response=await reportGET(new Request(url));assert.equal(response.status,200);
 const payload=await response.json();assert.equal(payload.counts.total,1);assert.equal(payload.rows[0].symbol,'TEST');assert(payload.blockers.length>0);assert.equal(payload.counts.passed,0);assert.equal(payload.page.hasMore,false);
 assert.equal((await reportGET(new Request(url+'&offset=-1'))).status,400);
 assert.equal((await reportGET(new Request(url.replace('core','bad')))).status,400);
 assert.equal((await reportGET(new Request(url.replace('scan-test','absent')))).status,404);
 assert.equal((await reportGET(new Request(url+'&offset=25'))).status,200);
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
 const result=await processScanBatch('outage');assert.equal(result.run.status,'partial');assert.equal(result.run.failed,1);assert.equal(result.done,true);assert.equal(result.run.retryPending,0);
 const row=await db().prepare("SELECT payload,evaluation FROM fundamental_snapshots WHERE id='outage:OUTAGE'").first();
 assert.match(row.payload,/Injected provider outage/);assert.equal(JSON.parse(row.evaluation).bounce.screeningQualified,false);
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
  const result=await processScanBatch('rebound-evidence');assert.equal(result.done,true);
  const stored=sqlite.prepare("SELECT payload,evaluation FROM fundamental_snapshots WHERE run_id='rebound-evidence'").get();
  const e=JSON.parse(stored.evaluation);assert.equal(e.bounce.screeningQualified,true,JSON.stringify(e.bounce.checks));assert.equal(e.core.screeningQualified,false);assert.equal(e.core.measurableStatus,'UNKNOWN');
  assert.equal(JSON.parse(stored.payload).splitAdjusted,true);assert.equal(JSON.parse(stored.payload).history,undefined);
 }finally{setHistoryResult(null);}
});

test('history retries recover without double-counting failures or retaining stale errors',async()=>{
 const company={ticker:'OUTAGE',cik:101};
 await db().prepare("UPDATE strategy_runs SET stage=10,status='running',offset=1,failed=1,retry_queue=? WHERE id='outage'").bind(JSON.stringify([{company,attempt:1}])).run();
 const now=new Date().toISOString();
 setHistoryResult({history:[{date:now.slice(0,10),close:10,volume:100}],source:'TEST_ONLY',url:'https://example.test',availableAt:now,retrievedAt:now});
 try{
  const r=await processScanBatch('outage');assert.equal(r.done,true);assert.equal(r.run.failed,0);assert.equal(r.run.status,'complete');assert.equal(r.run.error,null);
  const row=await db().prepare("SELECT payload,evaluation FROM fundamental_snapshots WHERE id='outage:OUTAGE'").first();assert(!row.payload.includes('Injected provider outage'));assert.equal(JSON.parse(row.evaluation).bounce.screeningQualified,false);
 }finally{setHistoryResult(null);}
});
test('concurrent quick/full starts share one durable run before any network call',async()=>{
  await db().prepare("UPDATE strategy_runs SET stage=13,status='complete',lease_until=0 WHERE status='running'").run();
 await db().prepare("UPDATE strategy_runs SET created_at='2000-01-01' WHERE status IN ('complete','partial')").run();
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
  const max=sqlite.prepare("SELECT MAX(length(payload)) AS bytes,COUNT(*) AS pages FROM raw_cache WHERE key LIKE 'universe:large-directory:quotes:%'").get();assert.equal(max.pages,15);assert(max.bytes<1_000_000);
  for(let page=0;page<15;page++){const result=await processScanBatch('large-directory');assert.equal(result.run.stage,page===14?4:1);if(page<14)assert.equal(result.run.offset,(page+1)*1000);}
  assert.equal(sqlite.prepare("SELECT universe FROM strategy_runs WHERE id='large-directory'").get().universe,'paged-v1');
  await db().prepare("UPDATE strategy_runs SET stage=9,offset=1200 WHERE id='large-directory'").run();
  const scored=await processScanBatch('large-directory');assert.equal(scored.run.offset,1400);assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM fundamental_snapshots WHERE run_id='large-directory'").get().n,200);
 }finally{setUniverse([]);}
});

test('radar pages contain only qualified category members and rank scores descending',async()=>{
 await db().prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,processed,stage,strategy_hash) VALUES('ranked-order','2099-01-01','2099-01-01','complete','Bulk Quotes/SEC Frames v10 · full',3,3,13,?)").bind(currentHash()).run();
 await insertSnapshot('ranked-order',{...base,symbol:'RANK-HIGH',name:'High score fixture',marketCap:50e6,return12m:-.2,evSales:1,ps:1,revenueGrowth:.25,operatingMarginTrend:.12,insiderBuyValue:50000,cash:20e6,debt:1e6}).run();
 await insertSnapshot('ranked-order',{...base,symbol:'RANK-LOW',name:'Low score fixture',marketCap:1.8e9,return12m:-.6,evSales:9,ps:9,revenueGrowth:-.2,operatingMarginTrend:-.1,insiderBuyValue:0,cash:1e6,debt:50e6}).run();
 await insertSnapshot('ranked-order',{...base,symbol:'RANK-FAIL',name:'Failed gate fixture',marketCap:5e9,return12m:.4}).run();
 const first=await readState({strategy:'core',limit:1});
 assert.equal(first.summary.total,3);assert.equal(first.summary.coreRanked,2);assert.equal(first.summary.coreFailed,1);assert.equal(first.snapshots.length,1);assert.equal(first.page.hasMore,true);
 const second=await readState({strategy:'core',limit:10,offset:1});assert.equal(second.snapshots.length,1);
 const all=await readState({strategy:'core',limit:10});assert.equal(all.snapshots.length,2);assert.equal(all.snapshots.some(s=>s.symbol==='RANK-FAIL'),false);
 const scores=all.snapshots.map(s=>evaluateStrategy('core',s).score);for(let i=1;i<scores.length;i++){const previous=scores[i-1]??-Infinity;const current=scores[i]??-Infinity;assert(previous>=current)}
 assert.deepEqual([...first.snapshots,...second.snapshots].map(s=>s.symbol),all.snapshots.map(s=>s.symbol));
});
