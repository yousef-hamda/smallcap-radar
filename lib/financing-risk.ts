import type { Snapshot, Provenance } from './engine';
import { derivedEvidence } from './evidence';
import {compatibleFinancialSources,compatibleSnapshotMetrics,operatingIssuerMetricsApplicable,modelEvidenceAvailable} from './financial-integrity';

export type FinancingRiskLevel = 'clean' | 'mild' | 'elevated' | 'severe' | 'unknown';

type RiskFlag = { id: string; level: Exclude<FinancingRiskLevel, 'clean' | 'unknown'>; text: string };

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Review the observable financing signals used by the Core safety gate.
 *
 * This is a transparent safety heuristic, not a learned probability model.
 * It deliberately requires dated evidence for the accounting inputs and never
 * treats an absent debt or cash value as zero. The thresholds are kept here so
 * the rule can be backtested and changed as one versioned unit later.
 */
export function assessFinancingRisk(snapshot: Snapshot): { level: FinancingRiskLevel; evidence?: string; sources: Provenance[] } {
  const sources: Provenance[] = [];
  const missing: string[] = [];
  const known = (key: 'cash'|'debt'|'revenue'|'fcf'|'netIncome'|'dilution') => {
    const source = snapshot.provenance[key];
    const age = source ? (Date.parse(snapshot.asOf) - Date.parse(source.periodEnd)) / 864e5 : Infinity;
    const valid = finite(snapshot[key]) && !!source && modelEvidenceAvailable(source, snapshot.asOf)
      && Number.isFinite(Date.parse(source.retrievedAt)) && Date.parse(source.retrievedAt) <= Date.parse(snapshot.asOf)
      && age >= 0 && age <= 400 && (source.scope ?? 'consolidated') === 'consolidated'
      && (key === 'dilution' || /^[A-Z]{3}$/.test(source.currency ?? ''));
    return valid;
  };
  const annual = (key: 'revenue'|'fcf'|'netIncome') => {
    const source = snapshot.provenance[key];
    const days = source?.periodStart ? (Date.parse(source.periodEnd) - Date.parse(source.periodStart)) / 864e5 : 0;
    return known(key) && days >= 330 && days <= 380;
  };
  if (!operatingIssuerMetricsApplicable(snapshot)) return { level: 'unknown', evidence: 'يتطلب هذا النوع من الأوراق المالية نموذج مخاطر خاصاً.', sources: [] };
  const cashKnown = known('cash') && snapshot.cash! >= 0 && !snapshot.provenance.cash.periodStart;
  const debtKnown = known('debt') && snapshot.debt! >= 0 && !snapshot.provenance.debt.periodStart;
  const revenueKnown = annual('revenue') && snapshot.revenue! > 0;
  const fcfKnown = annual('fcf');
  const incomeKnown = annual('netIncome');
  const dilutionKnown = snapshot.splitAdjusted === true && known('dilution');
  const balancesAligned = cashKnown && debtKnown && compatibleSnapshotMetrics(snapshot, ['cash', 'debt'], 'balance');
  const flowAligned = (key: 'fcf'|'netIncome') => compatibleFinancialSources([snapshot.provenance[key], snapshot.provenance.revenue], 'flow');
  const runwayAligned = cashKnown && fcfKnown && snapshot.provenance.cash.currency === snapshot.provenance.fcf.currency
    && snapshot.provenance.cash.periodEnd === snapshot.provenance.fcf.periodEnd;
  if (!cashKnown) missing.push('cash');
  if (!debtKnown) missing.push('debt');
  if (!revenueKnown) missing.push('annual-revenue');
  if (!balancesAligned) missing.push('compatible-cash-debt');
  if (!fcfKnown || !flowAligned('fcf') || !runwayAligned) missing.push('annual-compatible-cash-flow');
  if (!(fcfKnown && flowAligned('fcf')) && !(incomeKnown && flowAligned('netIncome'))) missing.push('annual-compatible-earnings');
  // Adverse findings are independently observable. A loss never suppresses
  // evidenced burn, leverage or issuance signals; missing data cannot mean clean.
  const cash = cashKnown ? snapshot.cash! : 0;
  const debt = debtKnown ? snapshot.debt! : 0;
  const revenue = revenueKnown ? snapshot.revenue! : 0;
  const flags: RiskFlag[] = [];

  if (balancesAligned && debt > 0 && cash === 0) flags.push({ id: 'no-cash', level: 'severe', text: 'دين مثبت مع عدم وجود نقد مثبت' });
  else if (balancesAligned && cash > 0 && debt / cash >= 8) flags.push({ id: 'debt-cash', level: 'severe', text: `الدين إلى النقد ${(debt / cash).toFixed(1)}×` });
  else if (balancesAligned && cash > 0 && debt / cash >= 4) flags.push({ id: 'debt-cash', level: 'elevated', text: `الدين إلى النقد ${(debt / cash).toFixed(1)}×` });
  else if (balancesAligned && cash > 0 && debt / cash >= 2) flags.push({ id: 'debt-cash', level: 'mild', text: `الدين إلى النقد ${(debt / cash).toFixed(1)}×` });

  if (runwayAligned && snapshot.fcf! < 0) {
    const runway = cash / Math.abs(snapshot.fcf!);
    if (runway < 0.75) flags.push({ id: 'runway', level: 'severe', text: `مدرج نقدي تقريبي ${runway.toFixed(1)} سنة` });
    else if (runway < 1.5) flags.push({ id: 'runway', level: 'elevated', text: `مدرج نقدي تقريبي ${runway.toFixed(1)} سنة` });
    else if (runway < 3) flags.push({ id: 'runway', level: 'mild', text: `مدرج نقدي تقريبي ${runway.toFixed(1)} سنة` });
  }

  if (dilutionKnown) {
    if (snapshot.dilution! >= 0.5) flags.push({ id: 'dilution', level: 'severe', text: `تخفيف معدل ${(snapshot.dilution! * 100).toFixed(1)}%` });
    else if (snapshot.dilution! >= 0.25) flags.push({ id: 'dilution', level: 'elevated', text: `تخفيف معدل ${(snapshot.dilution! * 100).toFixed(1)}%` });
    else if (snapshot.dilution! >= 0.1) flags.push({ id: 'dilution', level: 'mild', text: `تخفيف معدل ${(snapshot.dilution! * 100).toFixed(1)}%` });
  }

  const severe = flags.filter((flag) => flag.level === 'severe').length;
  const elevated = flags.filter((flag) => flag.level === 'elevated').length;
  const mild = flags.filter((flag) => flag.level === 'mild').length;
  const level: FinancingRiskLevel = severe > 0 ? 'severe' : elevated >= 2 ? 'severe' : elevated > 0 ? 'elevated' : mild >= 2 ? 'elevated' : mild > 0 ? 'mild' : missing.length ? 'unknown' : 'clean';
  const summary = [
    cashKnown ? `نقد ${cash.toLocaleString('en-US')}` : 'النقد غير متاح',
    debtKnown ? `دين ${debt.toLocaleString('en-US')}` : 'الدين غير متاح',
    revenueKnown ? `الإيرادات ${revenue.toLocaleString('en-US')}` : 'الإيرادات غير متاحة',
    fcfKnown ? `FCF ${snapshot.fcf!.toLocaleString('en-US')}` : 'FCF غير متاح',
    flags.length ? flags.map((flag) => flag.text).join('؛ ') : 'لا توجد إشارة تمويل حادة في البيانات المتاحة',
  ].join(' · ');
  for(const [key,used] of [['cash',cashKnown],['debt',debtKnown],['revenue',revenueKnown],['fcf',fcfKnown],['netIncome',incomeKnown&&flowAligned('netIncome')],['dilution',dilutionKnown]] as const){
    if(used)sources.push(snapshot.provenance[key]);
  }
  return { level, evidence: `${summary}. مستوى الخطر: ${level}.${missing.length ? ` مراجعة غير مكتملة: ${missing.join('، ')}.` : ''}`, sources: [...new Set(sources)] };
}

export function applyFinancingRisk(snapshot: Snapshot): Snapshot {
  const result = assessFinancingRisk(snapshot);
  const provenance = { ...snapshot.provenance };
  delete provenance.deathSpiral;
  if (result.level !== 'unknown') {
    const source = derivedEvidence('Observed financing-risk review', result.sources, snapshot.asOf, `financing-risk-v2; ${result.level}; annual burn, aligned balances and split-reviewed dilution`);
    if (source) provenance.deathSpiral = source;
  }
  return { ...snapshot, provenance, deathSpiral: result.level, riskEvidence: result.evidence };
}
