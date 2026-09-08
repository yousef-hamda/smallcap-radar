import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {sqlite} from './env.mjs';
import {scanProgress} from '../../.test-build/scan-progress.mjs';
import {visitor} from '../../.test-build/visitor.mjs';
import {numeric} from '../../.test-build/providers.mjs';
import {evaluateStrategy} from '../../.test-build/engine.mjs';
import {fixtures} from '../../.test-build/fixtures.mjs';
import {ensureSchema,db,currentHash,readState,insertSnapshot} from '../../.test-build/storage.mjs';
import {processScanBatch,bounceHistoryCandidate,historyCandidate} from '../../.test-build/scanner.mjs';
import {GET,POST} from '../../.test-build/radar-api.mjs';
await ensureSchema();
sqlite.exec(await fs.readFile('drizzle/0003_solid_spot.sql','utf8'));
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
test('source conflict prevents both screening and final qualification',()=>{for(const strategy of ['core','bounce']){const e=evaluateStrategy(strategy,{...base,sourceConflicts:['injected conflict']});assert.equal(e.screeningQualified,false);assert.equal(e.status,'FAIL');assert.equal(e.finalRanked,false)}});
test('visitor isolation and cookie flags',()=>{
 const a=visitor(new Request('https://radar.test')),b=visitor(new Request('https://radar.test'));assert.notEqual(a.owner,b.owner);assert.match(a.cookie,/HttpOnly; SameSite=Lax; Secure/);assert.equal(visitor(new Request('https://radar.test',{headers:{cookie:a.cookie.split(';')[0]}})).owner,a.owner);
});
test('stage9 must hand off stage10 without completion or lost processed count',async()=>{
 await db().prepare('INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,universe,stage,strategy_hash) VALUES(?,?,?,?,?,?,?,?,?)').bind('scan-test','2026-09-08T00:00:00Z','2026-09-08T00:00:00Z','running','Bulk Quotes/SEC Frames v7 · full',1,JSON.stringify([{ticker:'TEST',name:'Synthetic test only',cik:99,exchange:'Nasdaq',marketCap:1e9,price:10}]),9,currentHash()).run();
 const result=await processScanBatch('scan-test');assert.equal(result.done,false);assert.equal(result.run.stage,10);assert.equal(result.run.offset,0);assert.equal(result.run.processed,1);assert.equal(result.run.status,'running');
 const final=await processScanBatch('scan-test');assert.equal(final.done,true);assert.equal(final.run.stage,13);assert.equal(final.run.processed,1);assert.equal(final.run.status,'complete');
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
test('live lease prevents a duplicate batch',async()=>{await db().prepare("UPDATE strategy_runs SET status='running',stage=10,offset=0,lease_until=? WHERE id='scan-test'").bind(Date.now()+60000).run();const r=await processScanBatch('scan-test');assert.equal(r.busy,true);assert.equal(r.done,false)});

test('provider outage finishes partial, preserves row and never manufactures history',async()=>{
 const company={ticker:'OUTAGE',name:'Synthetic outage fixture',cik:101,exchange:'Nasdaq',marketCap:100e6,price:10};
 await db().prepare('INSERT INTO strategy_runs(id,created_at,updated_at,status,source,total,universe,stage,strategy_hash) VALUES(?,?,?,?,?,?,?,?,?)').bind('outage','2026-09-10','2026-09-10','running','Bulk Quotes/SEC Frames v7 · full',1,JSON.stringify([company]),10,currentHash()).run();
 await insertSnapshot('outage',{...base,symbol:'OUTAGE',marketCap:100e6,price:10,return12m:-.5,low52w:5,ma30w:null,medianDollarVolume20d:null}).run();
 const result=await processScanBatch('outage');assert.equal(result.run.status,'partial');assert.equal(result.run.failed,1);assert.equal(result.done,true);
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
