import type { Snapshot, Provenance } from './engine';
import type { OpportunityEvidenceSet } from './opportunity-engine';
import { derivedEvidence, usableEvidence } from './evidence';
import { OPPORTUNITY_SPEC, type OpportunityFactorId } from './opportunity-spec';
import { compatibleSnapshotMetrics, commercialObservationKind, operatingIssuerMetricsApplicable, commonPerShareMetricsApplicable } from './financial-integrity';
import {peerObservation,peerContext,uniqueIssuerPeers} from './opportunity-peers';
import {buildOpportunityThesis,intrinsicValuationGrade} from './opportunity-thesis';

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, low = 0, high = 10) => Math.max(low, Math.min(high, value));
type Component = { name: string; weight: number; grade: number | null; keys: string[]; values: Array<string | number> };

/** Fixed component denominators: missing observations earn zero, never a positive prior.
 * These are model estimates, not assertions of fair value, a moat, or reviewed governance. */
export function proxyOpportunityEvidence(snapshot: Snapshot): OpportunityEvidenceSet {
  if(snapshot.listingStatus==='not-confirmed-current')snapshot={...snapshot,provenance:{},peerContext:undefined,opportunityResearch:undefined};
  const output: OpportunityEvidenceSet = {};
  const ownPeer=peerObservation(snapshot);
  const validatedPeerContext=snapshot.peerContext?peerContext(snapshot,uniqueIssuerPeers(snapshot.peerContext.peers)):undefined;
  const derivedGrowth = deriveRevenueGrowth(snapshot);
  const growthTrace = derivedGrowth?.inputs ?? [];
  const observation = (key: string): number | null => {
    if (key === 'dilution' && snapshot.splitAdjusted !== true) return null;
    if (['ps','evSales','fcfYield'].includes(key) && !commonPerShareMetricsApplicable(snapshot)) return null;
    if (!operatingIssuerMetricsApplicable(snapshot) && !['price','ma30w','low52w','high52w','return12m','nextEarnings'].includes(key)) return null;
    const value = key==='revenueGrowth' && !finite(snapshot.revenueGrowth) ? derivedGrowth?.value : snapshot[key as keyof Snapshot];
    const source = key==='revenueGrowth' && !finite(snapshot.revenueGrowth) ? derivedGrowth?.source : snapshot.provenance?.[key];
    if (!finite(value) || !source || !usableEvidence(source, snapshot.asOf)
      || !Number.isFinite(Date.parse(source.retrievedAt)) || Date.parse(source.retrievedAt) > Date.parse(snapshot.asOf)) return null;
    try { if (new URL(source.url!).protocol !== 'https:') return null; } catch { return null; }
    // Retain original rights metadata. Using an observed value in a model does
    // not certify its source, freshness or redistribution entitlement.
    const age = (Date.parse(snapshot.asOf) - Date.parse(source.periodEnd)) / 86_400_000;
    if (!Number.isFinite(age) || age < 0 || age > (['price','ma30w','low52w','high52w','return12m'].includes(key) ? 7 : 400)) return null;
    // Compound pricing ratios carry a fiscal period, not a quote period.
    // Require both a usable financial period and a fresh market dependency.
    if(['ps','evSales','fcfYield'].includes(key)){
      const marketAge=(Date.parse(snapshot.asOf)-Date.parse(source.availableAt))/86_400_000;
      const price=observation('price');
      if(marketAge>7 || price===null || price<=0)return null;
    }
    return value;
  };
  const component = (name: string, weight: number, keys: string[], calculate: (...values: number[]) => number): Component => {
    const values = keys.map(observation);
    const flows = keys.filter(key => ['revenue','fcf','netIncome'].includes(key));
    const balances = keys.filter(key => ['cash','debt'].includes(key));
    const specialized=snapshot.opportunityResearch?.financialStrength && snapshot.opportunityResearch.financialStrength.industryModel!=='industrial-operating-company';
    const annualFlow=keys.includes('fcf')&&keys.includes('cash')?snapshot.provenance.fcf:undefined;
    const annualDays=annualFlow?.periodStart?(Date.parse(annualFlow.periodEnd)-Date.parse(annualFlow.periodStart))/864e5:0;
    const runwayCompatible=!keys.includes('cash')||!keys.includes('fcf')||(annualDays>=330&&annualDays<=380&&annualFlow?.currency===snapshot.provenance.cash?.currency&&annualFlow?.periodEnd===snapshot.provenance.cash?.periodEnd);
    const compatible = !(specialized&&['cash-debt','fcf-margin','runway','cash-conversion'].includes(name)) && runwayCompatible && (flows.length < 2 || compatibleSnapshotMetrics(snapshot, flows, 'flow'))
      && (balances.length < 2 || compatibleSnapshotMetrics(snapshot, balances, 'balance'));
    return { name, weight, keys, values: values.map(value => value ?? 'missing-or-ineligible'), grade: compatible && values.every(finite) ? clamp(calculate(...values as number[])) : null };
  };
  const set = (id: OpportunityFactorId, rationale: string, components: Component[]) => {
    const conflicts = snapshot.sourceConflicts ?? [];
    const usable = conflicts.length ? [] : components.filter(item => item.grade !== null);
    const coveragePct = usable.reduce((sum, item) => sum + item.weight, 0);
    const sources: Provenance[] = [...new Map(usable.flatMap(item => item.keys.flatMap(key => {
      const source = snapshot.provenance?.[key];
      if(key==='revenueGrowth'&&derivedGrowth&&!finite(snapshot.revenueGrowth))return derivedGrowth.sources.map(item=>[JSON.stringify(item),item] as const);
      return source ? [[JSON.stringify(source), source] as const] : [];
    }))).values()];
    output[id] = {
      score: Math.round(usable.reduce((sum, item) => sum + item.grade! * item.weight / 100, 0) * 100) / 100,
      proxy: true, coveragePct, confidence: 'low', sources, conflicts,
      rationale: `${rationale} Model components use a fixed denominator; missing components earn zero. Input coverage ${coveragePct}%; this is a model rating, not a qualitative review.${conflicts.length ? ' Unresolved snapshot conflicts withhold model points.' : ''}`,
      calculation: { rubricId: `${id}-model-v5-opportunity`, inputs: [...components.flatMap(item => [
        { name: `${item.name}:weight`, value: item.weight },
        { name: `${item.name}:grade`, value: conflicts.length ? 'withheld-conflict' : item.grade ?? 'missing-zero' },
        ...item.keys.map((key, index) => ({ name: `${item.name}:${key}`, value: item.values[index] })),
      ]), ...(components.some(item=>item.keys.includes('revenueGrowth')) ? growthTrace : [])] },
    };
  };
  const evSales=observation('evSales');
  const multiple = evSales!==null&&evSales>0 ? 'evSales' : 'ps';
  const thesis=buildOpportunityThesis(snapshot),intrinsicGrade=intrinsicValuationGrade(thesis);
  set('valuation', 'Intrinsic downside protection and base upside account for 60% of the fixed valuation denominator; relative sales pricing and observed FCF yield account for 25% and 15%. Unsupported intrinsic value earns zero.', [
    {name:'intrinsic-value-sensitivity',weight:60,grade:intrinsicGrade,keys:[],values:[intrinsicGrade??'missing-intrinsic-zero']},
    component('sales-multiple',25,[multiple],value=>value<=0?0:value<=1?9:value<=3?7.5:value<=6?5.5:value<=10?3.5:1.5),
    observation('fcfYield')!==null
      ?component('fcf-yield',15,['fcfYield'],value=>clamp(value*100))
      :component('fcf-yield-from-margin-and-sales-multiple',15,['fcf','revenue','ps'],(fcf,sales,ps)=>sales>0&&ps>0?clamp(fcf/sales/ps*100):0),
  ]);
  if(intrinsicGrade!==null&&output.valuation){
    output.valuation.sources.push(...thesis.valuation.sources);
    output.valuation.calculation!.inputs.push(
      {name:'normalized owner cash flow',value:thesis.valuation.normalizedCashflow!,unit:'USD'},
      {name:'normalized net income',value:thesis.valuation.normalizedEarnings!,unit:'USD'},
      ...thesis.valuation.scenarios.flatMap(item=>[{name:item.name+':intrinsic estimate',value:item.valuePerSecurity,unit:'USD'},{name:item.name+':upside',value:item.upside},{name:item.name+':required return assumption',value:item.requiredReturn},{name:item.name+':growth assumption',value:item.initialGrowth}])
    );
  }
  const earningsDate = Date.parse(snapshot.nextEarnings ?? '');
  const inHorizon = Number.isFinite(earningsDate) && earningsDate > Date.parse(snapshot.asOf)
    && earningsDate <= Date.parse(snapshot.asOf) + OPPORTUNITY_SPEC.defaultHorizonMonths * 30.4375 * 86_400_000
    && !!snapshot.provenance?.nextEarnings && usableEvidence(snapshot.provenance.nextEarnings, snapshot.asOf);
  const backlog = snapshot.backlog;
  const revenue = observation('revenue');
  const backlogEligible = finite(backlog?.amount) && backlog!.amount! >= 0 && revenue !== null && revenue > 0
    && ['backlog','remaining-performance-obligation'].includes(commercialObservationKind(snapshot))
    && !!backlog?.expectedRecognitionBy && Date.parse(backlog.expectedRecognitionBy) > Date.parse(snapshot.asOf)
    && Date.parse(backlog.expectedRecognitionBy) <= Date.parse(snapshot.asOf) + OPPORTUNITY_SPEC.defaultHorizonMonths * 30.4375 * 86_400_000
    && !!snapshot.provenance?.backlog && usableEvidence(snapshot.provenance.backlog, snapshot.asOf);
  set('catalysts', 'Observed growth and disclosed backlog approximate business momentum; a scheduled earnings event earns only limited timing credit, not positive impact.', [
    component('growth-momentum', 50, ['revenueGrowth'], value => clamp(value * 25)),
    { name: 'backlog', weight: 30, grade: backlogEligible ? clamp(backlog!.amount! / revenue! * 5) : null, keys: ['backlog','revenue'], values: [backlog?.amount ?? 'missing', revenue ?? 'missing'] },
    { name: 'earnings-window', weight: 20, grade: inHorizon ? 2 : null, keys: ['nextEarnings'], values: [snapshot.nextEarnings ?? 'missing'] },
  ]);
  set('competitivePosition', 'Margins and growth approximate business quality; they do not establish a durable competitive moat.', [
    component('gross-margin', 30, ['grossMargin'], value => value * 15),
    {name:'industry-peer-gross-margin',weight:20,grade:validatedPeerContext?.grade??null,keys:[],values:[snapshot.peerContext?.method??'missing comparable issuer peers']},
    component('margin-trend', 30, ['operatingMarginTrend'], value => value > 0 ? clamp(value * 100) : 0),
    component('growth', 20, ['revenueGrowth'], value => clamp(value * 25)),
  ]);
  if(output.competitivePosition&&validatedPeerContext?.grade!=null){output.competitivePosition.sources.push(...(ownPeer?.sources??[]),...validatedPeerContext.peers.flatMap(peer=>peer.sources));output.competitivePosition.calculation?.inputs.push(...(ownPeer?[{name:"issuer:annual-gross-margin",value:ownPeer.grossMargin,unit:"ratio"}]:[]),...validatedPeerContext.peers.map(peer=>({name:'peer:'+peer.symbol+':gross-margin',value:peer.grossMargin,unit:'ratio'})));}
  const financingSource = snapshot.provenance?.deathSpiral;
  const financingKnown = !!financingSource && usableEvidence(financingSource, snapshot.asOf)
    && ['clean','moderate','severe'].includes(snapshot.deathSpiral ?? '');
  set('downsideRisk', 'Cash versus debt, dilution and observed financing findings approximate downside resilience.', [
    component('cash-debt', 40, ['cash','debt'], (cash, debt) => cash < 0 || debt < 0 ? 0 : debt === 0 ? 10 : clamp(cash / debt * 5)),
    component('dilution', 30, ['dilution'], value => clamp(10 - Math.max(0, value) * 40)),
    { name: 'financing-review', weight: 30, grade: financingKnown ? snapshot.deathSpiral === 'clean' ? 10 : snapshot.deathSpiral === 'severe' ? 0 : 3 : null, keys: ['deathSpiral'], values: [snapshot.deathSpiral ?? 'missing'] },
  ]);
  set('management', 'Dilution discipline, sourced insider purchases and earnings outcomes approximate alignment; governance diligence remains separate.', [
    component('dilution-discipline', 40, ['dilution'], value => clamp(10 - Math.max(0, value) * 40)),
    component('insider-purchases', 30, ['insiderBuyValue'], value => value > 0 ? 7 : 0),
    { name: 'earnings-outcome', weight: 30, grade: snapshot.provenance?.lastEarningsStatus && usableEvidence(snapshot.provenance.lastEarningsStatus, snapshot.asOf) ? snapshot.lastEarningsStatus === 'إيجابي' ? 7 : snapshot.lastEarningsStatus === 'سلبي' ? 0 : null : null, keys: ['lastEarningsStatus'], values: [snapshot.lastEarningsStatus ?? 'missing'] },
  ]);
  set('technicalTiming', 'Observed trend, range and return approximate entry timing; dates and market-source metadata are retained.', [
    component('moving-average', 40, ['price','ma30w'], (price, average) => price > 0 && average > 0 ? clamp(5 + (price / average - 1) * 20) : 0),
    component('range', 30, ['price','low52w','high52w'], (price, low, high) => price > 0 && low > 0 && high > low ? clamp((price - low) / (high - low) * 10) : 0),
    component('trailing-return', 30, ['return12m'], value => clamp(5 + value * 10)),
  ]);
  set('financialStrength', 'Observed liquidity, FCF margin and cash runway approximate financial capacity when a reviewed industry model is unavailable.', [
    component('cash-debt', 40, ['cash','debt'], (cash, debt) => cash < 0 || debt < 0 ? 0 : debt === 0 ? 10 : clamp(cash / debt * 5)),
    component('fcf-margin', 40, ['fcf','revenue'], (fcf, sales) => sales > 0 ? clamp(fcf / sales * 50) : 0),
    component('runway', 20, ['cash','fcf'], (cash, fcf) => cash < 0 ? 0 : fcf > 0 ? 10 : fcf < 0 ? clamp(cash / -fcf * 5) : 0),
  ]);
  set('earningsQuality', 'Profit margin, FCF margin and cash conversion approximate quantitative earnings quality; no accounting review is inferred.', [
    component('profit-margin', 30, ['netIncome','revenue'], (profit, sales) => sales > 0 ? clamp(profit / sales * 50) : 0),
    component('fcf-margin', 40, ['fcf','revenue'], (fcf, sales) => sales > 0 ? clamp(fcf / sales * 50) : 0),
    component('cash-conversion', 30, ['fcf','netIncome'], (fcf, profit) => profit > 0 ? clamp(fcf / profit * 8) : 0),
  ]);
  return output;
}


/** Reproducible observed growth: eight adjacent quarters, otherwise annual
 * disclosures. This is operating momentum, never a promised future event. */
function deriveRevenueGrowth(snapshot: Snapshot) {
  const research=snapshot.opportunityResearch?.earnings;
  if(!research || (research.conflicts??[]).length)return null;
  type Metric={value:number;unit:string;source:Provenance};
  const metrics=(periods:typeof research.annual):Metric[]=>Array.isArray(periods)?periods.flatMap(period=>{
    const metric=period?.metrics?.revenue;
    if(!metric||!finite(metric.value)||metric.value<=0||!metric.unit||!usableEvidence(metric.source,snapshot.asOf)
      ||!Number.isFinite(Date.parse(metric.source.retrievedAt))||Date.parse(metric.source.retrievedAt)>Date.parse(snapshot.asOf))return [];
    try{if(new URL(metric.source.url!).protocol!=='https:')return [];}catch{return [];}
    return [metric];
  }).sort((a,b)=>Date.parse(a.source.periodEnd)-Date.parse(b.source.periodEnd)):[];
  const quarters=metrics(research.quarterly),annual=metrics(research.annual);
  let selected:Metric[]=[],value:number|null=null,method='';
  if(quarters.length>=8){
    const last=quarters.slice(-8);
    const adjacent=last.every((item,index)=>index===0||((Date.parse(item.source.periodEnd)-Date.parse(last[index-1].source.periodEnd))/86_400_000>=60&&(Date.parse(item.source.periodEnd)-Date.parse(last[index-1].source.periodEnd))/86_400_000<=120));
    if(adjacent&&new Set(last.map(item=>item.unit)).size===1){
      selected=last;value=last.slice(4).reduce((sum,item)=>sum+item.value,0)/last.slice(0,4).reduce((sum,item)=>sum+item.value,0)-1;method='latest-four-quarter-revenue / prior-four-quarter-revenue - 1';
    }
  }
  if(value===null&&annual.length>=2){
    const last=annual.at(-1)!,prior=annual.at(-2)!;
    const years=(Date.parse(last.source.periodEnd)-Date.parse(prior.source.periodEnd))/(365.25*86_400_000);
    // Adjacent reported fiscal years are comparable without normalizing by
    // exponentiation, whose final bits depend on the runtime's math library.
    if(years>=0.9&&years<=1.1&&last.unit===prior.unit){selected=[prior,last];value=last.value/prior.value-1;method='latest-reported-annual-revenue / prior-reported-annual-revenue - 1';}
  }
  if(value===null||!finite(value)||!selected.length)return null;
  const latest=selected.at(-1)!;
  if((Date.parse(snapshot.asOf)-Date.parse(latest.source.periodEnd))/86_400_000>400)return null;
  const source=derivedEvidence('Observed SEC revenue growth', [...selected].reverse().map(item=>item.source),snapshot.asOf,method);
  if(!source)return null;
  return {value,source,sources:selected.map(item=>item.source),inputs:[
    {name:'observed-growth-method',value:method},
    ...selected.flatMap((item,index)=>[{name:`growth-revenue-${index}:value`,value:item.value,unit:item.unit},{name:`growth-revenue-${index}:period`,value:item.source.periodEnd}]),
    {name:'derived-observed-revenue-growth',value},
  ]};
}
