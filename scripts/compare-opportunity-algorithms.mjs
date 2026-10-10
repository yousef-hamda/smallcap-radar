/** Frozen-input acceptance comparison. Prepare .test-build with test:runtime.
 * Baseline directory is an independently preserved prior compiled evaluator.
 * Raw inputs stay private/ignored; output contains public aggregate diagnostics.
 * Usage: node scripts/compare-opportunity-algorithms.mjs DATA BASELINE_DIR [REPORT]
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
import {evaluateOpportunityDossier,opportunityDossierFromSnapshot} from '../.test-build/opportunity-dossier.mjs';
import {applyFinancingRisk} from '../.test-build/financing-risk.mjs';
import {alignSnapshotFinancials} from '../.test-build/financial-integrity.mjs';
import {peerObservation,peerContext,uniqueIssuerPeers} from '../.test-build/opportunity-peers.mjs';
import {isCurrentOpportunityEvaluation} from '../.test-build/opportunity-engine.mjs';
import {OPPORTUNITY_SPEC,opportunitySpecHash} from '../.test-build/opportunity-spec.mjs';

const [file,baselineDirectory,output]=process.argv.slice(2);
if(!file||!baselineDirectory)throw Error('Usage: compare-opportunity-algorithms.mjs DATA BASELINE_DIR [REPORT]');
const baseline=await import(pathToFileURL(path.resolve(baselineDirectory,'opportunity-dossier.mjs')));
const baselineFinancing=await import(pathToFileURL(path.resolve(baselineDirectory,'financing-risk.mjs')));
const digest=createHash('sha256');for await(const chunk of fs.createReadStream(file))digest.update(chunk);
const inputHash=digest.digest('hex'),lineFormat=/\.(?:jsonl|ndjson)$/.test(file);
let input;
if(lineFormat){for await(const line of createInterface({input:fs.createReadStream(file),crlfDelay:Infinity})){if(line.trim()){input=JSON.parse(line);break;}}}
else input=JSON.parse(fs.readFileSync(file,'utf8'));
const weights=[25,20,15,12,10,10,5,3];
async function* frozenRows(){
 if(!lineFormat){yield* input.rows;return;}
 let header=true;for await(const line of createInterface({input:fs.createReadStream(file),crlfDelay:Infinity})){if(!line.trim())continue;if(header){header=false;continue;}yield JSON.parse(line);}
}
assert.deepEqual(OPPORTUNITY_SPEC.factors.map(f=>f.weight),weights);
assert.ok(lineFormat?input.rowCount:input.rows?.length,'No frozen input rows');
const rows=[],factorChanges=Object.fromEntries(OPPORTUNITY_SPEC.factors.map(f=>[f.id,{weight:f.weight,increased:0,decreased:0,unchanged:0,totalDelta:0,beforePositive:0,afterPositive:0}]));
let savedBaselineParity=0,changed=0,reviewedBefore=0,reviewedAfter=0,traceChecks=0,normalizationIdempotence=0;
const evaluate=s=>evaluateOpportunityDossier(s,opportunityDossierFromSnapshot(s));
const classCounts=new Map(),peerRows=[];
for await(const row of frozenRows()){const raw=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;if(raw.securityType==='common'&&raw.cik)classCounts.set(raw.cik,(classCounts.get(raw.cik)??0)+1);const peer=peerObservation(raw);if(peer)peerRows.push(peer);}
const peers=uniqueIssuerPeers(peerRows);
let index=0,baselineVersion=null;const asOfDates=new Set();
for await(const row of frozenRows()){
 const raw=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;
 assert.equal(raw.symbol,row.symbol);
 const priorSnapshot=baselineFinancing.applyFinancingRisk(structuredClone(raw));
 const prior=baseline.evaluateOpportunityDossier(priorSnapshot,baseline.opportunityDossierFromSnapshot(priorSnapshot));
 const stored=typeof row.evaluation==='string'?JSON.parse(row.evaluation):row.evaluation;
 baselineVersion??=stored?.opportunity?.version;asOfDates.add(raw.asOf);
 if(stored?.opportunity){assert.deepEqual(prior,stored.opportunity,`${row.symbol}: frozen baseline mismatch`);savedBaselineParity++;}
 const snapshot=applyFinancingRisk(alignSnapshotFinancials(structuredClone(raw)));
 if(Number.isSafeInteger(snapshot.cik)&&snapshot.cik>0)snapshot.issuerCommonListingCount=classCounts.get(snapshot.cik)??0;
 snapshot.peerContext=peerContext(snapshot,peers);
 const next=evaluate(snapshot);
 assert.ok(isCurrentOpportunityEvaluation(next),`${row.symbol}: invalid candidate`);
 assert.equal(next.asOf,prior.asOf,`${row.symbol}: changed factual cutoff`);
 assert.deepEqual(next.factors.map(f=>f.weight),weights);
 const expected=Math.round(next.factors.reduce((n,f)=>n+Math.round(f.score*100)*f.weight,0)/10)/100;
 assert.equal(next.score,expected,`${row.symbol}: arithmetic`);
 const causes=[];
 for(const [i,factor]of next.factors.entries()){
  const old=prior.factors[i],detail=factorChanges[factor.id],delta=Number((factor.score-old.score).toFixed(2));
  assert.equal(factor.id,old.id);assert.ok(factor.score>=0&&factor.score<=10);
  detail[delta>0?'increased':delta<0?'decreased':'unchanged']++;detail.totalDelta+=delta;
  detail.beforePositive+=old.score>0;detail.afterPositive+=factor.score>0;
  reviewedBefore+=old.evidenced&&!old.proxy;reviewedAfter+=factor.evidenced&&!factor.proxy;
  if(delta)causes.push({factor:factor.id,before:old.score,after:factor.score});
  if(factor.proxy&&!factor.conflicts.length){
   const components=factor.calculation.inputs.filter(i=>i.name.endsWith(':grade'));
   assert.ok(components.length,`${row.symbol}/${factor.id}: no components`);
   const grade=Math.round(components.reduce((n,c)=>{const w=factor.calculation.inputs.find(i=>i.name===c.name.slice(0,-6)+':weight')?.value;assert.ok(Number.isFinite(w));return n+(typeof c.value==='number'?c.value:0)*w/100;},0)*100)/100;
   assert.equal(factor.score,grade,`${row.symbol}/${factor.id}: independent component reconstruction`);traceChecks++;
  }
 }
 if(causes.length)changed++;
 if(index%75===0||causes.length&&index<100){
  const again=applyFinancingRisk(alignSnapshotFinancials(structuredClone(snapshot)));
  assert.deepEqual(evaluate(again),next,`${row.symbol}: normalization/review must be idempotent`);normalizationIdempotence++;
  const renamed=evaluate({...snapshot,symbol:'IDENTITY-CONTROL',name:'Synthetic name control'});
  assert.deepEqual(renamed.factors.map(f=>[f.score,f.weight,f.points]),next.factors.map(f=>[f.score,f.weight,f.points]),`${row.symbol}: identifier independence`);
 }
 rows.push({symbol:row.symbol,before:prior.score,after:next.score,delta:Number((next.score-prior.score).toFixed(2)),causes,type:raw.securityType??'unknown',sector:raw.sector??'unknown',cap:raw.marketCap??null,valuation:next.thesis.valuation.status==='available',beforeValuation:prior.thesis.valuation.status==='available',sourceEligible:next.sourceEligible});
 if((index+1)%1000===0)process.stderr.write(`Compared ${index+1}/${lineFormat?input.rowCount:input.rows.length}\n`);
 index++;
}
assert.equal(new Set(rows.map(r=>r.symbol)).size,rows.length,'Duplicate symbols');
assert.equal(rows.length,lineFormat?input.rowCount:input.rows.length,'Frozen universe is truncated');
assert.equal(savedBaselineParity,rows.length,'Every frozen row must have a verified saved baseline');
const binary=(a,b)=>a.symbol<b.symbol?-1:a.symbol>b.symbol?1:0;
const before=[...rows].sort((a,b)=>b.before-a.before||binary(a,b)),after=[...rows].sort((a,b)=>b.after-a.after||binary(a,b));
const rankBefore=new Map(before.map((r,i)=>[r.symbol,i+1]));
after.forEach((r,i)=>{r.rankBefore=rankBefore.get(r.symbol);r.rankAfter=i+1;r.rankChange=r.rankBefore-r.rankAfter;});
const groupSummary=list=>{const types={},sectors={};for(const r of list){types[r.type]=(types[r.type]??0)+1;sectors[r.sector]=(sectors[r.sector]??0)+1;}return{count:list.length,types,sectors,missingCapitalization:list.filter(r=>r.cap===null).length,below5B:list.filter(r=>r.cap!==null&&r.cap<5e9).length,atLeast5B:list.filter(r=>r.cap!==null&&r.cap>=5e9).length};};
const topSets=Object.fromEntries([20,100,Math.ceil(rows.length/10)].map(n=>{const previous=new Set(before.slice(0,n).map(r=>r.symbol));return[n,{overlap:after.slice(0,n).filter(r=>previous.has(r.symbol)).length,before:groupSummary(before.slice(0,n)),after:groupSummary(after.slice(0,n))}];}));
const publicChange=r=>({symbol:r.symbol,before:r.before,after:r.after,delta:r.delta,rankBefore:r.rankBefore,rankAfter:r.rankAfter,causes:r.causes});
const cutoffs=[...asOfDates].sort();
const report={status:'PASS',cutoffDate:'2026-10-08',input:{sha256:inputHash,runId:input.runId,rows:rows.length,asOf:{distinct:cutoffs.length,first:cutoffs[0],last:cutoffs.at(-1)}},baseline:{version:baselineVersion,savedParity:savedBaselineParity},candidate:{version:OPPORTUNITY_SPEC.version,rubricHash:opportunitySpecHash()},weights,acceptance:{numericFactors:rows.length*8,missingFactors:0,missingFinalGrades:0,retainedListings:rows.length,sortedListings:rows.length,independentComponentChecks:traceChecks,normalizationAndIdentifierControls:normalizationIdempotence,scoreSort:'descending, symbol BINARY ascending',predictiveClaim:false},changes:{changed,unchanged:rows.length-changed,increased:rows.filter(r=>r.delta>0).length,decreased:rows.filter(r=>r.delta<0).length,beforeZero:rows.filter(r=>r.before===0).length,afterZero:rows.filter(r=>r.after===0).length,factors:factorChanges,reviewedFactorCountBefore:reviewedBefore,reviewedFactorCountAfter:reviewedAfter},topSets,largestIncreases:[...rows].sort((a,b)=>b.delta-a.delta||binary(a,b)).slice(0,20).map(publicChange),largestDecreases:[...rows].sort((a,b)=>a.delta-b.delta||binary(a,b)).slice(0,20).map(publicChange),top20:after.slice(0,20).map(publicChange),limitations:['A single contemporary acquisition release cannot establish six-month realized outcomes or predictive improvement.','Source acquisition fixes are validated separately; this replay never invents newly acquired facts.','Complete numeric grades do not imply reviewed catalysts, fully diluted value, governance diligence or trading safety.','Composition by capitalization and sector is descriptive; no size or sector quota changes the ranking.']};
for(const detail of Object.values(factorChanges))detail.totalDelta=Number(detail.totalDelta.toFixed(2));
if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
