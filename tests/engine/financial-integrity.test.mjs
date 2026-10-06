import {peerObservation,peerContext,uniqueIssuerPeers} from '../../.test-build/opportunity-peers.mjs';
import {readSecArtifact,recordSecArtifact} from '../../.test-build/sec-artifact-cache.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {compatibleFinancialSources,alignSnapshotFinancials,commercialObservationKind,evidenceLeaves} from '../../.test-build/financial-integrity.mjs';
import {reportedBorrowings} from '../../.test-build/sec.mjs';
import {evaluateOpportunity} from '../../.test-build/opportunity-engine.mjs';
import {OPPORTUNITY_SPEC} from '../../.test-build/opportunity-spec.mjs';
import {buildOpportunityThesis,intrinsicValuationGrade} from '../../.test-build/opportunity-thesis.mjs';
import {parseFilingObservations,persistFilingDocument} from '../../.test-build/filing-observations.mjs';
import {env as runtimeEnv} from '../runtime/env.mjs';
import {derivedEvidence} from '../../.test-build/evidence.mjs';

const asOf='2026-10-03T12:00:00Z';
const source=(start='2026-01-01',end='2026-06-30')=>({source:'SEC fixture',url:'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json',periodStart:start,periodEnd:end,availableAt:'2026-08-01T00:00:00Z',retrievedAt:asOf,currency:'USD',rightsStatus:'redistribution-permitted',confidence:'high'});
const base=()=>({symbol:'SYNTH',name:'Fixture',asOf,securityType:'common',price:10,marketCap:1000,revenue:100,fcf:20,netIncome:15,cash:100,debt:30,splitAdjusted:true,dilution:0,provenance:Object.fromEntries(['revenue','fcf','netIncome','dilution'].map(k=>[k,source()]).concat(['cash','debt'].map(k=>[k,source(undefined)])))});
const factor=(s,id)=>evaluateOpportunity(s).factors.find(x=>x.id===id);

const valuationFixture=()=>{
 const s=base();s.issuerCommonListingCount=1;s.marketCap=100;
 for(const key of ['price','marketCap'])s.provenance[key]={...source(),periodStart:undefined,periodEnd:'2026-10-02',availableAt:'2026-10-02T21:00:00Z'};
 const annual=[2023,2024,2025].map(year=>{const start=`${year}-01-01`,end=`${year}-12-31`;return {start,end,metrics:Object.fromEntries(Object.entries({revenue:100+(year-2023)*20,netIncome:20,operatingCashFlow:30,capitalExpenditure:5,stockBasedCompensation:5}).map(([key,value])=>[key,{value,unit:'USD',source:source(start,end)}]))};});
 s.opportunityResearch={earnings:{annual,quarterly:[],conflicts:[]},financialStrength:{industryModel:'industrial-operating-company'}};return s;
};

test('intrinsic sensitivities use owner cash flow and a conservative earnings cross-check',()=>{
 const s=valuationFixture(),thesis=buildOpportunityThesis(s);
 assert.equal(thesis.valuation.status,'available');assert.equal(thesis.valuation.normalizedCashflow,20);
 assert.equal(thesis.valuation.scenarios.length,3);assert.equal(thesis.probability,null);assert.equal(thesis.sixMonthTarget,null);
 const [bear,base,bull]=thesis.valuation.scenarios;assert(bear.valuePerSecurity<=base.valuePerSecurity&&base.valuePerSecurity<=bull.valuePerSecurity);
 for(const item of thesis.valuation.scenarios){assert.equal(item.equityValue,Math.min(item.cashflowValue,item.earningsValue));assert.equal(item.upside,item.valuePerSecurity/s.price-1);assert.equal(item.discount,1-s.price/item.valuePerSecurity);}
 assert.notEqual(base.upside,base.discount);assert(intrinsicValuationGrade(thesis)>=0);
 const evaluation=evaluateOpportunity(s);assert.equal(evaluation.factors[0].calculation.rubricId,'valuation-model-v5-opportunity');assert(evaluation.factors[0].calculation.inputs.some(item=>item.name==='base:intrinsic estimate'));assert.equal(evaluation.thesis.action,'research-required');
});

test('intrinsic model withholds unsupported financial, class, currency, time and sector inputs',()=>{
 for(const mutate of [s=>s.issuerCommonListingCount=2,s=>s.securityType='warrant',s=>s.splitAdjusted=false,s=>s.opportunityResearch.financialStrength.industryModel=undefined,s=>delete s.opportunityResearch.earnings.annual[1].metrics.stockBasedCompensation,s=>s.opportunityResearch.earnings.annual[0].metrics.revenue.unit='EUR',s=>s.provenance.price.periodEnd='2026-09-01',s=>s.opportunityResearch.earnings.annual[0].metrics.operatingCashFlow.value=-5]){
  const s=valuationFixture();mutate(s);const thesis=buildOpportunityThesis(s);assert.equal(thesis.valuation.status,'unavailable');assert.equal(intrinsicValuationGrade(thesis),null);assert(thesis.valuation.gaps.length);
  assert(evaluateOpportunity(s).factors.every(f=>Number.isFinite(f.score)));
 }
 const malformed={...base(),opportunityResearch:{earnings:{annual:[{metrics:{}}]}}};assert.doesNotThrow(()=>evaluateOpportunity(malformed));
});

test('filing excerpts preserve financing and future-event facts without awarding impact points',async()=>{
 const body='<html><script>expects approval on December 1, 2026.</script><p>The company expects to launch its new product on December 15, 2026.</p><p>The credit agreement has a maturity on December 31, 2026.</p><p>The audit committee reported a material weakness in internal controls.</p></html>';
 const observations=parseFilingObservations(body,asOf);assert.equal(observations.length,3);assert(observations.some(item=>item.eventDate==='2026-12-15'));assert(observations.every(item=>item.reviewStatus==='unreviewed'&&item.scoreCredit===0));
 const input={cik:1,accession:'0000000001-26-000001',url:'https://www.sec.gov/Archives/edgar/data/1/filing.htm',filed:'2026-10-02',retrievedAt:asOf,asOf,body};
 const first=await persistFilingDocument(input),second=await persistFilingDocument(input);assert.deepEqual(first,second);assert.equal(first.contentHash.length,64);
 assert.equal((await runtimeEnv.DB.prepare('SELECT COUNT(*) AS n FROM filing_documents WHERE accession=?').bind(input.accession).first()).n,1);
 const revised=await persistFilingDocument({...input,body:body+'<p>New financing was announced.</p>'});assert.notEqual(first.contentHash,revised.contentHash);assert.equal((await runtimeEnv.DB.prepare('SELECT COUNT(*) AS n FROM filing_documents WHERE accession=?').bind(input.accession).first()).n,2);
});

test('derived provenance preserves dependencies and the most restrictive input rights',()=>{
 const result=derivedEvidence('Combined',[source(),{...source(),rightsStatus:'unknown'}],asOf,'ratio');assert.equal(result.rightsStatus,'unknown');assert.equal(result.dependencies.length,2);
 assert.equal(derivedEvidence('Combined',[source(),{...source(),rightsStatus:'restricted'}],asOf,'ratio').rightsStatus,'restricted');
});

test('financial comparisons reject mismatched duration, currency, scope and balance date',()=>{
 assert.equal(compatibleFinancialSources([source(),source()],'flow'),true);
 for(const bad of [{...source(),periodStart:'2026-04-01'},{...source(),periodEnd:'2026-03-31'},{...source(),currency:'EUR'},{...source(),scope:'segment'},{...source(),periodStart:undefined}])assert.equal(compatibleFinancialSources([source(),bad],'flow'),false);
 const cash={...source(),periodStart:undefined};assert.equal(compatibleFinancialSources([cash,cash],'balance'),true);
 assert.equal(compatibleFinancialSources([cash,{...cash,periodEnd:'2026-03-31'}],'balance'),false);
});

test('a profitable mismatched quarter cannot create a TTM margin or cash-conversion grade',()=>{
 const s=base();s.provenance.cash.periodStart=undefined;s.provenance.debt.periodStart=undefined;
 assert.ok(factor(s,'earningsQuality').score>0);
 const mismatched={...s,provenance:{...s.provenance,fcf:source('2026-04-01','2026-06-30'),netIncome:source('2026-04-01','2026-06-30')}};
 assert.equal(factor(mismatched,'earningsQuality').score,3,'only the independently comparable cash-conversion component remains');
 const badBalance={...s,provenance:{...s.provenance,debt:source(undefined,'2026-03-31')}};badBalance.provenance.debt.periodStart=undefined;
 assert.ok(factor(badBalance,'financialStrength').score<factor(s,'financialStrength').score);
});

test('contract liabilities are identified separately and cannot create positive catalyst points',()=>{
 const s={...base(),backlog:{amount:10000,expectedRecognitionBy:'2026-12-31'},provenance:{...base().provenance,backlog:{...source(undefined),tag:'ContractWithCustomerLiabilityCurrent'}}};
 assert.equal(commercialObservationKind(s),'contract-liability');assert.equal(factor(s,'catalysts').score,0);
 s.provenance.backlog.tag='RevenueRemainingPerformanceObligation';assert.ok(factor(s,'catalysts').score>0);
 delete s.backlog.expectedRecognitionBy;assert.equal(factor(s,'catalysts').score,0,'RPO without a conversion window is not a six-month catalyst');
});

test('unreviewed splits cannot earn alignment or dilution-protection points',()=>{
 const s=base();assert.ok(factor(s,'management').score>0);
 s.splitAdjusted=false;assert.equal(factor(s,'management').score,0);
});

test('every security type retains eight bounded grades without inheriting common-share valuation',()=>{
 for(const securityType of ['common','adr','preferred','warrant','right','unit','fund','debt','unknown']){
  const result=evaluateOpportunity({...base(),securityType});assert.equal(result.state,'ranked');assert.equal(result.rankingEligible,true);
  assert.equal(result.factors.length,8);assert.ok(result.factors.every(f=>Number.isFinite(f.score)&&f.score>=0&&f.score<=10));
  assert.equal(result.score,Math.round(result.factors.reduce((sum,f)=>sum+Math.round(f.score*100)*f.weight,0)/10)/100);
  if(!['common','adr'].includes(securityType))assert.ok(result.factors.filter(f=>f.id!=='technicalTiming').every(f=>f.score===0));
 }
 assert.equal(OPPORTUNITY_SPEC.factors.reduce((sum,f)=>sum+f.weight,0),100);
});

const fact=(value,end='2026-06-30')=>({val:value,end,filed:'2026-08-01',form:'20-F',accn:'1-26-1'});
const concept=(value)=>({units:{USD:[fact(value)]}});
test('reported aggregate borrowing replaces rather than adds current and noncurrent components',()=>{
 const facts={'ifrs-full':{Borrowings:concept(100),BorrowingsCurrent:concept(20),BorrowingsNoncurrent:concept(80)}};
 assert.equal(reportedBorrowings(facts,asOf).val,100);assert.equal(reportedBorrowings(facts,asOf).components.length,1);
 facts['ifrs-full'].Borrowings=concept(0);assert.equal(reportedBorrowings(facts,asOf),null,'a total contradicting its parts needs reconciliation');
 facts['ifrs-full'].BorrowingsCurrent=concept(0);facts['ifrs-full'].BorrowingsNoncurrent=concept(0);
 assert.equal(reportedBorrowings(facts,asOf).val,0,'a consistent disclosed zero is preserved');
 facts['ifrs-full'].BorrowingsCurrent=concept(20);facts['ifrs-full'].BorrowingsNoncurrent=concept(80);
 delete facts['ifrs-full'].Borrowings;assert.equal(reportedBorrowings(facts,asOf).val,100);
 delete facts['ifrs-full'].BorrowingsNoncurrent;assert.equal(reportedBorrowings(facts,asOf),null,'missing noncurrent borrowing is not zero');
});

test('aligned newer quarters replace stale annual fields and preserve complete dependency lineage',()=>{
 const periods=[['2025-07-01','2025-09-30'],['2025-10-01','2025-12-31'],['2026-01-01','2026-03-31'],['2026-04-01','2026-06-30']];
 const s=base();s.revenue=999;s.provenance.revenue=source('2024-01-01','2024-12-31');
 s.opportunityResearch={earnings:{conflicts:[],annual:[],quarterly:periods.map(([start,end])=>({start,end,metrics:Object.fromEntries([['revenue',30],['netIncome',5],['operatingCashFlow',8],['capitalExpenditure',2]].map(([k,value])=>[k,{value,unit:'USD',source:source(start,end)}]))}))}};
 const aligned=alignSnapshotFinancials(s);assert.equal(aligned.revenue,120);assert.equal(aligned.netIncome,20);assert.equal(aligned.fcf,24);
 assert.equal(evidenceLeaves(aligned.provenance.revenue).length,4);assert.equal(evidenceLeaves(aligned.provenance.fcf).length,8);
 assert.deepEqual(alignSnapshotFinancials(aligned),aligned,'normalization is idempotent');assert.equal(s.revenue,999,'raw input is not mutated');
 s.opportunityResearch.earnings.quarterly[2].metrics.revenue.unit='EUR';assert.equal(alignSnapshotFinancials(s).revenue,999);
});

test('comparable peers require distinct issuers, fiscal windows and sufficient observations',()=>{
 const own=valuationFixture();own.cik=1;own.provenance.industryModel={...source(),tag:'SIC 3571: Computers'};own.opportunityResearch.earnings.annual[2].metrics.grossProfit={value:60,unit:'USD',source:source('2025-01-01','2025-12-31')};
 const observation=peerObservation(own);assert(observation);
 const peers=Array.from({length:6},(_,i)=>({...observation,symbol:'PEER'+i,cik:i+2,grossMargin:i*.1}));
 assert.equal(peerContext(own,peers.slice(0,4)).grade,null);assert(peerContext(own,peers).grade>0);
 assert.equal(uniqueIssuerPeers([...peers,peers[0]]).length,6);
 assert.equal(peerContext(own,peers.map(p=>({...p,end:'2024-12-31'}))).grade,null);
 assert.equal(peerContext(own,peers.map(p=>({...p,sic:9999}))).grade,null);
});
test('SEC artifacts survive module reload, validate hashes and identities, and expire without stale substitution',async()=>{
 const url='https://data.sec.gov/api/xbrl/companyfacts/CIK0000000007.json',now=Date.now(),payload={cik:7,facts:{'us-gaap':{}}};
 await recordSecArtifact(url,payload,undefined,now);
 const reloaded=await import('../../.test-build/sec-artifact-cache.mjs?restart');assert.deepEqual(await reloaded.readSecArtifact(url,now+1000),payload);
 assert.equal(await readSecArtifact(url,now+7*60*60_000),null);
 await assert.rejects(()=>recordSecArtifact(url,{cik:8}),/issuer mismatch/);
 await runtimeEnv.DB.prepare('UPDATE sec_artifact_cache SET content_hash=? WHERE url=?').bind('corrupt',url).run();assert.equal(await readSecArtifact(url,now+1000),null);
 await recordSecArtifact(url,null,'HTTP 403',now);
 const status=await runtimeEnv.DB.prepare('SELECT last_error,last_success_at FROM provider_acquisition_status WHERE url=?').bind(url).first();assert.equal(status.last_error,'HTTP 403');assert.equal(status.last_success_at,now);
});

test('intrinsic discounted currency estimates publish cents without fractional hash noise',()=>{
 const fixture=valuationFixture();fixture.opportunityResearch.earnings.annual.forEach((period,index)=>{period.metrics.operatingCashFlow.value=12345678901.23+index*111111;period.metrics.netIncome.value=9876543210.34;});
 const thesis=buildOpportunityThesis(fixture);assert.equal(thesis.valuation.status,'available');
 for(const scenario of thesis.valuation.scenarios)assert.equal(scenario.cashflowValue,Number(scenario.cashflowValue.toFixed(2)));
 assert.deepEqual(buildOpportunityThesis(structuredClone(fixture)),thesis);
});
