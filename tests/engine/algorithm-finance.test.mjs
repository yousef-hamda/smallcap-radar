import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreCatalysts,scoreFinancialStrength,scoreFinancialStrengthPartial,scoreEarningsQualityPartial} from '../../.test-build/opportunity-scoring.mjs';
import {assessFinancingRisk,applyFinancingRisk} from '../../.test-build/financing-risk.mjs';
import {buildOpportunityThesis} from '../../.test-build/opportunity-thesis.mjs';
import {peerObservation,peerContext} from '../../.test-build/opportunity-peers.mjs';

const asOf='2026-10-03T12:00:00Z';
const source=(start='2025-07-01',end='2026-06-30')=>({source:'SEC fixture',url:'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json',periodStart:start,periodEnd:end,availableAt:'2026-08-01T00:00:00Z',retrievedAt:asOf,currency:'USD',rightsStatus:'redistribution-permitted',confidence:'high'});
const instant=()=>({...source(),periodStart:undefined});
const sv=(value,p=source())=>({value,unit:'USD',source:p});
const finance=()=>({industryModel:'industrial-operating-company',asOf,unrestrictedCash:sv(100,instant()),totalDebt:sv(20,instant()),freeCashFlowTtm:sv(12),operatingIncomeTtm:sv(24),interestExpenseTtm:sv(2),debtDueWithin24Months:sv(10,instant())});
const event=(overrides={})=>({id:'contract',title:'Executed customer agreement',classification:'binding-contract',announcedAt:'2026-08-01',expectedAt:'2026-11-01',source:source(),impactAsPctTtmRevenue:sv(20),conditions:[],progressVerified:true,marketPricing:'not-priced',...overrides});
const impact=(value,unit)=>({value,unit,source:source()});
const catalyst=events=>scoreCatalysts({asOf,horizonMonths:6,searchCompleted:true,searchSources:[source()],events});
const knownEvent=(overrides={})=>event({impactAsPctTtmRevenue:impact(20,'percent-of-ttm-revenue'),...overrides});

 test('many nonbinding announcements cannot overwhelm one evidenced binding catalyst',()=>{
  const weak=knownEvent({classification:'non-binding'}),strong=knownEvent();
  const repeated=Array.from({length:30},(_,i)=>({...weak,id:'weak'+i}));
  assert.equal(catalyst([weak]).score,3);assert.equal(catalyst(repeated).score,3);
  assert(catalyst([strong]).score>catalyst(repeated).score);
  assert.equal(catalyst([...repeated,strong]).score,catalyst([strong]).score);
  assert.equal(catalyst([...repeated,strong].reverse()).score,catalyst([...repeated,strong]).score);
 });
 test('catalyst units are explicit and materiality has no numeric magnitude discontinuity',()=>{
  assert.equal(catalyst([knownEvent()]).score,catalyst([knownEvent({impactAsPctTtmRevenue:impact(.2,'ratio-of-ttm-revenue')})]).score);
  const one=catalyst([knownEvent({impactAsPctTtmRevenue:impact(1,'percent-of-ttm-revenue')})]);
  const next=catalyst([knownEvent({impactAsPctTtmRevenue:impact(1.01,'percent-of-ttm-revenue')})]);
  assert(next.score>=one.score);
  assert.equal(catalyst([knownEvent({impactAsPctTtmRevenue:impact(20,'revenue dollars')})]).score,null);
 });
 test('missing catalyst economics earns no more credit than a documented zero impact',()=>{
  const missing=catalyst([knownEvent({impactAsPctTtmRevenue:undefined})]);
  const zero=catalyst([knownEvent({impactAsPctTtmRevenue:impact(0,'ratio-of-ttm-revenue')})]);
  assert.equal(missing.score,zero.score);assert(missing.score<catalyst([knownEvent()]).score);
  assert.equal(missing.confidence,'medium');
 });
 test('catalyst malformed review fields and future evidence are explicitly unscored',()=>{
  for(const changes of [{classification:'invented'}, {classification:'toString'}, {marketPricing:'guaranteed'}, {conditions:['']}, {progressVerified:'yes'}, {source:{...source(),retrievedAt:'2026-12-01'}}]){
   const result=catalyst([knownEvent(changes)]);assert.equal(result.score,null);assert(result.conflicts.length>0);
  }
 });
 test('annual aligned financial-strength control retains the original subcomponent weights',()=>{
  const full=scoreFinancialStrength(finance()),partial=scoreFinancialStrengthPartial(finance());
  assert.equal(full.score,10);assert.equal(partial.score,10);assert.equal(partial.coveragePct,100);
  assert.deepEqual(full.subScores,{cashRunway:10,interestCoverage:10,maturityCoverage:10});
 });
 test('quarterly values cannot impersonate TTM runway or interest coverage',()=>{
  const input=finance();for(const key of ['freeCashFlowTtm','operatingIncomeTtm','interestExpenseTtm'])input[key].source=source('2026-04-01');
  assert.equal(scoreFinancialStrength(input).score,null);
  const partial=scoreFinancialStrengthPartial(input);assert.equal(partial.coveragePct,30);assert.equal(partial.subScores.cashRunway,0);assert.equal(partial.subScores.interestCoverage,0);assert.equal(partial.subScores.maturityCoverage,10);
 });
 test('solvency rejects mismatched flow periods, balance dates, scope and source currency independently',()=>{
  for(const mutate of [s=>s.interestExpenseTtm.source=source('2025-04-01','2026-03-31'),s=>s.unrestrictedCash.source.periodEnd='2026-03-31',s=>s.operatingIncomeTtm.source.scope='segment',s=>s.interestExpenseTtm.source.currency='EUR']){
   const input=finance();mutate(input);assert.equal(scoreFinancialStrength(input).score,null);assert(scoreFinancialStrengthPartial(input).coveragePct<100);
  }
 });
 const snapshot=()=>({symbol:'FIN',name:'Finance fixture',asOf,securityType:'common',cash:100,debt:20,revenue:100,fcf:12,netIncome:10,splitAdjusted:true,dilution:0,provenance:{cash:instant(),debt:instant(),revenue:source(),fcf:source(),netIncome:source(),dilution:source()}});
 test('loss-making issuers retain evidenced severe leverage, burn and dilution findings',()=>{
  const s={...snapshot(),cash:1,debt:20,fcf:-20,netIncome:-20,dilution:.8};
  assert.equal(assessFinancingRisk(s).level,'severe');
  delete s.revenue;delete s.provenance.revenue;
  assert.equal(assessFinancingRisk(s).level,'severe','independent adverse evidence survives missing revenue');
 });
 test('clean findings require complete evidence and recomputation replaces stale provenance',()=>{
  const input=snapshot();input.provenance.deathSpiral={...source(),tag:'stale-old-review'};
  const reviewed=applyFinancingRisk(input);assert.equal(reviewed.deathSpiral,'clean');assert.match(reviewed.provenance.deathSpiral.tag,/financing-risk-v2/);
  assert.deepEqual(applyFinancingRisk(reviewed),reviewed,'financing review is idempotent');
  assert(reviewed.provenance.deathSpiral.dependencies.includes(input.provenance.cash));
  assert.equal(input.provenance.deathSpiral.tag,'stale-old-review','input remains unchanged');
  const adverse=snapshot();adverse.debt=900;adverse.provenance.fcf.periodStart='2026-04-01';
  const quarter=applyFinancingRisk(adverse);assert.equal(quarter.deathSpiral,'severe');assert(!quarter.provenance.deathSpiral.dependencies.includes(adverse.provenance.fcf),'unused quarterly FCF is absent from the financing review lineage');
  delete reviewed.fcf;delete reviewed.provenance.fcf;
  const missing=applyFinancingRisk(reviewed);assert.equal(missing.deathSpiral,'unknown');assert.equal(missing.provenance.deathSpiral,undefined);
 });
 test('unusable future and mismatched evidence cannot manufacture financing safety',()=>{
  for(const mutate of [s=>s.provenance.fcf.periodStart='2026-04-01',s=>s.provenance.cash.periodEnd='2026-03-31',s=>s.provenance.fcf.retrievedAt='2026-11-01']){
   const s=snapshot();mutate(s);assert.equal(applyFinancingRisk(s).deathSpiral,'unknown');assert.equal(applyFinancingRisk(s).provenance.deathSpiral,undefined);
  }
  const nested=snapshot();nested.provenance.fcf.dependencies=[{...source(),availableAt:'2026-12-01'}];
  assert.equal(applyFinancingRisk(nested).deathSpiral,'unknown','a current wrapper cannot hide a future underlying flow');
 });
 const intrinsic=()=>{
  const s=snapshot();s.cik=1;s.price=10;s.marketCap=100;s.issuerCommonListingCount=1;
  s.provenance.price={...instant(),periodEnd:'2026-10-02',availableAt:'2026-10-02'};s.provenance.marketCap=s.provenance.price;
  s.opportunityResearch={financialStrength:{industryModel:'industrial-operating-company'},earnings:{conflicts:[],annual:[2023,2024,2025].map(y=>({start:y+'-01-01',end:y+'-12-31',metrics:Object.fromEntries(Object.entries({revenue:100,netIncome:20,operatingCashFlow:30,capitalExpenditure:5,stockBasedCompensation:5}).map(([k,v])=>[k,sv(v,source(y+'-01-01',y+'-12-31'))]))})),quarterly:[]}};return s;
 };
 const recentQuarters=(income=1)=>[['2025-07-01','2025-09-30'],['2025-10-01','2025-12-31'],['2026-01-01','2026-03-31'],['2026-04-01','2026-06-30']].map(([start,end])=>({start,end,metrics:Object.fromEntries(Object.entries({operatingCashFlow:4,capitalExpenditure:1,stockBasedCompensation:1,netIncome:income}).map(([key,value])=>[key,sv(value,source(start,end))]))}));
 test('current compatible deterioration caps intrinsic estimates without inventing missing TTM evidence',()=>{
  const s=intrinsic(),annual=buildOpportunityThesis(s);assert.equal(annual.valuation.status,'available');
  s.opportunityResearch.earnings.quarterly=recentQuarters();
  const current=buildOpportunityThesis(s);assert.equal(current.valuation.status,'available');assert.equal(current.valuation.normalizedCashflow,8);assert.equal(current.valuation.normalizedEarnings,4);
  assert(current.valuation.scenarios[1].equityValue<annual.valuation.scenarios[1].equityValue);
  s.opportunityResearch.earnings.quarterly=recentQuarters(-1);assert.equal(buildOpportunityThesis(s).valuation.status,'unavailable');
  delete s.opportunityResearch.earnings.quarterly[0].metrics.stockBasedCompensation;assert.equal(buildOpportunityThesis(s).valuation.status,'unavailable','known current losses cannot be hidden by missing SBC');
  s.opportunityResearch.earnings.quarterly[3].metrics.netIncome.source.retrievedAt='2026-12-01';assert.equal(buildOpportunityThesis(s).valuation.status,'available','future observations cannot affect current estimates');
  const nested=intrinsic();nested.opportunityResearch.earnings.annual[1].metrics.netIncome.source.dependencies=[{...source(),retrievedAt:'2026-12-01'}];assert.equal(buildOpportunityThesis(nested).valuation.status,'unavailable');
  const compact=intrinsic();compact.netIncome=-10;assert.equal(buildOpportunityThesis(compact).valuation.status,'unavailable','independent current annual/TTM net loss is sufficient');
  compact.provenance.netIncome.periodStart='2026-04-01';assert.equal(buildOpportunityThesis(compact).valuation.status,'available','a quarter cannot impersonate annual earnings');
 });
 test('peer boundary deduplicates issuers and rejects impossible gross margins',()=>{
  const s=intrinsic();s.provenance.industryModel={...source(),tag:'SIC 3571: Computer equipment'};
  for(const period of s.opportunityResearch.earnings.annual)period.metrics.grossProfit=sv(40,period.metrics.revenue.source);
  const own=peerObservation(s);assert(own);
  const peers=Array.from({length:5},(_,i)=>({...own,cik:i+2,symbol:'P'+i,grossMargin:.1+i*.1}));
  const normal=peerContext(s,peers);assert.notEqual(normal.grade,null);
  assert.deepEqual(peerContext(s,[...peers,...peers].reverse()),normal);
  assert.equal(peerContext(s,Array(5).fill(peers[0])).grade,null);
  const contradictory=[...peers,{...peers[0],symbol:'ALTERNATE',grossMargin:.99}];
  assert.equal(peerContext(s,contradictory).grade,null,'conflicting alternate listing removes its issuer rather than choosing favorable metrics');
  assert.equal(peerContext(s,contradictory.reverse()).grade,null);
  assert.equal(peerContext(s,[...peers,{...peers[0],sic:9999}]).grade,null,'conflicting SIC cannot be hidden by industry filtering');
  assert.equal(peerContext(s,peers.map(p=>({...p,grossMargin:1.1}))).grade,null);
  const crowded=Array.from({length:30},(_,i)=>({...own,cik:i+2,symbol:'P'+i,grossMargin:i/40}));
  assert.equal(peerContext(s,crowded).grade,peerContext(s,crowded.map(p=>({...p,symbol:'RENAMED'+(32-p.cik)}))).grade,'ticker labels cannot select different economic peers');
  s.opportunityResearch.earnings.annual.forEach(period=>period.metrics.grossProfit.value=101);assert.equal(peerObservation(s),null);
  const conflict=intrinsic();conflict.provenance.industryModel={...source(),tag:'SIC 3571: Computer equipment'};conflict.opportunityResearch.earnings.conflicts=['unresolved revenue'];assert.equal(peerObservation(conflict),null);
 });
 test('reviewed earnings ratios cannot mix continuing operations or falsely declared source currencies',()=>{
  const metrics=(start,end)=>Object.fromEntries(Object.entries({revenue:25,netIncome:1,operatingIncome:2,operatingCashFlow:4,capitalExpenditure:1,stockBasedCompensation:1}).map(([key,value])=>[key,sv(value,source(start,end))]));
  const annual=[2023,2024,2025].map(y=>metrics(y+'-01-01',y+'-12-31'));
  const dates=[['2024-07-01','2024-09-30'],['2024-10-01','2024-12-31'],['2025-01-01','2025-03-31'],['2025-04-01','2025-06-30'],['2025-07-01','2025-09-30'],['2025-10-01','2025-12-31'],['2026-01-01','2026-03-31'],['2026-04-01','2026-06-30']];
  const input={asOf,annual,quarterly:dates.map(([start,end])=>metrics(start,end))};assert.notEqual(scoreEarningsQualityPartial(input).score,null);
  input.quarterly[7].operatingCashFlow.source.scope='continuing-operations';assert.equal(scoreEarningsQualityPartial(input).score,null);
  delete input.quarterly[7].operatingCashFlow.source.scope;input.quarterly[7].netIncome.source.currency='EUR';assert.equal(scoreEarningsQualityPartial(input).score,null);
 });
