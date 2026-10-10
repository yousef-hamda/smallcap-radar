import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeCompanyFacts,fetchCompanyFactsFallback,preliminarySnapshot} from '../../.test-build/bulk.mjs';
const asOf=new Date('2026-10-03T12:00:00Z');
const fact=(value,extra={})=>({cik:1,start:'2025-01-01',end:'2025-12-31',val:value,unit:'USD',scope:'consolidated',tag:'RevenueFromContractWithCustomerExcludingAssessedTax',priority:1,url:'https://data.sec.gov/api/xbrl/frames/us-gaap/revenue/USD/CY2025.json',observedAt:asOf.toISOString(),kind:'frames',...extra});
const merged=(a,b)=>mergeCompanyFacts({revenue:a},{revenue:b});
const candidate=(value,extra={})=>fact(value,{kind:'companyfacts',filed:'2026-02-01',priority:0,url:'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json',...extra});

test('SEC reconciliation tolerates disclosed symmetric <=1% differences while retaining exact raw source traces',()=>{
 for(const values of [[100,100.5],[100.5,100],[99,100],[-100,-100.5],[0,0]]){
  const result=merged(fact(values[0]),candidate(values[1]));assert.deepEqual(result.conflicts??[],[]);assert.equal(result.revenue.val,values[1]);
  if(values[0]!==values[1]){assert.equal(result.warnings.length,1);assert.match(result.warnings[0],/within 1%/);assert.match(result.warnings[0],/"prior":\{"value":/);assert(result.warnings[0].includes(String(values[0]))&&result.warnings[0].includes(String(values[1])));assert.match(result.warnings[0],/not independent verification/);}
 }
});

test('material same-definition discrepancies and sign changes remain explicit source conflicts',()=>{
 for(const values of [[100,102],[102,100],[100,-100],[0,1],[-100,-102]]){const result=merged(fact(values[0]),candidate(values[1]));assert.equal(result.conflicts.length,1);assert.match(result.conflicts[0],/> 1%/);assert.match(result.warnings[0],/material difference/);}
});

test('same fiscal end cannot turn different durations, currencies or scopes into a false contradiction',()=>{
 for(const change of [{start:'2025-04-01'},{end:'2026-03-31'},{unit:'EUR'},{currency:'EUR'},{scope:'segment'},{metricScope:'continuing-operations'},{cik:2}]){
  const result=merged(fact(100,change),candidate(140));assert.deepEqual(result.conflicts??[],[]);assert.match(result.warnings[0],/not comparable/);assert.match(result.warnings[0],/"value":100/);assert.match(result.warnings[0],/"value":140/);
 }
 const changedConcept=merged(fact(100,{tag:'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',scope:undefined}),candidate(140));assert.deepEqual(changedConcept.conflicts??[],[],'explicit continuing-operation tag identifies a different scope');
});

test('legacy unresolved conflicts remain conserved and new comparison warnings surface on compact snapshots',()=>{
 const old='revenue: historical unresolved conflict without complete source pair';const result=mergeCompanyFacts({revenue:fact(100),conflicts:[old]},{revenue:candidate(100.5)});assert.deepEqual(result.conflicts,[old]);
 const s=preliminarySnapshot({cik:1,ticker:'SYNTH',name:'Fixture',exchange:'NYSE',securityType:'common',price:10,marketCap:100},result,asOf.toISOString());assert(s.dataIssues.some(item=>item.startsWith('[source-comparison] ')));assert(s.sourceConflicts.includes(old));
});

test('mocked official Frames and Company Facts acquisition applies period and materiality checks before source conflicts',async()=>{
 const originalFetch=globalThis.fetch,oldAgent=process.env.SEC_USER_AGENT;process.env.SEC_USER_AGENT='SmallCapRadar test (contact: test@example.com)';let requests=0;
 globalThis.fetch=async url=>{requests++;const cik=Number(String(url).match(/CIK(\d+)\.json/)?.[1]);return Response.json({cik,facts:{'us-gaap':{RevenueFromContractWithCustomerExcludingAssessedTax:{units:{USD:[{start:'2025-01-01',end:'2025-12-31',val:cik===99103?102:100.5,filed:'2026-02-01',form:'10-K',accn:'0000000001-26-000001'}]}}}}});};
 try{
  for(const [cik,start,conflicted] of [[99101,'2025-04-01',false],[99102,'2025-01-01',false],[99103,'2025-01-01',true]]){
   const initial=new Map([[cik,{revenue:fact(100,{cik,start})}]]);const result=await fetchCompanyFactsFallback([cik],asOf,initial);assert.equal(result.success,1);const acquired=result.fundamentals.get(cik);assert.equal(!!acquired.conflicts?.length,conflicted);assert(acquired.warnings.length);assert.equal(initial.get(cik).revenue.val,100,'raw prior input remains conserved');
  }assert.equal(requests,3);
 }finally{globalThis.fetch=originalFetch;if(oldAgent===undefined)delete process.env.SEC_USER_AGENT;else process.env.SEC_USER_AGENT=oldAgent;}
});
