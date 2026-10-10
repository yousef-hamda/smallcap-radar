import test from 'node:test';
import assert from 'node:assert/strict';
import {rawSecOwnershipDocument,selectRecentForm4Filings,fetchInsiderPurchases,attachScanMarketResearch} from '../../.test-build/providers.mjs';
import {buildSecFinancialStrengthInputs,buildSecEarningsQualityAssessment} from '../../.test-build/sec-opportunity.mjs';
import {alignSnapshotFinancials} from '../../.test-build/financial-integrity.mjs';
import {evaluateOpportunity} from '../../.test-build/opportunity-engine.mjs';
import {completeSnapshotSchema} from '../../.test-build/validation.mjs';
const asOf='2026-10-03T12:00:00Z';
const source=(start,end,extra={})=>({source:'SEC evidence fixture',url:'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json',periodStart:start,periodEnd:end,availableAt:'2026-08-01T00:00:00Z',retrievedAt:asOf,currency:'USD',rightsStatus:'redistribution-permitted',confidence:'high',...extra});
const metric=(value,start,end)=>({value,unit:'USD',source:source(start,end)});
const snapshot=()=>({symbol:'SYNTH',name:'Evidence fixture',securityType:'common',asOf,provenance:{}});
const factor=(s,id)=>evaluateOpportunity(s).factors.find(f=>f.id===id);
const submissions=(document='xslF345X05/ownership.xml',form='4')=>({cik:1,filings:{recent:{form:[form,'10-Q'],accessionNumber:['0000000001-26-000001','0000000001-25-000001'],primaryDocument:[document,'q.htm'],filingDate:['2026-09-20','2025-09-20']}}});
const annual=(year,value)=>({start:`${year}-01-01`,end:`${year}-12-31`,metrics:{revenue:metric(value,`${year}-01-01`,`${year}-12-31`)}});
const history=()=>({earnings:{annual:[annual(2024,100),annual(2025,140)],quarterly:[],conflicts:[]}});
const instant=(val,end='2026-06-30')=>({units:{USD:[{end,val,filed:'2026-08-01',form:'20-F',accn:'test'}]}});
const earnings=()=>({coverage:{selectedUnit:'USD'},periods:{annual:[],quarterly:[]},conflicts:[]});

test('strict snapshot import preserves reported currency and analytical translation labels',()=>{
 const period={...annual(2025,100),reportedCurrency:'EUR',translation:'translated-to-usd'};
 const s={...snapshot(),opportunityResearch:{earnings:{providerStatus:'retrieved',coverage:{annualPeriodsFound:1,quarterlyPeriodsFound:0,selectedUnit:'USD'},annual:[period],quarterly:[],missing:[],conflicts:[],limitations:[],readyForScoring:false}}};
 assert.deepEqual(completeSnapshotSchema.parse(s),s);
 assert.equal(completeSnapshotSchema.safeParse({...s,opportunityResearch:{earnings:{...s.opportunityResearch.earnings,annual:[{...period,translation:'unreviewed'}]}}}).success,false);
});

test('standard SEC ownership XSL routes resolve to raw XML while traversal and unknown routes stay rejected',()=>{
 for(const document of ['ownership.xml','xslF345X05/ownership.xml','xslF345X03/form4-123.xml'])assert.equal(rawSecOwnershipDocument(document),document.split('/').at(-1));
 for(const document of ['../ownership.xml','xslF345X05/../ownership.xml','xslF345X05/%2e%2e/ownership.xml','https://other.test/f.xml','folder/ownership.xml','xslF345X05/ownership.htm','xslF345X05/ownership.xml?x=1'])assert.equal(rawSecOwnershipDocument(document),null);
 const selected=selectRecentForm4Filings(submissions(),asOf);assert.equal(selected.selected.length,1);assert.equal(selected.coverage.availableForm4Count,1);assert.equal(selected.coverage.submissionWindowComplete,true);
});

test('malformed ownership paths and amendments cannot disappear into a complete empty review',()=>{
 for(const form of ['4','4/A'])assert.equal(selectRecentForm4Filings(submissions('../ownership.xml',form),asOf).coverage.submissionWindowComplete,false);
 const amended=submissions('xslF345X05/ownership.xml','4/A');assert.equal(selectRecentForm4Filings(amended,asOf).coverage.submissionWindowComplete,true);
});

test('SEC raw ownership XML is fetched, archived and credited without treating XSL HTML as the document',async()=>{
 const original=globalThis.fetch,agent=process.env.SEC_USER_AGENT;process.env.SEC_USER_AGENT='SmallCapRadar test (contact: test@example.com)';let requested;
 globalThis.fetch=async url=>{requested=String(url);return new Response('<ownershipDocument><issuer><issuerCik>1</issuerCik></issuer><reportingOwner><rptOwnerName>Officer</rptOwnerName></reportingOwner><nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionCode>P</transactionCode><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode><transactionDate><value>2026-09-19</value></transactionDate><transactionShares><value>100</value></transactionShares><transactionPricePerShare><value>2</value></transactionPricePerShare></nonDerivativeTransaction></ownershipDocument>');};
 try{const result=await fetchInsiderPurchases(1,asOf,submissions());assert.equal(requested,'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/ownership.xml');assert.equal(result.observedPurchaseValue,200);assert.equal(result.coverage.state,'complete');assert.match(result.purchases[0].contentHash,/^[a-f0-9]{64}$/);
 const amendment=submissions('xslF345X05/ownership.xml','4/A');const held=await fetchInsiderPurchases(1,asOf,amendment);assert.equal(held.coverage.state,'partial');assert.equal(held.observedPurchaseValue,0);
 }finally{globalThis.fetch=original;if(agent===undefined)delete process.env.SEC_USER_AGENT;else process.env.SEC_USER_AGENT=agent;}
});

test('contradictory aggregate borrowing cannot be bypassed by fallback component addition',()=>{
 const facts={Borrowings:instant(0),BorrowingsCurrent:instant(20),BorrowingsNoncurrent:instant(80),CashAndCashEquivalents:instant(50)};
 const build=()=>buildSecFinancialStrengthInputs(1,{cik:1,facts:{'ifrs-full':facts}},asOf,asOf,earnings(),'industrial-operating-company');
 assert.equal(build().metrics.totalDebt,undefined);assert(build().missing.some(item=>item.includes('inconsistent')));
 facts.Borrowings=instant(100);assert.equal(build().metrics.totalDebt.value,100);delete facts.Borrowings;assert.equal(build().metrics.totalDebt.value,100);
});

test('independent financial balances remain usable with missing or conflicted earnings research',()=>{
 const financialStrength={metrics:{unrestrictedCash:metric(50,undefined,'2026-06-30'),totalDebt:metric(10,undefined,'2026-06-30')},conflicts:[]};
 for(const research of [undefined,{annual:[],quarterly:[],conflicts:['stockBasedCompensation: concept conflict']}]){const s={...snapshot(),opportunityResearch:{earnings:research,financialStrength}};const aligned=alignSnapshotFinancials(s);assert.equal(aligned.cash,50);assert.equal(aligned.debt,10);}
 const held=alignSnapshotFinancials({...snapshot(),opportunityResearch:{financialStrength:{...financialStrength,conflicts:['cash balance contradiction']}}});assert.equal(held.cash,undefined);
});

test('market capitalization freshness is checked at its own dependency, not the newer financial publication',()=>{
 const s={...snapshot(),price:10,marketCap:20,revenue:100,fcf:20,provenance:{price:source(undefined,'2026-10-02',{availableAt:'2026-10-02T21:00:00Z'}),marketCap:source(undefined,'2024-10-02',{availableAt:'2024-10-02T21:00:00Z'}),revenue:source('2025-07-01','2026-06-30',{availableAt:'2026-10-02T20:00:00Z'}),fcf:source('2025-07-01','2026-06-30',{availableAt:'2026-10-02T20:00:00Z'})}};
 const held=alignSnapshotFinancials(s);assert.equal(held.ps,null);assert.equal(held.fcfYield,null);assert.equal(factor(held,'valuation').score,0);
 s.provenance.marketCap=source(undefined,'2026-10-02',{availableAt:'2026-10-02T21:00:00Z'});const fresh=alignSnapshotFinancials(s);assert.equal(fresh.ps,.2);assert.equal(fresh.fcfYield,1);assert(factor(fresh,'valuation').score>0);
});

test('new comparable SEC revenue periods recover growth credit masked by a stale finite compact field',()=>{
 const s={...snapshot(),opportunityResearch:history()};assert.equal(factor(s,'catalysts').score,5);
 s.revenueGrowth=.1;s.provenance.revenueGrowth=source('2020-01-01','2020-12-31');assert.equal(factor(s,'catalysts').score,5);
});

test('overlapping YTD, wrong source dates and segment revenue cannot impersonate standalone growth periods',()=>{
 for(const mutate of [r=>r.annual[1].start='2025-04-01',r=>r.annual[1].metrics.revenue.source.periodStart='2025-04-01',r=>r.annual[1].metrics.revenue.source.scope='segment',r=>r.annual[1].metrics.revenue.source.currency='EUR']){
  const s={...snapshot(),opportunityResearch:history()};mutate(s.opportunityResearch.earnings);assert.equal(factor(s,'catalysts').score,0);
 }
 const quarters=Array.from({length:8},(_,index)=>{const year=2024+Math.floor(index/4),month=(index%4)*3;const start=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10),end=new Date(Date.UTC(year,month+3,0)).toISOString().slice(0,10);return {start,end,metrics:{revenue:metric(index<4?25:35,start,end)}};});
 const s={...snapshot(),opportunityResearch:{earnings:{annual:[],quarterly:quarters,conflicts:[]}}};assert.equal(factor(s,'catalysts').score,5);
 for(const row of quarters){row.start=row.start.slice(0,4)+'-01-01';row.metrics.revenue.source.periodStart=row.start;}assert.equal(factor(s,'catalysts').score,0);
});

test('backlog ratio credit requires aligned currency, consolidated scope and current source availability',()=>{
 const s={...snapshot(),revenue:100,backlog:{kind:'backlog',amount:100,expectedRecognitionBy:'2026-12-31',currency:'USD'},provenance:{revenue:source('2025-07-01','2026-06-30'),backlog:source(undefined,'2026-06-30')}};
 assert.equal(factor(s,'catalysts').score,1.5);
 for(const mutate of [x=>x.backlog.currency='EUR',x=>x.provenance.backlog.currency='EUR',x=>x.provenance.backlog.scope='segment',x=>x.provenance.backlog.periodEnd='2020-06-30',x=>x.provenance.backlog.retrievedAt='2026-10-04T12:00:00Z']){const held=structuredClone(s);mutate(held);assert.equal(factor(held,'catalysts').score,0);}
});

test('split-adjusted chart history does not certify or penalize an unreconciled SEC share change',()=>{
 const stock={history:[{date:'2025-01-01',close:10},{date:'2026-10-02',close:10}],splits:[{date:'2026-01-15',factor:2}],url:'https://query1.finance.yahoo.com/v8/finance/chart/SYNTH',source:'Yahoo Finance chart API',retrievedAt:asOf,availableAt:'2026-10-02T21:00:00Z'};
 const s={...snapshot(),shareCountRatio:2.2,dilution:1.2,splitAdjusted:false,provenance:{shareCountRatio:source('2025-06-30','2026-06-30'),dilution:source('2025-06-30','2026-06-30')}};
 attachScanMarketResearch(s,stock);assert.equal(s.splitAdjusted,true);assert(Math.abs(s.dilution-.1)<1e-12);
 const uncovered={...snapshot(),shareCountRatio:2.2,dilution:1.2,splitAdjusted:false,provenance:{shareCountRatio:source('2024-06-30','2026-06-30')}};attachScanMarketResearch(uncovered,stock);assert.equal(uncovered.splitAdjusted,false);
 const noShares=snapshot();attachScanMarketResearch(noShares,stock);assert.notEqual(noShares.splitAdjusted,true);
});

test('financing grades distinguish current mild and elevated findings without admitting stale clean evidence',()=>{
 for(const [level,expected] of [['clean',3],['mild',2.1],['elevated',.9],['severe',0]])assert.equal(factor({...snapshot(),deathSpiral:level,provenance:{deathSpiral:source(undefined,'2026-06-30')}},'downsideRisk').score,expected);
 assert.equal(factor({...snapshot(),deathSpiral:'clean',provenance:{deathSpiral:source(undefined,'2020-06-30')}},'downsideRisk').score,0);
});

test('SEC total versus continuing cash-flow disclosures are distinct scopes, not contradictory aliases',()=>{
 const row={start:'2025-01-01',end:'2025-12-31',filed:'2026-03-01',val:100,form:'10-K',accn:'test'};
 const payload={cik:1,facts:{'us-gaap':{RevenueFromContractWithCustomerExcludingAssessedTax:{units:{USD:[row]}},NetCashProvidedByUsedInOperatingActivities:{units:{USD:[{...row,val:20}]}},NetCashProvidedByUsedInOperatingActivitiesContinuingOperations:{units:{USD:[{...row,val:15}]}}}}};
 const built=buildSecEarningsQualityAssessment(1,payload,asOf,asOf);assert.deepEqual(built.conflicts,[]);assert.equal(built.periods.annual[0].metrics.operatingCashFlow.value,20);assert.equal(built.periods.annual[0].metrics.operatingCashFlow.source.scope,'consolidated');
});

test('interest expense must match the same four operating quarters; aligned alternative concept and duplicate filings stay usable',()=>{
 const quarters=[['2025-07-01','2025-09-30'],['2025-10-01','2025-12-31'],['2026-01-01','2026-03-31'],['2026-04-01','2026-06-30']];
 const earn=earnings();earn.periods.quarterly=quarters.map(([start,end])=>({start,end,metrics:{operatingCashFlow:metric(20,start,end),capitalExpenditure:metric(5,start,end),operatingIncome:metric(10,start,end)}}));
 const row=(start,end,val=2)=>({start,end,val,filed:'2026-08-01',form:'10-Q',accn:'test'});
 const facts={CashAndCashEquivalentsAtCarryingValue:instant(50),LongTermDebtCurrent:instant(10),LongTermDebtNoncurrent:instant(20),InterestExpenseNonoperating:{units:{USD:quarters.map(([start,end])=>row(start.replace('2026','2025').replace('2025-07','2024-07').replace('2025-10','2024-10'),end.replace('2026','2025').replace('2025-09','2024-09').replace('2025-12','2024-12')))}}};
 const build=()=>buildSecFinancialStrengthInputs(1,{cik:1,facts:{'us-gaap':facts}},asOf,asOf,earn,'industrial-operating-company');
 assert.equal(build().metrics.interestExpenseTtm,undefined,'old lower expense cannot inflate current coverage');
 facts.InterestExpenseDebt={units:{USD:quarters.flatMap(([start,end])=>[row(start,end),{...row(start,end),form:'10-Q/A',filed:'2026-08-02',accn:'amended'}])}};
 assert.equal(build().metrics.interestExpenseTtm.value,8);assert.equal(build().metrics.interestExpenseTtm.source.periodStart,'2025-07-01');assert.equal(build().metrics.interestExpenseTtm.source.periodEnd,'2026-06-30');
});

test('canonical borrowing aliases preserve valid IFRS long-term parts while rejecting contradictory aggregate totals',()=>{
 const facts={CurrentPortionOfLongtermBorrowings:instant(20),LongtermBorrowings:instant(80)};
 const build=()=>buildSecFinancialStrengthInputs(1,{cik:1,facts:{'ifrs-full':facts}},asOf,asOf,earnings(),'industrial-operating-company');
 assert.equal(build().metrics.totalDebt.value,100);assert.match(build().metrics.totalDebt.source.tag,/CurrentPortionOfLongtermBorrowings/);
 facts.Borrowings=instant(0);assert.equal(build().metrics.totalDebt,undefined);facts.Borrowings=instant(100);assert.equal(build().metrics.totalDebt.value,100);
});

test('requested research horizon governs earnings and backlog timing without changing factor weights',()=>{
 const s={...snapshot(),revenue:100,backlog:{kind:'backlog',amount:100,expectedRecognitionBy:'2026-12-31',currency:'USD'},nextEarnings:'2026-12-01',provenance:{revenue:source('2025-07-01','2026-06-30'),backlog:source(undefined,'2026-06-30'),nextEarnings:source(undefined,'2026-10-01',{availableAt:'2026-10-01T00:00:00Z'})}};
 const short=evaluateOpportunity(s,{}, {horizonMonths:1});const normal=evaluateOpportunity(s,{}, {horizonMonths:6});assert.equal(short.factors.find(f=>f.id==='catalysts').score,0);assert.equal(normal.factors.find(f=>f.id==='catalysts').score,1.9);assert.deepEqual(short.factors.map(f=>f.weight),normal.factors.map(f=>f.weight));
});

test('definite debt contradiction removes only inherited debt while preserving independent cash',()=>{
 const facts={Borrowings:instant(0),BorrowingsCurrent:instant(20),BorrowingsNoncurrent:instant(80),CashAndCashEquivalents:instant(50)};
 const financialStrength=buildSecFinancialStrengthInputs(1,{cik:1,facts:{'ifrs-full':facts}},asOf,asOf,earnings(),'industrial-operating-company');assert(financialStrength.conflicts.some(item=>item.startsWith('totalDebt: reported aggregate contradicts contemporaneous components')));
 const s={...snapshot(),debt:100,cash:1,provenance:{debt:source(undefined,'2026-06-30'),cash:source(undefined,'2026-06-30')},opportunityResearch:{financialStrength}};
 const aligned=alignSnapshotFinancials(s);assert.equal(aligned.debt,undefined);assert.equal(aligned.provenance.debt,undefined);assert.equal(aligned.cash,50);
 const unknown=alignSnapshotFinancials({...s,opportunityResearch:{financialStrength:{...financialStrength,conflicts:[],metrics:{},missing:['debt unavailable']}}});assert.equal(unknown.debt,100,'missing acquisition is not a fabricated contradictory finding');
});

test('model credit rejects future or unauditable source dependencies even when wrapper dates look usable',()=>{
 const s={...snapshot(),grossMargin:.5,provenance:{grossMargin:source('2025-07-01','2026-06-30')}};assert(factor(s,'competitivePosition').score>0);
 for(const dependency of [source('2025-07-01','2026-06-30',{retrievedAt:'2026-10-04T12:00:00Z'}),source('2025-07-01','2026-06-30',{availableAt:'2026-10-04T12:00:00Z'}),source('2025-07-01','2026-06-30',{url:'http://invalid.test'})]){
  const held=structuredClone(s);held.provenance.grossMargin.dependencies=[dependency];assert.equal(factor(held,'competitivePosition').score,0);
 }
 s.provenance.grossMargin.dependencies=[source('2025-07-01','2026-06-30',{rightsStatus:'unknown'})];assert(factor(s,'competitivePosition').score>0,'unknown rights remain an explicit model evidence limitation, without inventing entitlement');
});

test('secured-loan and other-borrowing subcategories cannot masquerade as a complete total debt fallback',()=>{
 const facts={CurrentSecuredBankLoansReceivedAndCurrentPortionOfNoncurrentSecuredBankLoansReceived:instant(5),NoncurrentPortionOfNoncurrentSecuredBankLoansReceived:instant(5),NoncurrentPortionOfOtherNoncurrentBorrowings:instant(1)};
 const build=()=>buildSecFinancialStrengthInputs(1,{cik:1,facts:{'ifrs-full':facts}},asOf,asOf,earnings(),'industrial-operating-company');assert.equal(build().metrics.totalDebt,undefined);
 facts.Borrowings=instant(100);assert.equal(build().metrics.totalDebt.value,100);
});

test('24-month maturity coverage requires broad current principal or explicitly disclosed nonoverlapping short-term plus long-term portions',()=>{
 const facts={CashAndCashEquivalentsAtCarryingValue:instant(50),LongTermDebtCurrent:instant(10),LongTermDebtNoncurrent:instant(20),LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo:instant(8)};
 const build=()=>buildSecFinancialStrengthInputs(1,{cik:1,facts:{'us-gaap':facts}},asOf,asOf,earnings(),'industrial-operating-company');
 assert.equal(build().metrics.debtDueWithin24Months,undefined,'missing short-term borrowing is not known zero');
 facts.ShortTermBorrowings=instant(5);assert.equal(build().metrics.debtDueWithin24Months.value,23);assert.equal(build().metrics.totalDebt.value,35);
 facts.ShortTermBorrowings=instant(0);assert.equal(build().metrics.debtDueWithin24Months.value,18);
 const narrow={ShortTermBorrowings:instant(5),CurrentSecuredBankLoansReceivedAndCurrentPortionOfNoncurrentSecuredBankLoansReceived:instant(5),LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo:instant(8)};
 assert.equal(buildSecFinancialStrengthInputs(1,{cik:1,facts:{'ifrs-full':narrow}},asOf,asOf,earnings(),'industrial-operating-company').metrics.debtDueWithin24Months,undefined);
 const broad={BorrowingsCurrent:instant(15),BorrowingsNoncurrent:instant(20),ShortTermBorrowings:instant(5),LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo:instant(8)};
 const result=buildSecFinancialStrengthInputs(1,{cik:1,facts:{'ifrs-full':broad}},asOf,asOf,earnings(),'industrial-operating-company');assert.equal(result.metrics.debtDueWithin24Months.value,23,'broad current borrowing already includes short-term debt');
});

test('a complete segment flow history cannot be promoted to consolidated issuer profitability',()=>{
 const s={...snapshot(),opportunityResearch:history()};for(const row of s.opportunityResearch.earnings.annual)row.metrics.revenue.source.scope='segment';
 assert.equal(alignSnapshotFinancials(s).revenue,undefined);
 const compact={...snapshot(),revenue:100,netIncome:20,fcf:20,provenance:Object.fromEntries(['revenue','netIncome','fcf'].map(key=>[key,source('2025-07-01','2026-06-30',{scope:'segment'})]))};assert.equal(factor(compact,'earningsQuality').score,0);assert.equal(factor(compact,'financialStrength').score,0);
});

test('growth selection recovers from invalid newer dependencies and retains the actual chosen input trace',()=>{
 const s={...snapshot(),opportunityResearch:history(),revenueGrowth:.2,provenance:{revenueGrowth:source('2025-07-01','2026-06-30')}};
 s.provenance.revenueGrowth.dependencies=[source('2025-07-01','2026-06-30',{retrievedAt:'2026-10-04T12:00:00Z'})];let result=factor(s,'catalysts');assert.equal(result.score,5);assert(result.calculation.inputs.some(item=>item.name==='derived-observed-revenue-growth'));
 delete s.provenance.revenueGrowth.dependencies;result=factor(s,'catalysts');assert.equal(result.score,2.5);assert(!result.calculation.inputs.some(item=>item.name==='derived-observed-revenue-growth'));assert.equal(result.sources[0].periodEnd,'2026-06-30');
 s.revenueGrowth=140/100-1;result=factor(s,'catalysts');assert(!result.calculation.inputs.some(item=>item.name==='derived-observed-revenue-growth'));assert.equal(result.sources[0].periodEnd,'2026-06-30','equal numeric observations do not substitute another source');
});
