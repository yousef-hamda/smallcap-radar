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
    version: '2.0.0-draft.2',
    marketCap: { min: 25e6, max: 2e9 },
    liquidity: 150e3,
    liquidityMetric: 'medianDollarVolume20d',
    evSalesMax: 10,
    weights: {
      Valuation: 24,
      Quality: 19,
      'Share Discipline': 15,
      'Small Size + Low Coverage': 14,
      Growth: 7,
      'Insider Buying': 7,
      'Margin Trend': 6,
      'Entry Point': 5,
      'Balance Sheet': 3,
    },
    freshnessDays: 3,
    filingFreshnessDays: 200,
    score: { growthMin: -0.1, growthMax: 0.3, marginMin: -0.1, marginMax: 0.1, insiderScale: 0.01, entryAnchor: -0.1, entryRange: 0.6 },
    scoreStatus: 'unvalidated',
    policy: 'لا توجد بوابة إنقاذ بالدرجة؛ الصيغة قابلة لإعادة الحساب لكنها غير معتمدة بحثياً بعد.',
  },
  bounce: {
    id: 'BOUNCE_V2',
    version: '2.0.0-draft.2',
    marketCap: { min: 25e6, max: 600e6 },
    liquidity: 150e3,
    liquidityMetric: 'medianDollarVolume20d',
    returnMax: -0.35,
    lowDistanceMin: 0.1,
    dilutionMax: 0.25,
    shareCountRatio: { minExclusive: 0.5, maxExclusive: 1.5 },
    maMultiplier: 1.05,
    weeklyCloses: 30,
    exit: { target: 0.2, stop: -0.15, months: 3 },
    weights: {},
    scoreStatus: 'gates-only',
    policy: 'ارتداد بوابات فقط؛ لا توجد درجة تنبؤية من 100 في المواصفة.',
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
