/**
 * Canonical strategy contract.
 *
 * Thresholds live here exactly once.  The scanner, evaluator, UI/export and
 * tests must consume this object; a number repeated in one of those layers is
 * a parity bug.
 */
export const SPECS = {
  core: {
    id: 'CORE_VALUE_V2',
    version: '2.6.0-draft.1-category-alignment',
    marketCap: { min: 25e6, max: 2e9 },
    liquidity: 150e3,
    liquidityMetric: 'medianDollarVolume20d',
    evSalesMax: 10,
    dilutionMax: 0.25,
    weights: {
      Valuation: 24,
      Quality: 19,
      'Share Discipline': 15,
      'Small Size + Execution Liquidity': 14,
      Growth: 7,
      'Insider Buying': 7,
      'Margin Trend': 6,
      'Entry Point': 5,
      'Balance Sheet': 3,
    },
    freshnessDays: 3,
    filingFreshnessDays: 200,
    score: { growthMin: -0.1, growthMax: 0.3, marginMin: -0.1, marginMax: 0.1, insiderScale: 0.01, entryAnchor: -0.1, entryRange: 0.6, liquidityCeiling: 3e6 },
    // Category membership follows the documented Core screen. The weighted
    // score only orders companies that pass every evidenced thesis gate.
    eligibilityGateIds: ['security', 'cap', 'liquidity', 'revenue', 'valuation', 'profitability', 'deathSpiral', 'criticalData', 'freshness', 'filingFreshness', 'conflict'],
    factorCheckIds: ['revenue', 'valuation', 'profitability', 'deathSpiral'],
    model: {
      id: 'CORE_DIAGNOSTIC_BASELINE',
      version: 'diagnostic-2.6.0-category-alignment',
      validation: 'blocked' as const,
      objective: '12–24 month benchmark-relative risk-adjusted return',
      probabilityAvailable: false,
      dataset: { rows: 0, companies: 0, months: 0, pointInTime: false, delisted: false },
    },
    scoreStatus: 'diagnostic-awaiting-historical-validation',
    policy: 'الإيرادات والتقييم والربحية ومراجعة مخاطر التمويل بوابات أهلية. الدرجة التشخيصية ترتب فقط من يجتازها وليست احتمال ربح.',
  },
  bounce: {
    id: 'BOUNCE_V2',
    version: '2.6.0-draft.1-category-alignment',
    marketCap: { min: 25e6, max: 600e6 },
    liquidity: 150e3,
    liquidityMetric: 'medianDollarVolume20d',
    returnMax: -0.35,
    lowDistanceMin: 0.1,
    dilutionMax: 0.25,
    shareCountRatio: { minExclusive: 0.5, maxExclusive: 1.5 },
    maMultiplier: 1.05,
    weeklyCloses: 30,
    ranking: {
      weights: { collapse: 25, reversal: 25, liquidity: 20, dilution: 15, offLow: 10, size: 5 },
      collapseFloor: -0.8,
      reversalCeiling: 0.25,
      liquidityCeiling: 3e6,
      offLowAnchor: 0.25,
      offLowRange: 0.55,
    },
    exit: { target: 0.2, stop: -0.15, months: 3 },
    // Bounce is a conjunctive screen: the decline, move off the low, reviewed
    // dilution and reversal must all pass before the score ranks a candidate.
    eligibilityGateIds: ['security', 'cap', 'liquidity', 'collapse', 'low', 'dilution', 'reversal', 'criticalData', 'freshness', 'conflict'],
    factorCheckIds: ['collapse', 'low', 'dilution', 'reversal'],
    model: {
      id: 'BOUNCE_DIAGNOSTIC_BASELINE',
      version: 'diagnostic-2.6.0-category-alignment',
      validation: 'blocked' as const,
      objective: '3-month net risk-adjusted utility; +20% target before −15% stop reported separately',
      probabilityAvailable: false,
      dataset: { rows: 0, companies: 0, months: 18, pointInTime: false, delisted: false },
    },
    weights: {},
    scoreStatus: 'diagnostic-awaiting-historical-validation',
    policy: 'شروط الهبوط والابتعاد عن القاع والتخفيف المراجَع والانعكاس بوابات أهلية. الأوزان ترتب المؤهلين ولا تمثل احتمال الربح.',
  },
  legacy: {
    id: 'LEGACY_BENCHMARK',
    version: '1.0.0-reference',
    marketCap: { min: 50e6, max: 5e9 },
    liquidity: 300e3,
    psMax: 10,
    dilutionMax: 0.25,
    momentum: { min: -0.5, max: 0.5 },
    insiderScale: 0.01,
    weights: {
      Valuation: 25,
      'Profitability/FCF': 20,
      Momentum: 20,
      Dilution: 15,
      Size: 10,
      Insider: 10,
    },
    scoreStatus: 'normalization-unavailable',
  },
} as const;

/** Required and optional SEC Frames datasets traversed by the bulk stage. */
export const SEC_FRAME_DATASET_COUNT = 16;

export type StrategyKey = keyof typeof SPECS;

export const INVESTABLE_EXCHANGES = [
  'Nasdaq', 'NYSE', 'NYSE American', 'NASDAQ', 'NMS', 'NGM', 'NCM', 'NYQ', 'ASE',
] as const;

export const NON_TRADABLE_NAME = /\b(etf|fund|trust|warrant|right|unit|preferred|depositary|senior note|bond|debenture|limited partnership)\b|(?:,\s*)?L\.?P\.?\b/i;

export const specHash = (strategy: StrategyKey) => {
  let hash = 2166136261;
  for (const character of JSON.stringify(SPECS[strategy])) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};
