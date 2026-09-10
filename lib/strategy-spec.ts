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
    version: '2.1.0-draft.5-feature-ranking',
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
    eligibilityGateIds: ['security', 'cap', 'liquidity', 'deathSpiral', 'criticalData', 'freshness', 'conflict'],
    factorCheckIds: ['revenue', 'valuation', 'profitability', 'filingFreshness'],
    model: {
      id: 'CORE_DIAGNOSTIC_BASELINE',
      version: 'diagnostic-2.1.0',
      validation: 'blocked' as const,
      objective: '12–24 month benchmark-relative risk-adjusted return',
      probabilityAvailable: false,
      dataset: { rows: 0, companies: 0, months: 0, pointInTime: false, delisted: false },
    },
    scoreStatus: 'diagnostic-awaiting-historical-validation',
    policy: 'بوابات الأهلية منفصلة عن عوامل الترتيب. الصيغة قابلة لإعادة الحساب لكنها غير معتمدة تنبؤياً بعد.',
  },
  bounce: {
    id: 'BOUNCE_V2',
    version: '2.1.0-draft.5-feature-ranking',
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
    eligibilityGateIds: ['security', 'cap', 'liquidity', 'criticalData', 'freshness', 'conflict'],
    factorCheckIds: ['collapse', 'low', 'dilution', 'reversal'],
    model: {
      id: 'BOUNCE_DIAGNOSTIC_BASELINE',
      version: 'diagnostic-2.1.0',
      validation: 'blocked' as const,
      objective: '3-month net risk-adjusted utility; +20% target before −15% stop reported separately',
      probabilityAvailable: false,
      dataset: { rows: 0, companies: 0, months: 18, pointInTime: false, delisted: false },
    },
    weights: {},
    scoreStatus: 'diagnostic-awaiting-historical-validation',
    policy: 'الأهلية تحددها بوابات التنفيذ والسلامة فقط. درجة 100 ترتب العوامل الموثقة ولا تمثل احتمال الربح.',
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
