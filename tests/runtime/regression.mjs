import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {sqlite} from './env.mjs';
import {scanProgress} from '../../.test-build/scan-progress.mjs';
import {visitor} from '../../.test-build/visitor.mjs';
import {numeric,parseNews,fetchJson} from '../../.test-build/providers.mjs';
import {reconcile} from '../../.test-build/reconcile.mjs';
import {setHistoryResult,setUniverse,universeCalls,setIntradayResult} from './providers.mjs';
import {evaluateStrategy} from '../../.test-build/engine.mjs';
import {fixtures} from '../../.test-build/fixtures.mjs';
import {ensureSchema,db,currentHash,readState,insertSnapshot} from '../../.test-build/storage.mjs';
import {processScanBatch,startScan,bounceHistoryCandidate,historyCandidate} from '../../.test-build/scanner.mjs';
import {GET,POST} from '../../.test-build/radar-api.mjs';
import {GET as chartGET} from '../../.test-build/chart-api.mjs';
import worker from '../../.test-build/worker.mjs';
import {validPushSubscription} from '../../.test-build/push-validation.mjs';
import {createECDH,randomBytes} from 'node:crypto';
import {fetchBulkFundamentals} from '../../.test-build/bulk.mjs';
import {importSchema} from '../../.test-build/validation.mjs';
import {apiJson} from '../../.test-build/client-json.mjs';
import webpush from 'web-push';
await ensureSchema();
sqlite.exec(await fs.readFile('drizzle/0003_solid_spot.sql','utf8'));
sqlite.exec(await fs.readFile('drizzle/0004_nervous_gressill.sql','utf8'));
sqlite.exec(await fs.readFile('drizzle/0005_freezing_warlock.sql','utf8'));
const base=fixtures[0];
const run=(patch={})=>({id:'test',status:'running',source:'Bulk Quotes/SEC Frames v7 · full',stage:0,offset:0,total:100,processed:0,failed:0,retryPending:0,...patch});
test('progress is monotonic at all full-scan phase transitions',()=>{
 const sequence=[run(),run({stage:4}),run({stage:9}),run({stage:9,offset:100}),run({stage:10}),run({stage:10,offset:99}),run({stage:10,offset:100}),run({stage:13,offset:100,status:'complete'})].map(s=>scanProgress(s).percent);
 assert(sequence.every((n,i)=>i===0||n>=sequence[i-1]));assert.equal(sequence.at(-1),100);assert(sequence.slice(0,-1).every(n=>n<100));
});
test('partial, failed, empty and active retry runs never claim 100%',()=>{
 for(const r of [null,run({stage:13,offset:100,status:'partial',failed:1}),run({stage:10,offset:100,status:'failed'}),run({stage:13,offset:100,retryPending:1}),run({stage:4,total:0})])assert(scanProgress(r).percent<100);
});
test('missing numeric provider fields stay null, while actual zero is zero',()=>{for(const n of [null,undefined,'','  ','N/A','--',NaN,Infinity,false,{},[]])assert.equal(numeric(n),null);assert.equal(numeric('$1,234.50'),1234.5);assert.equal(numeric('0'),0)});
test('ten-day volume proxy cannot reject a historical candidate',()=>{
 const s={...base,securityType:'common',marketCap:100e6,price:10,return12m:-.5,low52w:5,averageVolume10d:0};assert(bounceHistoryCandidate(s));assert(historyCandidate(s));assert(historyCandidate({...s,averageVolume10d:undefined}));
});
test('source conflict prevents both screening and final qualification',()=>{for(const strategy of ['core','bounce']){const e=evaluateStrategy(strategy,{...base,sourceConflicts:['injected conflict']});assert.equal(e.screeningQualified,false);assert.equal(e.status,'UNKNOWN');assert.equal(e.finalRanked,false)}});
test('visitor isolation and cookie flags',()=>{
 const a=visitor(new Request('https://radar.test')),b=visitor(new Request('https://radar.test'));assert.notEqual(a.owner,b.owner);assert.match(a.cookie,/HttpOnly; SameSite=Lax; Secure/);assert.equal(visitor(new Request('https://radar.test',{headers:{cookie:a.cookie.split(';')[0]}})).owner,a.owner);
});
test('stage9 persists rows and hands only history candidates to stage10',async()=>{
 await db().prepare('INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,universe,stage,strategy_hash) VALUES(?,?,?,?,?,?,?,?,?)').bind('scan-test','2026-09-08T00:00:00Z','2026-09-08T00:00:00Z','running','Bulk Quotes/SEC Frames v7 · full',1,JSON.stringify([{ticker:'TEST',name:'Synthetic test only',cik:99,exchange:'Nasdaq',marketCap:1e9,price:10}]),9,currentHash()).run();
 const result=await processScanBatch('scan-test');assert.equal(result.done,false);assert.equal(result.run.stage,10);assert.equal(result.run.offset,0);assert.equal(result.run.total,0);assert.equal(result.run.processed,0);assert.equal(result.run.status,'running');
 assert.equal((await db().prepare("SELECT COUNT(*) AS n FROM fundamental_snapshots WHERE run_id='scan-test'").first()).n,1);
 const final=await processScanBatch('scan-test');assert.equal(final.done,true);assert.equal(final.run.stage,13);assert.equal(final.run.processed,0);assert.equal(final.run.status,'complete');
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
test('client API parser translates HTML route failures instead of leaking JSON syntax errors',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response('<!DOCTYPE html><title>error</title>',{status:503,headers:{'content-type':'text/html'}});
  await assert.rejects(apiJson('/api/test'),error=>/استجابة غير صالحة/.test(error.message)&&!/Unexpected token/.test(error.message));
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
