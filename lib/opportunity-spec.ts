/** Single shared contract for the unified opportunity category. */
export const OPPORTUNITY_SPEC = {
  id: 'UNIFIED_OPPORTUNITY',
  version: '1.0.2-supported-universe-ranking',
  defaultHorizonMonths: 6,
  defaultRiskTolerance: 'medium' as const,
  // Include small and micro caps; liquidity is screened independently.
  marketCapMin: 0,
  medianDollarVolume20dMin: 150_000,
  quoteFreshnessMarketDays: 3,
  marketDataFreshnessMarketDays: 3,
  // Evidence coverage is disclosed separately from complete mathematical ranking.
  minimumEvidenceCoverage: 100,
  rankingPolicy: 'all-listings-numeric-grade' as const,
  missingComponentGrade: 0,
  tieBreak: 'symbol-ascending' as const,
  requiredRankedFactors: [
    'valuation',
    'catalysts',
    'financialStrength',
    'earningsQuality',
    'competitivePosition',
    'downsideRisk',
    'management',
    'technicalTiming',
  ] as const,
  factors: [
    { id: 'valuation', label: 'السعر مقابل القيمة العادلة', weight: 25 },
    { id: 'catalysts', label: 'محفزات النمو خلال المدة', weight: 20 },
    { id: 'financialStrength', label: 'القوة المالية والسيولة', weight: 15 },
    { id: 'earningsQuality', label: 'جودة الأرباح والتدفق النقدي', weight: 12 },
    { id: 'competitivePosition', label: 'الميزة التنافسية وجودة النشاط', weight: 10 },
    { id: 'downsideRisk', label: 'المخاطر وحماية الجانب السلبي', weight: 10 },
    { id: 'management', label: 'الإدارة والحوكمة وتوافق المصالح', weight: 5 },
    { id: 'technicalTiming', label: 'التشارت وتوقيت الدخول', weight: 3 },
  ] as const,
} as const;

export type OpportunityFactorId = (typeof OPPORTUNITY_SPEC.factors)[number]['id'];
export type OpportunityRiskTolerance = 'low' | 'medium' | 'high';

export function opportunitySpecHash() {
  let hash = 2166136261;
  for (const character of JSON.stringify(OPPORTUNITY_SPEC)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
