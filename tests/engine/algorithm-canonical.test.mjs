import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateOpportunity, isCurrentOpportunityEvaluation, isOpportunityProvenanceValid, opportunityWeightedScore} from '../../.test-build/opportunity-engine.mjs';
import {proxyOpportunityEvidence} from '../../.test-build/opportunity-proxies.mjs';
import {currentOpportunityEvaluation} from '../../.test-build/opportunity-dossier.mjs';

const asOf='2026-09-30T22:00:00Z';
const source={source:'Synthetic official filing',url:'https://example.test/filing',periodEnd:'2026-06-30',availableAt:'2026-08-01T00:00:00Z',retrievedAt:'2026-09-30T21:00:00Z',currency:'USD',rightsStatus:'redistribution-permitted'};
const snapshot=()=>({symbol:'TEST',name:'Synthetic',securityType:'common',exchange:'Nasdaq',asOf,provenance:{securityType:source,exchange:source}});
const reviewed=(sources=[source])=>({score:10,coveragePct:100,rationale:'Synthetic sourced review',sources,calculation:{rubricId:'test-review',inputs:[{name:'review',value:10}]}});

test('a supplied proxy cannot invent scores, component weights, coverage or provenance',()=>{
 const s=snapshot(),expected=evaluateOpportunity(s);
 const spoof=Object.fromEntries(expected.factors.map(f=>[f.id,{...reviewed(),proxy:true}]));
 const actual=evaluateOpportunity(s,spoof);
 assert.equal(actual.score,0);
 assert.deepEqual(actual.factors.map(f=>[f.score,f.coveragePct,f.calculation]),expected.factors.map(f=>[f.score,f.coveragePct,f.calculation]));
 const models=proxyOpportunityEvidence(s);
 assert.deepEqual(actual.factors.map(f=>f.sources),actual.factors.map(f=>models[f.id].sources));
});

test('reviewed credit cannot discard invalid source dependencies and still claim complete evidence',()=>{
 const s=snapshot(),valid=evaluateOpportunity(s,{valuation:reviewed()});
 assert.equal(valid.factors[0].score,10);
 for(const bad of [{...source,availableAt:'2027-01-01'}, {...source,retrievedAt:'2027-01-01'}, {...source,url:'http://example.test/filing'}, {...source,rightsStatus:'restricted'}]){
  const result=evaluateOpportunity(s,{valuation:reviewed([source,bad])});
  assert.equal(result.factors[0].score,0);
  assert.equal(result.factors[0].coveragePct,0);
  assert.equal(result.factors[0].complete,false);
 }
});

test('derived reviewed sources validate their entire dependency tree, including dates, rights and cycles',()=>{
 assert.equal(isOpportunityProvenanceValid({...source,dependencies:[source]},asOf),true);
 for(const dependency of [{...source,availableAt:'2027-01-01'}, {...source,retrievedAt:'2027-01-01'}, {...source,periodEnd:'2027-01-01'}, {...source,rightsStatus:'restricted'}]){
  assert.equal(isOpportunityProvenanceValid({...source,dependencies:[dependency]},asOf),false);
 }
 const cycle={...source};cycle.dependencies=[cycle];
 assert.equal(isOpportunityProvenanceValid(cycle,asOf),false);
});

test('unresolved snapshot conflict cannot be overridden by a supplied reviewed grade',()=>{
 const result=evaluateOpportunity({...snapshot(),sourceConflicts:['Unresolved capitalization disagreement']},{valuation:reviewed()});
 assert.equal(result.factors[0].score,0);assert.equal(result.sourceEligible,false);assert.equal(result.state,'ranked');
});

test('ticker and issuer labels do not determine factor grades or their fixed weights',()=>{
 const first=evaluateOpportunity(snapshot(),{valuation:reviewed()}),second=evaluateOpportunity({...snapshot(),symbol:'ZZZZ',name:'Another label'}, {valuation:reviewed()});
 assert.deepEqual(first.factors.map(f=>[f.id,f.score,f.weight,f.points]),second.factors.map(f=>[f.id,f.score,f.weight,f.points]));
 assert.deepEqual(first.factors.map(f=>f.weight),[25,20,15,12,10,10,5,3]);
 assert.equal(first.score,opportunityWeightedScore(first.factors));
});

test('same-cutoff source changes invalidate saved evaluation reuse and explicit dossiers are reassessed',()=>{
 const s=snapshot(),saved=currentOpportunityEvaluation(s);
 assert.equal(currentOpportunityEvaluation(s,saved),saved);
 const changed=currentOpportunityEvaluation({...s,price:100},saved);
 assert.notEqual(changed.snapshotHash,saved.snapshotHash);
 assert.notEqual(changed.evaluationHash,saved.evaluationHash);
 const explicit=currentOpportunityEvaluation(s,saved,{asOf:s.asOf,competitivePosition:[{id:'product-differentiation',score:10,rationale:'Synthetic reviewed comparison',sources:[source]}]});
 assert.notEqual(explicit,saved);
});

test('current saved ratings enforce canonical factor order, precision and rubric identity',()=>{
 const saved=evaluateOpportunity(snapshot());assert.equal(isCurrentOpportunityEvaluation(saved),true);
 for(const mutate of [r=>r.factors.reverse(),r=>r.version='obsolete',r=>r.snapshotHash='wrong',r=>r.evaluationHash='wrong',r=>{r.factors[0].score=.001;r.factors[0].points=0;}]){
  const changed=structuredClone(saved);mutate(changed);assert.equal(isCurrentOpportunityEvaluation(changed),false);
 }
});
