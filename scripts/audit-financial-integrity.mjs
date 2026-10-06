/** Read-only full-universe integrity audit. Run test:runtime to prepare modules. */
import {peerObservation,peerContext,uniqueIssuerPeers} from '../.test-build/opportunity-peers.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {alignSnapshotFinancials,compatibleSnapshotMetrics} from '../.test-build/financial-integrity.mjs';
import {evaluateOpportunityDossier,opportunityDossierFromSnapshot} from '../.test-build/opportunity-dossier.mjs';
import {applyFinancingRisk} from '../.test-build/financing-risk.mjs';
import {OPPORTUNITY_SPEC} from '../.test-build/opportunity-spec.mjs';
const file=process.argv[2];if(!file)throw Error('Usage: node scripts/audit-financial-integrity.mjs universe.json');
const input=JSON.parse(fs.readFileSync(file,'utf8'));
const report={runId:input.runId,version:OPPORTUNITY_SPEC.version,total:input.rows.length,missingFactors:0,missingFinalGrades:0,sorted:0,modifiedSnapshots:0,recoveredDebt:0,movedContractLiabilities:0,pairs:{},types:{},top:[]};
const grades=[];
const classCounts=new Map();for(const row of input.rows){const s=JSON.parse(row.payload);if(s.securityType==='common'&&Number(s.cik)>0)classCounts.set(Number(s.cik),(classCounts.get(Number(s.cik))??0)+1);}
const peers=uniqueIssuerPeers(input.rows.flatMap(row=>{const p=peerObservation(JSON.parse(row.payload));return p?[p]:[]}));
report.peerModels=0;report.intrinsicModels=0;report.candidateReviews=0;report.researchRequired=0;
for(const row of input.rows){
 const before=JSON.parse(row.payload),after=applyFinancingRisk(alignSnapshotFinancials(before));
 if(Number(after.cik)>0)after.issuerCommonListingCount=classCounts.get(Number(after.cik))??0;
 if(JSON.stringify(before)!==JSON.stringify(after))report.modifiedSnapshots++;
 if(before.debt==null&&after.debt!=null)report.recoveredDebt++;
 if(before.backlog&&!after.backlog&&after.contractLiabilities)report.movedContractLiabilities++;
 for(const [keys,kind] of [[['revenue','fcf'],'flow'],[['revenue','netIncome'],'flow'],[['cash','debt'],'balance']]){
  const key=keys.join('/'),stats=report.pairs[key]??={beforeIncompatible:0,afterIncompatible:0,beforeAvailable:0,afterAvailable:0};
  for(const [stage,snapshot] of [['before',before],['after',after]])if(keys.every(k=>typeof snapshot[k]==='number')){
   stats[`${stage}Available`]++;if(!compatibleSnapshotMetrics(snapshot,keys,kind))stats[`${stage}Incompatible`]++;
  }
 }
 after.peerContext=peerContext(after,peers);if(after.peerContext.grade!=null)report.peerModels++;
 const evaluation=evaluateOpportunityDossier(after,opportunityDossierFromSnapshot(after));
 if(evaluation.thesis.valuation.status==='available')report.intrinsicModels++;
 if(evaluation.thesis.action==='candidate-review')report.candidateReviews++;else report.researchRequired++;
 assert.equal(evaluation.factors.length,8,row.symbol);
 for(const factor of evaluation.factors)assert.ok(Number.isFinite(factor.score)&&factor.score>=0&&factor.score<=10,row.symbol);
 assert.ok(Number.isFinite(evaluation.score)&&evaluation.score>=0&&evaluation.score<=100,row.symbol);
 assert.equal(evaluation.score,Math.round(evaluation.factors.reduce((sum,f)=>sum+Math.round(f.score*100)*f.weight,0)/10)/100,row.symbol);
 assert.equal(evaluation.rankingEligible,true,row.symbol);
 const counts=report.types[after.securityType??'unknown']??={total:0,numeric:0};counts.total++;counts.numeric++;
 grades.push({symbol:row.symbol,score:evaluation.score,type:after.securityType});
}
grades.sort((a,b)=>b.score-a.score||(a.symbol<b.symbol?-1:a.symbol>b.symbol?1:0));
assert.equal(new Set(grades.map(row=>row.symbol)).size,input.rows.length);report.sorted=grades.length;report.top=grades.slice(0,15);
process.stdout.write(JSON.stringify(report,null,2)+'\n');
