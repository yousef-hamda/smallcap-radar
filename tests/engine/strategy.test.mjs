import test from 'node:test';import assert from 'node:assert/strict';
import {SPECS,evaluateStrategy,specHash} from '../../.test-build/engine.mjs';
import {fixtures} from '../../.test-build/fixtures.mjs';
import {simulateExit,expiryDate,pointInTime,firmHoldout,firmBootstrap,bonferroni,splitAdjustedDilution,ma30Weeks,bounceHistoryMetrics} from '../../.test-build/research.mjs';
import {trailingAnnual,insiderPurchases,latestInstant} from '../../.test-build/sec.mjs';
import {preliminarySnapshot,parseCompanyFacts,needsCompanyFacts,fetchCompanyFactsFallback,fetchBulkFundamentals} from '../../.test-build/bulk.mjs';
import {yahooPercentAsRatio,parseYahooDaily,yahooSymbol,yahooBulkQuotes} from '../../.test-build/providers.mjs';
import {reviewShareSplits} from '../../.test-build/research.mjs';
import {enrichFinancials} from '../../.test-build/financials.mjs';
import {derivedEvidence} from '../../.test-build/evidence.mjs';
import {parseYahooIntraday} from '../../.test-build/chart-data.mjs';
import {parseOfficialDirectory} from '../../.test-build/directory.mjs';
import {applyFinancingRisk} from '../../.test-build/financing-risk.mjs';
const base=fixtures[0];const gate=(s,id,strategy='core')=>evaluateStrategy(strategy,s).checks.find(c=>c.id===id).status;
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
test('both target and stop in daily bar assumes stop',()=>{const r=simulateExit(100,'2026-01-01',[{date:'2026-01-02',open:100,high:122,low:83,close:105}]);assert.equal(r.reason,'stop');assert.equal(r.fill,85)});
test('gap below stop fills at open',()=>assert.equal(simulateExit(100,'2026-01-01',[{date:'2026-01-02',open:75,high:80,low:70,close:78}]).fill,75));
test('target touch and conservative gap-up',()=>assert.equal(simulateExit(100,'2026-01-01',[{date:'2026-01-02',open:130,high:135,low:125,close:129}]).fill,120));
test('calendar expiry clamps month end and uses next observed trading open',()=>{assert.equal(expiryDate('2026-01-31'),'2026-04-30');const r=simulateExit(100,'2026-01-31',[{date:'2026-05-01',open:103,high:105,low:99,close:101}]);assert.equal(r.fill,103);assert.equal(r.reason,'time')});
test('no future bars means open, not a fictional exit',()=>{const r=simulateExit(100,'2026-01-01',[]);assert.equal(r.reason,'open');assert.equal(r.netReturn,null)});
test('cost sensitivity monotonic',()=>{const b=[{date:'2026-01-02',open:100,high:122,low:99,close:120}];const r=[0,25,50,100].map(slippageBps=>simulateExit(100,'2026-01-01',b,{slippageBps,commission:0,shares:1}).netReturn);assert(r.every((n,i)=>!i||n<r[i-1]))});
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
test('insiders only code P',()=>assert.equal(insiderPurchases(['P','A','M','S'].map(code=>({code,shares:10,price:5,date:'2025-01-01',owner:'a'}))).length,1));
test('instant latest never future',()=>assert.equal(latestInstant([{end:'2025-01-01',val:10,filed:'2025-02-01',form:'10-K'}],'2025-01-31T00:00:00Z'),null));
test('30 completed consecutive weekly closes, no partial week',()=>{const rows=[];for(let i=0;i<30;i++){const d=new Date('2025-01-03T00:00:00Z');d.setUTCDate(d.getUTCDate()+7*i);rows.push({date:d.toISOString().slice(0,10),close:100})}assert.equal(ma30Weeks(rows,'2025-08-01T00:00:00Z'),100);assert.equal(ma30Weeks(rows.slice(1),'2025-08-01T00:00:00Z'),null)});
test('Bounce history derives return, low and MA without quote fields',()=>{const rows=[];for(let i=0;i<400;i++){const d=new Date('2024-01-02T00:00:00Z');d.setUTCDate(d.getUTCDate()+i);if(d.getUTCDay()===0||d.getUTCDay()===6)continue;const close=i<150?100-i*.3:55+(i-150)*.2;rows.push({date:d.toISOString().slice(0,10),close,low:close*.95})}const r=bounceHistoryMetrics(rows,'2025-06-30T00:00:00Z');assert(Number.isFinite(r.return12m));assert(Number.isFinite(r.low52w));assert(Number.isFinite(r.ma30w));});
test('standalone Q3 cannot be misread as YTD',()=>{const rows=[{start:'2024-01-01',end:'2024-12-31',val:100,filed:'2025-02-01',form:'10-K',tag:'CFO'},{start:'2024-07-01',end:'2024-09-30',val:20,filed:'2024-11-01',form:'10-Q',tag:'CFO'},{start:'2025-07-01',end:'2025-09-30',val:30,filed:'2025-11-01',form:'10-Q',tag:'CFO'}];assert.equal(trailingAnnual(rows,'2025-12-01T00:00:00Z'),null)});
test('future price dependency cannot pass freshness or provenance',()=>{const s={...base,provenance:{...base.provenance,price:{...base.provenance.price,availableAt:'2027-01-01T00:00:00Z'}}};assert.equal(gate(s,'freshness'),'UNKNOWN');assert.equal(gate(s,'provenance'),'UNKNOWN')});
test('bulk snapshot derives FCF and valuation without per-company requests',()=>{const fact=(val,tag,end='2025-12-31')=>({cik:1,start:'2025-01-01',end,val,filed:'2026-02-15',form:'10-K',tag,priority:0,url:'https://data.sec.gov/test'});const s=preliminarySnapshot({cik:1,ticker:'TEST',name:'Test Corp',exchange:'Nasdaq',price:10,marketCap:100e6,averageVolume10d:100000},{revenue:fact(50e6,'Revenues'),netIncome:fact(2e6,'NetIncomeLoss'),ocf:fact(6e6,'NetCashProvidedByUsedInOperatingActivities'),capex:fact(1e6,'PaymentsToAcquirePropertyPlantAndEquipment'),cash:fact(10e6,'CashAndCashEquivalentsAtCarryingValue'),debtNoncurrent:fact(20e6,'LongTermDebtNoncurrent')},'2026-03-01T00:00:00.000Z');assert.equal(s.fcf,5e6);assert.equal(s.ps,2);assert.equal(s.evSales,undefined);assert.equal(s.medianDollarVolume20d,undefined);assert.match(s.dataIssues[0],/لا يُستنتج/)});
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
 globalThis.fetch=async()=>{call++;if(call===1)return new Response('',{headers:{'set-cookie':'A=1; Path=/'}});if(call===2)return new Response('crumb');return Response.json({quoteResponse:{result:[{symbol:'DOT-A',regularMarketPrice:12,regularMarketTime:now},{symbol:'STALE',regularMarketPrice:99}]}})};
 try{
  const rows=await yahooBulkQuotes([{cik:1,ticker:'DOT.A',name:'Dot',exchange:'NYSE',price:8,marketCap:80e6,quoteSource:'bundled official dated snapshot',quoteAvailableAt:'2026-01-01T00:00:00Z',priceSource:'bundled official dated snapshot',priceAvailableAt:'2026-01-01T00:00:00Z',marketCapSource:'bundled official dated snapshot',marketCapAvailableAt:'2026-01-01T00:00:00Z'},{cik:2,ticker:'STALE',name:'Stale',exchange:'NYSE',price:7,quoteAvailableAt:'2026-01-01T00:00:00Z'}]);
  assert.equal(rows[0].price,12);assert.equal(rows[0].quoteSource,'Yahoo bulk quote live');assert.equal(rows[0].marketCap,80e6);assert.equal(rows[0].marketCapAvailableAt,'2026-01-01T00:00:00Z');assert.notEqual(rows[0].priceAvailableAt,rows[0].marketCapAvailableAt);
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
 }, parsed=parseCompanyFacts(123,{facts},asOf);
 assert(parsed);assert.equal(parsed.revenue.val,120);assert.equal(parsed.netIncome.val,12);assert.equal(parsed.cash.val,30);assert.equal(parsed.debtCurrent.val,2);assert.equal(parsed.debtNoncurrent.val,8);assert.equal(parsed.shares.val,110);assert.equal(parsed.priorShares.val,100);assert.equal(parsed.revenue.kind,'companyfacts');assert.equal(needsCompanyFacts(parsed),false);
 const future={facts:{'us-gaap':{Revenues:{units:{USD:[annual('Revenues',999),{...annual('Revenues',1000),end:'2027-12-31',filed:'2026-08-01'}]}}}}};assert.equal(parseCompanyFacts(123,future,asOf).revenue.val,999);
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
 globalThis.fetch=async()=>{calls++;if(calls===1)return new Response('',{status:503});return Response.json({facts:{'us-gaap':{Revenues:{units:{USD:[{start:'2025-01-01',end:'2025-12-31',val:120,filed:'2026-02-15',form:'10-K'}]}}}}});};
 try{const result=await fetchCompanyFactsFallback([9876543],asOf);assert.equal(result.requests,1);assert.equal(result.success,1);assert.equal(result.failed,0);assert(calls>=2);assert.equal(result.fundamentals.get(9876543).revenue.val,120);assert.equal(result.fundamentals.get(9876543).revenue.kind,'companyfacts');}finally{globalThis.fetch=original;}
});
test('deep financial enrichment derives cash debt EV/S without treating missing debt as zero',()=>{
 const row=val=>({val,end:'2026-06-30',filed:'2026-08-01',form:'10-Q'});
 const facts={'us-gaap':Object.fromEntries([['CashAndCashEquivalentsAtCarryingValue',20e6],['LongTermDebtCurrent',3e6],['LongTermDebtNoncurrent',7e6]].map(([tag,val])=>[tag,{units:{USD:[row(val)]}}]))};
 const s=enrichFinancials(base,facts,'https://data.sec.gov/test');assert.equal(s.cash,20e6);assert.equal(s.debt,10e6);assert.equal(s.evSales,(base.marketCap-10e6)/base.revenue);
 const missing=structuredClone(facts);delete missing['us-gaap'].LongTermDebtCurrent;
 const partial=enrichFinancials({...base,evSales:undefined},missing,'https://data.sec.gov/test');assert.equal(partial.debt,undefined);assert.equal(partial.evSales,undefined);
});
test('intraday parser removes null, duplicate and future points and uses previous close baseline',()=>{
 const asOf='2026-09-08T15:00:00Z',cut=Math.floor(Date.parse(asOf)/1000);
 const r=parseYahooIntraday({chart:{result:[{timestamp:[cut-600,cut-300,cut-300,cut+300],indicators:{quote:[{close:[10,null,11,12]}]},meta:{chartPreviousClose:8}}]}},asOf);
 assert.deepEqual(r.points,[{t:cut-600,c:10},{t:cut-300,c:11}]);assert.equal(r.baseline,8);assert.equal(r.changePct,.375);
});
test('official directory excludes ETF and test issues and joins SEC CIKs',()=>{
 const nasdaq='Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares\nAAA|AAA old|Q|N|N|100|N|N\nETFZ|Fund|Q|N|N|100|Y|N\nTEST|Test|Q|Y|N|100|N|N';
 const other='ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol\nBBB|BBB Inc|N|BBB|N|100|N|BBB\nOTC|OTC Inc|U|OTC|N|100|N|OTC';
 assert.deepEqual(parseOfficialDirectory(nasdaq,other,{'0':{ticker:'AAA',title:'AAA SEC',cik_str:123},'1':{ticker:'BBB',title:'BBB SEC',cik_str:456}}),[{ticker:'AAA',name:'AAA SEC',exchange:'Nasdaq',cik:123},{ticker:'BBB',name:'BBB SEC',exchange:'NYSE',cik:456}]);
});
test('official directory joins SEC dash symbols to Nasdaq dot share classes',()=>{
 const other='ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol\nBRK.B|Class B|N|BRK.B|N|100|N|BRK.B';
 assert.deepEqual(parseOfficialDirectory('',other,{'0':{ticker:'BRK-B',title:'Issuer',cik_str:1067983}}),[{ticker:'BRK.B',name:'Issuer',exchange:'NYSE',cik:1067983}]);
});
test('SEC frame request counters describe only the current resumable page',async()=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=async url=>{calls.push(String(url));return Response.json({data:[]});};
 try{
  const result=await fetchBulkFundamentals([987654321],new Date('2026-09-01T00:00:00Z'),{offset:12,limit:4});
  assert.equal(result.requests,1);assert.equal(result.optionalRequests,3);assert.equal(result.success,1);assert.equal(result.optionalSuccess,3);assert.equal(calls.length,4);
 }finally{globalThis.fetch=original;}
});
