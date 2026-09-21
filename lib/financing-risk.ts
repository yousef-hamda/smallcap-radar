import type { Snapshot } from './engine';
import { usableEvidence } from './evidence';

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
export function assessFinancingRisk(snapshot: Snapshot): { level: FinancingRiskLevel; evidence?: string } {
  const required = ['cash', 'debt', 'revenue'] as const;
  const missing: string[] = required.filter((key) => !finite(snapshot[key]) || !usableEvidence(snapshot.provenance[key], snapshot.asOf));
  const hasProfitEvidence = (finite(snapshot.netIncome) && snapshot.netIncome > 0 && usableEvidence(snapshot.provenance.netIncome, snapshot.asOf)) ||
    (finite(snapshot.fcf) && snapshot.fcf > 0 && usableEvidence(snapshot.provenance.fcf, snapshot.asOf));
  if (!hasProfitEvidence) missing.push('profitability');
  if (missing.length) return { level: 'unknown', evidence: `مراجعة مخاطر التمويل غير مكتملة؛ الحقول الحرجة غير المثبتة: ${missing.join('، ')}` };

  const cash = snapshot.cash!;
  const debt = snapshot.debt!;
  const revenue = snapshot.revenue!;
  const flags: RiskFlag[] = [];

  if (cash < 0 || debt < 0 || revenue <= 0) {
    return { level: 'unknown', evidence: 'مراجعة مخاطر التمويل غير مكتملة؛ توجد قيمة مالية غير منطقية.' };
  }

  if (debt > 0 && cash === 0) flags.push({ id: 'no-cash', level: 'severe', text: 'دين مثبت مع عدم وجود نقد مثبت' });
  else if (cash > 0 && debt / cash >= 8) flags.push({ id: 'debt-cash', level: 'severe', text: `الدين إلى النقد ${(debt / cash).toFixed(1)}×` });
  else if (cash > 0 && debt / cash >= 4) flags.push({ id: 'debt-cash', level: 'elevated', text: `الدين إلى النقد ${(debt / cash).toFixed(1)}×` });
  else if (cash > 0 && debt / cash >= 2) flags.push({ id: 'debt-cash', level: 'mild', text: `الدين إلى النقد ${(debt / cash).toFixed(1)}×` });

  if (finite(snapshot.fcf) && snapshot.fcf < 0) {
    if (!usableEvidence(snapshot.provenance.fcf, snapshot.asOf)) {
      return { level: 'unknown', evidence: 'مراجعة مخاطر التمويل غير مكتملة؛ حرق النقد غير مؤرخ.' };
    }
    const runway = snapshot.fcf === 0 ? Number.POSITIVE_INFINITY : cash / Math.abs(snapshot.fcf);
    if (runway < 0.75) flags.push({ id: 'runway', level: 'severe', text: `مدرج نقدي تقريبي ${runway.toFixed(1)} سنة` });
    else if (runway < 1.5) flags.push({ id: 'runway', level: 'elevated', text: `مدرج نقدي تقريبي ${runway.toFixed(1)} سنة` });
    else if (runway < 3) flags.push({ id: 'runway', level: 'mild', text: `مدرج نقدي تقريبي ${runway.toFixed(1)} سنة` });
  }

  if (snapshot.splitAdjusted === true && finite(snapshot.dilution) && usableEvidence(snapshot.provenance.dilution, snapshot.asOf)) {
    if (snapshot.dilution >= 0.5) flags.push({ id: 'dilution', level: 'severe', text: `تخفيف معدل ${(snapshot.dilution * 100).toFixed(1)}%` });
    else if (snapshot.dilution >= 0.25) flags.push({ id: 'dilution', level: 'elevated', text: `تخفيف معدل ${(snapshot.dilution * 100).toFixed(1)}%` });
    else if (snapshot.dilution >= 0.1) flags.push({ id: 'dilution', level: 'mild', text: `تخفيف معدل ${(snapshot.dilution * 100).toFixed(1)}%` });
  }

  const severe = flags.filter((flag) => flag.level === 'severe').length;
  const elevated = flags.filter((flag) => flag.level === 'elevated').length;
  const mild = flags.filter((flag) => flag.level === 'mild').length;
  const level: FinancingRiskLevel = severe > 0 ? 'severe' : elevated >= 2 ? 'severe' : elevated > 0 ? 'elevated' : mild >= 2 ? 'elevated' : mild > 0 ? 'mild' : 'clean';
  const summary = [
    `نقد ${cash.toLocaleString('en-US')}، دين ${debt.toLocaleString('en-US')}`,
    `الإيرادات ${revenue.toLocaleString('en-US')}`,
    finite(snapshot.fcf) ? `FCF ${snapshot.fcf.toLocaleString('en-US')}` : 'FCF غير متاح',
    flags.length ? flags.map((flag) => flag.text).join('؛ ') : 'لا توجد إشارة تمويل حادة في البيانات المتاحة',
  ].join(' · ');
  return { level, evidence: `${summary}. مستوى الخطر: ${level}.` };
}

export function applyFinancingRisk(snapshot: Snapshot): Snapshot {
  const result = assessFinancingRisk(snapshot);
  // Preserve an explicit, evidenced review supplied by an import or an older
  // durable run when the current snapshot lacks the fields needed to recompute
  // it. Missing replacement data must not erase a previously documented result.
  if (result.level === 'unknown' && snapshot.deathSpiral && snapshot.deathSpiral !== 'unknown' && snapshot.riskEvidence) return snapshot;
  return { ...snapshot, deathSpiral: result.level, riskEvidence: result.evidence };
}
