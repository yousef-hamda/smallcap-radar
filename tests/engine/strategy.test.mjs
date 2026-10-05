import test from 'node:test';import assert from 'node:assert/strict';
import {SPECS,evaluateStrategy,specHash} from '../../.test-build/engine.mjs';
import {fixtures} from '../../.test-build/fixtures.mjs';
import {simulateForwardReturn,horizonDate,pointInTime,firmHoldout,firmBootstrap,bonferroni,splitAdjustedDilution,ma30Weeks,opportunityHistoryMetrics,completedSessionQuote} from '../../.test-build/research.mjs';
import {trailingAnnual,insiderPurchases,latestInstant,REVENUE_TAGS} from '../../.test-build/sec.mjs';
import {preliminarySnapshot,parseCompanyFacts,needsCompanyFacts,fetchCompanyFactsFallback,fetchBulkFundamentals} from '../../.test-build/bulk.mjs';
import {yahooPercentAsRatio,parseYahooDaily,parseCboeDaily,yahooSymbol,yahooBulkQuotes,parseSecFilingNews,parseSecFilingIndex,parseSec8KItemReferences,fetchSec8KItemIndex,selectRecentForm4Filings,fetchInsiderPurchases,fetchJson,enrichSnapshotsWithSecOpportunity,resolveCompanyBySymbol,searchListedCompanies} from '../../.test-build/providers.mjs';
import {reviewShareSplits} from '../../.test-build/research.mjs';
import {enrichFinancials} from '../../.test-build/financials.mjs';
import {derivedEvidence} from '../../.test-build/evidence.mjs';
import {parseYahooIntraday} from '../../.test-build/chart-data.mjs';
import {parseOfficialDirectory,classifyListedSecurity} from '../../.test-build/directory.mjs';
import {applyFinancingRisk} from '../../.test-build/financing-risk.mjs';
import {OPPORTUNITY_SPEC} from '../../.test-build/opportunity-spec.mjs';
import {evaluateOpportunity,isOpportunityProvenanceValid} from '../../.test-build/opportunity-engine.mjs';
import {operatingCandidateSignals,operatingCandidateOrderSql} from '../../.test-build/opportunity-candidates.mjs';
import {scoreFairValue,scoreFinancialStrength,scoreFinancialStrengthPartial,scoreCatalysts,scoreEarningsQuality,scoreDownsideRisk,scoreTechnicalTiming,scoreQualitativeFactor} from '../../.test-build/opportunity-scoring.mjs';
import {scoreOpportunityDossier,evaluateOpportunityDossier,opportunityDossierFromSnapshot,currentOpportunityEvaluation} from '../../.test-build/opportunity-dossier.mjs';
import {buildTechnicalTimingResearch} from '../../.test-build/opportunity-market.mjs';
import {buildSecEarningsQualityAssessment,buildSecFinancialStrengthInputs,classifySecCompanyFacts,classifySecIssuerModel} from '../../.test-build/sec-opportunity.mjs';
import {DATA_FIELD_REGISTRY,sourceRegistrySummary} from '../../.test-build/source-registry.mjs';
import {parseEcbDailyCsv,convertFlowToUsd,convertInstantToUsd,translateSourcedValue,convertEarningsPeriodsToUsd,convertFinancialMetricsToUsd,fetchEcbDailySeries} from '../../.test-build/ecb-fx.mjs';
process.env.SEC_USER_AGENT??='SmallCapRadar/2.2 (contact: tests@example.com)';
const base=fixtures[0];const gate=(s,id,strategy='core')=>evaluateStrategy(strategy,s).checks.find(c=>c.id===id).status;
const opportunityAsOf='2026-09-30T12:00:00.000Z';
const opportunityProvenance={source:'Official source fixture',url:'https://example.test/filing',periodStart:'2026-01-01',periodEnd:'2026-06-30',availableAt:'2026-08-01T12:00:00.000Z',retrievedAt:'2026-09-30T11:00:00.000Z',currency:'USD',rightsStatus:'redistribution-permitted',confidence:'high'};
const freshMarketEvidence={...opportunityProvenance,periodStart:'2026-09-02',periodEnd:'2026-09-29',availableAt:'2026-09-29T20:00:00.000Z'};
const opportunitySnapshot={symbol:'SYNTH',name:'Synthetic Company',asOf:opportunityAsOf,securityType:'common',exchange:'Nasdaq',price:10,marketCap:3e9,medianDollarVolume20d:500000,provenance:{securityType:opportunityProvenance,exchange:opportunityProvenance,price:freshMarketEvidence,marketCap:freshMarketEvidence,medianDollarVolume20d:freshMarketEvidence}};
const opportunityEvidence=()=>Object.fromEntries(OPPORTUNITY_SPEC.factors.map(factor=>[factor.id,{score:10,rationale:`Sourced fixture for ${factor.id}`,sources:[opportunityProvenance],confidence:'high',calculation:{rubricId:`fixture-${factor.id}`,inputs:[{name:'sourced-fixture-input',value:1}]}}]));
test('SEC provider requests send the configured reachable-contact User-Agent',async()=>{
 const originalFetch=globalThis.fetch,previous=process.env.SEC_USER_AGENT;let observed;
 process.env.SEC_USER_AGENT='SmallCapRadar/2.2 (contact: data-admin@example.com)';
 globalThis.fetch=async(_url,init)=>{observed=new Headers(init?.headers).get('user-agent');return Response.json({facts:{}})};
 try{await fetchJson('https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json',1000,0,1);assert.equal(observed,process.env.SEC_USER_AGENT)}
 finally{globalThis.fetch=originalFetch;if(previous===undefined)delete process.env.SEC_USER_AGENT;else process.env.SEC_USER_AGENT=previous;}
});
test('SEC requests are suppressed when no valid contact identity is configured',async()=>{
 const originalFetch=globalThis.fetch,previous=process.env.SEC_USER_AGENT;let calls=0;delete process.env.SEC_USER_AGENT;
 globalThis.fetch=async()=>{calls++;return Response.json({facts:{}})};
 try{await assert.rejects(fetchJson('https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json',1000,0,1),/SEC_USER_AGENT must contain a valid reachable contact email/);assert.equal(calls,0);}
 finally{globalThis.fetch=originalFetch;if(previous===undefined)delete process.env.SEC_USER_AGENT;else process.env.SEC_USER_AGENT=previous;}
});
test('all published score weight sets sum to 100',()=>{for(const weights of [SPECS.core.weights,SPECS.legacy.weights,SPECS.bounce.ranking.weights])assert.equal(Object.values(weights).reduce((a,b)=>a+b),100)});
test('inclusive Core market cap boundaries',()=>{for(const [cap,status] of [[24999999,'FAIL'],[25e6,'PASS'],[2e9,'PASS'],[2000000001,'FAIL']])assert.equal(gate({...base,marketCap:cap},'cap'),status)});
test('Core liquidity and EV/S boundaries',()=>{assert.equal(gate({...base,medianDollarVolume20d:150000},'liquidity'),'PASS');assert.equal(gate({...base,medianDollarVolume20d:149999},'liquidity'),'FAIL');assert.equal(gate({...base,evSales:10},'valuation'),'PASS');assert.equal(gate({...base,evSales:10.001},'valuation'),'FAIL')});
test('profitability OR and missing data semantics',()=>{assert.equal(gate({...base,netIncome:-1,fcf:1},'profitability'),'PASS');assert.equal(gate({...base,netIncome:null,fcf:-1},'profitability'),'UNKNOWN');assert.equal(gate({...base,netIncome:0,fcf:0},'profitability'),'FAIL');const fcfOnly={...base,netIncome:5,fcf:1,provenance:{...base.provenance,netIncome:undefined}};assert.equal(gate(fcfOnly,'profitability'),'PASS')});
test('unresolved death spiral never passes without evidence',()=>{assert.equal(gate({...base,deathSpiral:'unknown'},'deathSpiral'),'UNKNOWN');assert.equal(gate({...base,riskEvidence:undefined},'deathSpiral'),'UNKNOWN');assert.equal(gate({...base,deathSpiral:'severe'},'deathSpiral'),'FAIL')});
test('financing risk review turns complete SEC solvency evidence into a usable Core gate',()=>{
 const p={source:'SEC test',periodEnd:'2026-06-30',availableAt:'2026-08-01T00:00:00Z',retrievedAt:base.asOf,confidence:'high'};
 const reviewed=applyFinancingRisk({...base,cash:20e6,debt:5e6,provenance:{...base.provenance,cash:p,debt:p}});
 assert.equal(reviewed.deathSpiral,'clean');assert.match(reviewed.riskEvidence,/لا توجد إشارة/);assert.equal(gate(reviewed,'deathSpiral'),'PASS');
 const distressed=applyFinancingRisk({...reviewed,cash:1e6,debt:10e6,fcf:-2e6,provenance:{...reviewed.provenance,fcf:p}});
 assert.equal(distressed.deathSpiral,'severe');assert.equal(gate(distressed,'deathSpiral'),'FAIL');
});
test('financial freshness uses filing availability while bounding the reporting period',()=>{
 const recentFiling={...base.provenance.revenue,periodEnd:'2025-12-31',availableAt:'2026-03-01T00:00:00Z'};
 assert.equal(gate({...base,provenance:{...base.provenance,revenue:recentFiling}},'filingFreshness'),'PASS');
 const ancientPeriod={...recentFiling,periodEnd:'2024-01-01'};
 assert.equal(gate({...base,provenance:{...base.provenance,revenue:ancientPeriod}},'filingFreshness'),'UNKNOWN');
});
test('price freshness counts market weekdays instead of weekend calendar days',()=>{
 const friday={...base.provenance.price,availableAt:'2026-09-25T21:00:00Z'};
 assert.equal(gate({...base,asOf:'2026-09-29T00:00:00Z',provenance:{...base.provenance,price:friday}},'freshness'),'PASS');
 const prior={...friday,availableAt:'2026-09-21T21:00:00Z'};
 assert.equal(gate({...base,asOf:'2026-09-29T00:00:00Z',provenance:{...base.provenance,price:prior}},'freshness'),'UNKNOWN');
});
test('Core thesis conditions are gates and score cannot rescue a failure',()=>{const r=evaluateStrategy('core',{...base,confidence:'B',revenue:0});assert.equal(r.checks.find(c=>c.id==='revenue').role,'eligibility');assert.equal(r.checks.find(c=>c.id==='revenue').status,'FAIL');assert.equal(r.factorStatus,'FAIL');assert.equal(r.qualified,false);assert.equal(r.status,'FAIL');assert(r.score>=0&&r.score<=100);assert.equal(r.screeningQualified,false);assert.equal(r.finalRanked,false)});
test('declared cap and liquidity universe limits are eligibility gates',()=>{
 const core=evaluateStrategy('core',{...base,marketCap:2e9+1});assert.equal(core.checks.find(c=>c.id==='cap').role,'eligibility');assert.equal(core.status,'FAIL');assert.equal(core.qualified,false);
 const bounce=evaluateStrategy('bounce',{...base,medianDollarVolume20d:SPECS.bounce.liquidity-1});assert.equal(bounce.checks.find(c=>c.id==='liquidity').role,'eligibility');assert.equal(bounce.status,'FAIL');assert.equal(bounce.screeningQualified,false);
});
test('nonfinite and missing gate input become UNKNOWN',()=>{for(const marketCap of [null,undefined,NaN,Infinity])assert.equal(gate({...base,marketCap},'cap'),'UNKNOWN')});
test('Bounce decline strict and size inclusive',()=>{assert.equal(gate({...base,return12m:-.35},'collapse','bounce'),'FAIL');assert.equal(gate({...base,return12m:-.3501},'collapse','bounce'),'PASS');for(const cap of [25e6,600e6])assert.equal(gate({...base,marketCap:cap},'cap','bounce'),'PASS')});
test('Bounce low inclusive, MA and dilution strict',()=>{assert.equal(gate({...base,price:11,low52w:10},'low','bounce'),'PASS');assert.equal(gate({...base,price:10.5,ma30w:10},'reversal','bounce'),'FAIL');assert.equal(gate({...base,dilution:.25,shareCountRatio:1},'dilution','bounce'),'FAIL');assert.equal(gate({...base,splitAdjusted:false},'dilution','bounce'),'UNKNOWN')});
test('Bounce dilution passes only after a stable share-count review',()=>{assert.equal(gate({...base,dilution:.10,shareCountRatio:1.08},'dilution','bounce'),'PASS');assert.equal(gate({...base,dilution:.10,shareCountRatio:2.1},'dilution','bounce'),'UNKNOWN')});
test('Bounce operating liquidity threshold is explicit',()=>{assert.equal(gate({...base,medianDollarVolume20d:150000},'liquidity','bounce'),'PASS');assert.equal(gate({...base,medianDollarVolume20d:149999},'liquidity','bounce'),'FAIL');assert.equal(gate({...base,medianDollarVolume20d:null},'liquidity','bounce'),'UNKNOWN')});
test('Bounce thesis gates define membership before score ordering',()=>{const accepted=evaluateStrategy('bounce',base);assert(accepted.score>=0&&accepted.score<=100);assert.equal(accepted.scoreCoverage,100);assert.equal(accepted.factors.reduce((sum,f)=>sum+f.maxPoints,0),100);assert.equal(accepted.checks.find(c=>c.id==='reversal').role,'eligibility');assert.equal(accepted.screeningQualified,true);const weaker=evaluateStrategy('bounce',{...base,return12m:-.2});assert(weaker.score>=0&&weaker.score<=100);assert.equal(weaker.checks.find(c=>c.id==='collapse').role,'eligibility');assert.equal(weaker.screeningQualified,false);assert.equal(weaker.status,'FAIL');assert.equal(weaker.factorStatus,'FAIL');assert(weaker.score<accepted.score)});
test('future evidence is excluded',()=>{const s={...base,provenance:{...base.provenance,marketCap:{...base.provenance.marketCap,availableAt:'2027-01-01T00:00:00Z'}}};assert.equal(gate(s,'provenance'),'UNKNOWN')});
test('missing research and source conflict never final ranks',()=>{const r=evaluateStrategy('core',{...base,confidence:'D',sourceConflicts:['Revenue disagreement']});assert.equal(r.finalRanked,false);assert.equal(r.checks.find(c=>c.id==='conflict').status,'UNKNOWN')});
test('same data and spec yield identical result and stable hash',()=>{assert.deepEqual(evaluateStrategy('core',base),evaluateStrategy('core',structuredClone(base)));assert.notEqual(specHash('core'),specHash('bounce'))});
test('split does not create dilution',()=>assert.equal(splitAdjustedDilution(200,100,2),0));
test('daily history ignores dividends, incomplete sessions, invalid and duplicate bars',()=>{
 const t=Date.parse('2026-08-28T13:30:00Z')/1000;
 const result=parseYahooDaily({chart:{result:[{timestamp:[t,t,t+86400,NaN,t+86400*4],indicators:{quote:[{close:[10,12,null,40,99],low:[9,11,null,38,90]}],adjclose:[{adjclose:[5,6,null,20,50]}]}}]}},'2026-09-01T15:00:00Z');
 assert.deepEqual(result.history.map(r=>r.close),[12]);assert.deepEqual(result.splits,[]);
 assert.equal(parseYahooDaily({chart:{error:{code:'oops'}}}).splits,null);
 const bad={chart:{result:[{events:{splits:{a:{date:t,numerator:2,denominator:0}}}}]}};assert.equal(parseYahooDaily(bad,'2026-09-01').splits,null);
});
test('daily history keeps a valid close but rejects impossible or zero OHLC fields',()=>{
 const t=Date.parse('2026-08-28T13:30:00Z')/1000;
 const [bar]=parseYahooDaily({chart:{result:[{timestamp:[t],indicators:{quote:[{close:[10],open:[9],high:[8],low:[0],volume:[100]}]}}]}},'2026-08-29T00:00:00Z').history;
 assert.deepEqual(bar,{date:'2026-08-28',close:10,open:undefined,high:undefined,low:undefined,volume:100});
});
test('last session is always the same completed close pair',()=>{
 const result=completedSessionQuote([{date:'2026-01-05',close:12},{date:'2026-01-03',close:10},{date:'2026-01-04',close:11}]);
 assert.deepEqual(result,{price:12,dailyChange:12/11-1,periodEnd:'2026-01-05'});
 assert.equal(completedSessionQuote([{date:'2026-01-05',close:12}]),null);
});
test('split review is evidence-based, interval-bound and idempotent',()=>{
 const p={...base.provenance.dilution,periodStart:'2025-06-30',periodEnd:'2026-06-30'};
 const s={...base,splitAdjusted:false,shareCountRatio:2.2,dilution:1.2,provenance:{...base.provenance,dilution:p,shareCountRatio:p}};
 const h={...p,source:'TEST ONLY SPLIT EVENTS'};
 const events=[{date:'2025-08-01',factor:2},{date:'2025-08-01',factor:2}];
 const result=reviewShareSplits(s,events,'2025-06-01','2026-08-28',h);
 assert.equal(result.splitAdjusted,true);assert(Math.abs(result.dilution-.1)<1e-9);assert.equal(result.shareCountRatio,1.1);
 assert.deepEqual(reviewShareSplits(result,events,'2025-06-01','2026-08-28',h),result);
 assert.equal(reviewShareSplits(s,null,'2025-06-01','2026-08-28',h).splitAdjusted,false);
 assert.equal(reviewShareSplits(s,[],'2025-07-01','2026-08-28',h).splitAdjusted,false);
 assert.equal(reviewShareSplits(s,[],'2025-06-01','2026-05-01',h).splitAdjusted,false);
 assert.equal(reviewShareSplits(s,[{date:'2025-08-01',factor:0}],'2025-06-01','2026-08-28',h).splitAdjusted,false);
 assert.equal(reviewShareSplits(s,events,'2025-06-01','2026-08-28',{...h,availableAt:'2028-01-01'}).splitAdjusted,false);
 assert.equal(reviewShareSplits(s,[],'2025-06-01','2026-08-28',h).splitAdjusted,true);
});
test('opportunity horizons clamp month ends and cover the requested 1/3/6/12-month periods',()=>{
 assert.deepEqual([1,3,6,12].map(months=>horizonDate('2026-01-31',months)),['2026-02-28','2026-04-30','2026-07-31','2027-01-31']);
 assert.equal(horizonDate('2024-08-31',6),'2025-02-28');assert.throws(()=>horizonDate('2026-01-01',2));
});
test('forward return measures the first close at the requested horizon without target or stop exits',()=>{
 const result=simulateForwardReturn(100,'2026-01-31',[{date:'2026-03-01',close:60},{date:'2026-03-01',close:61},{date:'2026-08-01',close:110},{date:'2026-08-03',close:80}],6);
 assert.equal(result.status,'OBSERVED');assert.equal(result.targetDate,'2026-07-31');assert.equal(result.exitDate,'2026-08-01');assert.equal(result.exit,110);assert.ok(Math.abs(result.netReturn-.1)<1e-12);assert.equal(result.priceReturnOnly,true);assert.match(result.convention,/no target or stop/);
});
test('forward outcome is censored when history ends early, is stale, or conflicts on the horizon session',()=>{
 assert.equal(simulateForwardReturn(100,'2026-01-01',[],3).reason,'history_ends_before_horizon');
 assert.equal(simulateForwardReturn(100,'2026-01-01',[{date:'2026-05-10',close:105}],3).reason,'no_close_near_horizon');
 assert.equal(simulateForwardReturn(100,'2026-01-01',[{date:'2026-04-01',close:105},{date:'2026-04-01',close:106}],3).reason,'conflicting_daily_closes');
});
test('forward return transaction costs are monotonic and invalid cost inputs are rejected',()=>{
 const bars=[{date:'2026-04-01',close:120}];const returns=[0,25,50,100].map(slippageBps=>simulateForwardReturn(100,'2026-01-01',bars,3,{slippageBps,commission:0,shares:1}).netReturn);
 assert(returns.every((value,index)=>!index||value<returns[index-1]));assert.throws(()=>simulateForwardReturn(100,'2026-01-01',bars,3,{slippageBps:Infinity,commission:0,shares:1}));
});
test('PIT actual disclosure and flagged 60-day fallback',()=>{const r=pointInTime([{periodEnd:'2023-06-30',availableAt:'2023-08-01T00:00:00Z'},{periodEnd:'2023-03-31'}],'2023-06-30T00:00:00Z');assert.equal(r.length,1);assert.equal(r[0].availabilityEstimated,true)});
test('stable firm holdout and bootstrap sampling',()=>{assert.equal(firmHoldout('CIK123','permanent-v1'),firmHoldout('CIK123','permanent-v1'));assert.throws(()=>firmHoldout('x',''));assert.equal(firmBootstrap([{firm:'a',value:1},{firm:'a',value:2},{firm:'b',value:3}],100).firms,2)});
test('multiple testing correction',()=>assert.equal(bonferroni(.01,80),.8));
test('annual cash flow not sum of cumulative quarters',()=>{const rows=[{start:'2024-01-01',end:'2024-12-31',val:100,filed:'2025-02-01',form:'10-K',tag:'CFO'},{start:'2024-01-01',end:'2024-06-30',val:40,filed:'2024-08-01',form:'10-Q',tag:'CFO'},{start:'2025-01-01',end:'2025-06-30',val:60,filed:'2025-08-01',form:'10-Q',tag:'CFO'}];assert.equal(trailingAnnual(rows,'2025-09-01T00:00:00Z').val,120)});
test('TTM bridge ignores a newer incompatible concept instead of discarding a valid same-tag bridge',()=>{
 const rows=[
  {start:'2024-01-01',end:'2024-12-31',val:100,filed:'2025-02-01',form:'10-K',tag:'RevenueA'},
  {start:'2024-01-01',end:'2024-06-30',val:40,filed:'2024-08-01',form:'10-Q',tag:'RevenueA'},
  {start:'2025-01-01',end:'2025-06-30',val:60,filed:'2025-08-01',form:'10-Q',tag:'RevenueA'},
  {start:'2025-01-01',end:'2025-09-30',val:999,filed:'2025-11-01',form:'10-Q',tag:'RevenueB'},
 ];
 assert.equal(trailingAnnual(rows,'2025-12-01T00:00:00Z').val,120);
});
test('foreign annual filers retained; future restatement excluded',()=>{const old={start:'2024-01-01',end:'2024-12-31',val:100,filed:'2025-02-01',form:'20-F'};assert.equal(trailingAnnual([old,{...old,val:200,filed:'2026-01-01'}],'2025-09-01T00:00:00Z').val,100)});
test('foreign 20-F plus matching 6-K YTD reports derive TTM only from comparable periods',()=>{
 const annual={start:'2025-01-01',end:'2025-12-31',val:1000,filed:'2026-03-01',form:'20-F',tag:'Revenue'};
 const prior={start:'2025-01-01',end:'2025-06-30',val:420,filed:'2025-08-10',form:'6-K',tag:'Revenue'};
 const current={start:'2026-01-01',end:'2026-06-30',val:600,filed:'2026-08-10',form:'6-K',tag:'Revenue'};
 const result=trailingAnnual([annual,prior,current],'2026-09-30T00:00:00Z');assert.equal(result.val,1180);assert.equal(result.end,'2026-06-30');assert.equal(result.method,'annual + current YTD − prior YTD');
 assert.equal(trailingAnnual([annual,current],'2026-09-30T00:00:00Z'),null,'unmatched interim periods must not fall back to stale annual data');
});
test('insiders only code P',()=>assert.equal(insiderPurchases(['P','A','M','S'].map(code=>({code,shares:10,price:5,date:'2025-01-01',owner:'a'}))).length,1));
test('instant latest never future',()=>assert.equal(latestInstant([{end:'2025-01-01',val:10,filed:'2025-02-01',form:'10-K'}],'2025-01-31T00:00:00Z'),null));
test('30 completed consecutive weekly closes, no partial week',()=>{const rows=[];for(let i=0;i<30;i++){const d=new Date('2025-01-03T00:00:00Z');d.setUTCDate(d.getUTCDate()+7*i);rows.push({date:d.toISOString().slice(0,10),close:100})}assert.equal(ma30Weeks(rows,'2025-08-01T00:00:00Z'),100);assert.equal(ma30Weeks(rows.slice(1),'2025-08-01T00:00:00Z'),null)});
test('Opportunity history derives dated return, low and MA without quote fields',()=>{const rows=[];for(let i=0;i<400;i++){const d=new Date('2024-01-02T00:00:00Z');d.setUTCDate(d.getUTCDate()+i);if(d.getUTCDay()===0||d.getUTCDay()===6)continue;const close=i<150?100-i*.3:55+(i-150)*.2;rows.push({date:d.toISOString().slice(0,10),close,low:close*.95})}const r=opportunityHistoryMetrics(rows,'2025-06-30T00:00:00Z');assert(Number.isFinite(r.return12m));assert(Number.isFinite(r.low52w));assert(Number.isFinite(r.ma30w));});
test('standalone Q3 cannot be misread as YTD',()=>{const rows=[{start:'2024-01-01',end:'2024-12-31',val:100,filed:'2025-02-01',form:'10-K',tag:'CFO'},{start:'2024-07-01',end:'2024-09-30',val:20,filed:'2024-11-01',form:'10-Q',tag:'CFO'},{start:'2025-07-01',end:'2025-09-30',val:30,filed:'2025-11-01',form:'10-Q',tag:'CFO'}];assert.equal(trailingAnnual(rows,'2025-12-01T00:00:00Z'),null)});
test('future price dependency cannot pass freshness or provenance',()=>{const s={...base,provenance:{...base.provenance,price:{...base.provenance.price,availableAt:'2027-01-01T00:00:00Z'}}};assert.equal(gate(s,'freshness'),'UNKNOWN');assert.equal(gate(s,'provenance'),'UNKNOWN')});
test('bulk snapshot derives FCF and valuation without per-company requests and keeps unverified security class unknown',()=>{const fact=(val,tag,end='2025-12-31')=>({cik:1,start:'2025-01-01',end,val,filed:'2026-02-15',form:'10-K',tag,priority:0,url:'https://data.sec.gov/test'});const s=preliminarySnapshot({cik:1,ticker:'TEST',name:'Test Corp',exchange:'Nasdaq',price:10,marketCap:100e6,averageVolume10d:100000},{revenue:fact(50e6,'Revenues'),netIncome:fact(2e6,'NetIncomeLoss'),ocf:fact(6e6,'NetCashProvidedByUsedInOperatingActivities'),capex:fact(1e6,'PaymentsToAcquirePropertyPlantAndEquipment'),cash:fact(10e6,'CashAndCashEquivalentsAtCarryingValue'),debtNoncurrent:fact(20e6,'LongTermDebtNoncurrent')},'2026-03-01T00:00:00.000Z');assert.equal(s.fcf,5e6);assert.equal(s.ps,2);assert.equal(s.evSales,undefined);assert.equal(s.medianDollarVolume20d,undefined);assert.equal(s.securityType,'unknown');assert.match(s.dataIssues[0],/لا يُستنتج/)});
test('bulk quote provenance uses the provider market date, not the later scan date',()=>{
 const s=preliminarySnapshot({cik:1,ticker:'DATE',name:'Date Corp',exchange:'Nasdaq',price:10,marketCap:100e6,quoteSource:'dated test',quoteAvailableAt:'2026-02-27T21:00:00Z'},undefined,'2026-03-01T12:00:00Z');
 assert.equal(s.provenance.price.periodEnd,'2026-02-27');assert.equal(s.provenance.price.retrievedAt,'2026-03-01T12:00:00Z');
});
test('IFRS cash and borrowings remain usable for EV/S',()=>{const fact=(val,tag)=>({cik:3,start:'2025-01-01',end:'2025-12-31',val,filed:'2026-02-15',form:'20-F',tag,priority:1,url:'https://data.sec.gov/test'});const s=preliminarySnapshot({cik:3,ticker:'IFRS',name:'Foreign Corp',exchange:'NYSE',price:4,marketCap:100e6,averageVolume10d:100000},{revenue:fact(50e6,'RevenueFromContractWithCustomerExcludingAssessedTax'),netIncome:fact(2e6,'ProfitLoss'),cash:{...fact(10e6,'CashAndCashEquivalents'),end:'2026-06-30',start:undefined},debtCurrent:{...fact(5e6,'BorrowingsCurrent'),end:'2026-06-30',start:undefined},debtNoncurrent:{...fact(20e6,'BorrowingsNoncurrent'),end:'2026-06-30',start:undefined}},'2026-07-01T00:00:00.000Z');assert.equal(s.evSales,2.3);});
test('bulk snapshot never treats missing SEC coverage as zero',()=>{const s=preliminarySnapshot({cik:2,ticker:'MISS',name:'Missing Corp',exchange:'NYSE',price:5,marketCap:50e6},undefined,'2026-03-01T00:00:00.000Z');assert.equal(s.revenue,undefined);assert.equal(evaluateStrategy('core',s).status,'UNKNOWN');assert.match(s.dataIssues[0],/لا توجد تغطية/)});
test('Yahoo percentage points are normalized exactly once',()=>{assert.equal(yahooPercentAsRatio(25.4),.254);assert(Math.abs(yahooPercentAsRatio(-93.6)+.936)<1e-12);assert.equal(yahooPercentAsRatio(null),undefined)});
test('Yahoo share-class symbols use the provider punctuation convention',()=>{assert.equal(yahooSymbol('brk.b'),'BRK-B');assert.equal(yahooSymbol('ACME'),'ACME')});
test('Yahoo bulk quotes require a valid provider market timestamp before replacing fallback data',async()=>{
 const original=globalThis.fetch,now=Math.floor(Date.now()/1000);let call=0;
  globalThis.fetch=async()=>{call++;if(call===1)return new Response('',{headers:{'set-cookie':'A=1; Path=/'}});if(call===2)return new Response('crumb');return Response.json({quoteResponse:{result:[{symbol:'DOT-A',regularMarketPrice:12,regularMarketChangePercent:4.2,regularMarketTime:now},{symbol:'STALE',regularMarketPrice:99}]}})};
 try{
  const rows=await yahooBulkQuotes([{cik:1,ticker:'DOT.A',name:'Dot',exchange:'NYSE',price:8,marketCap:80e6,quoteSource:'bundled official dated snapshot',quoteAvailableAt:'2026-01-01T00:00:00Z',priceSource:'bundled official dated snapshot',priceAvailableAt:'2026-01-01T00:00:00Z',marketCapSource:'bundled official dated snapshot',marketCapAvailableAt:'2026-01-01T00:00:00Z'},{cik:2,ticker:'STALE',name:'Stale',exchange:'NYSE',price:7,quoteAvailableAt:'2026-01-01T00:00:00Z'}]);
  assert.equal(rows[0].price,12);assert.equal(rows[0].intradayChange,.042);assert.equal(rows[0].dailyChange,undefined);assert.equal(rows[0].quoteSource,'Yahoo bulk quote live');assert.equal(rows[0].marketCap,80e6);assert.equal(rows[0].marketCapAvailableAt,'2026-01-01T00:00:00Z');assert.notEqual(rows[0].priceAvailableAt,rows[0].marketCapAvailableAt);
  const snapshot=preliminarySnapshot(rows[0],undefined,new Date().toISOString());assert.equal(snapshot.provenance.price.source,'Yahoo bulk quote live');assert.equal(snapshot.provenance.marketCap.source,'bundled official dated snapshot');
  assert.equal(rows[1].price,7);assert.equal(rows[1].quoteSource,undefined);
 }finally{globalThis.fetch=original;}
});
test('UNKNOWN strategy gates remain outside the category',()=>{const r=evaluateStrategy('core',{...base,confidence:'B',sourceConflicts:[],deathSpiral:'unknown'});assert.equal(r.checks.find(c=>c.id==='deathSpiral').status,'UNKNOWN');assert.equal(r.factorStatus,'UNKNOWN');assert.equal(r.screeningQualified,false);assert.equal(r.status,'UNKNOWN');assert.equal(r.qualified,false);assert.equal(r.gateStatus,'UNKNOWN');assert.equal(r.measurableStatus,'UNKNOWN')});
test('Core exposes a strict completeness-adjusted 100-point diagnostic score',()=>{const r=evaluateStrategy('core',base);assert.equal(r.rawScore,62.8);assert.equal(r.evidenceScore,81.6);assert.equal(r.score,62.8);assert.equal(r.factors.reduce((sum,f)=>sum+f.maxPoints,0),100);assert(r.factors.every(f=>f.points>=0&&f.points<=f.maxPoints));assert.equal(r.scoreCoverage,77);const partial=evaluateStrategy('core',{...base,fcf:null});assert(partial.score<r.score)});
test('complete dated evidence passes conflict check while a documented disagreement does not',()=>{assert.equal(gate({...base,confidence:'C',sourceConflicts:[]},'conflict'),'PASS');assert.equal(gate({...base,confidence:'D',sourceConflicts:['marketCap mismatch']},'conflict'),'UNKNOWN')});
test('future period end is unusable even when filing timestamp claims the past',()=>{
 assert.equal(gate({...base,provenance:{...base.provenance,revenue:{...base.provenance.revenue,periodEnd:'2028-01-01'}}},'provenance'),'UNKNOWN');
 assert.equal(latestInstant([{end:'2027-01-01',val:10,filed:'2025-01-01',form:'10-K'}],'2026-01-01'),null);
});
test('an unverified split cannot pass via a stable-looking share ratio',()=>{
 for(const splitAdjusted of [false,undefined]){
  const snapshot={...base,dilution:.1,shareCountRatio:1.1,splitAdjusted};
  assert.equal(gate(snapshot,'dilution','bounce'),'UNKNOWN');
  for(const strategy of ['core','bounce']){const factor=evaluateStrategy(strategy,snapshot).factors.find(f=>f.id===(strategy==='core'?'shareDiscipline':'dilution'));assert.equal(factor.available,false);assert.equal(factor.points,0);}
 }
});
test('unknown financing-risk review does not masquerade as covered quality',()=>{
 const result=evaluateStrategy('core',{...base,deathSpiral:'unknown',riskEvidence:undefined});
 const quality=result.factors.find(f=>f.id==='quality');assert.equal(quality.available,false);assert.equal(quality.availableWeight,0);assert.equal(result.scoreCoverage,58);
});
test('missing or future score inputs receive no points or score coverage',()=>{
 const p={...base.provenance,evSales:{...base.provenance.evSales,availableAt:'2028-01-01'}};
 const score=evaluateStrategy('core',{...base,provenance:p});assert.equal(score.factors.find(f=>f.id==='valuation').available,false);
 const partial=evaluateStrategy('core',{...base,fcf:null});assert.equal(partial.factors.find(f=>f.id==='quality').availableWeight,SPECS.core.weights.Quality/2);assert.equal(partial.scoreCoverage,77-SPECS.core.weights.Quality/2);
});
test('derived evidence uses the latest dependency and refuses future dependencies',()=>{
 const a={...base.provenance.revenue,availableAt:'2026-01-01'},b={...a,availableAt:'2026-08-31'};
 assert.equal(derivedEvidence('test',[a,b],base.asOf,'formula').availableAt,b.availableAt);
 assert.equal(derivedEvidence('test',[a,{...b,availableAt:'2028-01-01'}],base.asOf,'formula'),undefined);
});
test('bulk financials reject future balance sheets and mismatched cash-flow periods',()=>{
 const f=(val,start,end)=>({cik:1,val,start,end,filed:'2026-01-01',tag:'test',priority:0,url:'https://data.sec.gov/test'});
 const c={ticker:'BAD',name:'Synthetic Corp',exchange:'NYSE',cik:1,marketCap:100,price:1};
 const s=preliminarySnapshot(c,{revenue:f(100,'2025-01-01','2025-12-31'),ocf:f(20,'2025-01-01','2025-12-31'),capex:f(3,'2025-10-01','2025-12-31'),cash:f(10,undefined,'2027-01-01'),debtCurrent:f(1,undefined,'2025-12-31'),debtNoncurrent:f(2,undefined,'2025-12-31')},'2026-09-01T00:00:00Z');
 assert.equal(s.fcf,undefined);assert.equal(s.cash,undefined);assert.equal(s.evSales,undefined);assert.equal(s.debt,3);
});
test('SEC Company Facts fallback recovers standard annual, balance-sheet and share facts without future leakage',()=>{
 const asOf=new Date('2026-09-01T00:00:00Z'),annual=(tag,val)=>({start:'2025-01-01',end:'2025-12-31',val,filed:'2026-02-15',form:'10-K',tag}),instant=(tag,val,end='2026-06-30',filed='2026-08-01')=>({end,val,filed,form:'10-Q',tag}),
 facts={
  'us-gaap':{
   Revenues:{units:{USD:[annual('Revenues',120)]}},NetIncomeLoss:{units:{USD:[annual('NetIncomeLoss',12)]}},
   NetCashProvidedByUsedInOperatingActivities:{units:{USD:[annual('NetCashProvidedByUsedInOperatingActivities',20)]}},
   PaymentsToAcquirePropertyPlantAndEquipment:{units:{USD:[annual('PaymentsToAcquirePropertyPlantAndEquipment',4)]}},
   CashAndCashEquivalentsAtCarryingValue:{units:{USD:[instant('CashAndCashEquivalentsAtCarryingValue',30)]}},
   LongTermDebtCurrent:{units:{USD:[instant('LongTermDebtCurrent',2)]}},LongTermDebtNoncurrent:{units:{USD:[instant('LongTermDebtNoncurrent',8)]}},
  },
  dei:{EntityCommonStockSharesOutstanding:{units:{shares:[instant('EntityCommonStockSharesOutstanding',110),instant('EntityCommonStockSharesOutstanding',100,'2025-06-30','2025-08-01')]}}}
 }, parsed=parseCompanyFacts(123,{cik:123,facts},asOf);
 assert(parsed);assert.equal(parsed.revenue.val,120);assert.equal(parsed.netIncome.val,12);assert.equal(parsed.cash.val,30);assert.equal(parsed.debtCurrent.val,2);assert.equal(parsed.debtNoncurrent.val,8);assert.equal(parsed.shares.val,110);assert.equal(parsed.priorShares.val,100);assert.equal(parsed.revenue.kind,'companyfacts');assert.equal(needsCompanyFacts(parsed),false);
 const future={cik:123,facts:{'us-gaap':{Revenues:{units:{USD:[annual('Revenues',999),{...annual('Revenues',1000),end:'2027-12-31',filed:'2026-08-01'}]}}}}};assert.equal(parseCompanyFacts(123,future,asOf).revenue.val,999);
});
test('Company Facts bulk fallback rejects a valid-looking response for a different issuer',()=>{
 const payload={cik:'0000000124',facts:{'us-gaap':{Revenues:{units:{USD:[{start:'2025-01-01',end:'2025-12-31',val:999,filed:'2026-02-01',form:'10-K'}]}}}}};
 assert.equal(parseCompanyFacts(123,payload,new Date('2026-09-01T00:00:00Z')),undefined);
});
test('Company Facts custom-only payload remains unavailable instead of being guessed',()=>{
 const parsed=parseCompanyFacts(124,{facts:{'custom-taxonomy':{MyRevenue:{units:{USD:[{start:'2025-01-01',end:'2025-12-31',val:100,filed:'2026-02-01',form:'10-K'}]}}}}},new Date('2026-09-01T00:00:00Z'));
 assert.equal(parsed,undefined);assert.equal(needsCompanyFacts(undefined),true);
});
test('Company Facts provenance is visible in the preliminary snapshot',()=>{
 const fact=(key,val,tag,start='2025-01-01',end='2025-12-31')=>({cik:77,key,val,tag,start,end,filed:'2026-02-01',form:'10-K',priority:0,url:'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000077.json',kind:'companyfacts'});
 const s=preliminarySnapshot({cik:77,ticker:'FACT',name:'Facts Corp',exchange:'Nasdaq',price:10,marketCap:100e6},{revenue:fact('revenue',50e6,'Revenues'),netIncome:fact('netIncome',2e6,'NetIncomeLoss'),ocf:fact('ocf',6e6,'NetCashProvidedByUsedInOperatingActivities'),capex:fact('capex',1e6,'PaymentsToAcquirePropertyPlantAndEquipment')},'2026-03-01T00:00:00Z');
 assert.match(s.provenance.revenue.source,/Company Facts/);assert.equal(s.fcf,5e6);
});
test('Company Facts fallback retries a transient provider error and returns a dated fact',async()=>{
 const original=globalThis.fetch;let calls=0;const asOf=new Date('2026-09-01T00:00:00Z');
 globalThis.fetch=async()=>{calls++;if(calls===1)return new Response('',{status:503});return Response.json({cik:9876543,facts:{'us-gaap':{Revenues:{units:{USD:[{start:'2025-01-01',end:'2025-12-31',val:120,filed:'2026-02-15',form:'10-K'}]}}}}});};
 try{const result=await fetchCompanyFactsFallback([9876543],asOf);assert.equal(result.requests,1);assert.equal(result.success,1);assert.equal(result.failed,0);assert(calls>=2);assert.equal(result.fundamentals.get(9876543).revenue.val,120);assert.equal(result.fundamentals.get(9876543).revenue.kind,'companyfacts');}finally{globalThis.fetch=original;}
});
test('Company Facts fallback replaces older persisted facts when a newer filing is retrieved',async()=>{
 const original=globalThis.fetch,cik=9876545,old={cik,start:'2025-01-01',end:'2025-12-31',val:100,filed:'2026-01-20',form:'10-K',tag:'Revenues',priority:0,url:'https://data.sec.gov/old',kind:'frames'};
 globalThis.fetch=async()=>Response.json({cik,facts:{'us-gaap':{Revenues:{units:{USD:[{start:'2025-01-01',end:'2025-12-31',val:120,filed:'2026-02-15',form:'10-K',tag:'Revenues'}]}}}}});
 try{const result=await fetchCompanyFactsFallback([cik],new Date('2026-09-01T00:00:00Z'),new Map([[cik,{revenue:old}]]));assert.equal(result.fundamentals.get(cik).revenue.val,120);assert.deepEqual(result.changed,[cik]);}
 finally{globalThis.fetch=original;}
});
test('Company Facts permission failures are recorded without an unbounded retry queue',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('',{status:403});
 try{const result=await fetchCompanyFactsFallback([9876544],new Date('2026-09-01T00:00:00Z'));assert.equal(result.failed,1);assert.deepEqual(result.retryableFailedCiks,[]);}
 finally{globalThis.fetch=original;}
});
test('deep financial enrichment derives cash debt EV/S without treating missing debt as zero',()=>{
 const row=val=>({val,end:'2026-06-30',filed:'2026-08-01',form:'10-Q'});
 const facts={'us-gaap':Object.fromEntries([['CashAndCashEquivalentsAtCarryingValue',20e6],['LongTermDebtCurrent',3e6],['LongTermDebtNoncurrent',7e6]].map(([tag,val])=>[tag,{units:{USD:[row(val)]}}]))};
 const s=enrichFinancials(base,facts,'https://data.sec.gov/test');assert.equal(s.cash,20e6);assert.equal(s.debt,10e6);assert.equal(s.evSales,(base.marketCap-10e6)/base.revenue);
 const missing=structuredClone(facts);delete missing['us-gaap'].LongTermDebtCurrent;
 const partial=enrichFinancials({...base,evSales:undefined},missing,'https://data.sec.gov/test');assert.equal(partial.debt,undefined);assert.equal(partial.evSales,undefined);
});
test('deep financial enrichment derives gross margin and contracted backlog from standard SEC facts',()=>{
 const facts={
  'us-gaap':{
   Revenues:{units:{USD:[{start:'2025-01-01',end:'2025-12-31',val:100,filed:'2026-02-01',form:'10-K'}]}},
   CostOfGoodsAndServicesSold:{units:{USD:[{start:'2025-01-01',end:'2025-12-31',val:40,filed:'2026-02-01',form:'10-K'}]}},
   ContractWithCustomerLiability:{units:{USD:[{end:'2025-12-31',val:25,filed:'2026-02-01',form:'10-K'}]}}
  }
 };
 const s=enrichFinancials({...base,asOf:'2026-09-01T00:00:00Z'},facts,'https://data.sec.gov/test');
 assert.equal(s.grossMargin,.6);assert.equal(s.backlog.amount,25);assert.equal(s.provenance.grossMargin.source,'SEC revenue and cost of revenue');assert.equal(s.provenance.backlog.source,'SEC EDGAR');
});
test('Cboe fallback parser keeps only bounded positive dated OHLCV rows',()=>{
 const rows=parseCboeDaily({data:[{date:'2026-01-02',close:12,open:11,high:13,low:10,volume:100},{date:'2025-12-31',close:9},{date:'2026-02-01',close:0},{date:'bad',close:20}]},'2026-01-01','2026-01-31');
 assert.deepEqual(rows.map(row=>row.date),['2026-01-02']);assert.equal(rows[0].volume,100);
});
test('SEC filing index becomes profile events when RSS is unavailable',()=>{
 const news=parseSecFilingNews({filings:{recent:{form:['8-K','4','10-Q'],accessionNumber:['0000000000-26-000001','0000000000-26-000002','0000000000-26-000003'],primaryDocument:['current.htm','form4.xml','quarter.htm'],filingDate:['2026-08-01','2026-08-02','2026-07-01']}}},123,'2026-09-01T00:00:00Z');
 assert.equal(news.length,2);assert.match(news[0].link,/Archives\/edgar\/data\/123\/000000000026000001\/current.htm/);assert.equal(news[1].source,'SEC EDGAR filings');
});

test('SEC issuer filing index validates identity, bounds dates, and emits safe primary-source links',()=>{
 const payload={cik:'0000000123',filings:{recent:{form:['8-K','S-3','4','10-Q','8-K'],accessionNumber:['0000000123-26-000001','0000000123-26-000002','0000000123-26-000003','0000000123-26-000004','0000000123-26-000005'],primaryDocument:['current.htm','s3.htm','form4.xml','quarter.htm','../../escape.htm'],filingDate:['2026-09-20','2026-08-01','2026-07-01','2026-06-30','2026-09-25'],reportDate:['2026-09-18','','','2026-06-30','']}}};
 const result=parseSecFilingIndex(payload,123,'2026-09-22T12:00:00.000Z',20);
 assert.equal(result.providerStatus,'partial');assert.equal(result.items.length,4);assert.deepEqual(result.items.map(item=>item.form),['8-K','S-3','4','10-Q']);assert.match(result.limitations.join(' '),/1 malformed recent-index row/);
 assert.ok(result.items.every(item=>item.filed<='2026-09-22'));assert.match(result.items[0].url,/Archives\/edgar\/data\/123\/000000012326000001\/current\.htm$/);assert.equal(result.items[0].reportDate,'2026-09-18');
 assert.equal(result.source.availableAt,'2026-09-22T12:00:00.000Z');assert.match(result.limitations.join(' '),/discovery aid|contents|future catalyst/i);
 const sameCut=parseSecFilingIndex(payload,123,'2026-09-22T12:00:00.000Z',20,'2026-09-22T12:00:00.000Z');assert.equal(sameCut.source.retrievedAt,sameCut.source.availableAt);
});
test('SEC filing index separates unavailable, invalid, genuinely empty, and future-only results',()=>{
 const payload={cik:'124',filings:{recent:{form:['8-K'],accessionNumber:['0000000124-26-000001'],primaryDocument:['current.htm'],filingDate:['2026-09-23']}}};
 assert.equal(parseSecFilingIndex(payload,123,'2026-09-22T12:00:00Z').providerStatus,'invalid');
 assert.equal(parseSecFilingIndex({...payload,cik:'123'},123,'not-a-date').providerStatus,'invalid');
 assert.equal(parseSecFilingIndex({...payload,cik:'123'},123,'2026-02-30T12:00:00Z').providerStatus,'invalid');
 assert.equal(parseSecFilingIndex(null,123,'2026-09-22T12:00:00Z').providerStatus,'unavailable');
 const future=parseSecFilingIndex({...payload,cik:'123'},123,'2026-09-22T12:00:00Z');assert.equal(future.providerStatus,'empty');assert.equal(future.items.length,0);
 const empty=parseSecFilingIndex({cik:'123',filings:{recent:{form:[],accessionNumber:[],primaryDocument:[],filingDate:[]}}},123,'2026-09-22T12:00:00Z');assert.equal(empty.providerStatus,'empty');
 const malformed=parseSecFilingIndex({cik:'123',filings:{recent:{form:'8-K',accessionNumber:[],primaryDocument:[],filingDate:[]}}},123,'2026-09-22T12:00:00Z');assert.equal(malformed.providerStatus,'invalid');
});
test('SEC 8-K body parser extracts only supported item references and rejects oversized input',()=>{
 const html='<html><body><h2>Item 1.01 Entry into a Material Definitive Agreement</h2><p>See Item 2.02 and Item 9.01.</p><script>Item 5.02</script><!-- Item 7.01 --><p>Item 99.99</p></body></html>';
 assert.deepEqual(parseSec8KItemReferences(html),['1.01','2.02','9.01']);
 assert.deepEqual(parseSec8KItemReferences('Item 1.01'),[]);
 assert.deepEqual(parseSec8KItemReferences('x'.repeat(512_001)),[]);
});
test('SEC 8-K item acquisition is identity checked and bounded to four recent validated filings',async()=>{
 const original=globalThis.fetch,previousAgent=process.env.SEC_USER_AGENT;process.env.SEC_USER_AGENT='SmallCapRadar/2.2 (contact: test@example.com)';let requests=0;
 const cik=9876511,accessions=Array.from({length:6},(_,i)=>`${String(cik).padStart(10,'0')}-26-${String(i+1).padStart(6,'0')}`);
 const payload={cik:String(cik),filings:{recent:{form:accessions.map(()=>'8-K'),accessionNumber:accessions,primaryDocument:accessions.map((_,i)=>`report${i}.htm`),filingDate:accessions.map((_,i)=>`2026-09-${String(20-i).padStart(2,'0')}`)}}};
 globalThis.fetch=async url=>{requests++;assert.match(String(url),/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//);return new Response('<html><body><h2>Item 2.02</h2><p>Item 9.01</p></body></html>',{status:200,headers:{'content-type':'text/html'}})};
 try{const result=await fetchSec8KItemIndex(payload,cik,'2026-09-30T12:00:00.000Z','2026-09-30T12:00:00.000Z');assert.equal(result.providerStatus,'partial');assert.equal(result.selectedDocuments,4);assert.equal(result.fetchedDocuments,4);assert.equal(result.items.length,4);assert.equal(requests,4);assert.deepEqual(result.items[0].referencedItemNumbers,['2.02','9.01']);assert.match(result.limitations.join(' '),/Only the newest 4/);assert.match(result.limitations.join(' '),/does not summarize/);
  const invalid=await fetchSec8KItemIndex(payload,cik+1,'2026-09-30T12:00:00.000Z','2026-09-30T12:00:00.000Z');assert.equal(invalid.providerStatus,'unavailable');assert.equal(requests,4);
 }finally{globalThis.fetch=original;if(previousAgent===undefined)delete process.env.SEC_USER_AGENT;else process.env.SEC_USER_AGENT=previousAgent;}
});
test('bulk Opportunity enrichment omits the large filing list while profile-only discovery remains available',async()=>{
 const original=globalThis.fetch,cik=9876543,previousAgent=process.env.SEC_USER_AGENT;process.env.SEC_USER_AGENT='SmallCapRadar/2.2 (contact: test@example.com)';
 globalThis.fetch=async url=>String(url).includes('/submissions/CIK')?Response.json({cik:String(cik),sic:'7372',sicDescription:'Services-Prepackaged Software',filings:{recent:{form:['8-K'],accessionNumber:[`${String(cik).padStart(10,'0')}-26-000001`],primaryDocument:['current.htm'],filingDate:['2026-09-20']}}}):Response.json({cik,facts:{}});
 try{const snapshot={...opportunitySnapshot,cik,provenance:{...opportunitySnapshot.provenance}};await enrichSnapshotsWithSecOpportunity([snapshot]);assert.equal(snapshot.opportunityResearch.secFilings,undefined,'do not persist up to 60 SEC rows per issuer in every scan snapshot');assert.equal(snapshot.opportunityResearch.earnings.providerStatus,'retrieved');}
 finally{globalThis.fetch=original;if(previousAgent===undefined)delete process.env.SEC_USER_AGENT;else process.env.SEC_USER_AGENT=previousAgent;}
});

test('Form 4 acquisition selects only filings in the prior 12 months and exposes window coverage',()=>{
 const dates=['2026-09-20','2026-02-01','2025-10-01','2025-09-29','2026-10-01'];
 const payload={filings:{recent:{form:dates.map((_,i)=>i===1?'10-Q':'4'),accessionNumber:dates.map((_,i)=>`0000000000-26-${String(i+1).padStart(6,'0')}`),primaryDocument:dates.map((_,i)=>i===1?'q.htm':'form4.xml'),filingDate:dates}}};
 const selection=selectRecentForm4Filings(payload,'2026-09-30T18:00:00.000Z',8);
 assert.deepEqual(selection.selected.map(row=>row.filed),['2026-09-20','2025-10-01']);
 assert.equal(selection.coverage.windowStart,'2025-09-30');
 assert.equal(selection.coverage.availableForm4Count,2);
 assert.equal(selection.coverage.submissionWindowComplete,true);
});

test('Form 4 coverage is partial when SEC submission history does not reach the requested window',()=>{
 const payload={filings:{recent:{form:['4','10-Q'],accessionNumber:['a','b'],primaryDocument:['form4.xml','q.htm'],filingDate:['2026-08-01','2026-07-25']}}};
 const selection=selectRecentForm4Filings(payload,'2026-09-30T18:00:00.000Z',8);
 assert.equal(selection.coverage.submissionWindowComplete,false);
 assert.equal(selection.coverage.state,'partial');
});
test('Form 4 retrieval distinguishes inaccessible filing documents from absent code-P purchases',async()=>{
 const original=globalThis.fetch,previousAgent=process.env.SEC_USER_AGENT,filingDates=[...Array(54).fill('2026-09-20'),'2025-09-29'];process.env.SEC_USER_AGENT='SmallCapRadar/2.2 (contact: test@example.com)';
 const payload={filings:{recent:{form:filingDates.map((_,i)=>i===8?'10-Q':'4'),accessionNumber:filingDates.map((_,i)=>`0000999999-26-${String(i+1).padStart(6,'0')}`),primaryDocument:filingDates.map((_,i)=>i===8?'q.htm':'f4.xml'),filingDate:filingDates}}};
 globalThis.fetch=async url=>String(url).includes('/submissions/CIK')?Response.json(payload):new Response('',{status:403});
 try{const result=await fetchInsiderPurchases(9999999,'2026-09-30T18:00:00.000Z');assert.equal(result.purchases.length,0);assert.equal(result.coverage.state,'partial');assert.equal(result.coverage.availableForm4Count,53);assert.equal(result.coverage.selectedForm4Count,53);assert.equal(result.coverage.fetchedForm4Count,0);assert.equal(result.coverage.failedForm4Count,53);assert.equal(result.coverage.httpStatusCounts['403'],53);assert.match(result.coverage.message,/53 of 53/);assert.match(result.coverage.message,/HTTP 403: 53/);}finally{globalThis.fetch=original;if(previousAgent===undefined)delete process.env.SEC_USER_AGENT;else process.env.SEC_USER_AGENT=previousAgent;}
});
test('Form 4 HTTP 200 error bodies are invalid and never marked reviewed or complete',async()=>{
 const original=globalThis.fetch,previousAgent=process.env.SEC_USER_AGENT,cik=9999998;process.env.SEC_USER_AGENT='SmallCapRadar/2.2 (contact: test@example.com)';
 const payload={filings:{recent:{form:['4','4','10-Q'],accessionNumber:['0000999999-26-000001','0000999999-25-000002','0000999999-25-000003'],primaryDocument:['f4.xml','f4-old.xml','q.htm'],filingDate:['2026-09-20','2025-10-01','2025-09-20']}}};
 globalThis.fetch=async url=>String(url).includes('/submissions/CIK')?Response.json(payload):new Response('<html><body>temporarily unavailable</body></html>',{status:200});
 try{const result=await fetchInsiderPurchases(cik,'2026-09-30T18:00:00.000Z');assert.equal(result.coverage.state,'partial');assert.equal(result.coverage.fetchedForm4Count,2);assert.equal(result.coverage.reviewedForm4Count,0);assert.equal(result.coverage.invalidForm4Count,2);assert.equal(result.coverage.failedForm4Count,0);assert.match(result.coverage.message,/malformed/);}finally{globalThis.fetch=original;if(previousAgent===undefined)delete process.env.SEC_USER_AGENT;else process.env.SEC_USER_AGENT=previousAgent;}
});
test('Form 4 validated ownership documents with no code-P purchases can complete review',async()=>{
 const original=globalThis.fetch,previousAgent=process.env.SEC_USER_AGENT,cik=9999997;process.env.SEC_USER_AGENT='SmallCapRadar/2.2 (contact: test@example.com)';
 const payload={filings:{recent:{form:['4','4','10-Q'],accessionNumber:['0000999999-26-000001','0000999999-25-000002','0000999999-25-000003'],primaryDocument:['f4.xml','f4-old.xml','q.htm'],filingDate:['2026-09-20','2025-10-01','2025-09-20']}}};
 const xml='<?xml version="1.0"?><ownershipDocument><issuer><issuerCik>9999999</issuerCik></issuer><reportingOwner><rptOwnerName>Test Officer</rptOwnerName></reportingOwner></ownershipDocument>';
 globalThis.fetch=async url=>String(url).includes('/submissions/CIK')?Response.json(payload):new Response(xml,{status:200});
 try{const result=await fetchInsiderPurchases(cik,'2026-09-30T18:00:00.000Z');assert.equal(result.coverage.state,'complete');assert.equal(result.coverage.fetchedForm4Count,2);assert.equal(result.coverage.reviewedForm4Count,2);assert.equal(result.coverage.invalidForm4Count,0);assert.equal(result.purchases.length,0);}finally{globalThis.fetch=original;if(previousAgent===undefined)delete process.env.SEC_USER_AGENT;else process.env.SEC_USER_AGENT=previousAgent;}
});
test('intraday parser removes null, duplicate and future points and uses previous close baseline',()=>{
 const asOf='2026-09-08T15:00:00Z',cut=Math.floor(Date.parse(asOf)/1000);
 const r=parseYahooIntraday({chart:{result:[{timestamp:[cut-600,cut-300,cut-300,cut+300],indicators:{quote:[{close:[10,null,11,12]}]},meta:{chartPreviousClose:8}}]}},asOf);
 assert.deepEqual(r.points,[{t:cut-600,c:10},{t:cut-300,c:11}]);assert.equal(r.baseline,8);assert.equal(r.changePct,.375);
});
test('official directory excludes ETF and test issues and joins SEC CIKs',()=>{
 const nasdaq='Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares\nAAA|AAA old|Q|N|N|100|N|N\nETFZ|Fund|Q|N|N|100|Y|N\nTEST|Test|Q|Y|N|100|N|N';
 const other='ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol\nBBB|BBB Inc|N|BBB|N|100|N|BBB\nOTC|OTC Inc|U|OTC|N|100|N|OTC';
 assert.deepEqual(parseOfficialDirectory(nasdaq,other,{'0':{ticker:'AAA',title:'AAA SEC',cik_str:123},'1':{ticker:'BBB',title:'BBB SEC',cik_str:456}}),[{ticker:'AAA',name:'AAA SEC',exchange:'Nasdaq',cik:123,securityType:'unknown',securityName:'AAA old',directoryUrl:'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt'},{ticker:'BBB',name:'BBB SEC',exchange:'NYSE',cik:456,securityType:'unknown',securityName:'BBB Inc',directoryUrl:'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'}]);
});
test('official directory joins SEC dash symbols to Nasdaq dot share classes',()=>{
 const other='ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol\nBRK.B|Class B|N|BRK.B|N|100|N|BRK.B';
 assert.deepEqual(parseOfficialDirectory('',other,{'0':{ticker:'BRK-B',title:'Issuer',cik_str:1067983}}),[{ticker:'BRK.B',name:'Issuer',exchange:'NYSE',cik:1067983,securityType:'unknown',securityName:'Class B',directoryUrl:'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'}]);
});
test('listed security classification requires explicit issue-type wording and never infers common from issuer names',()=>{
 assert.equal(classifyListedSecurity('Acme Corporation - Class A Common Stock'),'common');
 assert.equal(classifyListedSecurity('Acme Corporation 6.5% Series A Preferred'),'preferred');
 assert.equal(classifyListedSecurity('Acme Corporation Warrants'),'warrant');
 assert.equal(classifyListedSecurity('Acme Corporation - American Depositary Shares'),'adr');
 assert.equal(classifyListedSecurity('Acme Corporation - American Depository Shares'),'adr');
 assert.equal(classifyListedSecurity('Closed End Fund Common Shares of Beneficial Interest'),'fund');
 assert.equal(classifyListedSecurity('Acme Corporation - Class A Ordinary Shares'),'common');
 assert.equal(classifyListedSecurity('Acme Corporation'),'unknown');
 assert.equal(classifyListedSecurity('Acme Corporation','Y'),'fund');
});
test('on-demand company resolution joins the live exchange issue class and retains retrieval provenance',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>{
  const value=String(url);
  if(value.endsWith('/nasdaqlisted.txt'))return new Response('Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares\nLIVESEC|Live Example Corp - Class A Common Stock|Q|N|N|100|N|N\n');
  if(value.endsWith('/otherlisted.txt'))return new Response('ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol\n');
  if(value.endsWith('/company_tickers.json'))return Response.json({'0':{ticker:'LIVESEC',title:'Live Example Corp',cik_str:123}});
  throw Error(`unexpected fixture URL ${value}`);
 };
 try{const company=await resolveCompanyBySymbol('LIVESEC');assert.equal(company?.securityType,'common');assert.equal(company?.securityName,'Live Example Corp - Class A Common Stock');assert.equal(company?.cik,123);assert.match(company?.directoryUrl,/nasdaqlisted\.txt$/);assert.ok(Number.isFinite(Date.parse(company?.directoryAvailableAt||'')));const matches=await searchListedCompanies('Live Example');assert.equal(matches[0]?.ticker,'LIVESEC');assert.equal(matches[0]?.securityType,'common');}
 finally{globalThis.fetch=original;}
});
test('live company search keeps exchange coverage when optional CIK lookup is unavailable',async()=>{
 const original=globalThis.fetch,{searchListedCompanies:searchFreshModule}=await import('../../.test-build/providers.mjs?partial-search');
 globalThis.fetch=async url=>{const value=String(url);if(value.endsWith('/nasdaqlisted.txt'))return new Response('Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares\nPARTIAL|Partial Listings Inc - Common Stock|Q|N|N|100|N|N\n');throw Error('injected optional directory outage');};
 try{const results=await searchFreshModule('Partial Listings');assert.equal(results.length,1);assert.equal(results[0].ticker,'PARTIAL');assert.equal(results[0].securityType,'common');assert.equal(results[0].cik,0);}
 finally{globalThis.fetch=original;}
});
test('SEC frame request counters describe only the current resumable page',async()=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=async url=>{calls.push(String(url));return Response.json({data:[]});};
 try{
  const result=await fetchBulkFundamentals([987654321],new Date('2026-09-01T00:00:00Z'),{offset:12,limit:4});
  assert.equal(result.requests,1);assert.equal(result.optionalRequests,3);assert.equal(result.success,1);assert.equal(result.optionalSuccess,3);assert.equal(calls.length,4);
 }finally{globalThis.fetch=original;}
});

test('unified opportunity weights exactly match the required fixed 100-point rubric',()=>{
 assert.deepEqual(OPPORTUNITY_SPEC.factors.map(({weight})=>weight),[25,20,15,12,10,10,5,3]);
 assert.equal(OPPORTUNITY_SPEC.factors.reduce((sum,{weight})=>sum+weight,0),100);
});
const fairMethod=(id,value,primary=false)=>({id,valuePerShare:{value,unit:'USD/share',source:opportunityProvenance},industryReview:{suitable:true,rationale:'Method is appropriate for the issuer business model and accounting basis.',sources:[opportunityProvenance]},primary,explanation:'Industry-suitable method with disclosed and sourced inputs.',assumptions:[{name:'equity value',value:value*110_000_000,unit:'USD',source:opportunityProvenance},{name:'terminal growth',value:0.025,unit:'ratio',source:opportunityProvenance}],calculation:{formula:'equity value divided by diluted shares',expression:{op:'divide',left:{op:'assumption',name:'equity value'},right:{op:'capitalization',metric:'dilutedShares'}},outputValue:value,unit:'USD/share',version:`${id}-fixture-v1`}});
const fairScenario=(id,value)=>({assumptions:[{name:`${id} equity value`,value:value*110_000_000,unit:'USD',source:opportunityProvenance}],calculation:{formula:`${id} equity value divided by diluted shares`,expression:{op:'divide',left:{op:'assumption',name:`${id} equity value`},right:{op:'capitalization',metric:'dilutedShares'}},outputValue:value,unit:'USD/share',version:`${id}-scenario-v1`}});
const fairValueInput=(overrides={})=>{const input={asOf:opportunityAsOf,currentPrice:{value:10,unit:'USD/share',source:freshMarketEvidence},conservativeValue:{value:12,unit:'USD/share',source:opportunityProvenance},baseValue:{value:16,unit:'USD/share',source:opportunityProvenance},optimisticValue:{value:20,unit:'USD/share',source:opportunityProvenance},methods:[fairMethod('normalized-dcf',16,true),fairMethod('peer-multiples',15)],capitalizationReview:{dilutedShares:{value:110_000_000,unit:'shares',source:opportunityProvenance},unrestrictedCash:{value:100_000_000,unit:'USD',source:opportunityProvenance},restrictedCash:{value:2_000_000,unit:'USD',source:opportunityProvenance},totalDebt:{value:20_000_000,unit:'USD',source:opportunityProvenance},leaseLiabilities:{value:5_000_000,unit:'USD',source:opportunityProvenance},rationale:'Reconciled basic shares, awards, convertible securities, warrants, unrestricted/restricted cash, debt and lease liabilities to the latest filings.',sources:[opportunityProvenance]},normalizationReview:{rationale:'Normalized cash flow for the disclosed non-recurring items and cyclical period.',sources:[opportunityProvenance]},...overrides};input.scenarioCalculations=overrides.scenarioCalculations??{conservative:fairScenario('conservative',input.conservativeValue.value),optimistic:fairScenario('optimistic',input.optimisticValue.value)};return input;};
test('fair-value rubric calculates margin of safety from two suitable independent methods',()=>{
 const result=scoreFairValue(fairValueInput());
 assert.equal(result.score,9);assert.equal(result.marginOfSafety,.6);assert.equal(result.methodSpread,roundedSpread(16,15));
 assert.equal(result.calculation.rubricId,'fair-value-v3');assert.equal(result.calculation.inputs.find(item=>item.name==='base-margin-of-safety').value,.6);
});
test('fair-value arithmetic is recomputed from sourced inputs with dimensional checks and the primary method anchors the base case',()=>{
 const input=fairValueInput();
 const composed={op:'divide',left:{op:'subtract',left:{op:'add',left:{op:'assumption',name:'equity value'},right:{op:'capitalization',metric:'unrestrictedCash'}},right:{op:'capitalization',metric:'totalDebt'}},right:{op:'capitalization',metric:'dilutedShares'}};
 const equity=(16*110_000_000)+20_000_000-100_000_000;
 const primary={...fairMethod('normalized-dcf',16,true),assumptions:[{name:'equity value',value:equity,unit:'USD',source:opportunityProvenance},{name:'terminal growth',value:0.025,unit:'ratio',source:opportunityProvenance}],calculation:{formula:'(equity value plus cash less debt) divided by diluted shares',expression:composed,outputValue:16,unit:'USD/share',version:'dcf-expression-v1'}};
 const result=scoreFairValue({...input,methods:[primary,fairMethod('peer-multiples',15)]});
 assert.equal(result.score,9,JSON.stringify(result));assert.ok(result.calculation.inputs.some(item=>item.name==='method:normalized-dcf:recomputed-output'&&item.value===16));
 assert.equal(scoreFairValue({...input,baseValue:{...input.baseValue,value:18},methods:[primary,fairMethod('peer-multiples',15)]}).score,null,'base case must match the chosen primary method');
 const wrongCurrency={...primary,assumptions:[...primary.assumptions,{name:'terminal growth',value:0.025,unit:'ratio',source:opportunityProvenance}],calculation:{...primary.calculation,expression:{op:'divide',left:{op:'assumption',name:'equity value'},right:{op:'assumption',name:'terminal growth'}}}};
 assert.equal(scoreFairValue({...input,methods:[wrongCurrency,fairMethod('peer-multiples',15)]}).score,null,'dimensionally invalid formulas must be withheld');
 const detachedOptimistic={...input.scenarioCalculations.optimistic,calculation:{...input.scenarioCalculations.optimistic.calculation,outputValue:21}};
 assert.equal(scoreFairValue({...input,scenarioCalculations:{...input.scenarioCalculations,optimistic:detachedOptimistic}}).score,null,'an optimistic number without a reconciled calculation cannot score');
 assert.equal(scoreFairValue({...input,scenarioCalculations:{...input.scenarioCalculations,conservative:undefined}}).score,null,'missing conservative-case calculation cannot score');
});
test('fair-value calculator plugs into the single evaluator with its full trace intact',()=>{
 const evidence=opportunityEvidence();evidence.valuation=scoreFairValue(fairValueInput());
 const result=evaluateOpportunity(opportunitySnapshot,evidence);
 const valuation=result.factors.find(factor=>factor.id==='valuation');
 assert.equal(valuation.score,9);assert.equal(valuation.points,22.5);assert.equal(valuation.calculation.rubricId,'fair-value-v3');assert.equal(result.state,'ranked');
});
function roundedSpread(a,b){return Math.round((Math.max(a,b)/Math.min(a,b)-1)*10000)/10000}
test('fair-value rubric applies every documented margin-of-safety score band',()=>{
 const cases=[[-.6,0],[-.4,1],[-.1,2],[.05,3],[.15,5],[.25,7],[.4,8],[.6,9]];
 for(const [margin,score] of cases){const base=10*(1+margin);const result=scoreFairValue(fairValueInput({conservativeValue:{value:Math.min(10,base),unit:'USD/share',source:opportunityProvenance},baseValue:{value:base,unit:'USD/share',source:opportunityProvenance},optimisticValue:{value:Math.max(22,base),unit:'USD/share',source:opportunityProvenance},methods:[fairMethod('normalized-dcf',base,true),fairMethod('peer-multiples',base*0.95)]}));assert.equal(result.score,score,`margin ${margin}`)}
});
test('fair value rejects stale quotes, stale model inputs, mixed balance dates, and detached share counts',()=>{
 const input=fairValueInput();
 assert.equal(scoreFairValue({...input,currentPrice:{...input.currentPrice,source:{...freshMarketEvidence,periodEnd:'2026-09-10',availableAt:'2026-09-10T20:00:00.000Z'}}}).score,null,'valuation quote must be recent');
 assert.equal(scoreFairValue({...input,currentPrice:{...input.currentPrice,source:{...freshMarketEvidence,currency:'EUR'}}}).score,null,'the source currency must match the stated USD/share unit');
 const malformedUnit='USD//share';
 const malformedUnits={...input,currentPrice:{...input.currentPrice,unit:malformedUnit},conservativeValue:{...input.conservativeValue,unit:malformedUnit},baseValue:{...input.baseValue,unit:malformedUnit},optimisticValue:{...input.optimisticValue,unit:malformedUnit},methods:input.methods.map(method=>({...method,valuePerShare:{...method.valuePerShare,unit:malformedUnit},calculation:{...method.calculation,unit:malformedUnit}}))};
 assert.equal(scoreFairValue(malformedUnits).score,null,'invalid unit expressions cannot pass by matching malformed labels');
 assert.equal(scoreFairValue({...input,baseValue:{...input.baseValue,source:{...opportunityProvenance,periodEnd:'2025-01-01'}}}).score,null,'scenario sources older than the freshness limit must be held');
 const splitDateCapital={...input.capitalizationReview,totalDebt:{...input.capitalizationReview.totalDebt,source:{...opportunityProvenance,periodEnd:'2026-06-29'}}};
 assert.equal(scoreFairValue({...input,capitalizationReview:splitDateCapital}).score,null,'cash, debt, restricted cash, and leases must share a balance-sheet cut');
 const oldShares={...input.capitalizationReview,dilutedShares:{...input.capitalizationReview.dilutedShares,source:{...opportunityProvenance,periodEnd:'2026-01-01'}}};
 assert.equal(scoreFairValue({...input,capitalizationReview:oldShares}).score,null,'fully diluted shares cannot be detached from the balance-sheet date');
 const staleCapital={...input.capitalizationReview,unrestrictedCash:{...input.capitalizationReview.unrestrictedCash,source:{...opportunityProvenance,periodEnd:'2025-01-01'}}};
 assert.equal(scoreFairValue({...input,capitalizationReview:staleCapital}).score,null,'capitalization inputs must satisfy the freshness bound');
});
test('fair-value rubric caps or withholds scores for unresolved inputs, unsuitable methods, unit mismatch, spread and scenario conflicts',()=>{
 assert.equal(scoreFairValue(fairValueInput({capitalizationReview:undefined})).score,null);
 assert.equal(scoreFairValue(fairValueInput({conservativeValue:{value:9,unit:'USD/share',source:opportunityProvenance}})).score,4);
 assert.equal(scoreFairValue(fairValueInput({methods:[fairMethod('normalized-dcf',16,true)]})).score,null);
 assert.equal(scoreFairValue(fairValueInput({methods:[fairMethod('normalized-dcf',16,true),fairMethod('peer-multiples',40)]})).conflicts.length,1);
 assert.equal(scoreFairValue(fairValueInput({methods:[fairMethod('normalized-dcf',16,true),{...fairMethod('peer-multiples',15),assumptions:[]}]})).score,null,'a method with no sourced assumptions is not a valuation cross-check');
 assert.equal(scoreFairValue(fairValueInput({methods:[fairMethod('normalized-dcf',16,true),{...fairMethod('peer-multiples',15),industryReview:{suitable:true,rationale:'',sources:[]}}]})).score,null,'industry suitability needs its own sourced review');
 assert.equal(scoreFairValue(fairValueInput({capitalizationReview:{...fairValueInput().capitalizationReview,dilutedShares:{...fairValueInput().capitalizationReview.dilutedShares,value:0}}})).score,null,'zero diluted shares invalidates per-share valuation');
 assert.match(scoreFairValue(fairValueInput({baseValue:{value:16,unit:'EUR/share',source:opportunityProvenance}})).rationale,/different currencies/);
 assert.equal(scoreFairValue(fairValueInput({methods:[fairMethod('normalized-dcf',16,true),{...fairMethod('peer-multiples',15),calculation:{...fairMethod('peer-multiples',15).calculation,outputValue:15.5}}]})).score,null,'method calculation output must reconcile to quoted value per share');
 assert.equal(scoreFairValue(fairValueInput({methods:[fairMethod('normalized-dcf',16,true),{...fairMethod('peer-multiples',15),calculation:{...fairMethod('peer-multiples',15).calculation,expression:{op:'divide',left:{op:'assumption',name:'terminal growth'},right:{op:'capitalization',metric:'dilutedShares'}}}}]})).score,null,'a declared calculation must recompute to its per-share value with compatible units');
 assert.equal(scoreFairValue(fairValueInput({methods:[fairMethod('normalized-dcf',16,true),{...fairMethod('peer-multiples',15),assumptions:[...fairMethod('peer-multiples',15).assumptions,{name:'equity value',value:9,unit:'EUR',source:opportunityProvenance}]}]})).score,null,'ambiguous duplicate calculation assumptions cannot be used');
 assert.match(scoreFairValue(fairValueInput({optimisticValue:{value:14,unit:'USD/share',source:opportunityProvenance}})).rationale,/not ordered/);
});
const financialInput=(overrides={})=>({industryModel:'industrial-operating-company',asOf:opportunityAsOf,unrestrictedCash:{value:1_000_000_000,unit:'USD',source:opportunityProvenance},totalDebt:{value:200_000_000,unit:'USD',source:opportunityProvenance},freeCashFlowTtm:{value:120_000_000,unit:'USD',source:opportunityProvenance},operatingIncomeTtm:{value:160_000_000,unit:'USD',source:opportunityProvenance},interestExpenseTtm:{value:20_000_000,unit:'USD',source:opportunityProvenance},debtDueWithin24Months:{value:50_000_000,unit:'USD',source:opportunityProvenance},...overrides});
test('industrial financial-strength rubric calculates sourced cash runway, interest and maturity coverage',()=>{
 const result=scoreFinancialStrength(financialInput());
 assert.equal(result.score,10);assert.deepEqual(result.subScores,{cashRunway:10,interestCoverage:10,maturityCoverage:10});
 assert.equal(result.calculation.rubricId,'financial-strength-industrial-v1');assert.equal(result.sources.length,6);
});
test('industrial financial-strength rubric scores stressed solvency conservatively and treats zero debt explicitly',()=>{
 const weak=financialInput({unrestrictedCash:{value:90_000_000,unit:'USD',source:opportunityProvenance},totalDebt:{value:500_000_000,unit:'USD',source:opportunityProvenance},freeCashFlowTtm:{value:-120_000_000,unit:'USD',source:opportunityProvenance},operatingIncomeTtm:{value:10_000_000,unit:'USD',source:opportunityProvenance},interestExpenseTtm:{value:20_000_000,unit:'USD',source:opportunityProvenance},debtDueWithin24Months:{value:180_000_000,unit:'USD',source:opportunityProvenance}});
 const weakResult=scoreFinancialStrength(weak);assert.deepEqual(weakResult.subScores,{cashRunway:3,interestCoverage:0,maturityCoverage:3});assert.equal(weakResult.score,2.1);
 const noDebt=scoreFinancialStrength(financialInput({totalDebt:{value:0,unit:'USD',source:opportunityProvenance},interestExpenseTtm:{value:0,unit:'USD',source:opportunityProvenance},debtDueWithin24Months:{value:0,unit:'USD',source:opportunityProvenance}}));assert.equal(noDebt.subScores.interestCoverage,10);assert.equal(noDebt.subScores.maturityCoverage,10);
});
test('financial-strength rubric returns unscored for unsupported industry, stale, missing or conflicting units',()=>{
 assert.equal(scoreFinancialStrength(financialInput({industryModel:'bank-capital'})).score,null);
 assert.equal(scoreFinancialStrength(financialInput({interestExpenseTtm:undefined})).score,null);
 assert.equal(scoreFinancialStrength(financialInput({totalDebt:{value:200_000_000,unit:'EUR',source:opportunityProvenance}})).conflicts.length,1);
 const stale={...opportunityProvenance,periodEnd:'2025-01-01'};
 assert.equal(scoreFinancialStrength(financialInput({unrestrictedCash:{value:1_000_000_000,unit:'USD',source:stale}})).score,null);
});
const catalystInput=(overrides={})=>({asOf:opportunityAsOf,horizonMonths:6,searchCompleted:true,searchSources:[opportunityProvenance],events:[{id:'contract-1',title:'Executed multi-year customer order',classification:'binding-contract',announcedAt:'2026-08-01T00:00:00Z',expectedAt:'2026-11-01T00:00:00Z',source:opportunityProvenance,impactAsPctTtmRevenue:{value:.2,unit:'percent-of-ttm-revenue',source:opportunityProvenance},conditions:[],progressVerified:true,marketPricing:'not-priced'}],...overrides});
test('catalyst rubric scores sourced binding events and preserves status, materiality, timing and pricing trace',()=>{
 const result=scoreCatalysts(catalystInput());assert.equal(result.score,7.8);assert.equal(result.eventScores.length,1);assert.equal(result.confidence,'high');assert.equal(result.calculation.rubricId,'catalysts-v1');assert.ok(result.sources.length>=2);
 const evidence=opportunityEvidence();evidence.catalysts=result;const evaluated=evaluateOpportunity(opportunitySnapshot,evidence);assert.equal(evaluated.factors.find(factor=>factor.id==='catalysts').score,7.8);
});
test('catalyst rubric distinguishes a documented empty search from missing search and handles nonbinding and priced events conservatively',()=>{
 assert.equal(scoreCatalysts(catalystInput({events:[]})).score,1);
 assert.equal(scoreCatalysts(catalystInput({searchCompleted:false})).score,null);
 const speculative=catalystInput({events:[{...catalystInput().events[0],classification:'non-binding',conditions:['financing','regulatory approval'],progressVerified:false,marketPricing:'priced'}]});
 assert.ok(scoreCatalysts(speculative).score<=3);
 assert.equal(scoreCatalysts(catalystInput({events:[{...catalystInput().events[0],expectedAt:'2027-08-01T00:00:00Z'}]})).score,1);
});
test('catalyst rubric rejects future, duplicate, stale-source and unquantifiable invalid event evidence',()=>{
 const event=catalystInput().events[0];
 assert.ok(scoreCatalysts(catalystInput({events:[{...event,announcedAt:'2027-01-01T00:00:00Z'}]})).conflicts.length>0);
 assert.ok(scoreCatalysts(catalystInput({events:[event,event]})).conflicts.length>0);
 assert.ok(scoreCatalysts(catalystInput({events:[{...event,source:{...opportunityProvenance,url:'http://bad.test'}}]})).conflicts.length>0);
 assert.ok(scoreCatalysts(catalystInput({events:[{...event,impactAsPctTtmRevenue:{value:-1,unit:'percent-of-ttm-revenue',source:opportunityProvenance}}]})).conflicts.length>0);
});
function earningsPeriod(end,start,revenue,{ni=4,op=5,cfo=6,capex=1,sbc=.5}={}){const source={...opportunityProvenance,periodStart:start,periodEnd:end};return Object.fromEntries(Object.entries({revenue,netIncome:ni,operatingIncome:op,operatingCashFlow:cfo,capitalExpenditure:capex,stockBasedCompensation:sbc}).map(([key,value])=>[key,{value,unit:'USD',source}]))}
function earningsInput(overrides={}){const annual=[earningsPeriod('2023-12-31','2023-01-01',100),earningsPeriod('2024-12-31','2024-01-01',120),earningsPeriod('2025-12-31','2025-01-01',144)];const ends=['2024-09-30','2024-12-31','2025-03-31','2025-06-30','2025-09-30','2025-12-31','2026-03-31','2026-06-30'];const quarterly=ends.map((end,index)=>{const start=new Date(Date.parse(`${end}T00:00:00Z`)-89*86400000).toISOString().slice(0,10);return earningsPeriod(end,start,index<4?40:45)});const review={score:10,rationale:'Reviewed the filed GAAP-to-non-GAAP bridge and tested recurring adjustments.',sources:[opportunityProvenance]};return {asOf:opportunityAsOf,annual,quarterly,gaapNonGaapBridgeReview:review,oneOffsReview:{...review,rationale:'Reviewed identified unusual items against three annual reports.'},...overrides}}
test('earnings-quality rubric reconciles three years and eight quarters into sourced growth, conversion, persistence and SBC factors',()=>{
 const result=scoreEarningsQuality(earningsInput());assert.equal(result.score,9.2);assert.deepEqual(result.subScores,{growth:8,cashConversion:10,operatingPersistence:10,sbcBurden:8,accountingTransparency:10});assert.equal(result.calculation.rubricId,'earnings-quality-v1');assert.equal(result.sources.length,68);assert.equal(result.confidence,'medium');
 const evidence=opportunityEvidence();evidence.earningsQuality=result;assert.equal(evaluateOpportunity(opportunitySnapshot,evidence).factors.find(factor=>factor.id==='earningsQuality').score,9.2);
});
test('earnings-quality rubric withholds incomplete, stale, future, misaligned and inconsistent reporting-period inputs',()=>{
 const input=earningsInput();assert.equal(scoreEarningsQuality({...input,quarterly:input.quarterly.slice(1)}).score,null);
 assert.equal(scoreEarningsQuality({...input,quarterly:input.quarterly.map((period,index)=>index===7?{...period,stockBasedCompensation:undefined}:period)}).score,null);
 const stale={...opportunityProvenance,periodStart:'2024-01-01',periodEnd:'2024-03-31'};assert.ok(scoreEarningsQuality({...input,quarterly:input.quarterly.map((period,index)=>index===7?{...period,revenue:{...period.revenue,source:stale}}:period)}).conflicts.length>0);
 const future=earningsPeriod('2027-03-31','2027-01-01',10);assert.ok(scoreEarningsQuality({...input,quarterly:[...input.quarterly.slice(0,7),future]}).conflicts.length>0);
 const mismatch={...input.quarterly[0].netIncome,source:{...input.quarterly[0].netIncome.source,periodEnd:'2024-10-01'}};assert.ok(scoreEarningsQuality({...input,quarterly:input.quarterly.map((period,index)=>index===0?{...period,netIncome:mismatch}:period)}).conflicts.length>0);
 const currency={...input.annual[0].netIncome,unit:'EUR'};assert.ok(scoreEarningsQuality({...input,annual:input.annual.map((period,index)=>index===0?{...period,netIncome:currency}:period)}).conflicts.length>0);
 const longGap=earningsInput();longGap.annual=longGap.annual.map((period,index)=>index===1?Object.fromEntries(Object.entries(period).map(([key,metric])=>[key,{...metric,source:{...metric.source,periodStart:'2022-01-01',periodEnd:'2022-12-31'}}])):period);
 assert.ok(scoreEarningsQuality(longGap).conflicts.includes('period alignment conflict'));
});
test('earnings-quality requires sourced adjustment and one-off reviews and reflects their actual assessments',()=>{
 const input=earningsInput();
 assert.equal(scoreEarningsQuality({...input,gaapNonGaapBridgeReview:undefined}).score,null);
 assert.equal(scoreEarningsQuality({...input,oneOffsReview:{...input.oneOffsReview,sources:[]}}).score,null);
 assert.equal(scoreEarningsQuality({...input,oneOffsReview:{...input.oneOffsReview,score:11}}).score,null);
 const reviewed=scoreEarningsQuality({...input,gaapNonGaapBridgeReview:{...input.gaapNonGaapBridgeReview,score:3},oneOffsReview:{...input.oneOffsReview,score:3}});
 assert.equal(reviewed.subScores.accountingTransparency,3);assert.equal(reviewed.score,8.15);assert.match(reviewed.rationale,/adjustment quality 3\/10/);
});
const riskAreas=['dilution','financing','customer-concentration','legal-regulatory','accounting-auditor','short-interest','insider-overhang','operations-supply-chain'];
const riskInput=(findings=[],overrides={})=>({asOf:opportunityAsOf,reviews:riskAreas.map(area=>({area,status:findings.some(finding=>finding.area===area)?'risk-found':'searched-none',sources:[opportunityProvenance],note:`Documented primary-source review for ${area}`})),findings,...overrides});
test('downside-risk rubric only scores after all risk domains are sourced and each material finding reconciles',()=>{
 const clean=scoreDownsideRisk(riskInput());assert.equal(clean.score,10);assert.equal(clean.reviewedAreas,8);assert.equal(clean.identifiedRisks,0);
 const finding={id:'maturity-wall',area:'financing',severity:5,probability:.8,permanence:1,mitigatedFraction:0,source:opportunityProvenance,note:'Large near-term maturity with no committed refinancing.'};
 const stressed=scoreDownsideRisk(riskInput([finding]));assert.equal(stressed.score,8.4);assert.equal(stressed.riskPenalty,1.6);assert.equal(stressed.calculation.rubricId,'downside-risk-v1');
 const evidence=opportunityEvidence();evidence.downsideRisk=stressed;assert.equal(evaluateOpportunity(opportunitySnapshot,evidence).factors.find(factor=>factor.id==='downsideRisk').score,8.4);
});
test('downside-risk rubric withholds incomplete, unavailable, contradictory and out-of-range risk evidence',()=>{
 const input=riskInput();assert.equal(scoreDownsideRisk({...input,reviews:input.reviews.slice(1)}).score,null);
 assert.equal(scoreDownsideRisk({...input,reviews:input.reviews.map((review,index)=>index===5?{...review,status:'unavailable-rights'}:review)}).score,null);
 const finding={id:'litigation',area:'legal-regulatory',severity:3,probability:.5,permanence:.6,mitigatedFraction:.2,source:opportunityProvenance,note:'Material disclosed litigation.'};
 assert.equal(scoreDownsideRisk(riskInput([finding],{reviews:input.reviews})).score,null,'searched-none conflicts with a finding');
 assert.equal(scoreDownsideRisk(riskInput([{...finding,probability:2}])).score,null);
});
function technicalInput(overrides={}){const bizDays=(count,endDate)=>{const days=[];let date=new Date(`${endDate}T00:00:00Z`);while(days.length<count){const day=date.getUTCDay();if(day!==0&&day!==6)days.unshift(date.toISOString().slice(0,10));date.setUTCDate(date.getUTCDate()-1)}return days};const dates=bizDays(220,'2026-09-29');const daily=dates.map((date,index)=>({date,close:100*(1.001)**index,volume:100000,completed:true}));const benchmarkDaily=dates.map((date,index)=>({date,close:100*(1.0003)**index,volume:100000,completed:true}));const weekly=Array.from({length:32},(_,index)=>{const date=new Date(Date.UTC(2026,8,25-(31-index)*7)).toISOString().slice(0,10);return {date,close:100*(1.01)**index,volume:100000,completed:true}});const monthEnds=Array.from({length:12},(_,index)=>{const d=new Date(Date.UTC(2025,9+index,0));while(d.getUTCDay()===0||d.getUTCDay()===6)d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10)});const monthly=monthEnds.map((date,index)=>({date,close:100*(1.02)**index,volume:100000,completed:true}));const barSource=(source,periodEnd)=>({...source,periodEnd,availableAt:`${periodEnd}T21:00:00Z`});return {asOf:opportunityAsOf,splitAdjusted:true,daily,weekly,monthly,benchmarkDaily,source:barSource(opportunityProvenance,daily.at(-1).date),weeklySource:barSource({...opportunityProvenance,source:'Primary weekly bars'},weekly.at(-1).date),monthlySource:barSource({...opportunityProvenance,source:'Primary monthly bars'},monthly.at(-1).date),benchmarkSource:barSource({...opportunityProvenance,source:'Primary benchmark daily bars',url:'https://www.nasdaq.com/market-activity/indexes'},benchmarkDaily.at(-1).date),...overrides}}
test('technical-timing rubric uses completed split-adjusted multi-timeframe bars and benchmark-aligned relative strength',()=>{
 const result=scoreTechnicalTiming(technicalInput());assert.ok(result.score>7);assert.equal(result.calculation.rubricId,'technical-timing-v1');assert.equal(result.indicators.ma200, result.indicators.ma200);assert.ok(result.indicators.relativeStrength63d>0);
 const evidence=opportunityEvidence();evidence.technicalTiming=result;assert.equal(evaluateOpportunity(opportunitySnapshot,evidence).factors.find(factor=>factor.id==='technicalTiming').score,result.score);
});
test('technical-timing rubric refuses partial bars, weekend points, unadjusted splits, thin history and unaligned benchmarks',()=>{
 const input=technicalInput();assert.equal(scoreTechnicalTiming({...input,splitAdjusted:false}).score,null);
 assert.equal(scoreTechnicalTiming({...input,weeklySource:undefined}).score,null);
 assert.equal(scoreTechnicalTiming({...input,monthlySource:{...input.monthlySource,periodEnd:'2026-08-28'}}).score,null);
 assert.equal(scoreTechnicalTiming({...input,benchmarkSource:undefined}).score,null);
 assert.equal(scoreTechnicalTiming({...input,benchmarkSource:{...input.benchmarkSource,url:'javascript:alert(1)'}}).score,null);
 assert.equal(scoreTechnicalTiming({...input,benchmarkSource:{...input.benchmarkSource,periodEnd:'2026-09-26'}}).score,null);
 assert.equal(scoreTechnicalTiming({...input,daily:input.daily.map((bar,index)=>index===219?{...bar,completed:false}:bar)}).score,null);
 assert.equal(scoreTechnicalTiming({...input,daily:input.daily.slice(0,150)}).score,null);
 assert.equal(scoreTechnicalTiming({...input,daily:input.daily.map((bar,index)=>index===219?{...bar,date:'2026-09-26'}:bar)}).score,null);
 const shortBenchmark=input.benchmarkDaily.slice(0,120),shortBenchmarkEnd=shortBenchmark.at(-1).date;
 assert.equal(scoreTechnicalTiming({...input,benchmarkDaily:shortBenchmark,benchmarkSource:{...input.benchmarkSource,periodEnd:shortBenchmarkEnd,availableAt:`${shortBenchmarkEnd}T21:00:00Z`}}).score,null);
});
test('technical-timing rejects sparse daily, weekly, monthly and benchmark histories even when bar counts pass',()=>{
 const input=technicalInput();
 const everyOtherWeekday=(count,endDate)=>{const rows=[];let date=new Date(`${endDate}T00:00:00Z`),take=true;while(rows.length<count){if(![0,6].includes(date.getUTCDay())){if(take)rows.unshift(date.toISOString().slice(0,10));take=!take}date.setUTCDate(date.getUTCDate()-1)}return rows};
 const rowsWithDates=(rows,dates)=>rows.slice(-dates.length).map((row,index)=>({...row,date:dates[index]}));
 const dailyDates=everyOtherWeekday(200,input.daily.at(-1).date);
 const benchmarkDates=everyOtherWeekday(64,input.benchmarkDaily.at(-1).date);
 const weeklyDates=Array.from({length:30},(_,index)=>{const date=new Date(`${input.weekly.at(-1).date}T00:00:00Z`);date.setUTCDate(date.getUTCDate()-(29-index)*14);while([0,6].includes(date.getUTCDay()))date.setUTCDate(date.getUTCDate()-1);return date.toISOString().slice(0,10)});
 const monthlyDates=Array.from({length:12},(_,index)=>{const date=new Date(`${input.monthly.at(-1).date}T00:00:00Z`);date.setUTCDate(date.getUTCDate()-(11-index)*62);while([0,6].includes(date.getUTCDay()))date.setUTCDate(date.getUTCDate()-1);return date.toISOString().slice(0,10)});
 assert.equal(scoreTechnicalTiming({...input,daily:rowsWithDates(input.daily,dailyDates)}).score,null,'200 points spread across over a year are not 200 daily sessions');
 assert.equal(scoreTechnicalTiming({...input,weekly:rowsWithDates(input.weekly,weeklyDates)}).score,null,'30 bars with multiweek gaps are not 30 weeks of coverage');
 assert.equal(scoreTechnicalTiming({...input,monthly:rowsWithDates(input.monthly,monthlyDates)}).score,null,'12 bars spanning multiple years are not one year of monthly coverage');
 assert.equal(scoreTechnicalTiming({...input,benchmarkDaily:rowsWithDates(input.benchmarkDaily,benchmarkDates)}).score,null,'64 sparse benchmark points cannot satisfy aligned daily coverage');
});
test('technical-timing RSI uses Wilder smoothing over the available close history',()=>{
 const input=technicalInput();
 const daily=input.daily.map((bar,index)=>({...bar,close:index<206?100:index<219?101:100}));
 const result=scoreTechnicalTiming({...input,daily});
 assert.ok(result.score!=null);
 assert.ok(result.indicators.rsi14>25&&result.indicators.rsi14<30,`expected smoothed RSI near 27.6, got ${result.indicators.rsi14}`);
});
test('technical research builds completed multi-timeframe bars and preserves the market-data rights gate',()=>{
 const asOf='2026-09-30T23:00:00.000Z',dates=[];let cursor=new Date('2025-01-01T00:00:00Z');
 while(cursor.toISOString().slice(0,10)<='2026-09-29'){if(![0,6].includes(cursor.getUTCDay()))dates.push(cursor.toISOString().slice(0,10));cursor.setUTCDate(cursor.getUTCDate()+1)}
 const history=dates.map((date,index)=>({date,close:50*(1.001)**index,volume:100_000}));
 const benchmarkHistory=dates.map((date,index)=>({date,close:100*(1.0003)**index,volume:1_000_000}));
 const source=(periodEnd,rightsStatus='unknown')=>({...freshMarketEvidence,source:'Market history fixture',url:'https://market.example/history',periodEnd,availableAt:`${periodEnd}T21:00:00.000Z`,retrievedAt:'2026-09-30T22:00:00.000Z',rightsStatus});
 const args={history,benchmarkHistory,historySource:source(dates.at(-1)),benchmarkSource:source(dates.at(-1)),splitAdjusted:true,asOf};
 const restricted=buildTechnicalTimingResearch(args);
 assert.equal(restricted.providerStatus,'retrieved');assert.ok(restricted.dailyBars>=200);assert.ok(restricted.weeklyBars>=30);assert.ok(restricted.monthlyBars>=12);assert.ok(restricted.benchmarkBars>=64);
 assert.equal(restricted.score.score,null);assert.ok(restricted.missing.some(value=>/redistribution rights are not verified/.test(value)));
 const snapshot={...opportunitySnapshot,asOf,opportunityResearch:{technicalTiming:restricted}};
 const dossier=opportunityDossierFromSnapshot(snapshot),evaluation=evaluateOpportunityDossier(snapshot,dossier);
 const factor=evaluation.factors.find(item=>item.id==='technicalTiming');assert.equal(factor.score,0);assert.equal(factor.proxy,true);assert.match(factor.rationale,/(redistribution rights are not verified|No permitted technical inputs are available)/);
 const compactResearch={...restricted};delete compactResearch.assessment;
 const compactSnapshot={...opportunitySnapshot,asOf,opportunityResearch:{technicalTiming:compactResearch}};
 const compactEvaluation=evaluateOpportunityDossier(compactSnapshot,opportunityDossierFromSnapshot(compactSnapshot));
 const compactFactor=compactEvaluation.factors.find(item=>item.id==='technicalTiming');
 assert.equal(compactFactor.score,0,'compact scans receive a zero proxy without persisting raw bars');assert.equal(compactFactor.proxy,true);
 assert.match(compactFactor.rationale,/(redistribution rights are not verified|No permitted technical inputs are available)/);
 assert.equal(compactResearch.dailyBars,restricted.dailyBars);assert.equal(compactResearch.benchmarkBars,restricted.benchmarkBars);
 const licensed=buildTechnicalTimingResearch({...args,rightsStatus:'redistribution-permitted'});
 assert.ok(licensed.score.score>0);assert.equal(licensed.assessment?.daily.at(-1)?.date,dates.at(-1));
 const incomplete=buildTechnicalTimingResearch({...args,history:history.slice(-100),splitAdjusted:false});
 assert.equal(incomplete.score.score,null);assert.ok(incomplete.missing.some(value=>/100\/200/.test(value)));assert.ok(incomplete.missing.some(value=>/split-adjusted/.test(value)));
});
test('bulk SEC enrichment reuses cached per-ticker and SPY histories, then persists compact technical evidence only',async()=>{
 const originalFetch=globalThis.fetch,dates=[];let cursor=new Date('2025-01-01T00:00:00Z');
 while(dates.length<260){if(![0,6].includes(cursor.getUTCDay()))dates.push(cursor.toISOString().slice(0,10));cursor.setUTCDate(cursor.getUTCDate()+1)}
 const history=dates.map((date,index)=>({date,close:40*(1.001)**index,volume:250_000}));
 const benchmarkHistory=dates.map((date,index)=>({date,close:100*(1.0003)**index,volume:1_000_000}));
 const stock={url:'https://query1.finance.yahoo.com/v8/finance/chart/SCANFIX',history,splits:[],source:'Yahoo Finance chart API · split-adjusted daily history and split events',retrievedAt:'2026-10-03T08:00:00.000Z',availableAt:`${dates.at(-1)}T21:00:00.000Z`};
 const benchmark={...stock,url:'https://query1.finance.yahoo.com/v8/finance/chart/SPY',history:benchmarkHistory};
 const snapshot={...opportunitySnapshot,symbol:'SCANFIX',cik:9999999,history:undefined,opportunityResearch:undefined};
 globalThis.fetch=async url=>String(url).includes('/companyfacts/')
  ?Response.json({cik:9999999,facts:{}})
  :Response.json({cik:9999999,filings:{recent:{form:[],filingDate:[],reportDate:[],accessionNumber:[],primaryDocument:[]}}});
 try{
  const result=await enrichSnapshotsWithSecOpportunity([snapshot],{bySymbol:new Map([['SCANFIX',stock]]),benchmark});
  assert.equal(result.providerStatus,'empty');
  const timing=snapshot.opportunityResearch.technicalTiming;
  assert.ok(timing.dailyBars>=200);assert.ok(timing.weeklyBars>=30);assert.ok(timing.monthlyBars>=12);assert.ok(timing.benchmarkBars>=64);
  assert.equal(timing.assessment,undefined,'raw OHLC arrays must not inflate durable screening snapshots');
  assert.equal(snapshot.history,undefined);
  assert.equal(timing.score.score,null,'unverified market-data reuse rights keep the factor unscored');
  assert.ok(timing.missing.some(value=>/redistribution rights are not verified/.test(value)));
 }finally{globalThis.fetch=originalFetch}
});
test('recent SEC filing metadata is surfaced for catalyst research without creating catalyst evidence',()=>{
 const filing={providerStatus:'retrieved',items:[{form:'8-K',filed:'2026-09-20',accession:'0000000001-26-000001',title:'SEC filing: 8-K filed 2026-09-20',url:'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/current.htm'}],source:opportunityProvenance,limitations:['Metadata only; review the filing body.']};
 const snapshot={...opportunitySnapshot,opportunityResearch:{secFilings:filing}},dossier=opportunityDossierFromSnapshot(snapshot),evaluation=evaluateOpportunityDossier(snapshot,dossier);
 assert.equal(dossier.catalysts,undefined);assert.match(dossier.researchNotes.catalysts,/discovery aid only/);
 const factor=evaluation.factors.find(item=>item.id==='catalysts');assert.equal(factor.score,0);assert.equal(factor.proxy,true);assert.match(factor.rationale,/(No catalyst score may be inferred|No dated growth or catalyst inputs are available)/);
});
test('qualitative competitive and management factors require five sourced dimensions and expose analyst judgment',()=>{
 const competitiveIds=['product-differentiation','customer-evidence','switching-advantage','competitive-durability','substitution-risk'];const assessments=competitiveIds.map((id,index)=>({id,score:6+index%3,rationale:`Reviewed source-backed assessment: ${id}`,sources:[opportunityProvenance]}));
 const competitive=scoreQualitativeFactor('competitivePosition',opportunityAsOf,assessments);assert.equal(competitive.score,6.8);assert.equal(competitive.confidence,'medium');assert.match(competitive.rationale,/analyst-review/);assert.equal(competitive.calculation.rubricId,'competitivePosition-qualitative-v1');
 const managementIds=['execution-record','capital-allocation','governance-controls','shareholder-alignment','insider-evidence'];const management=scoreQualitativeFactor('management',opportunityAsOf,managementIds.map(id=>({id,score:5,rationale:`Primary-source review: ${id}`,sources:[opportunityProvenance]})));assert.equal(management.score,5);
 const evidence=opportunityEvidence();evidence.competitivePosition=competitive;assert.equal(evaluateOpportunity(opportunitySnapshot,evidence).factors.find(factor=>factor.id==='competitivePosition').score,6.8);
});
test('qualitative review leaves factors unscored for missing dimensions, stale evidence, out-of-range ratings, or duplicate dimensions',()=>{
 const ids=['execution-record','capital-allocation','governance-controls','shareholder-alignment','insider-evidence'];const assessments=ids.map(id=>({id,score:5,rationale:id,sources:[opportunityProvenance]}));
 assert.equal(scoreQualitativeFactor('management',opportunityAsOf,assessments.slice(0,4)).score,null);
 assert.equal(scoreQualitativeFactor('management',opportunityAsOf,[{...assessments[0],score:11},...assessments.slice(1)]).score,null);
 assert.equal(scoreQualitativeFactor('management',opportunityAsOf,[...assessments,assessments[0]]).score,null);
 assert.equal(scoreQualitativeFactor('management',opportunityAsOf,[{...assessments[0],sources:[{...opportunityProvenance,url:'http://bad'}]},...assessments.slice(1)]).score,null);
});
test('unified opportunity scores on the fixed denominator and ranks only with material evidence',()=>{
 const evaluation=evaluateOpportunity(opportunitySnapshot,opportunityEvidence());
 assert.equal(evaluation.state,'ranked');assert.equal(evaluation.rankingEligible,true);assert.equal(evaluation.score,100);assert.equal(evaluation.coveragePct,100);assert.equal(evaluation.evidencedWeight,100);
 const materialOnly=Object.fromEntries(['valuation','catalysts','financialStrength','earningsQuality','downsideRisk'].map(id=>[id,opportunityEvidence()[id]]));
 const partial=evaluateOpportunity(opportunitySnapshot,materialOnly);
 assert.equal(partial.state,'needs-research');assert.equal(partial.coveragePct,82);assert.equal(partial.score,82);assert.equal(partial.confidence,'low');
 const partialValuation=opportunityEvidence();partialValuation.valuation.coveragePct=40;
 const quantified=evaluateOpportunity(opportunitySnapshot,partialValuation);
 assert.equal(quantified.factors.find(factor=>factor.id==='valuation').points,10);assert.equal(quantified.coveragePct,85);assert.equal(quantified.score,85);assert.equal(quantified.rankingEligible,false);assert.equal(quantified.factors.find(factor=>factor.id==='valuation').complete,false);
});
test('SEC operating research priorities use only issuer-linked dated facts and expose missing history',()=>{
 const annual=(year,revenue,income,cash,capex,rightsStatus='redistribution-permitted')=>{const end=`${year}-12-31`,source={source:'SEC Company Facts · annual fixture',url:'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json',periodEnd:end,availableAt:`${Number(year)+1}-02-01T00:00:00Z`,retrievedAt:`${Number(year)+1}-02-02T00:00:00Z`,rightsStatus,confidence:'high'};const value=n=>({value:n,unit:'USD',source});return{start:`${year}-01-01`,end,metrics:{revenue:value(revenue),netIncome:value(income),operatingCashFlow:value(cash),capitalExpenditure:value(capex)}}};
 const snapshot={...opportunitySnapshot,asOf:'2026-09-30T23:00:00Z',opportunityResearch:{earnings:{annual:[annual('2023',100,10,14,4),annual('2024',120,18,22,5),annual('2025',150,30,40,8)]},financialStrength:{industryModel:'industrial-operating-company'}}};
 const signals=operatingCandidateSignals(snapshot);assert.equal(signals.eligibleForOperatingQueue,true);assert.equal(signals.hasVerifiedRevenue,true);assert.equal(signals.annualEvidenceYears,3);assert.equal(signals.profitableYears,3);assert.equal(signals.positiveFcfYears,3);assert.ok(signals.revenueGrowth>0);assert.equal(signals.latestProfitMargin,.2);assert.equal(signals.latestFcfMargin,32/150);
 const restricted={...snapshot,opportunityResearch:{earnings:{annual:[annual('2025',150,30,40,8,'unknown')]},financialStrength:{industryModel:'industrial-operating-company'}}};assert.equal(operatingCandidateSignals(restricted).hasVerifiedRevenue,false);assert.equal(operatingCandidateSignals(restricted).annualEvidenceYears,0);
 const bank={...snapshot,opportunityResearch:{...snapshot.opportunityResearch,financialStrength:{providerStatus:'retrieved'}}};assert.equal(operatingCandidateSignals(bank).eligibleForOperatingQueue,false);
 const mismatched={...snapshot,opportunityResearch:{...snapshot.opportunityResearch,earnings:{annual:[annual('2023',100,10,14,4),annual('2024',120,18,22,5),annual('2025',0.149,245.796, -26.898,0.149)]}}};const bad=operatingCandidateSignals(mismatched);assert.equal(bad.eligibleForOperatingQueue,false);assert.equal(bad.latestProfitMargin,null);
 const growthOutlier={...snapshot,opportunityResearch:{...snapshot.opportunityResearch,earnings:{annual:[annual('2023',100,10,14,4),annual('2024',120,18,22,5),annual('2025',400,80,90,8)]}}};const growthSignals=operatingCandidateSignals(growthOutlier);assert.equal(growthSignals.eligibleForOperatingQueue,true);assert.equal(growthSignals.revenueGrowth,null);
 const fcfOutlier={...snapshot,opportunityResearch:{...snapshot.opportunityResearch,earnings:{annual:[annual('2023',100,10,14,4),annual('2024',120,18,22,5),annual('2025',150,30,170,8)]}}};const fcfSignals=operatingCandidateSignals(fcfOutlier);assert.equal(fcfSignals.eligibleForOperatingQueue,true);assert.equal(fcfSignals.latestFcfMargin,null);assert.equal(fcfSignals.positiveFcfYears,2);
 const stale={...snapshot,opportunityResearch:{...snapshot.opportunityResearch,earnings:{annual:[annual('2023',100,10,14,4),annual('2024',120,18,22,5),annual('2024',150,30,40,8)]}}};assert.equal(operatingCandidateSignals(stale).eligibleForOperatingQueue,false);
 const order=operatingCandidateOrderSql();assert.match(order,/source\.rightsStatus/);assert.match(order,/redistribution-permitted/);assert.match(order,/industrial-operating-company/);assert.match(order,/opportunityResearch\.earnings\.conflicts/);assert.match(order,/sourceConflicts/);assert.match(order,/julianday/);assert.match(order,/BETWEEN -1 AND 1/);assert.match(order,/BETWEEN -3 AND 1/);assert.match(order,/<=1 THEN/);assert.match(order,/symbol ASC/);assert.match(order,/operatingCashFlow/);
});
test('SEC revenue concepts prefer consolidated operating revenue over narrow contract-revenue fallback',()=>{
 assert.ok(REVENUE_TAGS.indexOf('RevenueAndOperatingIncome')<REVENUE_TAGS.indexOf('RevenueFromContractsWithCustomers'));
});
test('missing, out-of-range, unsourced, stale and future factor evidence never earns points',()=>{
 const evidence=opportunityEvidence();evidence.valuation.score=11;evidence.catalysts.sources=[];evidence.financialStrength.sources=[{...opportunityProvenance,availableAt:'2027-01-01T00:00:00Z'}];
 const result=evaluateOpportunity(opportunitySnapshot,evidence);
 assert.equal(result.state,'needs-research');assert.equal(result.rankingEligible,false);
 for(const id of ['valuation','catalysts','financialStrength']){const factor=result.factors.find(item=>item.id===id);assert.equal(factor.score,null);assert.equal(factor.points,0);assert.equal(factor.evidenced,false);}
});
test('undated or non-auditable security identity and factor source cannot rank',()=>{
 const evidence=opportunityEvidence();evidence.valuation.sources=[{...opportunityProvenance,url:'http://example.test/source'}];
 assert.equal(evaluateOpportunity(opportunitySnapshot,evidence).state,'needs-research');
 const missingIdentitySource={...opportunitySnapshot,provenance:{...opportunitySnapshot.provenance,securityType:undefined}};
 assert.equal(evaluateOpportunity(missingIdentitySource,opportunityEvidence()).state,'needs-research');
});
test('dated primary listing identity can establish the share class without asserting market-data reuse rights',()=>{
 const evidence=opportunityEvidence();
 const listing={source:'official exchange issue directory',url:'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt',periodEnd:opportunityAsOf.slice(0,10),availableAt:opportunityAsOf,retrievedAt:opportunityAsOf,tag:'Synthetic Company - Common Stock',confidence:'high',rightsStatus:'unknown'};
 const result=evaluateOpportunity({...opportunitySnapshot,provenance:{...opportunitySnapshot.provenance,securityType:listing,exchange:listing}},evidence);
 assert.equal(result.checks.find(check=>check.id==='security').status,'PASS');assert.equal(result.state,'ranked');
});
test('evidence from sources without cleared reuse rights cannot score or pass safety gates',()=>{
 const evidence=opportunityEvidence();evidence.valuation.sources=[{...opportunityProvenance,rightsStatus:'unverified'}];
 const snapshot={...opportunitySnapshot,provenance:{...opportunitySnapshot.provenance,price:{...freshMarketEvidence,rightsStatus:'unverified'}}};
 const result=evaluateOpportunity(snapshot,evidence);
 assert.equal(result.state,'needs-research');
 assert.equal(result.checks.find(check=>check.id==='price').status,'UNKNOWN');
 const valuation=result.factors.find(factor=>factor.id==='valuation');
 assert.equal(valuation.evidenced,false);assert.equal(valuation.score,null);
});
test('a numeric factor score without a reproducible calculation trace earns no points',()=>{
 const evidence=opportunityEvidence();delete evidence.valuation.calculation;
 const result=evaluateOpportunity(opportunitySnapshot,evidence);
 const valuation=result.factors.find(factor=>factor.id==='valuation');
 assert.equal(valuation.evidenced,false);assert.equal(valuation.score,null);assert.equal(valuation.points,0);assert.equal(result.state,'needs-research');
});
test('overall confidence cannot be high if a ranked factor has no confidence assessment',()=>{
 const evidence=opportunityEvidence();delete evidence.valuation.confidence;
 const result=evaluateOpportunity(opportunitySnapshot,evidence);
 assert.equal(result.state,'ranked');assert.equal(result.confidence,'medium');
});
test('unified opportunity enforces only broad security, size, liquidity and current-price safety',()=>{
 const allEvidence=opportunityEvidence();
 assert.equal(evaluateOpportunity({...opportunitySnapshot,marketCap:3e9},allEvidence).state,'ranked','there is no old Core upper cap');
 assert.equal(evaluateOpportunity({...opportunitySnapshot,marketCap:20e6},allEvidence).state,'ranked','micro caps are not rejected solely due to size');
 assert.equal(evaluateOpportunity({...opportunitySnapshot,marketCap:0},allEvidence).state,'excluded','zero capitalization is invalid');
 assert.equal(evaluateOpportunity({...opportunitySnapshot,medianDollarVolume20d:149999},allEvidence).state,'excluded');
 assert.equal(evaluateOpportunity({...opportunitySnapshot,provenance:{...opportunitySnapshot.provenance,marketCap:{...freshMarketEvidence,availableAt:'2026-09-21T20:00:00Z'}}},allEvidence).state,'needs-research','stale market cap does not exclude or rank');
 assert.equal(evaluateOpportunity({...opportunitySnapshot,provenance:{...opportunitySnapshot.provenance,medianDollarVolume20d:{...freshMarketEvidence,availableAt:'2026-09-21T20:00:00Z'}}},allEvidence).state,'needs-research','stale liquidity does not exclude or rank');
 assert.equal(evaluateOpportunity({...opportunitySnapshot,securityType:'warrant'},allEvidence).state,'excluded');
 const adr={...opportunitySnapshot,securityType:'adr',provenance:{...opportunitySnapshot.provenance,securityType:{...opportunityProvenance,rightsStatus:'unknown'},exchange:{...opportunityProvenance,rightsStatus:'unknown'}}};
 const adrResult=evaluateOpportunity(adr,allEvidence);assert.equal(adrResult.state,'needs-research');assert.match(adrResult.checks.find(check=>check.id==='security').explanation,/conversion ratio/);
 assert.equal(evaluateOpportunity({...opportunitySnapshot,securityType:undefined},allEvidence).state,'needs-research');
 assert.equal(evaluateOpportunity({...opportunitySnapshot,provenance:{...opportunitySnapshot.provenance,price:{...opportunitySnapshot.provenance.price,availableAt:'2026-09-24T20:00:00Z'}}},allEvidence).state,'needs-research');
});
test('source registry covers every factor and distinguishes public FINRA short interest from unavailable borrow data',()=>{
 const ids=new Set(DATA_FIELD_REGISTRY.map(field=>field.id));
 for(const id of ['valuation-multiples','catalysts-contracts','filings-fundamentals','financial-strength-solvency','foreign-currency-conversion','governance-litigation','peers-sector','insider-ownership','short-interest-borrow','technical-indicators'])assert.ok(ids.has(id),`missing field family ${id}`);
 const shortInterest=DATA_FIELD_REGISTRY.find(field=>field.id==='short-interest-borrow');
 const finra=shortInterest.sources.find(source=>source.name.startsWith('FINRA'));
 assert.equal(finra.access,'free-with-key');assert.match(finra.note,/twice-monthly/);assert.match(finra.note,/not intended for commercial use/);assert.match(finra.note,/borrow fee and availability are separate/);
 const nasdaqShort=shortInterest.sources.find(source=>source.name.startsWith('Nasdaq Trader'));
 assert.equal(nasdaqShort.access,'unverified-terms');assert.match(nasdaqShort.note,/per-issue lookup/);assert.match(nasdaqShort.note,/does not establish automated extraction or product redistribution rights/);
 const nyseShort=shortInterest.sources.find(source=>source.name.startsWith('NYSE Group'));
 assert.equal(nyseShort.access,'paid-or-licensed');assert.match(nyseShort.note,/does not establish a free bulk API/);
 const financialDatasets=DATA_FIELD_REGISTRY.find(field=>field.id==='filings-fundamentals').sources.find(source=>source.name.includes('Financial Datasets'));
 assert.equal(financialDatasets.access,'paid-or-licensed');assert.match(financialDatasets.note,/MCP calls count as billable/);assert.match(financialDatasets.note,/Scale redistribution tier/);
 const quote=DATA_FIELD_REGISTRY.find(field=>field.id==='quote-price-history');
 assert.equal(quote.sources.find(source=>source.name.includes('Yahoo')).access,'unverified-terms');
 const nasdaq=quote.sources.find(source=>source.name.includes('Nasdaq Data Link'));
 assert.equal(nasdaq.access,'paid-or-licensed');assert.match(nasdaq.url,/data\.nasdaq\.com\/terms/);assert.match(nasdaq.note,/internal unless the applicable order form grants broader rights/);
 const sec=DATA_FIELD_REGISTRY.find(field=>field.id==='filings-fundamentals').sources[0];
 assert.match(sec.note,/EDGAR public filing content is free to access and reuse/);assert.match(sec.note,/do not use SEC seal/);
 const fx=DATA_FIELD_REGISTRY.find(field=>field.id==='foreign-currency-conversion');
 assert.equal(fx.state,'partial');assert.equal(fx.refresh,'on-demand');assert.equal(fx.sources[0].access,'free-no-key');assert.match(fx.sources[0].note,/source attribution/);assert.match(fx.hardLimit,/not used in scoring/);assert.match(fx.hardLimit,/bulk scans/);
 assert.equal(sourceRegistrySummary().fieldFamilies,DATA_FIELD_REGISTRY.length);
});
test('old Core profitability/EV-S and Bounce drawdown/MA30W conditions do not gate the unified category',()=>{
 const result=evaluateOpportunity({...opportunitySnapshot,revenue:0,evSales:99,netIncome:-1,fcf:-1,return12m:0,low52w:9,ma30w:20,dilution:1},opportunityEvidence());
 assert.equal(result.state,'ranked');assert.equal(result.score,100);
});
test('conflicts hold affected evidence for review without fabricating points',()=>{
 const evidence=opportunityEvidence();evidence.valuation.conflicts=['SEC and company IR value disagree'];
 const result=evaluateOpportunity(opportunitySnapshot,evidence);
 assert.equal(result.state,'needs-research');assert.equal(result.factors.find(factor=>factor.id==='valuation').score,null);
 const conflicted=evaluateOpportunity({...opportunitySnapshot,sourceConflicts:['market cap conflict']},opportunityEvidence());
 assert.equal(conflicted.state,'needs-research');assert.equal(conflicted.coveragePct,100);assert.equal(conflicted.score,100,'retained evidence remains visible even while the final ranking is held');
});
test('risk tolerance and investment horizon are report context, not score-weight changes',()=>{
 const evidence=opportunityEvidence();
 const medium=evaluateOpportunity(opportunitySnapshot,evidence,{horizonMonths:6,riskTolerance:'medium'});
 const low=evaluateOpportunity(opportunitySnapshot,evidence,{horizonMonths:12,riskTolerance:'low'});
 assert.equal(medium.score,low.score);assert.equal(medium.coveragePct,low.coveragePct);assert.equal(low.horizonMonths,12);assert.equal(low.riskTolerance,'low');
 assert.equal(evaluateOpportunity(opportunitySnapshot,evidence,{horizonMonths:0,riskTolerance:'medium'}).horizonMonths,6);
});

const competitiveAssessment=()=>['product-differentiation','customer-evidence','switching-advantage','competitive-durability','substitution-risk'].map(id=>({id,score:7,rationale:`Dated review for ${id}`,sources:[opportunityProvenance]}));
const managementAssessment=()=>['execution-record','capital-allocation','governance-controls','shareholder-alignment','insider-evidence'].map(id=>({id,score:6,rationale:`Dated review for ${id}`,sources:[opportunityProvenance]}));
const completeOpportunityDossier=()=>({asOf:opportunityAsOf,valuation:fairValueInput(),catalysts:catalystInput(),financialStrength:financialInput(),earningsQuality:earningsInput(),competitivePosition:competitiveAssessment(),downsideRisk:riskInput(),management:managementAssessment(),technicalTiming:technicalInput()});
test('dossier orchestrator runs every validated calculator and produces one reproducible weighted evaluation',()=>{
 const dossier=completeOpportunityDossier();const evidence=scoreOpportunityDossier(dossier);
 assert.deepEqual(Object.keys(evidence).sort(),OPPORTUNITY_SPEC.factors.map(factor=>factor.id).sort());
 for(const factor of OPPORTUNITY_SPEC.factors){assert.ok(evidence[factor.id].calculation?.rubricId,`${factor.id} calculation trace`);assert.ok(evidence[factor.id].sources.length,`${factor.id} sourced evidence`)}
 const result=evaluateOpportunityDossier(opportunitySnapshot,dossier);
 assert.equal(result.state,'ranked');assert.equal(result.coveragePct,100);assert.equal(result.score,result.factors.reduce((sum,factor)=>sum+factor.points,0));
 assert.deepEqual(result.factors.map(factor=>factor.weight),[25,20,15,12,10,10,5,3]);
});
test('stale scan-report scores are rebuilt from the saved dossier instead of dropping its evidence',()=>{
 const snapshot=opportunitySnapshot,dossier=completeOpportunityDossier();
 const stale={...evaluateOpportunity(snapshot,{}),hash:'obsolete-rubric'};
 const recalculated=currentOpportunityEvaluation(snapshot,stale,dossier);
 const expected=evaluateOpportunityDossier(snapshot,dossier);
 assert.equal(recalculated.state,'ranked');assert.equal(recalculated.score,expected.score);assert.ok(recalculated.score>0);assert.equal(recalculated.coveragePct,100);
 assert.equal(currentOpportunityEvaluation(snapshot,recalculated,dossier),recalculated,'current-rubric stored evaluations are reused');
});
test('dossier evaluation always produces a complete algorithmic 100-point grade',()=>{
 const evaluation=evaluateOpportunityDossier(opportunitySnapshot,{asOf:opportunitySnapshot.asOf});
 assert.equal(evaluation.score>=0,true);assert.equal(evaluation.algorithmicCoveragePct,100);
 assert.equal(evaluation.factors.every(factor=>typeof factor.score==='number' && factor.score>=0 && factor.score<=10),true);
 assert.equal(evaluation.factors.reduce((sum,factor)=>sum+factor.points,0),evaluation.score);
 assert.equal(evaluation.rankingEligible,false,'source safety and evidence gates remain separate from the algorithmic grade');
});
test('dossier orchestrator does not manufacture missing sections or combine different as-of cuts',()=>{
 const incomplete=completeOpportunityDossier();incomplete.earningsQuality.quarterly=incomplete.earningsQuality.quarterly.slice(1);
 const partial=evaluateOpportunityDossier(opportunitySnapshot,incomplete);
 assert.equal(partial.state,'needs-research');assert.equal(partial.factors.find(factor=>factor.id==='earningsQuality').score,0);assert.equal(partial.factors.find(factor=>factor.id==='earningsQuality').proxy,true);assert.equal(partial.rankingEligible,false);
 const mismatched=completeOpportunityDossier();mismatched.catalysts={...mismatched.catalysts,asOf:'2026-09-29T12:00:00.000Z'};
 const result=evaluateOpportunityDossier(opportunitySnapshot,mismatched);
 assert.equal(result.state,'needs-research');assert.equal(result.factors.find(factor=>factor.id==='catalysts').score,0);assert.equal(result.factors.find(factor=>factor.id==='catalysts').proxy,true);assert.match(result.factors.find(factor=>factor.id==='catalysts').rationale,/timestamp does not match/);
 assert.equal(evaluateOpportunityDossier({...opportunitySnapshot,asOf:'2026-09-30T12:00:01.000Z'},completeOpportunityDossier()).rankingEligible,false);
});
test('snapshot SEC earnings history contributes only the quantified earnings subtotal while review points remain uncovered',()=>{
 const history=earningsInput();
 const adapt=(periods)=>periods.map(period=>({start:period.revenue.source.periodStart,end:period.revenue.source.periodEnd,metrics:{revenue:period.revenue,netIncome:period.netIncome,operatingIncome:period.operatingIncome,operatingCashFlow:period.operatingCashFlow,capitalExpenditure:period.capitalExpenditure,stockBasedCompensation:period.stockBasedCompensation}}));
 const snapshot={...opportunitySnapshot,opportunityResearch:{earnings:{providerStatus:'retrieved',coverage:{annualPeriodsFound:3,quarterlyPeriodsFound:8,selectedUnit:'USD'},annual:adapt(history.annual),quarterly:adapt(history.quarterly),missing:[],conflicts:[],limitations:[],readyForScoring:false}}};
 const dossier=opportunityDossierFromSnapshot(snapshot);assert.equal(dossier.earningsQualityPartial.annual.length,3);assert.equal(dossier.earningsQualityPartial.quarterly.length,8);assert.equal(dossier.earningsQualityPartial.gaapNonGaapBridgeReview,undefined);
 const result=evaluateOpportunityDossier(snapshot,dossier),factor=result.factors.find(item=>item.id==='earningsQuality');
 assert.ok(factor.score>0);assert.equal(factor.evidenced,true);assert.equal(factor.complete,false);assert.equal(factor.coveragePct,85);assert.equal(factor.points,Math.round(factor.score/10*12*.85*100)/100);assert.equal(factor.sources.length,66);assert.match(factor.rationale,/GAAP\/non-GAAP and one-off reviews remain unscored/);assert.equal(result.state,'needs-research');
});
test('unresolved SEC concept conflicts withhold provisional earnings points and operating priority signals',()=>{
 const history=earningsInput();
 const adapt=periods=>periods.map(period=>({start:period.revenue.source.periodStart,end:period.revenue.source.periodEnd,metrics:{revenue:period.revenue,netIncome:period.netIncome,operatingIncome:period.operatingIncome,operatingCashFlow:period.operatingCashFlow,capitalExpenditure:period.capitalExpenditure,stockBasedCompensation:period.stockBasedCompensation}}));
 const snapshot={...opportunitySnapshot,opportunityResearch:{earnings:{providerStatus:'retrieved',coverage:{annualPeriodsFound:3,quarterlyPeriodsFound:8,selectedUnit:'USD'},annual:adapt(history.annual),quarterly:adapt(history.quarterly),missing:[],conflicts:['competing revenue concepts report different values'],limitations:[],readyForScoring:false}}};
 const evaluation=evaluateOpportunityDossier(snapshot,opportunityDossierFromSnapshot(snapshot));
 const factor=evaluation.factors.find(item=>item.id==='earningsQuality');
 assert.equal(factor.score,0);assert.equal(factor.proxy,true);assert.equal(factor.points,0);assert.equal(factor.coveragePct,0);
 assert.match(factor.rationale,/competing revenue concepts/);
 const signals=operatingCandidateSignals(snapshot);
 assert.equal(signals.eligibleForOperatingQueue,false);assert.equal(signals.revenueGrowth,null);
});
test('SEC financial-strength adapter derives only aligned debt, maturity, interest and four-quarter cash-flow inputs',()=>{
 const asOf='2026-09-30T12:00:00.000Z',cik=1234567;
 const ends=['2025-09-30','2025-12-31','2026-03-31','2026-06-30'];
 const starts=['2025-07-01','2025-10-01','2026-01-01','2026-04-01'];
 const earnings={coverage:{selectedUnit:'USD'},periods:{quarterly:ends.map((end,index)=>({start:starts[index],end,metrics:{
  operatingCashFlow:{value:150,unit:'USD',source:{...opportunityProvenance,periodStart:starts[index],periodEnd:end,availableAt:'2026-08-01T12:00:00.000Z'}},
  capitalExpenditure:{value:50,unit:'USD',source:{...opportunityProvenance,periodStart:starts[index],periodEnd:end,availableAt:'2026-08-01T12:00:00.000Z'}},
  operatingIncome:{value:80,unit:'USD',source:{...opportunityProvenance,periodStart:starts[index],periodEnd:end,availableAt:'2026-08-01T12:00:00.000Z'}},
 }}))}};
 const instant=(val)=>({end:'2026-06-30',filed:'2026-08-01',form:'10-Q',accn:'0000000000-26-000001',val});
 const duration=(end,start,val,index)=>({start,end,val,filed:'2026-08-01',form:'10-Q',accn:`0000000000-26-00000${index+1}`});
 const payload={cik,facts:{'us-gaap':{
  CashAndCashEquivalentsAtCarryingValue:{units:{USD:[instant(500)]}},LongTermDebtCurrent:{units:{USD:[instant(100)]}},LongTermDebtNoncurrent:{units:{USD:[instant(300)]}},LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo:{units:{USD:[instant(80)]}},
  InterestExpenseNonoperating:{units:{USD:ends.map((end,index)=>duration(end,starts[index],12,index))}},
 }}};
 const result=buildSecFinancialStrengthInputs(cik,payload,asOf,'2026-09-30T11:00:00.000Z',earnings,'industrial-operating-company');
 assert.equal(result.assessment?.totalDebt.value,400);assert.equal(result.assessment?.debtDueWithin24Months.value,180);assert.equal(result.assessment?.freeCashFlowTtm.value,400);assert.equal(result.assessment?.operatingIncomeTtm.value,320);assert.equal(result.assessment?.interestExpenseTtm.value,48);
 assert.equal(result.missing.length,0);assert.equal(scoreFinancialStrength(result.assessment).score,8.8);
 const conflicted=buildSecFinancialStrengthInputs(cik,payload,asOf,'2026-09-30T11:00:00.000Z',{...earnings,conflicts:['competing operatingCashFlow concepts report different values']},'industrial-operating-company');
 assert.equal(conflicted.assessment,undefined);assert.equal(conflicted.conflicts.length,1);
 const partialAssessment={industryModel:'industrial-operating-company',asOf,unrestrictedCash:result.metrics.unrestrictedCash,totalDebt:result.metrics.totalDebt,freeCashFlowTtm:result.metrics.freeCashFlowTtm,operatingIncomeTtm:result.metrics.operatingIncomeTtm,debtDueWithin24Months:result.metrics.debtDueWithin24Months};
 const partialScore=scoreFinancialStrengthPartial(partialAssessment);assert.equal(partialScore.coveragePct,70);assert.ok(partialScore.score>0);assert.match(partialScore.rationale,/70%.*unavailable dimensions remain uncovered/);
 const partialSnapshot={...opportunitySnapshot,opportunityResearch:{financialStrength:{providerStatus:'retrieved',industryModel:'industrial-operating-company',metrics:{...partialAssessment},missing:['interest is missing'],conflicts:[],limitations:[],readyForScoring:false}}};
 const partialEvaluation=evaluateOpportunityDossier(partialSnapshot,opportunityDossierFromSnapshot(partialSnapshot)),partialFactor=partialEvaluation.factors.find(item=>item.id==='financialStrength');
 assert.equal(partialFactor.coveragePct,70);assert.ok(partialFactor.points>0);assert.equal(partialFactor.complete,false);assert.equal(partialEvaluation.rankingEligible,false);
 const incomplete=structuredClone(payload);delete incomplete.facts['us-gaap'].LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo;
 const missingMaturity=buildSecFinancialStrengthInputs(cik,incomplete,asOf,'2026-09-30T11:00:00.000Z',earnings,'industrial-operating-company');
 assert.equal(missingMaturity.assessment,undefined);assert.match(missingMaturity.missing.join(' '),/year-two debt maturities/);
 const unclassified=buildSecFinancialStrengthInputs(cik,payload,asOf,'2026-09-30T11:00:00.000Z',earnings);
 assert.equal(unclassified.assessment,undefined);assert.match(unclassified.missing.join(' '),/sourced operating-company classification/);
 const snapshot={...opportunitySnapshot,opportunityResearch:{financialStrength:{providerStatus:'retrieved',metrics:unclassified.metrics,missing:unclassified.missing,conflicts:[],limitations:unclassified.limitations,readyForScoring:false}}};
 const dossier=opportunityDossierFromSnapshot(snapshot);assert.equal(dossier.financialStrength,undefined);
 const evaluation=evaluateOpportunityDossier(snapshot,dossier),factor=evaluation.factors.find(item=>item.id==='financialStrength');
 assert.equal(factor.score,0);assert.equal(factor.proxy,true);assert.equal(factor.evidenced,false);assert.match(factor.rationale,/6\/6 available/);assert.match(factor.rationale,/operating-company classification/);
});
test('dossier withholds fair value when its reference price or trading session differs from the screened quote',()=>{
 const roundingOnly=completeOpportunityDossier();roundingOnly.valuation={...roundingOnly.valuation,currentPrice:{...roundingOnly.valuation.currentPrice,value:10.01}};
 assert.equal(evaluateOpportunityDossier(opportunitySnapshot,roundingOnly).factors.find(factor=>factor.id==='valuation').evidenced,true,'one-cent formatting difference is tolerated');
 const differentPrice=completeOpportunityDossier();differentPrice.valuation={...differentPrice.valuation,currentPrice:{...differentPrice.valuation.currentPrice,value:10.2}};
 const priceMismatch=evaluateOpportunityDossier(opportunitySnapshot,differentPrice);
 assert.equal(priceMismatch.factors.find(factor=>factor.id==='valuation').proxy,true);assert.ok(priceMismatch.factors.find(factor=>factor.id==='valuation').score>=0);
 assert.match(priceMismatch.factors.find(factor=>factor.id==='valuation').conflicts.join(' '),/differs from the screened quote/);
 const differentSession=completeOpportunityDossier();differentSession.valuation={...differentSession.valuation,currentPrice:{...differentSession.valuation.currentPrice,source:{...differentSession.valuation.currentPrice.source,periodEnd:'2026-09-28'}}};
 const sessionMismatch=evaluateOpportunityDossier(opportunitySnapshot,differentSession);
 assert.equal(sessionMismatch.factors.find(factor=>factor.id==='valuation').proxy,true);assert.ok(sessionMismatch.factors.find(factor=>factor.id==='valuation').score>=0);
 assert.match(sessionMismatch.factors.find(factor=>factor.id==='valuation').conflicts.join(' '),/session differs/);
});
test('dossier orchestrator requires catalyst assessment to match the selected horizon',()=>{
 const dossier=completeOpportunityDossier();dossier.catalysts={...dossier.catalysts,horizonMonths:12};
 const result=evaluateOpportunityDossier(opportunitySnapshot,dossier,{horizonMonths:6});
 assert.equal(result.state,'needs-research');assert.equal(result.factors.find(factor=>factor.id==='catalysts').score,0);assert.equal(result.factors.find(factor=>factor.id==='catalysts').proxy,true);
 const aligned=completeOpportunityDossier();aligned.catalysts={...aligned.catalysts,horizonMonths:12};
 assert.equal(evaluateOpportunityDossier(opportunitySnapshot,aligned,{horizonMonths:12}).factors.find(factor=>factor.id==='catalysts').evidenced,true);
});
test('dossier orchestrator contains malformed section payloads as unscored research gaps',()=>{
 const dossier=completeOpportunityDossier();dossier.valuation={...dossier.valuation,methods:null};
 const result=evaluateOpportunityDossier(opportunitySnapshot,dossier);
 assert.equal(result.state,'needs-research');assert.equal(result.factors.find(factor=>factor.id==='valuation').score,0);assert.equal(result.factors.find(factor=>factor.id==='valuation').proxy,true);
 assert.match(result.factors.find(factor=>factor.id==='valuation').rationale,/calculator input error/);
});

function makeSecEarningsFixture(){
 const tags={revenue:'RevenueFromContractWithCustomerExcludingAssessedTax',grossProfit:'GrossProfit',netIncome:'NetIncomeLoss',operatingIncome:'OperatingIncomeLoss',operatingCashFlow:'NetCashProvidedByUsedInOperatingActivities',capitalExpenditure:'PaymentsToAcquirePropertyPlantAndEquipment',stockBasedCompensation:'ShareBasedCompensation'};
 const facts={'us-gaap':Object.fromEntries(Object.values(tags).map(tag=>[tag,{units:{USD:[]}}]))};
 const add=(metric,start,end,val,form,filed)=>facts['us-gaap'][tags[metric]].units.USD.push({start,end,val,form,filed,accn:`${String(filed).replaceAll('-','')}${String(facts['us-gaap'][tags[metric]].units.USD.length+1).padStart(6,'0')}`});
 const metricBases={revenue:100,grossProfit:42,netIncome:10,operatingIncome:14,operatingCashFlow:18,capitalExpenditure:3,stockBasedCompensation:2};
 for(let year=2023;year<=2025;year++){
  let annualFiled=`${year+1}-02-15`;
  for(const metric of Object.keys(tags)){
   const qValues=Array.from({length:4},(_,q)=>metricBases[metric]+(year-2023)*12+q*2);
   const annual=qValues.reduce((sum,value)=>sum+value,0);
   add(metric,`${year}-01-01`,`${year}-12-31`,annual,'10-K',annualFiled);
   if(year===2023)continue;
   let cumulative=0;
   const qEnd=['03-31','06-30','09-30'];
   for(let q=0;q<3;q++){
    cumulative+=qValues[q];
    add(metric,`${year}-01-01`,`${year}-${qEnd[q]}`,cumulative,'10-Q',`${year}-${['05-10','08-10','11-10'][q]}`);
   }
  }
 }
 for(const metric of Object.keys(tags)){
  const values=[metricBases[metric]+36,metricBases[metric]+38];
  let cumulative=0;
  for(let q=0;q<2;q++){
   cumulative+=values[q];
   add(metric,'2026-01-01',`2026-${q===0?'03-31':'06-30'}`,cumulative,'10-Q',q===0?'2026-05-10':'2026-08-10');
  }
 }
 // A later amendment replaces Q1 revenue and changes the standalone Q2
 // calculation that is reconstructed from cumulative Company Facts entries.
 add('revenue','2026-01-01','2026-03-31',130,'10-Q/A','2026-08-20');
 return {cik:1234567,facts};
}
const disclosureReviews=()=>({gaapNonGaapBridgeReview:{score:8,rationale:'Reconciled adjustments to the filed GAAP bridge.',sources:[opportunityProvenance]},oneOffsReview:{score:7,rationale:'Reviewed one-off claims across filed reports.',sources:[opportunityProvenance]}});
test('SEC Company Facts status requires the expected issuer CIK and standard facts',()=>{
 assert.equal(classifySecCompanyFacts({cik:1234567,facts:{'us-gaap':{Revenue:{units:{USD:[{val:1,end:'2025-12-31'}]}}}}},1234567),'retrieved');
 assert.equal(classifySecCompanyFacts({cik:'0001234567',facts:{'ifrs-full':{Revenue:{units:{USD:[{val:1,end:'2025-12-31'}]}}}}},1234567),'retrieved','SEC zero-padded string CIKs are valid for foreign filers');
 assert.equal(classifySecCompanyFacts({cik:7654321,facts:{'us-gaap':{Revenue:{}}}},1234567),'invalid');
 assert.equal(classifySecCompanyFacts({cik:'0007654321',facts:{'us-gaap':{Revenue:{}}}},1234567),'invalid');
 assert.equal(classifySecCompanyFacts({cik:'12.3',facts:{'us-gaap':{Revenue:{}}}},1234567),'invalid');
 assert.equal(classifySecCompanyFacts({cik:1234567,facts:{}},1234567),'empty');
 assert.equal(classifySecCompanyFacts({cik:1234567,facts:{'us-gaap':{Revenue:{units:{USD:[]}}}}},1234567),'empty','empty units are not usable financial retrieval');
 assert.equal(classifySecCompanyFacts({facts:{'us-gaap':{Revenue:{}}}},1234567),'invalid');
 assert.equal(classifySecCompanyFacts(null,1234567),'invalid');
});
test('financial solvency model uses verified SEC SIC and withholds specialized issuer groups',()=>{
 const base={cik:1234567,sic:7372,sicDescription:'Services-Prepackaged Software'};
 assert.equal(classifySecIssuerModel(base,1234567)?.industryModel,'industrial-operating-company');
 assert.equal(classifySecIssuerModel({...base,sic:6021,sicDescription:'National Commercial Banks'},1234567)?.industryModel,undefined);
 assert.equal(classifySecIssuerModel({...base,sic:6798,sicDescription:'Real Estate Investment Trusts'},1234567)?.industryModel,undefined);
 assert.equal(classifySecIssuerModel({...base,sic:4911,sicDescription:'Electric Services'},1234567)?.industryModel,undefined);
 assert.equal(classifySecIssuerModel({...base,sic:9995,sicDescription:'Foreign Governments'},1234567)?.industryModel,undefined);
 assert.equal(classifySecIssuerModel({...base,cik:7654321},1234567),null,'a mismatched SEC submission cannot classify an issuer');
 assert.equal(classifySecIssuerModel({...base,sic:'7372'},1234567)?.industryModel,'industrial-operating-company');
 assert.equal(classifySecIssuerModel({...base,sic:'7372x'},1234567),null);
 assert.equal(classifySecIssuerModel({...base,sicDescription:''},1234567),null);
});
test('SEC earnings adapter withholds a complete but stale revenue history',()=>{
 const result=buildSecEarningsQualityAssessment(1234567,makeSecEarningsFixture(),'2027-04-30T12:00:00.000Z','2027-04-30T11:00:00.000Z',disclosureReviews());
 assert.equal(result.coverage.quarterlyPeriodsFound,8);assert.equal(result.assessment,undefined);
 assert.ok(result.missing.some(value=>value.includes('latest reported period is stale')));
});
test('SEC earnings adapter rejects mismatched issuer identity before parsing any facts',()=>{
 const payload=makeSecEarningsFixture();payload.cik=7654321;
 const result=buildSecEarningsQualityAssessment(1234567,payload,'2026-09-30T12:00:00.000Z','2026-09-30T11:00:00.000Z',disclosureReviews());
 assert.deepEqual(result.periods,{annual:[],quarterly:[]});assert.deepEqual(result.coverage,{annualPeriodsFound:0,quarterlyPeriodsFound:0,selectedUnit:'USD'});
 assert.equal(result.assessment,undefined);assert.equal(result.conflicts.length,1);assert.match(result.missing[0],/does not match/);
 const empty=buildSecEarningsQualityAssessment(1234567,{cik:1234567,facts:{}},'2026-09-30T12:00:00.000Z','2026-09-30T11:00:00.000Z',disclosureReviews());
 assert.deepEqual(empty.periods,{annual:[],quarterly:[]});assert.match(empty.missing[0],/no standard/);
});
test('SEC adapter creates three annual and eight standalone quarters, subtracts cumulative YTD, and uses latest amendment',()=>{
 const asOf='2026-09-30T12:00:00.000Z',payload=makeSecEarningsFixture();assert.equal(classifySecCompanyFacts(payload,1234567),'retrieved');const result=buildSecEarningsQualityAssessment(1234567,payload,asOf,'2026-09-30T11:00:00.000Z',disclosureReviews());
 assert.equal(result.assessment.annual.length,3);assert.equal(result.assessment.quarterly.length,8);assert.equal(result.coverage.selectedUnit,'USD');assert.deepEqual(result.missing,[]);assert.deepEqual(result.conflicts,[]);
 const q1=result.assessment.quarterly.find(period=>period.revenue.source.periodEnd==='2026-03-31');
 const q2=result.assessment.quarterly.find(period=>period.revenue.source.periodEnd==='2026-06-30');
 assert.equal(q1.revenue.value,130);assert.equal(q2.revenue.value,144);
 assert.match(q2.operatingCashFlow.source.tag,/minus/);
 const scored=scoreEarningsQuality(result.assessment);assert.ok(Number.isFinite(scored.score));assert.equal(scored.subScores.accountingTransparency,7.5);
});
test('SEC earnings aliases use declared concept priority and hold materially conflicting same-period facts',()=>{
 const base=makeSecEarningsFixture(),baseResult=buildSecEarningsQualityAssessment(1234567,base,'2026-09-30T12:00:00.000Z','2026-09-30T11:00:00.000Z',disclosureReviews()),baseRow=baseResult.periods.quarterly.find(period=>period.end==='2026-06-30');
 assert.ok(baseRow?.metrics.revenue);
 const aliasFact={start:'2026-04-01',end:'2026-06-30',val:baseRow.metrics.revenue.value+0.5,form:'10-Q',filed:'2026-08-10',accn:'000-alias-equal'};
 const equivalent=structuredClone(base);equivalent.facts['us-gaap'].Revenue={units:{USD:[aliasFact]}};
 const aligned=buildSecEarningsQualityAssessment(1234567,equivalent,'2026-09-30T12:00:00.000Z','2026-09-30T11:00:00.000Z',disclosureReviews());
 const q2=aligned.periods.quarterly.find(period=>period.end==='2026-06-30');assert.equal(q2.metrics.revenue.value,baseRow.metrics.revenue.value);assert.match(q2.metrics.revenue.source.tag,/RevenueFromContractWithCustomerExcludingAssessedTax/);assert.equal(aligned.conflicts.length,0);
 const conflicting=structuredClone(base);conflicting.facts['us-gaap'].Revenue={units:{USD:[{...aliasFact,val:baseRow.metrics.revenue.value*2,accn:'000-alias-conflict'}]}};
 const held=buildSecEarningsQualityAssessment(1234567,conflicting,'2026-09-30T12:00:00.000Z','2026-09-30T11:00:00.000Z',disclosureReviews());
 assert.equal(held.assessment,undefined);assert.ok(held.conflicts.some(value=>/competing revenue concepts report different values/.test(value)));
});
test('SEC adapter refuses incomplete custom-tag coverage, missing review, and future filing facts',()=>{
 const payload=makeSecEarningsFixture();delete payload.facts['us-gaap'].ShareBasedCompensation;
 const missing=buildSecEarningsQualityAssessment(1234567,payload,'2026-09-30T12:00:00.000Z','2026-09-30T11:00:00.000Z',disclosureReviews());
 assert.equal(missing.assessment,undefined);assert.ok(missing.missing.some(value=>value.includes('stockBasedCompensation')));
 const noReview=buildSecEarningsQualityAssessment(1234567,makeSecEarningsFixture(),'2026-09-30T12:00:00.000Z','2026-09-30T11:00:00.000Z');
 assert.equal(noReview.assessment,undefined);assert.ok(noReview.missing.some(value=>value.includes('review')));
 const future=makeSecEarningsFixture();future.facts['us-gaap'].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD.push({start:'2026-01-01',end:'2026-09-30',val:999,form:'10-Q',filed:'2026-10-20',accn:'000future'});
 const noFuture=buildSecEarningsQualityAssessment(1234567,future,'2026-09-30T12:00:00.000Z','2026-09-30T11:00:00.000Z',disclosureReviews());
 assert.equal(noFuture.assessment.quarterly.length,8);assert.ok(!noFuture.assessment.quarterly.some(period=>period.revenue.source.periodEnd==='2026-09-30'));
});
test('SEC gross-profit enrichment stays optional and cannot manufacture missing earnings-quality coverage',()=>{
 const payload=makeSecEarningsFixture(),grossProfitTag='GrossProfit';delete payload.facts['us-gaap'][grossProfitTag];
 const result=buildSecEarningsQualityAssessment(1234567,payload,'2026-09-30T12:00:00.000Z','2026-09-30T11:00:00.000Z',disclosureReviews());
 assert.ok(result.assessment,'optional gross profit is not a new gate for the six required financial series');
 assert.equal(result.periods.annual[0].metrics.grossProfit,undefined);
 assert.ok(result.missing.some(value=>value.includes('grossProfit')),'coverage still discloses the absent optional line');
});
test('SEC earnings adapter refuses eight quarterly observations that hide a multi-quarter gap',()=>{
 const payload=makeSecEarningsFixture(),revenueTag='RevenueFromContractWithCustomerExcludingAssessedTax';
 payload.facts['us-gaap'][revenueTag].units.USD=payload.facts['us-gaap'][revenueTag].units.USD.filter(row=>!(row.start==='2025-01-01'&&row.end==='2025-06-30'));
 const result=buildSecEarningsQualityAssessment(1234567,payload,'2026-09-30T12:00:00.000Z','2026-09-30T11:00:00.000Z',disclosureReviews());
 assert.equal(result.coverage.quarterlyPeriodsFound,8,'count alone must not imply continuous coverage');
 assert.equal(result.assessment,undefined);assert.ok(result.missing.some(value=>value.includes('not consecutive')));
});
test('SEC adapter recognizes IFRS standard concepts for foreign filers without inventing unavailable quarters',()=>{
 const tags={revenue:'Revenue',netIncome:'ProfitLoss',operatingIncome:'ProfitLossFromOperatingActivities',operatingCashFlow:'CashFlowsFromUsedInOperatingActivities',capitalExpenditure:'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',stockBasedCompensation:'ExpenseFromSharebasedPaymentTransactionsInWhichGoodsOrServicesReceivedDidNotQualifyForRecognitionAsAssets'};
 const facts={'ifrs-full':Object.fromEntries(Object.values(tags).map(tag=>[tag,{units:{USD:[]}}]))};
 for(let year=2023;year<=2025;year++)for(const [index,tag] of Object.values(tags).entries())facts['ifrs-full'][tag].units.USD.push({start:`${year}-01-01`,end:`${year}-12-31`,val:(index+1)*100_000_000+year,form:'20-F',filed:`${year+1}-03-01`,accn:`ifrs-${year}-${index}`});
 const payload={cik:'0001855612',facts};
 assert.equal(classifySecCompanyFacts(payload,1855612),'retrieved');
 const result=buildSecEarningsQualityAssessment(1855612,payload,'2026-09-30T12:00:00.000Z','2026-09-30T11:00:00.000Z',disclosureReviews());
 assert.equal(result.coverage.annualPeriodsFound,3);assert.equal(result.coverage.quarterlyPeriodsFound,0);assert.equal(result.assessment,undefined);
 assert.equal(result.periods.annual[0].metrics.revenue.value,100_002_023);
 assert.equal(result.periods.annual[0].metrics.operatingIncome.value,300_002_023);
 assert.equal(result.periods.annual[0].metrics.capitalExpenditure.value,500_002_023);
 assert.equal(result.periods.annual[0].metrics.stockBasedCompensation.value,600_002_023);
 assert.equal(result.periods.annual[0].metrics.grossProfit,undefined,'foreign filers without an explicit gross-profit fact must not receive an inferred value');
 assert.ok(result.missing.some(value=>value.includes('grossProfit')),'the unavailable optional metric remains visible in coverage');
 assert.ok(result.missing.some(value=>value.includes('only 0/8 standalone quarters')));
 const euroPayload=structuredClone(payload);
 for(const tag of Object.values(tags)){euroPayload.facts['ifrs-full'][tag].units.EUR=euroPayload.facts['ifrs-full'][tag].units.USD;delete euroPayload.facts['ifrs-full'][tag].units.USD;}
 euroPayload.facts['ifrs-full'].CashAndCashEquivalents={units:{USD:[{end:'2025-12-31',val:50,form:'20-F',filed:'2026-03-01',accn:'unrelated-usd-cash'}]}};
 euroPayload.facts['ifrs-full'].Revenue.units.USD=[{start:'2026-01-01',end:'2026-09-30',val:999_000_000,form:'6-K',filed:'2026-10-12',accn:'future-usd-revenue'}];
 const euro=buildSecEarningsQualityAssessment(1855612,euroPayload,'2026-09-30T12:00:00.000Z','2026-09-30T11:00:00.000Z',disclosureReviews());
 assert.equal(euro.coverage.selectedUnit,'EUR');assert.equal(euro.coverage.annualPeriodsFound,3);assert.ok(euro.missing.some(value=>value.includes('not converted to USD')),'non-USD periods are visible but withheld from USD scoring');
});
test('SEC earnings currency selection follows the latest valid revenue reporting currency instead of stale historical USD',()=>{
 const payload=makeSecEarningsFixture();
 for(const concept of Object.values(payload.facts['us-gaap'])){
  const usd=concept.units.USD;concept.units.EUR=usd.map(row=>({...row,val:row.val*1.08}));concept.units.USD=usd.filter(row=>row.end<='2024-12-31');
 }
 const result=buildSecEarningsQualityAssessment(1234567,payload,'2026-09-30T12:00:00.000Z','2026-09-30T11:00:00.000Z',disclosureReviews());
 assert.equal(result.coverage.selectedUnit,'EUR');assert.equal(result.coverage.annualPeriodsFound,3);assert.equal(result.coverage.quarterlyPeriodsFound,8);
 const latest=result.periods.quarterly.find(period=>period.end==='2026-06-30');assert.equal(latest.metrics.revenue.unit,'EUR');assert.equal(result.assessment,undefined);assert.ok(result.missing.some(item=>/EUR is not converted to USD/.test(item)));
});
test('IFRS financial-strength aliases select explicit current/noncurrent concepts without double-counting broad borrowings',()=>{
 const cik=1855612,asOf='2026-09-30T12:00:00.000Z',retrievedAt='2026-09-30T11:00:00.000Z';
 const instant=(tag,val)=>({end:'2026-06-30',filed:'2026-08-15',form:'6-K',accn:'ifrs-issuer-2026q2',val,tag});
 const concepts={
  CashAndCashEquivalents:{USD:[instant('CashAndCashEquivalents',700)]},
  CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings:{USD:[instant('CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings',120)]},
  CurrentSecuredBankLoansReceivedAndCurrentPortionOfNoncurrentSecuredBankLoansReceived:{USD:[instant('CurrentSecuredBankLoansReceivedAndCurrentPortionOfNoncurrentSecuredBankLoansReceived',115)]},
  LongtermBorrowings:{USD:[instant('LongtermBorrowings',280)]},
  NoncurrentPortionOfOtherNoncurrentBorrowings:{USD:[instant('NoncurrentPortionOfOtherNoncurrentBorrowings',260)]},
  // Broad total must not be used alongside the split current/noncurrent facts.
  Borrowings:{USD:[instant('Borrowings',400)]},
  LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo:{USD:[instant('LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo',40)]},
 };
 const payload={cik,facts:{'ifrs-full':Object.fromEntries(Object.entries(concepts).map(([tag,units])=>[tag,{units}]))}};
 const result=buildSecFinancialStrengthInputs(cik,payload,asOf,retrievedAt,{coverage:{selectedUnit:'USD'},periods:{quarterly:[]}},'industrial-operating-company');
 assert.equal(result.metrics.unrestrictedCash.value,700);
 assert.equal(result.metrics.totalDebt.value,400,'choose one reported current alias and one noncurrent alias; do not sum competing tags');
 assert.equal(result.metrics.debtDueWithin24Months.value,160);
 assert.equal(result.metrics.totalDebt.source.tag,'CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings + LongtermBorrowings');
 assert.equal(result.metrics.debtDueWithin24Months.source.periodEnd,'2026-06-30');
});
test('IFRS financial-strength recognizes the separate current-borrowings concept and prefers specific interest over aggregate finance costs',()=>{
 const cik=1855612,asOf='2026-09-30T12:00:00.000Z',retrievedAt='2026-09-30T11:00:00.000Z';
 const instant=(tag,val)=>({end:'2026-06-30',filed:'2026-08-15',form:'6-K',accn:'ifrs-issuer-2026q2',val,tag});
 const ends=['2025-09-30','2025-12-31','2026-03-31','2026-06-30'];
 const starts=['2025-07-01','2025-10-01','2026-01-01','2026-04-01'];
 const duration=(tag,val,start,end,index)=>({start,end,val,filed:'2026-08-15',form:'6-K',accn:`ifrs-issuer-${index}`,tag});
 const concepts={
  CashAndCashEquivalents:{USD:[instant('CashAndCashEquivalents',700)]},
  CurrentPortionOfLongtermBorrowings:{USD:[instant('CurrentPortionOfLongtermBorrowings',120)]},
  LongtermBorrowings:{USD:[instant('LongtermBorrowings',280)]},
  LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo:{USD:[instant('LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo',40)]},
  InterestExpenseOnBorrowings:{USD:ends.map((end,index)=>duration('InterestExpenseOnBorrowings',2,starts[index],end,index))},
  FinanceCosts:{USD:ends.map((end,index)=>duration('FinanceCosts',10,starts[index],end,index))},
 };
 const payload={cik,facts:{'ifrs-full':Object.fromEntries(Object.entries(concepts).map(([tag,units])=>[tag,{units}]))}};
 const result=buildSecFinancialStrengthInputs(cik,payload,asOf,retrievedAt,{coverage:{selectedUnit:'USD'},periods:{quarterly:[]}},'industrial-operating-company');
 assert.equal(result.metrics.totalDebt.value,400);
 assert.match(result.metrics.totalDebt.source.tag,/CurrentPortionOfLongtermBorrowings/);
 assert.equal(result.metrics.interestExpenseTtm.value,8);
 assert.ok(result.metrics.interestExpenseTtm.source.tag.includes('InterestExpenseOnBorrowings'));
});

const ecbCsv=(records)=>['KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,TITLE_COMPL',...records.map(([currency,date,value])=>`EXR.D.${currency}.EUR.SP00.A,D,${currency},EUR,SP00,A,${date},${value},"ECB reference rate, ${currency}/Euro"`)].join('\n');
test('ECB parser accepts only the requested daily spot average series and rejects malformed/conflicting observations',()=>{
 const parsed=parseEcbDailyCsv(ecbCsv([['USD','2026-09-01','1.2'],['EUR','2026-09-01','1']]),['USD','EUR']);
 assert.deepEqual(parsed.map(item=>item.currency),['USD','EUR']);assert.equal(parsed[0].observations[0].unitsPerEur,1.2);
 assert.equal(parseEcbDailyCsv(ecbCsv([['USD','2026-09-01','1.2'],['GBP','2026-09-01','0.8']]),['USD'])[0].observations.length,1);
 assert.equal(parseEcbDailyCsv(ecbCsv([['USD','2026-09-01','1.2'],['USD','2026-09-01','1.3']]),['USD']),null);
 assert.equal(parseEcbDailyCsv('KEY,FREQ\n"broken', ['USD']),null);
});
test('ECB flow conversion averages date-matched daily cross-rates and records conversion lineage',()=>{
 const series=[
  {currency:'USD',observations:[{date:'2026-09-01',unitsPerEur:1.2},{date:'2026-09-02',unitsPerEur:1.3},{date:'2026-09-03',unitsPerEur:1.1}]},
  {currency:'JPY',observations:[{date:'2026-09-01',unitsPerEur:180},{date:'2026-09-02',unitsPerEur:195},{date:'2026-09-03',unitsPerEur:165}]},
 ];
 const result=convertFlowToUsd(100,'JPY','2026-09-01','2026-09-03',series);
 assert.ok(Math.abs(result.rate-(1.2/180+1.3/195+1.1/165)/3)<1e-12);assert.ok(Math.abs(result.value-100*result.rate)<1e-10);assert.equal(result.observationCount,3);
 const value=translateSourcedValue({value:100,unit:'JPY',source:{source:'SEC filing',url:'https://www.sec.gov/Archives/edgar/data/1/filing.htm',periodStart:'2026-09-01',periodEnd:'2026-09-03',availableAt:'2026-09-04T00:00:00Z',retrievedAt:'2026-09-05T00:00:00Z',currency:'JPY',rightsStatus:'redistribution-permitted',confidence:'high'}},result);
 assert.equal(value.unit,'USD');assert.equal(value.source.currency,'USD');assert.match(value.source.conversion.sourceUrl,/data-api\.ecb\.europa\.eu\/service\/data\/EXR\/D\.JPY\+USD\.EUR\.SP00\.A/);assert.match(value.source.tag,/2026-09-01\.\.2026-09-03/);
});
test('ECB flow conversion fails closed on incomplete rate coverage, stale endpoints, unknown currencies, and oversized periods',()=>{
 const series=[{currency:'USD',observations:[{date:'2026-09-01',unitsPerEur:1.2},{date:'2026-09-10',unitsPerEur:1.2}]},{currency:'JPY',observations:[{date:'2026-09-01',unitsPerEur:180},{date:'2026-09-10',unitsPerEur:180}]}];
 assert.equal(convertFlowToUsd(1,'JPY','2026-09-01','2026-09-10',series),null);
 assert.equal(convertFlowToUsd(1,'XYZ','2026-09-01','2026-09-10',series),null);
 assert.equal(convertFlowToUsd(1,'JPY','2024-01-01','2026-09-10',series),null);
});
test('ECB earnings translation converts a whole reported-currency period and preserves periods with incomplete metrics',()=>{
 const series=[{currency:'USD',observations:[{date:'2026-09-01',unitsPerEur:1.2},{date:'2026-09-02',unitsPerEur:1.2},{date:'2026-09-03',unitsPerEur:1.2}]},{currency:'JPY',observations:[{date:'2026-09-01',unitsPerEur:180},{date:'2026-09-02',unitsPerEur:180},{date:'2026-09-03',unitsPerEur:180}]}];
 const source={source:'SEC fact',url:'https://www.sec.gov/Archives/edgar/data/1/a.htm',periodStart:'2026-09-01',periodEnd:'2026-09-03',availableAt:'2026-09-04T00:00:00Z',retrievedAt:'2026-09-05T00:00:00Z',currency:'JPY',rightsStatus:'redistribution-permitted',confidence:'high'};
 const rows=convertEarningsPeriodsToUsd([{start:'2026-09-01',end:'2026-09-03',metrics:{revenue:{value:1800,unit:'JPY',source},netIncome:{value:180,unit:'JPY',source}}},{start:'2026-09-04',end:'2026-09-09',metrics:{revenue:{value:900,unit:'JPY',source}}}],'JPY',series);
 assert.equal(rows.state,'partial');assert.equal(rows.convertedCount,1);assert.equal(rows.withheldCount,1);assert.ok(Math.abs(rows.periods[0].metrics.revenue.value-12)<1e-12);assert.equal(rows.periods[0].translation,'translated-to-usd');assert.equal(rows.periods[1].metrics.revenue.unit,'JPY');
});
test('ECB balance-sheet translation uses the last observation on or before period end only',()=>{
 const series=[{currency:'USD',observations:[{date:'2026-09-03',unitsPerEur:1.2},{date:'2026-09-08',unitsPerEur:1.3}]},{currency:'JPY',observations:[{date:'2026-09-03',unitsPerEur:180},{date:'2026-09-08',unitsPerEur:195}]}];
 const result=convertInstantToUsd(1950,'JPY','2026-09-09',series);assert.equal(result.rate,1.3/195);assert.equal(result.ratePeriodStart,'2026-09-08');assert.equal(result.method,'period-end-prior-daily-reference-cross-rate');
 assert.equal(convertInstantToUsd(1,'JPY','2026-09-15',series),null);assert.equal(convertInstantToUsd(10,'USD','2026-09-09',[]).value,10);
});
test('ECB financial inputs use period-end conversion for balance-sheet values and period-average rates for TTM flows',()=>{
 const series=[{currency:'USD',observations:[{date:'2026-09-01',unitsPerEur:1.2},{date:'2026-09-02',unitsPerEur:1.2},{date:'2026-09-03',unitsPerEur:1.2}]},{currency:'JPY',observations:[{date:'2026-09-01',unitsPerEur:180},{date:'2026-09-02',unitsPerEur:180},{date:'2026-09-03',unitsPerEur:180}]}];
 const sourced=(value,start,end)=>({value,unit:'JPY',source:{source:'SEC source',url:'https://www.sec.gov/Archives/edgar/data/1/a.htm',periodStart:start,periodEnd:end,availableAt:'2026-09-04T00:00:00Z',retrievedAt:'2026-09-05T00:00:00Z',currency:'JPY',rightsStatus:'redistribution-permitted',confidence:'high'}});
 const result=convertFinancialMetricsToUsd({unrestrictedCash:sourced(1800,undefined,'2026-09-03'),totalDebt:sourced(900,undefined,'2026-09-03'),debtDueWithin24Months:sourced(300,undefined,'2026-09-03'),freeCashFlowTtm:sourced(1800,'2026-09-01','2026-09-03'),operatingIncomeTtm:sourced(900,'2026-09-01','2026-09-03'),interestExpenseTtm:sourced(90,'2026-09-01','2026-09-03')},'JPY',series,'2026-09-05T00:00:00Z');
 assert.equal(result.state,'complete');assert.equal(result.convertedCount,6);assert.equal(result.metrics.unrestrictedCash.unit,'USD');assert.equal(result.metrics.unrestrictedCash.source.conversion.method,'period-end-prior-daily-reference-cross-rate');assert.equal(result.metrics.freeCashFlowTtm.source.conversion.method,'period-average-daily-reference-cross-rate');
});
test('ECB API adapter bounds the request, validates content, and retrieves expected currency series',async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{const request=new URL(String(url));assert.match(request.pathname,/\/EXR\/D\.USD\.EUR\.SP00\.A$/);assert.equal(request.searchParams.get('startPeriod'),'2026-09-01');assert.equal(request.searchParams.get('endPeriod'),'2026-09-03');assert.equal(request.searchParams.get('format'),'csvdata');assert.equal(options.headers['User-Agent'],'SmallCapRadar/2.2');return new Response(ecbCsv([['USD','2026-09-01','1.2'],['USD','2026-09-02','1.3'],['USD','2026-09-03','1.1']]),{status:200,headers:{'content-type':'text/csv'}})};
 try{const data=await fetchEcbDailySeries('EUR','2026-09-01','2026-09-03');assert.equal(data?.[0].currency,'USD');assert.equal(data?.[0].observations.length,3);}finally{globalThis.fetch=originalFetch;}
});
test('ECB API adapter reports bounded failure reasons instead of silently hiding provider failures',async()=>{
 const originalFetch=globalThis.fetch;let reason;
 globalThis.fetch=async()=>new Response('blocked',{status:403});
 try{assert.equal(await fetchEcbDailySeries('EUR','2026-09-04','2026-09-06',value=>{reason=value}),null);assert.equal(reason,'frankfurter-http-403');}finally{globalThis.fetch=originalFetch;}
});
test('ECB adapter splits multi-year observations into bounded date chunks and merges validated series',async()=>{
 const originalFetch=globalThis.fetch,requests=[];
 globalThis.fetch=async url=>{const request=new URL(String(url)),start=request.searchParams.get('startPeriod'),end=request.searchParams.get('endPeriod');requests.push([start,end]);assert.ok((Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`))/86_400_000<400);return new Response(ecbCsv([['USD',start,'1.2']]),{status:200,headers:{'content-type':'text/csv'}})};
 try{const data=await fetchEcbDailySeries('EUR','2026-01-01','2027-02-05');assert.equal(requests.length,2);assert.deepEqual(data?.[0].observations.map(row=>row.date),['2026-01-01','2027-02-05']);}finally{globalThis.fetch=originalFetch;}
});
test('ECB fallback uses only Frankfurter data explicitly filtered to the ECB provider and retains its source',async()=>{
 const originalFetch=globalThis.fetch;let failure;
 globalThis.fetch=async(url)=>{const parsed=new URL(String(url));if(parsed.hostname==='data-api.ecb.europa.eu')throw Error('Worker network failure');assert.equal(parsed.hostname,'api.frankfurter.dev');assert.equal(parsed.pathname,'/v2/providers/ecb/rates');assert.equal(parsed.searchParams.get('base'),'EUR');assert.equal(parsed.searchParams.get('quotes'),'JPY,USD');return new Response(JSON.stringify([{date:'2026-09-01',base:'EUR',quote:'JPY',rate:150},{date:'2026-09-01',base:'EUR',quote:'USD',rate:1.2},{date:'2026-09-02',base:'EUR',quote:'JPY',rate:150},{date:'2026-09-02',base:'EUR',quote:'USD',rate:1.2},{date:'2026-09-03',base:'EUR',quote:'JPY',rate:150},{date:'2026-09-03',base:'EUR',quote:'USD',rate:1.2}]),{status:200,headers:{'content-type':'application/json'}})};
 try{const data=await fetchEcbDailySeries('JPY','2026-09-01','2026-09-03',reason=>{failure=reason});assert.equal(failure,undefined);assert.equal(data?.[0].rateProvider,'European Central Bank (ECB) via Frankfurter API');assert.match(data?.[0].sourceUrl??'',/^https:\/\/api\.frankfurter\.dev\/v2\/providers\/ecb\/rates/);const conversion=convertFlowToUsd(150,'JPY','2026-09-01','2026-09-03',data??[]);assert.equal(conversion?.rate,0.008);assert.equal(conversion?.rateProvider,'European Central Bank (ECB) via Frankfurter API');}finally{globalThis.fetch=originalFetch;}
});
test('Frankfurter conversion provenance links to the actual converted period even when acquisition was chunked',async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async url=>{const parsed=new URL(String(url));if(parsed.hostname==='data-api.ecb.europa.eu')throw Error('Worker network failure');return new Response(JSON.stringify([{date:parsed.searchParams.get('from'),base:'EUR',quote:'USD',rate:1.2}]),{status:200})};
 try{const data=await fetchEcbDailySeries('EUR','2026-01-01','2027-02-06');const instant=convertInstantToUsd(100,'EUR','2026-01-01',data??[]);assert.ok(instant);const source=new URL(instant.sourceUrl);assert.equal(source.searchParams.get('from'),'2026-01-01');assert.equal(source.searchParams.get('to'),'2026-01-01');assert.equal(source.searchParams.get('providers'),null);}finally{globalThis.fetch=originalFetch;}
});
test('ECB API adapter cancels an oversized streamed body even without Content-Length',async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(257_000));controller.close()}}),{status:200,headers:{'content-type':'text/csv'}});
 try{assert.equal(await fetchEcbDailySeries('CAD','2026-09-01','2026-09-03'),null);}finally{globalThis.fetch=originalFetch;}
});
test('converted provenance requires auditable ECB rate lineage and positive finite rates',()=>{
 const source={source:'SEC fact translated using ECB',url:'https://www.sec.gov/Archives/edgar/data/1/a.htm',periodStart:'2026-09-01',periodEnd:'2026-09-03',availableAt:'2026-09-04T00:00:00Z',retrievedAt:'2026-09-05T00:00:00Z',currency:'USD',rightsStatus:'redistribution-permitted',confidence:'high',conversion:{rate:.006666,sourceCurrency:'JPY',targetCurrency:'USD',method:'period-average-daily-reference-cross-rate',ratePeriodStart:'2026-09-01',ratePeriodEnd:'2026-09-03',observationCount:3,sourceUrl:'https://data-api.ecb.europa.eu/service/data/EXR/D.JPY+USD.EUR.SP00.A?startPeriod=2026-09-01&endPeriod=2026-09-03&format=csvdata',rateProvider:'European Central Bank (ECB) Data Portal',inputAvailableAt:'2026-09-04T00:00:00Z',inputRetrievedAt:'2026-09-05T00:00:00Z'}};
 assert.equal(isOpportunityProvenanceValid(source,'2026-09-06T00:00:00Z'),true);
 assert.equal(isOpportunityProvenanceValid({...source,conversion:{...source.conversion,sourceUrl:'https://api.frankfurter.dev/v2/providers/ecb/rates?from=2026-09-01&to=2026-09-03&base=EUR&quotes=JPY%2CUSD',rateProvider:'European Central Bank (ECB) via Frankfurter API'}},'2026-09-06T00:00:00Z'),true);
 assert.equal(isOpportunityProvenanceValid({...source,conversion:{...source.conversion,rate:0}},'2026-09-06T00:00:00Z'),false);
 assert.equal(isOpportunityProvenanceValid({...source,conversion:{...source.conversion,sourceUrl:'http://data.ecb.europa.eu/api'}},'2026-09-06T00:00:00Z'),false);
});
