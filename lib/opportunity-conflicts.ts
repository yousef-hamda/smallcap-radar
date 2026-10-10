import type { Snapshot } from './engine';
import type { OpportunityFactorId } from './opportunity-spec';

// Source disagreements written by the SEC comparison and snapshot reconciler
// identify a field before the colon. A free-form or unfamiliar disagreement
// cannot be safely localized, so it continues to withhold every model factor.
export const MODEL_DEPENDENCIES: Record<OpportunityFactorId, Record<string, readonly string[]>> = {
  valuation: {
    'intrinsic-value-sensitivity': ['price','marketCap','revenue','netIncome','ocf','capex','shares','priorShares','shareCountRatio'],
    'sales-multiple': ['ps','evSales','marketCap','revenue','cash','debt','debtTotal','debtCurrent','debtNoncurrent'],
    'fcf-yield': ['fcfYield','fcf','ocf','capex','marketCap'],
    'fcf-yield-from-margin-and-sales-multiple': ['fcf','ocf','capex','revenue','ps','marketCap'],
  },
  catalysts: {
    'growth-momentum': ['revenueGrowth','revenue'],
    backlog: ['backlog','revenue'],
    'earnings-window': ['nextEarnings'],
  },
  financialStrength: {
    'cash-debt': ['cash','debt','debtTotal','debtCurrent','debtNoncurrent'],
    'fcf-margin': ['fcf','ocf','capex','revenue'],
    runway: ['cash','fcf','ocf','capex'],
  },
  earningsQuality: {
    'profit-margin': ['netIncome','revenue'],
    'fcf-margin': ['fcf','ocf','capex','revenue'],
    'cash-conversion': ['fcf','ocf','capex','netIncome'],
  },
  competitivePosition: {
    'gross-margin': ['grossMargin','revenue','costOfRevenue'],
    'industry-peer-gross-margin': ['grossMargin','revenue','costOfRevenue'],
    'margin-trend': ['operatingMarginTrend','revenue'],
    growth: ['revenueGrowth','revenue'],
  },
  downsideRisk: {
    'cash-debt': ['cash','debt','debtTotal','debtCurrent','debtNoncurrent'],
    dilution: ['dilution','shareCountRatio','shares','priorShares'],
    'financing-review': ['deathSpiral','cash','debt','debtTotal','debtCurrent','debtNoncurrent','fcf','ocf','capex','netIncome','shares','priorShares'],
  },
  management: {
    'dilution-discipline': ['dilution','shareCountRatio','shares','priorShares'],
    'insider-purchases': ['insiderBuyValue'],
    'earnings-outcome': ['lastEarningsStatus'],
  },
  technicalTiming: {
    'moving-average': ['price','ma30w'],
    range: ['price','low52w','high52w'],
    'trailing-return': ['return12m'],
  },
};
const REPORTED_CONFLICT_FIELDS = new Set([
  'marketCap','revenue','netIncome','fcf','evSales','ocf','capex','shares','priorShares','cash',
  'debtCurrent','debtNoncurrent','debtTotal','costOfRevenue','backlog','contractLiabilities',
]);
const RECONCILED_CONFLICT_FIELDS = new Set(['marketCap','revenue','netIncome','fcf','evSales']);

function conflictField(conflict: string): string | null {
  const separator = conflict.indexOf(': ');
  if (separator <= 0) return null;
  const field = conflict.slice(0, separator);
  const detail = conflict.slice(separator + 2);
  if (REPORTED_CONFLICT_FIELDS.has(field)
    && detail.includes('; same fiscal window/unit/scope; symmetric difference ')
    && detail.endsWith('% > 1%')) return field;
  if (RECONCILED_CONFLICT_FIELDS.has(field)
    && /^اختلاف \d+(?:\.\d+)?% لنفس الفترة بين اللقطتين$/.test(detail)) return field;
  return null;
}

/** True when a known, field-identified conflict touches an input dependency.
 * Unknown formats fail closed and affect any requested set of inputs. */
export function conflictAffectsKeys(conflicts: readonly string[] | undefined, keys: readonly string[]): boolean {
  const relevant = new Set(keys);
  return (conflicts ?? []).some(conflict => {
    const field = typeof conflict === 'string' ? conflictField(conflict) : null;
    return field === null || relevant.has(field);
  });
}

/** Keep raw disagreements in the snapshot for the global decision gate while
 * exposing only dependent disagreements to each numerical model factor. */
export function modelFactorConflicts(snapshot: Snapshot, factor: OpportunityFactorId): string[] {
  const fields = new Set(Object.values(MODEL_DEPENDENCIES[factor]).flat());
  return (snapshot.sourceConflicts ?? []).filter(conflict => conflictAffectsKeys([conflict], [...fields]));
}
