import type { Provenance, Snapshot } from './engine';
import { derivedEvidence, usableEvidence,evidenceTimestamp,validEvidenceConversion } from './evidence';

/** Model observations retain unknown rights separately, but every dependency
 * must be auditable and actually available at the saved research cutoff. */
export function modelEvidenceAvailable(source:Provenance|undefined,asOf:string,ancestors=new Set<Provenance>(),depth=0):boolean {
  if(!source||depth>12||ancestors.has(source)||!usableEvidence(source,asOf)
    ||!Number.isFinite(evidenceTimestamp(source.retrievedAt))||evidenceTimestamp(source.retrievedAt)>evidenceTimestamp(asOf)
    ||!validEvidenceConversion(source,asOf))return false;
  try{if(new URL(source.url!).protocol!=='https:')return false;}catch{return false;}
  if(!source.dependencies)return true;
  if(!Array.isArray(source.dependencies))return false;
  const lineage=new Set(ancestors).add(source);
  return source.dependencies.every(item=>modelEvidenceAvailable(item,asOf,lineage,depth+1)
    &&Date.parse(item.availableAt)<=Date.parse(source.availableAt)&&Date.parse(item.retrievedAt)<=Date.parse(source.retrievedAt));
}

/** Fiscal compatibility is distinct from recency. Ratios must not mix currencies,
 * consolidated/segment scopes, or annual/quarter/YTD observation windows. */
export function compatibleFinancialSources(sources: Array<Provenance | undefined>, kind: 'flow' | 'balance') {
  if (!sources.length || sources.some(source => !source)) return false;
  const present = sources as Provenance[];
  if (present.some(source => !source.currency || !Number.isFinite(Date.parse(source.periodEnd)))) return false;
  if (new Set(present.map(source => source.currency)).size !== 1
    || new Set(present.map(source => source.periodEnd)).size !== 1
    || new Set(present.map(source => source.scope ?? 'consolidated')).size !== 1) return false;
  if (kind === 'balance') return present.every(source => !source.periodStart);
  // A missing duration is not evidence that two flows cover the same period.
  return present.every(source => !!source.periodStart && Date.parse(source.periodStart) < Date.parse(source.periodEnd))
    && new Set(present.map(source => source.periodStart)).size === 1;
}

export function compatibleSnapshotMetrics(snapshot: Snapshot, keys: string[], kind: 'flow' | 'balance') {
  return compatibleFinancialSources(keys.map(key => snapshot.provenance?.[key]), kind);
}

/** Missing security terms cannot turn issuer fundamentals into a different
 * instrument's per-share economics. Other securities keep numeric grades. */
export function operatingIssuerMetricsApplicable(snapshot: Snapshot) {
  return snapshot.listingStatus!=='not-confirmed-current' && (snapshot.securityType === 'common' || snapshot.securityType === 'adr');
}

export function commonPerShareMetricsApplicable(snapshot: Snapshot) {
  return snapshot.listingStatus!=='not-confirmed-current' && (snapshot.securityType === 'common'
    || (snapshot.securityType === 'adr' && !!snapshot.adrRatio && snapshot.adrRatio.value > 0
      && usableEvidence(snapshot.adrRatio.source,snapshot.asOf)
      && Date.parse(snapshot.adrRatio.source.retrievedAt) <= Date.parse(snapshot.asOf)));
}

export function commercialObservationKind(snapshot: Snapshot) {
  const tag = snapshot.provenance?.backlog?.tag ?? '';
  if (/ContractWithCustomerLiability/.test(tag)) return 'contract-liability' as const;
  if (/RemainingPerformanceObligation/.test(tag)) return 'remaining-performance-obligation' as const;
  return snapshot.backlog?.kind ?? 'unclassified';
}

/** Full dependency records retain dates, currencies, rights and transformations.
 * A repeated SEC endpoint is one underlying source, never corroboration. */
export function evidenceLeaves(source: Provenance, depth = 0): Provenance[] {
  if (depth >= 12 || !source.dependencies?.length) return [source];
  return source.dependencies.flatMap(item => evidenceLeaves(item, depth + 1));
}

export function financialIntegrityFindings(snapshot: Snapshot) {
  const issues: string[] = [];
  for (const [keys, kind] of [
    [['revenue', 'fcf'], 'flow'], [['revenue', 'netIncome'], 'flow'], [['cash', 'debt'], 'balance'],
  ] as const) {
    if (keys.every(key => typeof snapshot[key] === 'number') && !compatibleSnapshotMetrics(snapshot, [...keys], kind))
      issues.push(`${keys.join('/')}: incompatible or unverified fiscal periods, currency or scope`);
  }
  if (snapshot.backlog && commercialObservationKind(snapshot) === 'contract-liability')
    issues.push('Deferred revenue/contract liability is not backlog or a new growth catalyst.');
  if (snapshot.dilution != null && snapshot.splitAdjusted !== true)
    issues.push('Share-count change is not verified dilution until corporate actions are reconciled.');
  if (!operatingIssuerMetricsApplicable(snapshot))
    issues.push('Issuer operating metrics do not establish this security payoff; instrument terms require a separate model.');
  return issues;
}

/** Promote aligned source-backed periods into the compact snapshot. This is
 * also used during saved-row migration, so old annual values do not survive
 * when the saved SEC dossier already contains a newer usable TTM series. */
export function alignSnapshotFinancials(original: Snapshot): Snapshot {
  const snapshot = { ...original, provenance: { ...original.provenance } };
  const history=original.provenance?.history,price=original.provenance?.price;
  if(price&&!price.currency&&history?.currency&&price.url===history.url&&price.periodEnd===history.periodEnd)
    snapshot.provenance.price={...price,currency:history.currency,tag:`${price.tag??'completed close'}; currency inherited from matching saved history observation`};
  if (original.backlog) {
    const kind=commercialObservationKind(original);
    if (kind === 'contract-liability' && typeof original.backlog.amount === 'number') {
      snapshot.contractLiabilities={amount:original.backlog.amount,currency:original.backlog.currency??'USD',asOf:original.backlog.asOf??original.provenance.backlog.periodEnd,source:original.backlog.source??original.provenance.backlog.url??''};
      snapshot.provenance.contractLiabilities=original.provenance.backlog;
      delete snapshot.backlog;delete snapshot.provenance.backlog;
    } else snapshot.backlog={...original.backlog,kind};
  }
  const acquiredResearch = original.opportunityResearch?.earnings;
  // Earnings conflicts cannot erase independently sourced balance observations.
  const research = acquiredResearch&&!acquiredResearch.conflicts?.length?acquiredResearch:undefined;
  const valid = (metric: {value:number;unit:string;source:Provenance} | undefined) => !!metric
    && Number.isFinite(metric.value) && metric.unit === 'USD' && metric.source.currency === 'USD'
    &&(metric.source.scope??'consolidated')==='consolidated'
    && modelEvidenceAvailable(metric.source,snapshot.asOf);
  const quarters = [...(research?.quarterly ?? [])].sort((a,b) => a.end.localeCompare(b.end)).slice(-4);
  const contiguous = quarters.length === 4 && quarters.every((item,index) => {
    const duration = (Date.parse(item.end)-Date.parse(item.start))/86_400_000;
    return duration >= 55 && duration <= 120 && (!index || Date.parse(item.start)-Date.parse(quarters[index-1].end) === 86_400_000);
  });
  const promote = (key: 'revenue'|'netIncome'|'fcf'|'cash'|'debt', value: number, source: Provenance) => {
    const previous = snapshot.provenance[key];
    if (!previous || Date.parse(source.periodEnd) >= Date.parse(previous.periodEnd)) {
      snapshot[key] = value; snapshot.provenance[key] = source;
    }
  };
  for (const key of ['revenue','netIncome'] as const) {
    if (contiguous && quarters.every(period => valid(period.metrics[key])
      && period.metrics[key]!.source.periodStart === period.start && period.metrics[key]!.source.periodEnd === period.end)) {
      const metrics = quarters.map(period => period.metrics[key]!);
      const source = derivedEvidence(`SEC aligned four-quarter ${key}`,metrics.map(item=>item.source),snapshot.asOf,`sum of four contiguous standalone ${key} quarters`)!;
      promote(key,metrics.reduce((sum,item)=>sum+item.value,0),{...source,periodStart:quarters[0].start,periodEnd:quarters[3].end});
    } else {
      const annual = [...(research?.annual ?? [])].sort((a,b)=>a.end.localeCompare(b.end)).at(-1);
      const metric = annual?.metrics[key];
      if (annual && valid(metric) && metric!.source.periodStart === annual.start && metric!.source.periodEnd === annual.end)
        promote(key,metric!.value,metric!.source);
    }
  }
  if (contiguous && quarters.every(period=>valid(period.metrics.operatingCashFlow)&&valid(period.metrics.capitalExpenditure)
    && period.metrics.operatingCashFlow!.source.periodStart === period.start && period.metrics.operatingCashFlow!.source.periodEnd === period.end
    && period.metrics.capitalExpenditure!.source.periodStart === period.start && period.metrics.capitalExpenditure!.source.periodEnd === period.end
    && compatibleFinancialSources([period.metrics.operatingCashFlow!.source,period.metrics.capitalExpenditure!.source],'flow'))) {
    const metrics=quarters.flatMap(period=>[period.metrics.operatingCashFlow!,period.metrics.capitalExpenditure!]);
    const source=derivedEvidence('SEC aligned four-quarter free cash flow',metrics.map(item=>item.source),snapshot.asOf,'sum(operating cash flow) − sum(abs(capital expenditure))')!;
    const value=quarters.reduce((sum,period)=>sum+period.metrics.operatingCashFlow!.value-Math.abs(period.metrics.capitalExpenditure!.value),0);
    promote('fcf',value,{...source,periodStart:quarters[0].start,periodEnd:quarters[3].end});
  }
  const financial=original.opportunityResearch?.financialStrength;
  const debtContradiction=(financial?.conflicts??[]).some(item=>item.startsWith('totalDebt: reported aggregate contradicts contemporaneous components'));
  if(debtContradiction){delete snapshot.debt;delete snapshot.provenance.debt;}
  const unrelatedFinancialConflict=(financial?.conflicts??[]).some(item=>!item.startsWith('totalDebt: reported aggregate contradicts contemporaneous components'));
  if (!unrelatedFinancialConflict) for (const [input,output] of [['unrestrictedCash','cash'],['totalDebt','debt']] as const) {
    const metric=financial?.metrics?.[input];
    if (!(output==='debt'&&debtContradiction)&&valid(metric) && metric!.value >= 0) promote(output,metric!.value,metric!.source);
  }
  alignPricingRatios(snapshot);
  snapshot.dataIssues=[...new Set([...(original.dataIssues ?? []).filter(item=>!item.startsWith('[integrity] ')),...financialIntegrityFindings(snapshot).map(item=>`[integrity] ${item}`)])];
  return snapshot;
}

/** Pricing dependencies change independently of SEC dossier retrieval. Rebuild
 * every ratio from current same-currency inputs rather than retain stale ratios. */
function alignPricingRatios(snapshot: Snapshot) {
  const observed = (key: 'marketCap'|'revenue'|'fcf'|'cash'|'debt') => {
    const source=snapshot.provenance[key],value=snapshot[key];
    return typeof value==='number' && Number.isFinite(value) && !!source?.currency
      &&(source.scope??'consolidated')==='consolidated'
      && modelEvidenceAvailable(source,snapshot.asOf)
      && (key!=='marketCap'||((Date.parse(snapshot.asOf)-Date.parse(source.periodEnd))/864e5<=7
        &&(Date.parse(snapshot.asOf)-Date.parse(source.availableAt))/864e5<=7));
  };
  const sameCurrency = (keys: Array<'marketCap'|'revenue'|'fcf'|'cash'|'debt'>) => keys.every(observed)
    && new Set(keys.map(key=>snapshot.provenance[key].currency)).size===1;
  const set = (key:'ps'|'evSales'|'fcfYield', value:number|null, inputs:Provenance[], name:string, formula:string) => {
    const source=value!==null&&Number.isFinite(value)?derivedEvidence(name,inputs,snapshot.asOf,formula):undefined;
    snapshot[key]=source?value:null;
    if(source)snapshot.provenance[key]=source;else delete snapshot.provenance[key];
  };
  const annual = (key:'revenue'|'fcf') => {const source=snapshot.provenance[key];const days=source?.periodStart?(Date.parse(source.periodEnd)-Date.parse(source.periodStart))/864e5:0;return days>=330&&days<=380&&(source.scope??'consolidated')==='consolidated';};
  const sales=annual('revenue')&&sameCurrency(['marketCap','revenue']) && snapshot.marketCap!>0 && snapshot.revenue!>0;
  set('ps',sales?snapshot.marketCap!/snapshot.revenue!:null,sales?[snapshot.provenance.revenue,snapshot.provenance.marketCap]:[],'Market capitalization / aligned SEC revenue','marketCap / revenue');
  const ev=sales&&sameCurrency(['marketCap','revenue','cash','debt'])&&snapshot.cash!>=0&&snapshot.debt!>=0&&compatibleSnapshotMetrics(snapshot,['cash','debt'],'balance');
  set('evSales',ev?(snapshot.marketCap!+snapshot.debt!-snapshot.cash!)/snapshot.revenue!:null,ev?[snapshot.provenance.revenue,snapshot.provenance.marketCap,snapshot.provenance.cash,snapshot.provenance.debt]:[],'Aligned enterprise value / SEC revenue','(marketCap + debt − cash) / revenue');
  const yieldEligible=annual('fcf')&&sameCurrency(['marketCap','fcf'])&&snapshot.marketCap!>0;
  set('fcfYield',yieldEligible?snapshot.fcf!/snapshot.marketCap!:null,yieldEligible?[snapshot.provenance.fcf,snapshot.provenance.marketCap]:[],'Aligned free cash flow / market capitalization','fcf / marketCap');
  return snapshot;
}
