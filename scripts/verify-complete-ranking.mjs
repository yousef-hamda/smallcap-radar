/** Replay all production payloads through the same evaluator used by persistence.
 * Run test:runtime first to prepare .test-build. No private data are written here. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {evaluateOpportunityDossier,opportunityDossierFromSnapshot} from '../.test-build/opportunity-dossier.mjs';
import {isCurrentOpportunityEvaluation} from '../.test-build/opportunity-engine.mjs';
import {applyFinancingRisk} from '../.test-build/financing-risk.mjs';
const file=process.argv[2];if(!file)throw Error('Usage: node scripts/verify-complete-ranking.mjs universe.json [--stored]');
const input=JSON.parse(fs.readFileSync(file,'utf8')),rows=[];
for(const row of input.rows){
 const snapshot=applyFinancingRisk(JSON.parse(row.payload));
 const evaluation=evaluateOpportunityDossier(snapshot,opportunityDossierFromSnapshot(snapshot));
 assert.ok(isCurrentOpportunityEvaluation(evaluation),row.symbol);
 assert.equal(evaluation.score,Math.round(evaluation.factors.reduce((sum,factor)=>sum+Math.round(factor.score*100)*factor.weight,0)/10)/100,`${row.symbol}: exact arithmetic`);
 assert.deepEqual(evaluation,evaluateOpportunityDossier(structuredClone(snapshot),opportunityDossierFromSnapshot(structuredClone(snapshot))),row.symbol);
 if(process.argv.includes('--stored'))assert.deepEqual(evaluation,JSON.parse(row.evaluation).opportunity,`${row.symbol}: persisted evaluator parity`);
 rows.push({symbol:row.symbol,score:evaluation.score,hash:evaluation.evaluationHash,type:snapshot.securityType});
}
rows.sort((a,b)=>b.score-a.score||(a.symbol<b.symbol?-1:a.symbol>b.symbol?1:0));
assert.equal(new Set(rows.map(row=>row.symbol)).size,rows.length);
console.log(JSON.stringify({runId:input.runId,total:rows.length,missingFactors:0,missingFinalGrades:0,sorted:rows.length,positive:rows.filter(row=>row.score>0).length,zero:rows.filter(row=>row.score===0).length,types:[...new Set(rows.map(row=>row.type))],top:rows.slice(0,10),bottom:rows.slice(-3)},null,2));
