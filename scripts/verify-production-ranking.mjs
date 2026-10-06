/** Run inside the deployed service. Compares every production record against
 * live HTTP radar, report and company handlers, plus the durable rank table.
 * Emits counts only; never prints private tables, host secrets or source data. */
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const directory='/app/data/state/v3/d1/miniflare-D1DatabaseObject';
const databasePath=process.argv[2]??`${directory}/${readdirSync(directory).find(name=>name.endsWith('.sqlite')&&name!=='metadata.sqlite')}`;
const base=process.argv[3]??`http://127.0.0.1:${process.env.PORT??8080}`;
const database=new DatabaseSync(databasePath,{readOnly:true});
const run=database.prepare("SELECT id FROM strategy_runs r WHERE status IN ('complete','partial') AND (stage>=13 OR source='import') AND EXISTS(SELECT 1 FROM fundamental_snapshots s WHERE s.run_id=r.id) ORDER BY CASE WHEN source LIKE '%· full' THEN 0 ELSE 1 END,updated_at DESC,created_at DESC LIMIT 1").get();
const warmResponse=await fetch(base+'/api/radar?limit=1&runId='+encodeURIComponent(run.id),{signal:AbortSignal.timeout(180000)});assert.equal(warmResponse.status,200);await warmResponse.json();
const rows=database.prepare('SELECT s.symbol,s.evaluation,r.score,r.rank_position,r.evaluation_hash FROM fundamental_snapshots s JOIN opportunity_rankings r ON r.run_id=s.run_id AND r.symbol=s.symbol WHERE s.run_id=? ORDER BY r.rank_position').all(run.id);
const factorGrades=new Map();
const total=database.prepare('SELECT COUNT(*) AS n FROM fundamental_snapshots WHERE run_id=?').get(run.id).n;
assert.equal(rows.length,total);
// Independently count raw official non-ETF/non-test rows, including alternate
// Nasdaq symbols and every exchange code. A selected run count alone is not
// evidence that the universe is complete.
const officialUrls=['https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt','https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'];
let officialFiles,officialMethod='live official URLs',officialRetrievedAt=new Date().toISOString();
try{officialFiles=await Promise.all(officialUrls.map(async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200,url);const text=await response.text();assert.match(text,/(?:^|\n)File Creation Time:/);return text;}));}
catch{
 const raw=JSON.parse(readFileSync(new URL('../lib/listing-directory-sources.generated.json',import.meta.url),'utf8'));
 officialFiles=raw.files.map((body,index)=>{const text=gunzipSync(Buffer.from(body,'base64')).toString();assert.equal(createHash('sha256').update(text).digest('hex'),raw.sources[index].contentHash);assert.equal(raw.sources[index].url,officialUrls[index]);assert.match(text,/(?:^|\n)File Creation Time:/);return text;});
 officialMethod='checksum-verified complete official downloads';officialRetrievedAt=raw.retrievedAt;
}

const officialSymbols=new Set();
for(const [fileIndex,text]of officialFiles.entries())for(const line of text.split(/\r?\n/).slice(1)){
 const c=line.split('|');if(c.length<8||c[fileIndex===0?3:6]==='Y'||c[fileIndex===0?6:4]==='Y'||line.startsWith('File Creation Time:'))continue;
 const valid=value=>/^[A-Z][A-Z0-9.^-]{0,15}$/.test(value??'');const symbol=valid(c[0])?c[0]:fileIndex===1&&valid(c[7])?c[7]:null;assert.ok(symbol,`Unrepresentable official issue: ${c[0]}`);officialSymbols.add(symbol);
}
const savedSymbols=new Set(rows.map(row=>row.symbol));for(const symbol of officialSymbols)assert.ok(savedSymbols.has(symbol),`Official listed stock missing from ranking: ${symbol}`);
const previousRun=database.prepare("SELECT id FROM strategy_runs r WHERE id<>? AND status IN ('complete','partial') AND stage>=13 AND source LIKE 'Bulk Quotes/%· full' AND EXISTS(SELECT 1 FROM fundamental_snapshots s WHERE s.run_id=r.id) ORDER BY updated_at DESC,created_at DESC LIMIT 1").get(run.id);
const previousSymbols=previousRun?database.prepare('SELECT symbol FROM fundamental_snapshots WHERE run_id=?').all(previousRun.id).map(row=>row.symbol):[];
for(const symbol of previousSymbols)assert.ok(savedSymbols.has(symbol),`Previously tracked stock disappeared: ${symbol}`);
const extras=rows.filter(row=>!officialSymbols.has(row.symbol));for(const row of extras){const payload=JSON.parse(database.prepare('SELECT payload FROM fundamental_snapshots WHERE run_id=? AND symbol=?').get(run.id,row.symbol).payload);assert.equal(payload.listingStatus,'not-confirmed-current',row.symbol);assert.equal(row.score,0,row.symbol);}
console.log(JSON.stringify({stage:'inventory',officialMethod,officialRetrievedAt,officialListed:officialSymbols.size,previousTracked:previousSymbols.length,retainedUnconfirmed:extras.length,total,missingOfficial:0,missingPreviouslyTracked:0}));
const bySymbol=new Map();const weights=[25,20,15,12,10,10,5,3],factorIds=['valuation','catalysts','financialStrength','earningsQuality','competitivePosition','downsideRisk','management','technicalTiming'];
for(const [index,row] of rows.entries()){
 const evaluation=JSON.parse(row.evaluation).opportunity;
 assert.equal(evaluation.state,'ranked');assert.equal(evaluation.rankingEligible,true);assert.equal(evaluation.factors.length,8);assert.equal(evaluation.score,row.score);assert.equal(evaluation.evaluationHash,row.evaluation_hash);assert.equal(row.rank_position,index+1);
  for(const factor of evaluation.factors){
    const actualConflicts=(factor.conflicts??[]).filter(conflict=>conflict!==`${factor.id} as-of timestamp does not match the dossier.`);
    if(factor.proxy&&!actualConflicts.length&&factor.calculation?.rubricId?.endsWith('-model-v5-opportunity')){
      const inputs=factor.calculation.inputs,parts=inputs.filter(input=>input.name.endsWith(':grade'));
      assert.ok(parts.length,`${row.symbol}/${factor.id}: missing model component trace`);
      const expected=Math.round(parts.reduce((sum,part)=>{const weight=inputs.find(input=>input.name===part.name.slice(0,-6)+':weight')?.value;assert.ok(Number.isFinite(weight));return sum+(typeof part.value==='number'?part.value:0)*weight/100;},0)*100)/100;
      assert.equal(factor.score,expected,`${row.symbol}/${factor.id}: final grade must equal its persisted model components`);
    }
  }
 for(const [factorIndex,factor] of evaluation.factors.entries()){
  const signal=factorGrades.get(factor.id)??new Set();signal.add(factor.score);factorGrades.set(factor.id,signal);
  assert.equal(factor.id,factorIds[factorIndex]);assert.equal(factor.weight,weights[factorIndex]);assert.ok(Number.isFinite(factor.score)&&factor.score>=0&&factor.score<=10);assert.ok(Math.abs(factor.points-factor.score*factor.weight/10)<1e-8);assert.ok(factor.calculation?.inputs?.length);
 }
 assert.equal(evaluation.score,Math.round(evaluation.factors.reduce((sum,factor)=>sum+Math.round(factor.score*100)*factor.weight,0)/10)/100);
 if(index){const previous=rows[index-1];assert.ok(previous.score>row.score||(previous.score===row.score&&previous.symbol<row.symbol));}
 bySymbol.set(row.symbol,{evaluation,rank:row.rank_position});
}
for(const [id,values]of factorGrades){assert.ok(values.size>1,`${id}: no signal variation in the complete production universe`);assert.ok([...values].some(value=>value>0),`${id}: all grades are zero`);}
async function get(path){const response=await fetch(`${base}${path}`,{signal:AbortSignal.timeout(120000)});assert.equal(response.status,200,path);return response.json();}
const releasePage=await get('/api/radar?limit=1&runId='+encodeURIComponent(run.id));
const pinned='&runId='+encodeURIComponent(run.id)+'&release='+encodeURIComponent(releasePage.release.token);
const radarSeen=new Set(),reportSeen=new Set(),profileSeen=new Set();
function match(symbol,evaluation,rank){const saved=bySymbol.get(symbol);assert.ok(saved,symbol);assert.deepEqual(evaluation,saved.evaluation,symbol);assert.equal(rank,saved.rank,symbol);}
for(let offset=0;offset<total;offset+=250){
 const page=await get(`/api/radar?limit=250&offset=${offset}${pinned}`);assert.equal(page.dataRunId,run.id);assert.equal(page.summary.opportunityRanked,total);assert.equal(page.summary.opportunityNeedsResearch,0);assert.equal(page.summary.opportunityExcluded,0);
 page.snapshots.forEach((snapshot,index)=>{match(snapshot.symbol,page.storedEvaluations[index].opportunity,page.rankPositions[index]);assert.equal(page.rankPositions[index],offset+index+1);radarSeen.add(snapshot.symbol);});
}
console.log(JSON.stringify({stage:'radar',verified:radarSeen.size,total}));
for(let offset=0;offset<total;offset+=25){
 const report=await get(`/api/scan-report?runId=${run.id}&offset=${offset}${pinned}`);assert.equal(report.counts.passed,total);assert.equal(report.counts.failed,0);assert.equal(report.counts.unknown,0);
 report.rows.forEach((row,index)=>{match(row.symbol,row.evaluation,row.rank);assert.equal(row.rank,offset+index+1);reportSeen.add(row.symbol);});
}
console.log(JSON.stringify({stage:'reports',verified:reportSeen.size,total}));
let cursor=0;
await Promise.all(Array.from({length:4},async()=>{
 while(cursor<rows.length){const row=rows[cursor++];const company=await get(`/api/company?symbol=${encodeURIComponent(row.symbol)}${pinned}`);match(row.symbol,company.evaluation,company.ranking.position);assert.equal(company.ranking.runId,run.id);profileSeen.add(row.symbol);if(profileSeen.size%500===0)console.log(JSON.stringify({stage:'profiles',verified:profileSeen.size,total}));}
}));
assert.equal(radarSeen.size,total);assert.equal(reportSeen.size,total);assert.equal(profileSeen.size,total);
const reload=await get('/api/radar?limit=40'+pinned);reload.snapshots.forEach((row,index)=>match(row.symbol,reload.storedEvaluations[index].opportunity,reload.rankPositions[index]));
console.log(JSON.stringify({result:'PASS',runId:run.id,total,missingFactors:0,missingFinalGrades:0,sorted:rows.length,radar:radarSeen.size,reports:reportSeen.size,profiles:profileSeen.size,rankMin:1,rankMax:rows.length,version:bySymbol.values().next().value.evaluation.version,rubricHash:bySymbol.values().next().value.evaluation.hash,positive:rows.filter(row=>row.score>0).length,zero:rows.filter(row=>row.score===0).length,top:rows.slice(0,10).map(row=>({symbol:row.symbol,score:row.score,rank:row.rank_position})),reload:'PASS'}));
