import type {Snapshot,Provenance} from './engine';
import {commonPerShareMetricsApplicable,compatibleFinancialSources,modelEvidenceAvailable} from './financial-integrity';

export const INTRINSIC_POLICY = Object.freeze({version:'normalized-owner-cashflow-v3-current-period',years:5,bearReturn:.18,baseReturn:.14,bullReturn:.10,terminalGrowth:.02,maxGrowth:.15,minGrowth:-.10,earningsMultiples:[8,12,16]});
export type IntrinsicScenario={name:'bear'|'base'|'bull';requiredReturn:number;initialGrowth:number;terminalGrowth:number;cashflowValue:number;earningsValue:number;equityValue:number;valuePerSecurity:number;upside:number;discount:number};
export type OpportunityThesis={modelVersion:string;horizonMonths:number;probability:null;calibrationStatus:'unvalidated';valuation:{status:'available'|'unavailable';method:string;normalizedCashflow:number|null;normalizedEarnings:number|null;scenarios:IntrinsicScenario[];sources:Provenance[];gaps:string[];assumptions:typeof INTRINSIC_POLICY};sixMonthTarget:null;catalysts:Array<{id:string;date:string;title:string;status:'unreviewed';source:string}>;funding:{cash:number|null;debt:number|null;cashCurrency:string|null;debtCurrency:string|null;cashRunwayMonths:number|null;dilution:number|null};invalidation:string[];action:'research-required'|'risk-review'|'candidate-review'};
const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b),i=Math.floor(sorted.length/2);return sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2;};
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const clamp=(value:number,low:number,high:number)=>Math.min(high,Math.max(low,value));

/** A model estimate with explicit policy assumptions. No analyst target, vendor
 * multiple or unsupported share count is described as an observed fair value. */
export function buildOpportunityThesis(snapshot:Snapshot,horizonMonths=6):OpportunityThesis {
 const gaps:string[]=[];
 const periods=[...(snapshot.opportunityResearch?.earnings?.annual??[])].filter(item=>item&&typeof item.start==='string'&&typeof item.end==='string'&&item.metrics).sort((a,b)=>a.end.localeCompare(b.end)).slice(-3);
 const required=['operatingCashFlow','capitalExpenditure','stockBasedCompensation','netIncome','revenue'] as const;
 const usable=(source:Provenance|undefined)=>!!source&&modelEvidenceAvailable(source,snapshot.asOf)&&source.currency==='USD';
 if(!commonPerShareMetricsApplicable(snapshot))gaps.push('Security payoff or ADR ratio is unverified.');
 if(snapshot.issuerCommonListingCount!==1)gaps.push('Single common equity class and observed capitalization scope are not reconciled.');
 if(snapshot.opportunityResearch?.financialStrength?.industryModel!=='industrial-operating-company')gaps.push('A specialized or unverified industry requires a suitable independent valuation model.');
 if(!finite(snapshot.price)||snapshot.price<=0||!finite(snapshot.marketCap)||snapshot.marketCap<=0||!usable(snapshot.provenance.price)||!usable(snapshot.provenance.marketCap))gaps.push('USD price and equity capitalization are unavailable.');
 if(['price','marketCap'].some(key=>!snapshot.provenance[key]||(Date.parse(snapshot.asOf)-Date.parse(snapshot.provenance[key].periodEnd))/864e5>7))gaps.push('Price or capitalization is older than seven calendar days.');
 if(snapshot.splitAdjusted!==true)gaps.push('Corporate actions and dilution are not reconciled.');
 if(snapshot.sourceConflicts?.length||snapshot.opportunityResearch?.earnings?.conflicts?.length)gaps.push('Financial source conflicts remain unresolved.');
 if(periods.length!==3||periods.some((period,index)=>{
  const duration=(Date.parse(period.end)-Date.parse(period.start))/864e5;
  return duration<300||duration>400||(index>0&&Math.abs(Date.parse(period.start)-Date.parse(periods[index-1].end)-864e5)>864e5)
   ||required.some(key=>{const item=period.metrics[key];return !item||!finite(item.value)||item.unit!=='USD'||!usable(item.source)||(item.source.scope??'consolidated')!=='consolidated'||item.source.periodStart!==period.start||item.source.periodEnd!==period.end;})
   ||!compatibleFinancialSources(required.map(key=>period.metrics[key]?.source),'flow');
 }))gaps.push('Three consecutive aligned USD annual revenue, income, OCF, capex and SBC periods are required.');
 if(periods.length&&(Date.parse(snapshot.asOf)-Date.parse(periods.at(-1)!.end))/864e5>400)gaps.push('The latest fiscal year is stale.');
 const valid=!gaps.length;
 const cashflows=valid?periods.map(period=>period.metrics.operatingCashFlow!.value-Math.abs(period.metrics.capitalExpenditure!.value)-Math.max(0,period.metrics.stockBasedCompensation!.value)):[];
 const incomes=valid?periods.map(period=>period.metrics.netIncome!.value):[];
 let normalizedCashflow=valid?median(cashflows):null,normalizedEarnings=valid?median(incomes):null;
 const currentSources:Provenance[]=[];
 // Historical median earnings are not a license to ignore a demonstrated
 // current collapse. Missing interim inputs do not invalidate annual evidence.
 const quarters=[...(snapshot.opportunityResearch?.earnings?.quarterly??[])].filter(item=>item?.metrics&&item.start&&item.end).sort((a,b)=>a.end.localeCompare(b.end)).slice(-4);
 const currentPeriodValid=valid&&quarters.length===4&&quarters.at(-1)!.end>periods.at(-1)!.end
  &&(Date.parse(snapshot.asOf)-Date.parse(quarters.at(-1)!.end))/864e5<=400
  &&quarters.every((quarter,index)=>{
   const days=(Date.parse(quarter.end)-Date.parse(quarter.start))/864e5;
   return days>=55&&days<=120&&(!index||Date.parse(quarter.start)-Date.parse(quarters[index-1].end)===864e5);
  });
 const currentMetricKeysValid=(keys:Array<'operatingCashFlow'|'capitalExpenditure'|'stockBasedCompensation'|'netIncome'>)=>currentPeriodValid&&quarters.every(quarter=>
  keys.every(key=>{const metric=quarter.metrics[key];return !!metric&&finite(metric.value)&&metric.unit==='USD'&&usable(metric.source)
   &&metric.source.periodStart===quarter.start&&metric.source.periodEnd===quarter.end&&(metric.source.scope??'consolidated')==='consolidated';})
  &&compatibleFinancialSources(keys.map(key=>quarter.metrics[key]!.source),'flow'));
 const ownerKeys=['operatingCashFlow','capitalExpenditure','stockBasedCompensation'] as const;
 if(currentMetricKeysValid([...ownerKeys])){
  const recentCashflow=quarters.reduce((sum,quarter)=>sum+quarter.metrics.operatingCashFlow!.value-Math.abs(quarter.metrics.capitalExpenditure!.value)-Math.max(0,quarter.metrics.stockBasedCompensation!.value),0);
  currentSources.push(...quarters.flatMap(quarter=>ownerKeys.map(key=>quarter.metrics[key]!.source)));
  normalizedCashflow=Math.min(normalizedCashflow!,recentCashflow);
  if(recentCashflow<=0)gaps.push('Current compatible TTM owner cash flow is nonpositive; historical profitable years cannot establish a current profitable-company valuation.');
 }
 if(currentMetricKeysValid(['netIncome'])){
  const recentEarnings=quarters.reduce((sum,quarter)=>sum+quarter.metrics.netIncome!.value,0);
  currentSources.push(...quarters.map(quarter=>quarter.metrics.netIncome!.source));
  normalizedEarnings=Math.min(normalizedEarnings!,recentEarnings);
  if(recentEarnings<=0)gaps.push('Current compatible TTM earnings are nonpositive; historical profitable years cannot establish a current profitable-company valuation.');
 }
 for(const key of ['netIncome','fcf'] as const){
  const source=snapshot.provenance[key],value=snapshot[key];
  const days=source?.periodStart?(Date.parse(source.periodEnd)-Date.parse(source.periodStart))/864e5:0;
  if(valid&&finite(value)&&usable(source)&&(source!.scope??'consolidated')==='consolidated'&&days>=330&&days<=380
   &&source!.periodEnd>periods.at(-1)!.end&&(Date.parse(snapshot.asOf)-Date.parse(source!.periodEnd))/864e5<=400){
   if(key==='netIncome'){normalizedEarnings=Math.min(normalizedEarnings!,value);currentSources.push(source!);}
   // Negative FCF establishes negative owner cash flow even without SBC;
   // positive FCF cannot substitute for a sourced owner-cash-flow calculation.
   if(value<=0){currentSources.push(source!);gaps.push(`Current compatible annual/TTM ${key} is nonpositive; the historical profitable-company valuation is withheld.`);}
  }
 }
 if(valid&&(normalizedCashflow!<=0||normalizedEarnings!<=0||cashflows.some(value=>value<=0)))gaps.push('Sustained positive owner cash flow and positive normalized earnings are not established; no profitable-company DCF is assigned.');
 const sources=valid?[snapshot.provenance.price,snapshot.provenance.marketCap,...periods.flatMap(period=>required.map(key=>period.metrics[key]!.source)),...currentSources]:[];
 let scenarios:IntrinsicScenario[]=[];
 if(!gaps.length) {
  const revenues=periods.map(period=>period.metrics.revenue!.value);
  if(revenues.some(value=>value<=0))gaps.push('Positive comparable revenue is required for the growth sensitivity.');
  else {
   const observedGrowth=Math.sqrt(revenues[2]/revenues[0])-1;
   const growth=clamp(observedGrowth,INTRINSIC_POLICY.minGrowth,INTRINSIC_POLICY.maxGrowth);
   scenarios=(['bear','base','bull'] as const).map((name,index)=>{
    const requiredReturn=[INTRINSIC_POLICY.bearReturn,INTRINSIC_POLICY.baseReturn,INTRINSIC_POLICY.bullReturn][index];
    const initialGrowth=index===0?Math.min(0,growth):index===1?growth:clamp(growth+.05,INTRINSIC_POLICY.minGrowth,INTRINSIC_POLICY.maxGrowth);
    const terminalGrowth=Math.min(INTRINSIC_POLICY.terminalGrowth,initialGrowth);
    let cashflow=normalizedCashflow!,cashflowValue=0,discountFactor=1;
    for(let year=1;year<=INTRINSIC_POLICY.years;year++){
     const fadedGrowth=initialGrowth+(terminalGrowth-initialGrowth)*(year-1)/(INTRINSIC_POLICY.years-1);
     cashflow*=1+fadedGrowth;discountFactor*=1+requiredReturn;cashflowValue+=cashflow/discountFactor;
    }
    cashflowValue+=cashflow*(1+terminalGrowth)/(requiredReturn-terminalGrowth)/discountFactor;
    // Integer-year discounting uses repeated IEEE arithmetic instead of the
    // platform-dependent pow implementation; publish currency sensitivities
    // to cents so source hashes do not encode insignificant runtime precision.
    cashflowValue=Number(cashflowValue.toFixed(2));
    const earningsValue=normalizedEarnings!*INTRINSIC_POLICY.earningsMultiples[index];
    // Cash flows already include debt interest. Do not add cash/subtract debt
    // again, or assume unknown senior claims are zero. Use the lower cross-check.
    const equityValue=Math.max(0,Math.min(cashflowValue,earningsValue));
    const valuePerSecurity=snapshot.price!*equityValue/snapshot.marketCap!;
    return {name,requiredReturn,initialGrowth,terminalGrowth,cashflowValue,earningsValue,equityValue,valuePerSecurity,upside:valuePerSecurity/snapshot.price!-1,discount:1-snapshot.price!/valuePerSecurity};
   }).filter(item=>Object.values(item).every(value=>typeof value!=='number'||Number.isFinite(value)));
  }
 }
 const cash=finite(snapshot.cash)?snapshot.cash:null,debt=finite(snapshot.debt)?snapshot.debt:null;
 const fcf=finite(snapshot.fcf)&&snapshot.provenance.fcf?.currency==='USD'?snapshot.fcf:null;
 const flowSource=snapshot.provenance.fcf;
 const flowDays=flowSource?.periodStart?(Date.parse(flowSource.periodEnd)-Date.parse(flowSource.periodStart))/864e5:0;
 const fundingComparable=usable(snapshot.provenance.cash)&&usable(flowSource)&&flowDays>=330&&flowDays<=380&&snapshot.provenance.cash?.periodEnd===flowSource?.periodEnd;
 const runway=fundingComparable&&cash!==null&&cash>=0&&fcf!==null&&fcf<0?cash/(-fcf)*12:null;
 const base=scenarios.find(item=>item.name==='base'),bear=scenarios.find(item=>item.name==='bear');
 const risk=snapshot.deathSpiral==='severe'||(runway!==null&&runway<12);
 const catalysts=(snapshot.opportunityResearch?.secFilings?.form8KItemIndex?.items??[]).flatMap(filing=>(filing.observations??[]).filter(item=>!!item.eventDate).map(item=>({id:`${filing.accession}:${item.id}`,date:item.eventDate!,title:item.text,status:'unreviewed' as const,source:filing.url}))).slice(0,20);
 return {modelVersion:INTRINSIC_POLICY.version,horizonMonths,probability:null,calibrationStatus:'unvalidated',valuation:{status:scenarios.length===3?'available':'unavailable',method:'Five-year normalized owner cash-flow sensitivity cross-checked against normalized earnings; equity-value ratios use observed capitalization, not claimed fully diluted shares.',normalizedCashflow,normalizedEarnings,scenarios,sources,gaps,assumptions:INTRINSIC_POLICY},sixMonthTarget:null,catalysts,funding:{cash,debt,cashCurrency:snapshot.provenance.cash?.currency??null,debtCurrency:snapshot.provenance.debt?.currency??null,cashRunwayMonths:runway,dilution:snapshot.splitAdjusted===true&&finite(snapshot.dilution)?snapshot.dilution:null},invalidation:['Verify senior claims, restricted cash, diluted capitalization and security terms before treating modeled equity value as investable.','Invalidate the thesis if filings contradict the normalized cash flow or financing cannot cover the research horizon.','Intrinsic scenarios are not six-month price targets; no probability is calibrated.'],action:risk?'risk-review':base&&bear&&base.upside>=.5&&bear.upside>=0?'candidate-review':'research-required'};
}

export function intrinsicValuationGrade(thesis:OpportunityThesis) {
 if(thesis.valuation.status!=='available')return null;
 const bear=thesis.valuation.scenarios[0],base=thesis.valuation.scenarios[1];
 // 60% conservative protection / 40% base upside; no chance-of-success inference.
 return Math.round((clamp(bear.upside/.5,0,1)*6+clamp(base.upside,0,1)*4)*100)/100;
}
