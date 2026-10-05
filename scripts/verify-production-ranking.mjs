/** Run inside the deployed service. Compares every production record against
 * live HTTP radar, report and company handlers, plus the durable rank table.
 * Emits counts only; never prints private tables, host secrets or source data. */
import {DatabaseSync} from 'node:sqlite';
import {readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const directory='/app/data/state/v3/d1/miniflare-D1DatabaseObject';
const databasePath=process.argv[2]??`${directory}/${readdirSync(directory).find(name=>name.endsWith('.sqlite')&&name!=='metadata.sqlite')}`;
const base=process.argv[3]??`http://127.0.0.1:${process.env.PORT??8080}`;
const database=new DatabaseSync(databasePath,{readOnly:true});
const run=database.prepare("SELECT id FROM strategy_runs r WHERE status IN ('complete','partial') AND (stage>=13 OR source='import') AND EXISTS(SELECT 1 FROM fundamental_snapshots s WHERE s.run_id=r.id) ORDER BY CASE WHEN source LIKE '%· full' THEN 0 ELSE 1 END,CASE WHEN status='complete' THEN 0 ELSE 1 END,created_at DESC LIMIT 1").get();
const rows=database.prepare('SELECT s.symbol,s.evaluation,r.score,r.rank_position,r.evaluation_hash FROM fundamental_snapshots s JOIN opportunity_rankings r ON r.run_id=s.run_id AND r.symbol=s.symbol WHERE s.run_id=? ORDER BY r.rank_position').all(run.id);
const total=database.prepare('SELECT COUNT(*) AS n FROM fundamental_snapshots WHERE run_id=?').get(run.id).n;
assert.equal(rows.length,total);
const bySymbol=new Map();const weights=[25,20,15,12,10,10,5,3];
for(const [index,row] of rows.entries()){
 const evaluation=JSON.parse(row.evaluation).opportunity;
 assert.equal(evaluation.state,'ranked');assert.equal(evaluation.rankingEligible,true);assert.equal(evaluation.factors.length,8);assert.equal(evaluation.score,row.score);assert.equal(evaluation.evaluationHash,row.evaluation_hash);assert.equal(row.rank_position,index+1);
 for(const [factorIndex,factor] of evaluation.factors.entries()){
  assert.equal(factor.weight,weights[factorIndex]);assert.ok(Number.isFinite(factor.score)&&factor.score>=0&&factor.score<=10);assert.ok(Math.abs(factor.points-factor.score*factor.weight/10)<1e-8);assert.ok(factor.calculation?.inputs?.length);
 }
 assert.equal(evaluation.score,Math.round(evaluation.factors.reduce((sum,factor)=>sum+factor.score*factor.weight/10,0)*100)/100);
 if(index){const previous=rows[index-1];assert.ok(previous.score>row.score||(previous.score===row.score&&previous.symbol<row.symbol));}
 bySymbol.set(row.symbol,{evaluation,rank:row.rank_position});
}
async function get(path){const response=await fetch(`${base}${path}`,{signal:AbortSignal.timeout(120000)});assert.equal(response.status,200,path);return response.json();}
const radarSeen=new Set(),reportSeen=new Set(),profileSeen=new Set();
function match(symbol,evaluation,rank){const saved=bySymbol.get(symbol);assert.ok(saved,symbol);assert.deepEqual(evaluation,saved.evaluation,symbol);assert.equal(rank,saved.rank,symbol);}
for(let offset=0;offset<total;offset+=250){
 const page=await get(`/api/radar?limit=250&offset=${offset}`);assert.equal(page.dataRunId,run.id);assert.equal(page.summary.opportunityRanked,total);assert.equal(page.summary.opportunityNeedsResearch,0);assert.equal(page.summary.opportunityExcluded,0);
 page.snapshots.forEach((snapshot,index)=>{match(snapshot.symbol,page.storedEvaluations[index].opportunity,page.rankPositions[index]);assert.equal(page.rankPositions[index],offset+index+1);radarSeen.add(snapshot.symbol);});
}
console.log(JSON.stringify({stage:'radar',verified:radarSeen.size,total}));
for(let offset=0;offset<total;offset+=25){
 const report=await get(`/api/scan-report?runId=${run.id}&offset=${offset}`);assert.equal(report.counts.passed,total);assert.equal(report.counts.failed,0);assert.equal(report.counts.unknown,0);
 report.rows.forEach((row,index)=>{match(row.symbol,row.evaluation,row.rank);assert.equal(row.rank,offset+index+1);reportSeen.add(row.symbol);});
}
console.log(JSON.stringify({stage:'reports',verified:reportSeen.size,total}));
let cursor=0;
await Promise.all(Array.from({length:4},async()=>{
 while(cursor<rows.length){const row=rows[cursor++];const company=await get(`/api/company?symbol=${encodeURIComponent(row.symbol)}`);match(row.symbol,company.evaluation,company.ranking.position);assert.equal(company.ranking.runId,run.id);profileSeen.add(row.symbol);if(profileSeen.size%500===0)console.log(JSON.stringify({stage:'profiles',verified:profileSeen.size,total}));}
}));
assert.equal(radarSeen.size,total);assert.equal(reportSeen.size,total);assert.equal(profileSeen.size,total);
const reload=await get('/api/radar?limit=40');reload.snapshots.forEach((row,index)=>match(row.symbol,reload.storedEvaluations[index].opportunity,reload.rankPositions[index]));
console.log(JSON.stringify({result:'PASS',runId:run.id,total,missingFactors:0,missingFinalGrades:0,sorted:rows.length,radar:radarSeen.size,reports:reportSeen.size,profiles:profileSeen.size,rankMin:1,rankMax:rows.length,version:bySymbol.values().next().value.evaluation.version,rubricHash:bySymbol.values().next().value.evaluation.hash,positive:rows.filter(row=>row.score>0).length,zero:rows.filter(row=>row.score===0).length,top:rows.slice(0,10).map(row=>({symbol:row.symbol,score:row.score,rank:row.rank_position})),reload:'PASS'}));
