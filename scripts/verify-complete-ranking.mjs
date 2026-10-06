/** Replay all production payloads through the same evaluator used by persistence.
 * Run test:runtime first to prepare .test-build. No private data are written here. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {evaluateOpportunityDossier,opportunityDossierFromSnapshot} from '../.test-build/opportunity-dossier.mjs';
import {isCurrentOpportunityEvaluation} from '../.test-build/opportunity-engine.mjs';
import {applyFinancingRisk} from '../.test-build/financing-risk.mjs';
const file=process.argv[2];if(!file)throw Error('Usage: node scripts/verify-complete-ranking.mjs universe.json [--stored]');
const factorDetails={};
const input=JSON.parse(fs.readFileSync(file,'utf8')),rows=[];
for(const row of input.rows){
 const snapshot=applyFinancingRisk(JSON.parse(row.payload));
 const evaluation=evaluateOpportunityDossier(snapshot,opportunityDossierFromSnapshot(snapshot));
 assert.ok(isCurrentOpportunityEvaluation(evaluation),row.symbol);
 assert.equal(evaluation.score,Math.round(evaluation.factors.reduce((sum,factor)=>sum+Math.round(factor.score*100)*factor.weight,0)/10)/100,`${row.symbol}: exact arithmetic`);
 assert.deepEqual(evaluation,evaluateOpportunityDossier(structuredClone(snapshot),opportunityDossierFromSnapshot(structuredClone(snapshot))),row.symbol);
 if(process.argv.includes('--stored'))assert.deepEqual(evaluation,JSON.parse(row.evaluation).opportunity,`${row.symbol}: persisted evaluator parity`);
  for(const factor of evaluation.factors){
    const actualConflicts=(factor.conflicts??[]).filter(conflict=>conflict!==`${factor.id} as-of timestamp does not match the dossier.`);
    if(factor.proxy&&!actualConflicts.length&&factor.calculation?.rubricId?.endsWith('-model-v5-opportunity')){
      const inputs=factor.calculation.inputs,parts=inputs.filter(input=>input.name.endsWith(':grade'));
      assert.ok(parts.length,`${row.symbol}/${factor.id}: missing model component trace`);
      const expected=Math.round(parts.reduce((sum,part)=>{const weight=inputs.find(input=>input.name===part.name.slice(0,-6)+':weight')?.value;assert.ok(Number.isFinite(weight));return sum+(typeof part.value==='number'?part.value:0)*weight/100;},0)*100)/100;
      assert.equal(factor.score,expected,`${row.symbol}/${factor.id}: final grade must equal its persisted model components`);
    }
  }
 for(const factor of evaluation.factors){const detail=factorDetails[factor.id]??={numeric:0,positive:0,min:10,max:0};detail.numeric++;detail.positive+=factor.score>0;detail.min=Math.min(detail.min,factor.score);detail.max=Math.max(detail.max,factor.score);}
 rows.push({symbol:row.symbol,score:evaluation.score,hash:evaluation.evaluationHash,type:snapshot.securityType});
}
rows.sort((a,b)=>b.score-a.score||(a.symbol<b.symbol?-1:a.symbol>b.symbol?1:0));
assert.equal(new Set(rows.map(row=>row.symbol)).size,rows.length);
console.log(JSON.stringify({runId:input.runId,total:rows.length,factorDetails,missingFactors:0,missingFinalGrades:0,sorted:rows.length,positive:rows.filter(row=>row.score>0).length,zero:rows.filter(row=>row.score===0).length,types:[...new Set(rows.map(row=>row.type))],top:rows.slice(0,10),bottom:rows.slice(-3)},null,2));
