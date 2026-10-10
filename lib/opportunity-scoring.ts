import type { Provenance } from './engine';
import type { OpportunityEvidence } from './opportunity-engine';
import { isOpportunityProvenanceValid } from './opportunity-engine';
import { compatibleFinancialSources } from './financial-integrity';

export type FairValueMethodId = 'normalized-dcf' | 'peer-multiples' | 'sum-of-parts' | 'residual-income' | 'risk-adjusted-npv' | 'asset-value';

/** Small arithmetic tree: every numeric leaf must resolve to a sourced input. */
export type FairValueExpression =
  | { op: 'assumption'; name: string }
  | { op: 'capitalization'; metric: 'dilutedShares' | 'unrestrictedCash' | 'restrictedCash' | 'totalDebt' | 'leaseLiabilities' }
  | { op: 'add' | 'subtract' | 'multiply' | 'divide'; left: FairValueExpression; right: FairValueExpression };

export type SourcedValue = { value: number; unit: string; source: Provenance };

export type FairValueMethod = {
  id: FairValueMethodId;
  valuePerShare: SourcedValue;
  industryReview: { suitable: boolean; rationale: string; sources: Provenance[] };
  primary: boolean;
  explanation: string;
  assumptions: Array<{ name: string; value: string | number; unit?: string; source: Provenance }>;
  calculation: { formula: string; expression: FairValueExpression; outputValue: number; unit: string; version: string };
};

export type ValuationCapitalizationReview = {
  dilutedShares: SourcedValue;
  unrestrictedCash: SourcedValue;
  restrictedCash: SourcedValue;
  totalDebt: SourcedValue;
  leaseLiabilities: SourcedValue;
  rationale: string;
  sources: Provenance[];
};

export type ValuationNormalizationReview = {
  rationale: string;
  sources: Provenance[];
};

export type FairValueScenarioCalculation = {
  assumptions: Array<{ name: string; value: string | number; unit?: string; source: Provenance }>;
  calculation: { formula: string; expression: FairValueExpression; outputValue: number; unit: string; version: string };
};

export type FairValueAssessment = {
  currentPrice: SourcedValue;
  conservativeValue: SourcedValue;
  baseValue: SourcedValue;
  optimisticValue: SourcedValue;
  methods: FairValueMethod[];
  scenarioCalculations: { conservative: FairValueScenarioCalculation; optimistic: FairValueScenarioCalculation };
  capitalizationReview: ValuationCapitalizationReview;
  normalizationReview: ValuationNormalizationReview;
  asOf: string;
};

export type FairValueScore = OpportunityEvidence & {
  confidence: 'low' | 'medium' | 'high';
  marginOfSafety: number | null;
  methodSpread: number | null;
};

export type FinancialStrengthAssessment = {
  industryModel: 'industrial-operating-company';
  asOf: string;
  unrestrictedCash: SourcedValue;
  totalDebt: SourcedValue;
  freeCashFlowTtm: SourcedValue;
  operatingIncomeTtm: SourcedValue;
  interestExpenseTtm: SourcedValue;
  debtDueWithin24Months: SourcedValue;
};

export type FinancialStrengthScore = OpportunityEvidence & {
  subScores: { cashRunway: number; interestCoverage: number; maturityCoverage: number };
};

export type CatalystClassification = 'realized-revenue' | 'binding-contract' | 'funded-conditional' | 'regulatory' | 'operational' | 'customer-expansion' | 'guidance' | 'non-binding' | 'unverified';
export type CatalystEvent = {
  id: string;
  title: string;
  classification: CatalystClassification;
  announcedAt: string;
  expectedAt: string;
  source: Provenance;
  /** Explicit ratio/fraction-of-ttm-revenue or percent/%-of-ttm-revenue. */
  impactAsPctTtmRevenue?: SourcedValue;
  conditions: string[];
  progressVerified: boolean;
  marketPricing: 'not-priced' | 'partly-priced' | 'priced' | 'unknown';
};
export type CatalystAssessment = {
  asOf: string;
  horizonMonths: number;
  searchCompleted: boolean;
  searchSources: Provenance[];
  events: CatalystEvent[];
};
export type CatalystScore = OpportunityEvidence & { eventScores: Array<{ id: string; score: number; rationale: string }> };

export type EarningsPeriod = {
  revenue: SourcedValue;
  /** Optional SEC gross-profit line; absent for service issuers or filings that do not tag it separately. */
  grossProfit?: SourcedValue;
  netIncome: SourcedValue;
  operatingIncome: SourcedValue;
  operatingCashFlow: SourcedValue;
  capitalExpenditure: SourcedValue;
  stockBasedCompensation: SourcedValue;
};
export type EarningsQualityAssessment = {
  asOf: string;
  quarterly: EarningsPeriod[];
  annual: EarningsPeriod[];
  // These are deliberate review gates. Automated filing facts do not establish
  // whether management adjustments recur or whether an unusual item is truly
  // non-recurring, so an adapter may provide the financial series without
  // manufacturing either assessment.
  gaapNonGaapBridgeReview?: { score: number; rationale: string; sources: Provenance[] };
  oneOffsReview?: { score: number; rationale: string; sources: Provenance[] };
};
export type EarningsQualityScore = OpportunityEvidence & {
  subScores: { growth: number; cashConversion: number; operatingPersistence: number; sbcBurden: number; accountingTransparency?: number };
};
export type RiskArea = 'dilution' | 'financing' | 'customer-concentration' | 'legal-regulatory' | 'accounting-auditor' | 'short-interest' | 'insider-overhang' | 'operations-supply-chain';
export type DownsideRiskAssessment = {
  asOf: string;
  reviews: Array<{ area: RiskArea; status: 'risk-found' | 'searched-none' | 'unavailable-rights' | 'unreviewed'; sources: Provenance[]; note: string }>;
  findings: Array<{ id: string; area: RiskArea; severity: 1 | 2 | 3 | 4 | 5; probability: number; permanence: number; mitigatedFraction: number; source: Provenance; note: string }>;
};
export type DownsideRiskScore = OpportunityEvidence & { riskPenalty: number; reviewedAreas: number; identifiedRisks: number };
export type TechnicalBar = { date: string; close: number; volume?: number; completed: boolean };
export type TechnicalTimingAssessment = {
  asOf: string;
  splitAdjusted: boolean;
  daily: TechnicalBar[];
  weekly: TechnicalBar[];
  monthly: TechnicalBar[];
  benchmarkDaily: TechnicalBar[];
  source: Provenance;
  weeklySource: Provenance;
  monthlySource: Provenance;
  benchmarkSource: Provenance;
};
export type TechnicalTimingScore = OpportunityEvidence & { indicators: { ma20: number; ma50: number; ma100: number; ma200: number; ma30w: number; rsi14: number; relativeStrength63d: number } };
export type QualitativeFactorId = 'competitivePosition' | 'management';
export type QualitativeDimension = 'product-differentiation' | 'customer-evidence' | 'switching-advantage' | 'competitive-durability' | 'substitution-risk'
  | 'execution-record' | 'capital-allocation' | 'governance-controls' | 'shareholder-alignment' | 'insider-evidence';
export type QualitativeAssessment = { id: QualitativeDimension; score: number; rationale: string; sources: Provenance[] };

const finitePositive = (value: number) => Number.isFinite(value) && value > 0;
const rounded = (value: number, places = 4) => Math.round(value * 10 ** places) / 10 ** places;

function unavailable(rationale: string, conflicts: string[] = []): FairValueScore {
  return { score: null, rationale, sources: [], conflicts, confidence: 'low', marginOfSafety: null, methodSpread: null };
}

function unavailableFinancial(rationale: string, conflicts: string[] = []): FinancialStrengthScore {
  return { score: null, rationale, sources: [], conflicts, confidence: 'low', subScores: { cashRunway: 0, interestCoverage: 0, maturityCoverage: 0 } };
}

function unavailableCatalysts(rationale: string, conflicts: string[] = []): CatalystScore {
  return { score: null, rationale, sources: [], conflicts, confidence: 'low', eventScores: [] };
}

function unavailableEarnings(rationale: string, conflicts: string[] = [], sources: Provenance[] = []): EarningsQualityScore {
  return { score: null, rationale, sources, conflicts, confidence: 'low', subScores: { growth: 0, cashConversion: 0, operatingPersistence: 0, sbcBurden: 0, accountingTransparency: 0 } };
}

function unavailableDownside(rationale: string, conflicts: string[] = []): DownsideRiskScore {
  return { score: null, rationale, sources: [], conflicts, confidence: 'low', riskPenalty: 0, reviewedAreas: 0, identifiedRisks: 0 };
}

function unavailableTechnical(rationale: string, conflicts: string[] = []): TechnicalTimingScore {
  return { score: null, rationale, sources: [], conflicts, confidence: 'low', indicators: { ma20: 0, ma50: 0, ma100: 0, ma200: 0, ma30w: 0, rsi14: 0, relativeStrength63d: 0 } };
}

function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function validBars(bars: TechnicalBar[], minCount: number, asOf: string) {
  if (bars.length < minCount || bars.some((bar, index) => !bar.completed || !/^\d{4}-\d{2}-\d{2}$/.test(bar.date) || !Number.isFinite(Date.parse(bar.date)) || Date.parse(bar.date) > Date.parse(asOf)
    || [0, 6].includes(new Date(`${bar.date}T00:00:00Z`).getUTCDay())
    || !Number.isFinite(bar.close) || bar.close <= 0 || (bar.volume != null && (!Number.isFinite(bar.volume) || bar.volume < 0))
    || (index > 0 && Date.parse(bar.date) <= Date.parse(bars[index - 1].date)))) return false;
  return true;
}
function intervalCadenceValid(bars: TechnicalBar[], count: number, maximumSpanDays: number, maximumGapDays: number) {
  const sample = bars.slice(-count);
  if (sample.length < count) return false;
  const millis = (date: string) => Date.parse(`${date}T00:00:00Z`);
  if ((millis(sample.at(-1)!.date) - millis(sample[0].date)) / 86_400_000 > maximumSpanDays) return false;
  return sample.every((bar, index) => index === 0 || (millis(bar.date) - millis(sample[index - 1].date)) / 86_400_000 <= maximumGapDays);
}
function wilderRsi(closes: number[], period = 14) {
  if (closes.length <= period || closes.some(value => !finitePositive(value))) return null;
  const changes = closes.slice(1).map((close, index) => close - closes[index]);
  let gains = 0, losses = 0;
  for (const change of changes.slice(0, period)) {
    if (change > 0) gains += change;
    else losses -= change;
  }
  let averageGain = gains / period, averageLoss = losses / period;
  for (const change of changes.slice(period)) {
    averageGain = (averageGain * (period - 1) + Math.max(0, change)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(0, -change)) / period;
  }
  if (averageLoss === 0) return 100;
  if (averageGain === 0) return 0;
  return 100 - 100 / (1 + averageGain / averageLoss);
}
function marketWeekdayAge(fromDate: string, asOf: string) {
  // Provenance fields may be date-only (financial periods) or full ISO
  // timestamps (retrieval/availability). Do not append a second time suffix.
  const start = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(fromDate) ? `${fromDate}T00:00:00Z` : fromDate), end = Date.parse(asOf);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return Number.POSITIVE_INFINITY;
  let age = 0;
  for (let cursor = start + 86_400_000; cursor <= Date.UTC(new Date(end).getUTCFullYear(), new Date(end).getUTCMonth(), new Date(end).getUTCDate()); cursor += 86_400_000) {
    const day = new Date(cursor).getUTCDay(); if (day !== 0 && day !== 6) age++;
  }
  return age;
}

/** Completed-bar trend/timing diagnostic; it never forecasts a reversal. */
export function scoreTechnicalTiming(input: TechnicalTimingAssessment): TechnicalTimingScore {
  if (!Number.isFinite(Date.parse(input.asOf)) || !input.splitAdjusted) return unavailableTechnical('A valid date and verified split-adjusted history are required.');
  if (!isOpportunityProvenanceValid(input.source, input.asOf)
    || !isOpportunityProvenanceValid(input.weeklySource, input.asOf)
    || !isOpportunityProvenanceValid(input.monthlySource, input.asOf)
    || !isOpportunityProvenanceValid(input.benchmarkSource, input.asOf)
    || !validBars(input.daily, 200, input.asOf)
    || !validBars(input.weekly, 30, input.asOf)
    || !validBars(input.monthly, 12, input.asOf)
    || !validBars(input.benchmarkDaily, 64, input.asOf)
    || !intervalCadenceValid(input.daily, 200, 370, 7)
    || !intervalCadenceValid(input.weekly, 30, 350, 14)
    || !intervalCadenceValid(input.monthly, 12, 500, 62)
    || !intervalCadenceValid(input.benchmarkDaily, 64, 125, 7)) {
    return unavailableTechnical('At least 200 completed daily, 30 weekly, 12 monthly, and 64 benchmark daily bars with valid provenance are required.');
  }
  const lastDailyDate = input.daily[input.daily.length - 1].date;
  const lastWeeklyDate = input.weekly[input.weekly.length - 1]?.date;
  const lastMonthlyDate = input.monthly[input.monthly.length - 1]?.date;
  const lastBenchmarkDate = input.benchmarkDaily[input.benchmarkDaily.length - 1]?.date;
  if (input.source.periodEnd !== lastDailyDate || input.weeklySource.periodEnd !== lastWeeklyDate
    || input.monthlySource.periodEnd !== lastMonthlyDate || input.benchmarkSource.periodEnd !== lastBenchmarkDate
    || marketWeekdayAge(lastDailyDate, input.asOf) > 3 || marketWeekdayAge(lastBenchmarkDate ?? '', input.asOf) > 3
    || (Date.parse(input.asOf) - Date.parse(`${lastWeeklyDate}T00:00:00Z`)) / 86_400_000 > 14
    || (Date.parse(input.asOf) - Date.parse(`${lastMonthlyDate}T00:00:00Z`)) / 86_400_000 > 45
    || (Date.parse(input.asOf) - Date.parse(input.weekly[input.weekly.length - 1].date)) / 86_400_000 > 14
    || (Date.parse(input.asOf) - Date.parse(input.monthly[input.monthly.length - 1].date)) / 86_400_000 > 45) {
    return unavailableTechnical('Daily, weekly, and monthly bars must each end at a recent completed market interval.');
  }
  const daily = input.daily.slice(-200);
  const weekly = input.weekly.slice(-30);
  const monthly = input.monthly.slice(-12);
  const alignedBenchmark = new Map(input.benchmarkDaily.map(bar => [bar.date, bar.close]));
  const stockRelative = daily.slice(-64).filter(bar => alignedBenchmark.has(bar.date));
  if (stockRelative.length < 64) return unavailableTechnical('Benchmark history does not align to the last 64 completed stock sessions.', ['benchmark date alignment incomplete']);
  const last = daily[daily.length - 1].close;
  const ma20 = mean(daily.slice(-20).map(bar => bar.close));
  const ma50 = mean(daily.slice(-50).map(bar => bar.close));
  const ma100 = mean(daily.slice(-100).map(bar => bar.close));
  const ma200 = mean(daily.map(bar => bar.close));
  const ma30w = mean(weekly.map(bar => bar.close));
  const rsi14 = wilderRsi(daily.map(bar => bar.close));
  if (rsi14 == null) return unavailableTechnical('RSI requires a valid, positive close series.');
  const stockReturn63d = stockRelative[63].close / stockRelative[0].close - 1;
  const benchmarkReturn63d = alignedBenchmark.get(stockRelative[63].date)! / alignedBenchmark.get(stockRelative[0].date)! - 1;
  const relativeStrength63d = stockReturn63d - benchmarkReturn63d;
  const dailyTrend = [ma20, ma50, ma100, ma200].filter(average => last > average).length * 2.5;
  const weeklyUp = weekly[29].close > weekly[25].close;
  const weeklyTrend = last > ma30w ? weeklyUp ? 10 : 6 : weeklyUp ? 4 : 0;
  const monthlyChange = monthly[11].close / monthly[8].close - 1;
  const monthlyTrend = monthlyChange > 0.1 ? 10 : monthlyChange > 0 ? 8 : monthlyChange > -0.1 ? 5 : 2;
  const rsiScore = rsi14 >= 45 && rsi14 <= 65 ? 10 : rsi14 >= 35 && rsi14 < 45 || rsi14 > 65 && rsi14 <= 75 ? 7 : rsi14 >= 25 && rsi14 < 35 || rsi14 > 75 && rsi14 < 90 ? 4 : 1;
  const relativeScore = relativeStrength63d >= 0.1 ? 10 : relativeStrength63d >= 0.05 ? 8 : relativeStrength63d > -0.05 ? 6 : relativeStrength63d > -0.1 ? 4 : 1;
  const score = rounded(dailyTrend * 0.3 + weeklyTrend * 0.2 + monthlyTrend * 0.1 + rsiScore * 0.15 + relativeScore * 0.25, 2);
  return {
    score,
    rationale: `Completed split-adjusted bars only. Price ${last > ma200 ? 'above' : 'below'} MA200; ${dailyTrend / 2.5}/4 daily averages are below price; weekly MA30 ${last > ma30w ? 'reclaimed' : 'not reclaimed'}; RSI(14) ${rsi14.toFixed(1)}; 63-session relative strength ${(relativeStrength63d * 100).toFixed(1)} percentage points versus the supplied benchmark. These are descriptive indicators, not a reversal prediction.`,
    sources: [input.source, input.weeklySource, input.monthlySource, input.benchmarkSource], confidence: [input.source, input.weeklySource, input.monthlySource, input.benchmarkSource].every(source => source.confidence === 'high') ? 'high' : 'medium',
    indicators: { ma20: rounded(ma20), ma50: rounded(ma50), ma100: rounded(ma100), ma200: rounded(ma200), ma30w: rounded(ma30w), rsi14: rounded(rsi14, 2), relativeStrength63d: rounded(relativeStrength63d, 5) },
    calculation: { rubricId: 'technical-timing-v1', inputs: [
      { name: 'completed-daily-bars', value: daily.length }, { name: 'completed-weekly-bars', value: weekly.length }, { name: 'completed-monthly-bars', value: monthly.length },
      { name: 'price', value: last }, { name: 'ma20', value: rounded(ma20) }, { name: 'ma50', value: rounded(ma50) },
      { name: 'ma100', value: rounded(ma100) }, { name: 'ma200', value: rounded(ma200) }, { name: 'ma30w', value: rounded(ma30w) },
      { name: 'rsi14', value: rounded(rsi14, 2) }, { name: 'relative-strength-63d', value: rounded(relativeStrength63d, 5), unit: 'excess-return-ratio' },
      { name: 'weights-daily-weekly-monthly-rsi-relative', value: '0.30/0.20/0.10/0.15/0.25' },
    ] },
  };
}

const QUALITATIVE_DIMENSIONS: Record<QualitativeFactorId, readonly QualitativeDimension[]> = {
  competitivePosition: ['product-differentiation', 'customer-evidence', 'switching-advantage', 'competitive-durability', 'substitution-risk'],
  management: ['execution-record', 'capital-allocation', 'governance-controls', 'shareholder-alignment', 'insider-evidence'],
};

/**
 * Evidence-led analyst review for qualitative factors that cannot be inferred
 * reliably from structured market/XBRL feeds. A missing dimension stays null;
 * analyst judgments are never presented as machine-observed facts.
 */
export function scoreQualitativeFactor(factor: QualitativeFactorId, asOf: string, assessments: QualitativeAssessment[]): OpportunityEvidence {
  if (!Number.isFinite(Date.parse(asOf))) return { score: null, rationale: 'Valid as-of date required.', sources: [], confidence: 'low' };
  const required = QUALITATIVE_DIMENSIONS[factor];
  const byId = new Map<QualitativeDimension, QualitativeAssessment>();
  const conflicts: string[] = [];
  for (const assessment of assessments) {
    if (!required.includes(assessment.id) || byId.has(assessment.id)) conflicts.push(`unexpected or duplicate qualitative dimension: ${assessment.id}`);
    byId.set(assessment.id, assessment);
  }
  for (const dimension of required) if (!byId.has(dimension)) conflicts.push(`qualitative dimension not reviewed: ${dimension}`);
  for (const assessment of assessments) {
    if (!Number.isInteger(assessment.score) || assessment.score < 0 || assessment.score > 10 || !assessment.rationale.trim()
      || !assessment.sources.some(source => isOpportunityProvenanceValid(source, asOf))) conflicts.push(`qualitative judgment lacks a valid score, rationale, or dated source: ${assessment.id}`);
  }
  if (conflicts.length) return { score: null, rationale: 'All five disclosed analyst-review dimensions require dated evidence and an explicit rationale.', sources: [], confidence: 'low', conflicts };
  const sources = assessments.flatMap(assessment => assessment.sources);
  const score = rounded(assessments.reduce((sum, assessment) => sum + assessment.score, 0) / required.length, 2);
  return {
    score,
    rationale: `Five source-backed analyst-review dimensions for ${factor} were scored equally. These are disclosed judgment assessments, not automated measurements.`,
    sources,
    confidence: 'medium',
    calculation: { rubricId: `${factor}-qualitative-v1`, inputs: assessments.map(assessment => ({ name: assessment.id, value: assessment.score })) },
  };
}

const RISK_AREAS: readonly RiskArea[] = ['dilution', 'financing', 'customer-concentration', 'legal-regulatory', 'accounting-auditor', 'short-interest', 'insider-overhang', 'operations-supply-chain'];
const RISK_WEIGHTS: Record<RiskArea, number> = {
  dilution: 0.18, financing: 0.2, 'customer-concentration': 0.12, 'legal-regulatory': 0.12,
  'accounting-auditor': 0.16, 'short-interest': 0.06, 'insider-overhang': 0.06, 'operations-supply-chain': 0.1,
};

/** Penalizes identified risks only after every material risk domain is audited. */
export function scoreDownsideRisk(input: DownsideRiskAssessment): DownsideRiskScore {
  if (!Number.isFinite(Date.parse(input.asOf))) return unavailableDownside('A valid as-of date is required.');
  const conflicts: string[] = [];
  const reviewsByArea = new Map<RiskArea, DownsideRiskAssessment['reviews'][number]>();
  for (const review of input.reviews) {
    if (reviewsByArea.has(review.area)) conflicts.push(`duplicate risk review: ${review.area}`);
    reviewsByArea.set(review.area, review);
    if (!review.note.trim() || review.status === 'unreviewed' || review.status === 'unavailable-rights'
      || !review.sources.some(source => isOpportunityProvenanceValid(source, input.asOf))) {
      conflicts.push(`risk review is missing, unavailable, or unauditable: ${review.area}`);
    }
    if (review.status === 'searched-none' && input.findings.some(finding => finding.area === review.area)) conflicts.push(`risk marked absent but findings exist: ${review.area}`);
    if (review.status === 'risk-found' && !input.findings.some(finding => finding.area === review.area)) conflicts.push(`risk review says a risk exists but no finding is recorded: ${review.area}`);
  }
  for (const area of RISK_AREAS) if (!reviewsByArea.has(area)) conflicts.push(`risk area not reviewed: ${area}`);
  const seen = new Set<string>();
  for (const finding of input.findings) {
    if (!finding.id.trim() || seen.has(finding.id)) conflicts.push('duplicate or empty risk finding identity');
    seen.add(finding.id);
    if (!finding.note.trim() || !isOpportunityProvenanceValid(finding.source, input.asOf)
      || !Number.isFinite(finding.probability) || finding.probability < 0 || finding.probability > 1
      || !Number.isFinite(finding.permanence) || finding.permanence < 0 || finding.permanence > 1
      || !Number.isFinite(finding.mitigatedFraction) || finding.mitigatedFraction < 0 || finding.mitigatedFraction > 1) {
      conflicts.push(`invalid, unsourced, or out-of-range risk finding: ${finding.id}`);
    }
    if (reviewsByArea.get(finding.area)?.status !== 'risk-found') conflicts.push(`risk finding is not included in an audited risk-found area: ${finding.id}`);
  }
  if (conflicts.length) return unavailableDownside('All eight risk searches and every material finding must be sourced and reconciled before the downside factor can be scored.', conflicts);

  const categoryPenalty = Object.fromEntries(RISK_AREAS.map(area => {
    const exposure = input.findings.filter(finding => finding.area === area)
      .reduce((sum, finding) => sum + (finding.severity / 5) * finding.probability * finding.permanence * (1 - finding.mitigatedFraction), 0);
    return [area, Math.min(1, exposure) * RISK_WEIGHTS[area]];
  })) as Record<RiskArea, number>;
  const riskPenalty = rounded(Object.values(categoryPenalty).reduce((sum, penalty) => sum + penalty, 0) * 10, 2);
  const score = rounded(Math.max(0, 10 - riskPenalty), 2);
  const sources = [...input.reviews.flatMap(review => review.sources), ...input.findings.map(finding => finding.source)];
  const confidence: DownsideRiskScore['confidence'] = sources.every(source => source.confidence === 'high') ? 'high' : 'medium';
  return {
    score,
    rationale: `${input.reviews.length} documented risk-domain searches; ${input.findings.length} sourced finding(s); weighted downside penalty ${riskPenalty}/10. A searched-none result means only that the specified source search found no disclosed item.`,
    sources,
    confidence,
    riskPenalty,
    reviewedAreas: RISK_AREAS.length,
    identifiedRisks: input.findings.length,
    calculation: {
      rubricId: 'downside-risk-v1',
      inputs: [
        { name: 'reviewed-risk-domains', value: RISK_AREAS.length },
        { name: 'identified-findings', value: input.findings.length },
        ...RISK_AREAS.map(area => ({ name: `risk-domain:${area}:penalty-weight`, value: rounded(categoryPenalty[area]) })),
        ...input.findings.map(finding => ({ name: `finding:${finding.id}:severity-probability-permanence-unmitigated`, value: `${finding.severity}/5 × ${finding.probability} × ${finding.permanence} × ${1 - finding.mitigatedFraction}` })),
      ],
    },
  };
}

/** Three-year/8-quarter industrial earnings-quality diagnostic. */
function scoreEarningsQualityCore(input: EarningsQualityAssessment, allowPartialDisclosure: boolean): EarningsQualityScore {
  if (!Number.isFinite(Date.parse(input.asOf)) || input.annual.length < 3 || input.quarterly.length < 8) {
    return unavailableEarnings('At least three annual periods and eight quarterly periods are required.');
  }
  const disclosureReviews = [input.gaapNonGaapBridgeReview, input.oneOffsReview];
  const validDisclosureReviews = disclosureReviews.filter((review): review is NonNullable<typeof review> => !!review
    && Number.isInteger(review.score) && review.score >= 0 && review.score <= 10 && !!review.rationale?.trim()
    && !!review.sources?.length && review.sources.every(source => isOpportunityProvenanceValid(source, input.asOf)));
  if (!allowPartialDisclosure && validDisclosureReviews.length !== 2) {
    const auditedPeriods = [...input.annual, ...input.quarterly];
    const auditedSources = auditedPeriods.flatMap(period => [period.revenue, period.netIncome, period.operatingIncome, period.operatingCashFlow, period.capitalExpenditure, period.stockBasedCompensation]
      .filter(metric => !!metric && isOpportunityProvenanceValid(metric.source, input.asOf)).map(metric => metric.source));
    return unavailableEarnings('The financial history is available, but dated source-backed reviews with explicit 0–10 assessments are still required for both GAAP/non-GAAP adjustments and one-off items.', [], auditedSources);
  }
  const allPeriods = [...input.annual, ...input.quarterly];
  const allMetrics = allPeriods.flatMap(period => [period.revenue, period.netIncome, period.operatingIncome, period.operatingCashFlow, period.capitalExpenditure, period.stockBasedCompensation]);
  if (allMetrics.some(metric => Number.isFinite(Date.parse(metric?.source?.periodEnd)) && Date.parse(metric.source.periodEnd) > Date.parse(input.asOf))) {
    return unavailableEarnings('A financial reporting period ends after the evaluation date.', ['future financial period']);
  }
  if (allMetrics.some(metric => !metric || !Number.isFinite(metric.value) || !metric.unit || !isOpportunityProvenanceValid(metric.source, input.asOf))) {
    return unavailableEarnings('Every annual and quarterly revenue, earnings, operating cash-flow, capex, and SBC input needs dated provenance.');
  }
  const units = new Set(allMetrics.map(metric => metric.unit.toUpperCase()));
  if (units.size !== 1) return unavailableEarnings('Earnings inputs use different currencies or units.', ['currency/unit mismatch']);
  if (allMetrics.some(metric => metric.source.currency !== metric.unit || (metric.source.scope ?? 'consolidated') !== 'consolidated')) {
    return unavailableEarnings('Comparable consolidated earnings and cash-flow inputs must retain their reported currency and scope.', ['earnings source currency/scope mismatch']);
  }
  const annualPeriods = [...input.annual].sort((a, b) => Date.parse(a.revenue.source.periodEnd) - Date.parse(b.revenue.source.periodEnd));
  const quarterlyPeriods = [...input.quarterly].sort((a, b) => Date.parse(a.revenue.source.periodEnd) - Date.parse(b.revenue.source.periodEnd));
  const annualEnds = annualPeriods.map(period => Date.parse(period.revenue.source.periodEnd));
  const quarterlyEnds = quarterlyPeriods.map(period => Date.parse(period.revenue.source.periodEnd));
  if (new Set(annualEnds).size !== annualEnds.length || new Set(quarterlyEnds).size !== quarterlyEnds.length
    || annualEnds.some((date, index) => index > 0 && ((date - annualEnds[index - 1]) < 300 * 86_400_000 || (date - annualEnds[index - 1]) > 430 * 86_400_000))
    || quarterlyEnds.some((date, index) => index > 0 && (date - quarterlyEnds[index - 1]) < 55 * 86_400_000 || (date - quarterlyEnds[index - 1]) > 130 * 86_400_000)) {
    return unavailableEarnings('Annual or quarterly periods are duplicated, overlapping, or irregularly spaced.', ['period alignment conflict']);
  }
  if (annualEnds[annualEnds.length - 1] > Date.parse(input.asOf) || quarterlyEnds[quarterlyEnds.length - 1] > Date.parse(input.asOf)) {
    return unavailableEarnings('A financial period ends after the evaluation date.', ['future financial period']);
  }
  const latestPeriod = Math.max(...annualEnds, ...quarterlyEnds);
  if ((Date.parse(input.asOf) - latestPeriod) / 86_400_000 > 400) return unavailableEarnings('The latest financial period is older than 400 days.');
  for (const period of allPeriods) {
    const end = Date.parse(period.revenue.source.periodEnd);
    const start = Date.parse(period.revenue.source.periodStart ?? '');
    if (!Number.isFinite(start) || start > end) return unavailableEarnings('A financial reporting period has an invalid start/end date.', ['invalid period bounds']);
    const durationDays = (end - start) / 86_400_000;
    const annualPeriod = input.annual.includes(period);
    if (annualPeriod ? durationDays < 300 || durationDays > 400 : durationDays < 55 || durationDays > 120) {
      return unavailableEarnings('A financial reporting period has an unexpected duration.', ['period duration mismatch']);
    }
    const aligned = [period.netIncome, period.operatingIncome, period.operatingCashFlow, period.capitalExpenditure, period.stockBasedCompensation]
      .every(metric => Date.parse(metric.source.periodEnd) === end
        && Date.parse(metric.source.periodStart ?? '') === Date.parse(period.revenue.source.periodStart ?? ''));
    if (!aligned) return unavailableEarnings('Income, cash-flow, capex, or SBC periods do not align.', ['period mismatch']);
  }
  for (const periodSet of [annualPeriods, quarterlyPeriods]) {
    for (let index = 1; index < periodSet.length; index++) {
      const previousEnd = Date.parse(periodSet[index - 1].revenue.source.periodEnd);
      const currentStart = Date.parse(periodSet[index].revenue.source.periodStart ?? '');
      if (currentStart <= previousEnd) return unavailableEarnings('Reporting periods overlap or are out of order.', ['overlapping periods']);
    }
  }
  const annual = [...input.annual].sort((a, b) => Date.parse(a.revenue.source.periodEnd) - Date.parse(b.revenue.source.periodEnd));
  if (annual.some(period => period.revenue.value <= 0)) return unavailableEarnings('Annual revenue must be positive to calculate comparable growth.', ['nonpositive revenue']);
  const firstAnnual = annual[0].revenue.value;
  const lastAnnual = annual[annual.length - 1].revenue.value;
  const years = Math.max(1, (Date.parse(annual[annual.length - 1].revenue.source.periodEnd) - Date.parse(annual[0].revenue.source.periodEnd)) / (365.25 * 86_400_000));
  const revenueCagr = (lastAnnual / firstAnnual) ** (1 / years) - 1;
  const growth = revenueCagr < -0.2 ? 0 : revenueCagr < -0.05 ? 2 : revenueCagr < 0.02 ? 4 : revenueCagr < 0.08 ? 6 : revenueCagr < 0.15 ? 7 : revenueCagr < 0.3 ? 8 : 9;

  const quarterly = [...input.quarterly].sort((a, b) => Date.parse(a.revenue.source.periodEnd) - Date.parse(b.revenue.source.periodEnd));
  const recent = quarterly.slice(-4);
  const positiveOperatingQuarters = recent.filter(period => period.operatingIncome.value > 0).length;
  const operatingPersistence = rounded(positiveOperatingQuarters / 4 * 10, 2);
  const ttmNetIncome = recent.reduce((sum, period) => sum + period.netIncome.value, 0);
  const ttmCfo = recent.reduce((sum, period) => sum + period.operatingCashFlow.value, 0);
  const ttmCapex = recent.reduce((sum, period) => sum + Math.abs(period.capitalExpenditure.value), 0);
  const ttmSbc = recent.reduce((sum, period) => sum + Math.max(0, period.stockBasedCompensation.value), 0);
  const ttmRevenue = recent.reduce((sum, period) => sum + period.revenue.value, 0);
  if (!(ttmRevenue > 0)) return unavailableEarnings('Recent TTM revenue is not positive.', ['nonpositive TTM revenue']);
  const cashConversionRatio = ttmNetIncome > 0 ? (ttmCfo - ttmCapex) / ttmNetIncome : null;
  const cashConversion = cashConversionRatio == null ? (ttmCfo - ttmCapex) > 0 ? 5 : 1
    : cashConversionRatio < 0 ? 0 : cashConversionRatio < 0.5 ? 2 : cashConversionRatio < 0.8 ? 4 : cashConversionRatio < 1 ? 6 : cashConversionRatio < 1.25 ? 8 : 10;
  const sbcRatio = ttmSbc / ttmRevenue;
  const sbcBurden = sbcRatio < 0.01 ? 10 : sbcRatio < 0.03 ? 8 : sbcRatio < 0.06 ? 6 : sbcRatio < 0.1 ? 3 : 0;
  // These are disclosed analyst judgments because filing tags do not decide
  // whether an adjustment is recurring or economically credible. Both are
  // independently scored and linked to the primary filing evidence.
  const accountingTransparency = validDisclosureReviews.length
    ? rounded(validDisclosureReviews.reduce((sum, review) => sum + review.score, 0) / validDisclosureReviews.length, 2)
    : undefined;
  const knownWeight = 0.85 + (accountingTransparency === undefined ? 0 : 0.15);
  const evidencedWeightedScore = growth * 0.2 + cashConversion * 0.25 + operatingPersistence * 0.2 + sbcBurden * 0.2
    + (accountingTransparency ?? 0) * 0.15;
  const score = rounded(evidencedWeightedScore / knownWeight, 2);
  return {
    score,
    coveragePct: rounded(knownWeight * 100, 2),
    rationale: `Three-year revenue CAGR ${(revenueCagr * 100).toFixed(1)}%; recent TTM FCF/net-income ${cashConversionRatio == null ? 'not meaningful because net income is nonpositive' : `${(cashConversionRatio * 100).toFixed(1)}%`}; positive operating income ${positiveOperatingQuarters}/4 recent quarters; SBC/revenue ${(sbcRatio * 100).toFixed(1)}%; ${accountingTransparency === undefined ? 'GAAP/non-GAAP and one-off reviews remain unscored' : `source-reviewed adjustment quality ${accountingTransparency}/10`}.`,
    sources: [...allMetrics.map(metric => metric.source), ...validDisclosureReviews.flatMap(review => review.sources)],
    // The adjustment review contains analyst judgments, so a fully sourced
    // automated ratio series alone can never promote this factor to high.
    confidence: 'medium',
    subScores: { growth, cashConversion, operatingPersistence, sbcBurden, ...(accountingTransparency === undefined ? {} : { accountingTransparency }) },
    calculation: {
      rubricId: 'earnings-quality-v1',
      inputs: [
        { name: 'annual-period-count', value: input.annual.length }, { name: 'quarter-period-count', value: input.quarterly.length },
        { name: 'revenue-cagr', value: rounded(revenueCagr), unit: 'ratio' },
        { name: 'ttm-net-income', value: rounded(ttmNetIncome) }, { name: 'ttm-operating-cash-flow', value: rounded(ttmCfo) },
        { name: 'ttm-capex', value: rounded(ttmCapex) }, { name: 'ttm-free-cash-flow', value: rounded(ttmCfo - ttmCapex) },
        { name: 'ttm-sbc-revenue-ratio', value: rounded(sbcRatio), unit: 'ratio' },
        { name: 'quarterly-persistence-count', value: positiveOperatingQuarters },
        { name: 'disclosure-review-coverage', value: `${validDisclosureReviews.length}/2` },
        ...validDisclosureReviews.map((review, index) => ({ name: `disclosure-review-${index + 1}-score`, value: review.score, unit: 'out-of-10' })),
      ],
    },
  };
}

/** Full factor score; missing accounting review keeps the factor unscored. */
export function scoreEarningsQuality(input: EarningsQualityAssessment): EarningsQualityScore {
  return scoreEarningsQualityCore(input, false);
}

/**
 * Quantitative earnings-quality subtotal for the fixed-weight research queue.
 * The 85% numeric portion can be shown when statements are complete; the
 * 15% disclosure-review portion stays uncovered until a real review exists.
 */
export function scoreEarningsQualityPartial(input: EarningsQualityAssessment): EarningsQualityScore {
  return scoreEarningsQualityCore(input, true);
}

/**
 * Evidence-weighted catalyst score. The full search log is required so an
 * empty event list means "searched, none found" rather than "not fetched".
 * Event categories are never treated as equivalent: nonbinding and unverified
 * items cannot produce a strong score.
 */
export function scoreCatalysts(input: CatalystAssessment): CatalystScore {
  if (!Number.isFinite(Date.parse(input.asOf)) || !Number.isInteger(input.horizonMonths) || input.horizonMonths < 1 || input.horizonMonths > 120) {
    return unavailableCatalysts('A valid as-of date and investment horizon are required.');
  }
  const searchSources = input.searchSources.filter(source => isOpportunityProvenanceValid(source, input.asOf));
  if (!input.searchCompleted || searchSources.length === 0) return unavailableCatalysts('A documented dated primary-source catalyst search is required before scoring.');

  const horizonEnd = Date.parse(input.asOf) + input.horizonMonths * 30.4375 * 86_400_000;
  const seen = new Set<string>();
  const relevant: Array<{ event: CatalystEvent; score: number; timing: number; materiality: number; certainty: number; pricing: number }> = [];
  const conflicts: string[] = [];
  for (const event of input.events) {
    if (!event.id.trim() || seen.has(event.id)) { conflicts.push('duplicate or empty catalyst identity'); continue; }
    seen.add(event.id);
    if (!event.title.trim() || !Number.isFinite(Date.parse(event.announcedAt)) || !Number.isFinite(Date.parse(event.expectedAt))
      || Date.parse(event.announcedAt) > Date.parse(input.asOf) || Date.parse(event.expectedAt) < Date.parse(input.asOf)
      || !isOpportunityProvenanceValid(event.source, input.asOf)) {
      conflicts.push(`invalid, future, expired, or unsourced catalyst: ${event.id}`);
      continue;
    }
    if (Date.parse(event.expectedAt) > horizonEnd) continue;

    const certaintyByClass: Record<CatalystClassification, number> = {
      'realized-revenue': 9, 'binding-contract': 8, 'funded-conditional': 6,
      regulatory: 5, operational: 5, 'customer-expansion': 6, guidance: 4,
      'non-binding': 2, unverified: 0,
    };
    if (!Object.hasOwn(certaintyByClass, event.classification)
      || !['not-priced', 'partly-priced', 'priced', 'unknown'].includes(event.marketPricing)
      || !Array.isArray(event.conditions) || event.conditions.some(condition => typeof condition !== 'string' || !condition.trim())
      || typeof event.progressVerified !== 'boolean') {
      conflicts.push(`invalid catalyst classification or review fields: ${event.id}`);
      continue;
    }
    let certainty = certaintyByClass[event.classification];
    if (!event.progressVerified) certainty = Math.min(certainty, 4);
    if (event.conditions.length > 0) certainty = Math.max(0, certainty - Math.min(3, event.conditions.length));

    // Missing economics earns no impact credit. Units, not the magnitude of
    // the number, distinguish a fraction from a percentage.
    let materiality = 0;
    if (event.impactAsPctTtmRevenue) {
      const impact = event.impactAsPctTtmRevenue;
      const unit = impact.unit.trim().toLowerCase();
      const ratio = ['ratio-of-ttm-revenue', 'fraction-of-ttm-revenue'].includes(unit) ? impact.value
        : ['percent-of-ttm-revenue', '%-of-ttm-revenue'].includes(unit) ? impact.value / 100 : null;
      if (ratio === null || !Number.isFinite(ratio) || ratio < 0
        || !isOpportunityProvenanceValid(impact.source, input.asOf)) {
        conflicts.push(`invalid or unauditable catalyst materiality: ${event.id}`);
        continue;
      }
      materiality = ratio === 0 ? 0 : ratio < 0.01 ? 1 : ratio < 0.05 ? 3 : ratio < 0.1 ? 5 : ratio < 0.25 ? 7 : ratio < 0.5 ? 8 : 9;
    }
    const daysToEvent = (Date.parse(event.expectedAt) - Date.parse(input.asOf)) / 86_400_000;
    const timing = daysToEvent <= 30 ? 9 : daysToEvent <= 90 ? 8 : daysToEvent <= 180 ? 7 : 5;
    const pricing = event.marketPricing === 'not-priced' ? 9 : event.marketPricing === 'partly-priced' ? 6 : event.marketPricing === 'priced' ? 2 : 3;
    const rawScore = certainty * 0.4 + materiality * 0.3 + timing * 0.2 + pricing * 0.1;
    const statusCeiling: Partial<Record<CatalystClassification, number>> = { 'non-binding': 3, unverified: 1, guidance: 5 };
    const score = rounded(Math.min(rawScore, statusCeiling[event.classification] ?? 10), 2);
    relevant.push({ event, score, timing, materiality, certainty, pricing });
  }
  if (conflicts.length) return unavailableCatalysts('One or more catalyst records conflict or lack auditable evidence; reconcile before scoring.', conflicts);

  const sources = [...searchSources, ...relevant.flatMap(item => [item.event.source, ...(item.event.impactAsPctTtmRevenue ? [item.event.impactAsPctTtmRevenue.source] : [])])];
  // A documented empty search earns at most 1/10. It is distinct from missing
  // search coverage, which returns null above.
  // Events often describe the same economics. Until independence is reviewed,
  // additional announcements cannot multiply impact or breach status ceilings.
  const score = relevant.length === 0 ? 1 : Math.max(...relevant.map(item => item.score));
  const confidence: CatalystScore['confidence'] = relevant.length > 0 && relevant.every(item => item.certainty >= 7 && item.event.marketPricing !== 'unknown' && !!item.event.impactAsPctTtmRevenue) ? 'high'
    : relevant.length > 0 ? 'medium' : 'medium';
  return {
    score,
    rationale: relevant.length ? `${relevant.length} dated catalyst(s) within ${input.horizonMonths} months; binding status, verified progress, disclosed conditions, revenue materiality, timing, and pricing-in were scored separately.` : `No verified company-specific catalyst was found within ${input.horizonMonths} months after a documented search; score is 1/10.`,
    sources,
    confidence,
    eventScores: relevant.map(item => ({ id: item.event.id, score: item.score, rationale: `certainty ${item.certainty}/10; materiality ${item.materiality}/10; timing ${item.timing}/10; pricing-in ${item.pricing}/10` })),
    calculation: {
      rubricId: 'catalysts-v2-explicit-units',
      inputs: [
        { name: 'event-aggregation', value: 'strongest independently scored event; no announcement-count bonus' },
        { name: 'horizon-months', value: input.horizonMonths },
        { name: 'documented-search', value: 1 },
        { name: 'in-horizon-events', value: relevant.length },
        ...relevant.flatMap(item => [
          { name: `event:${item.event.id}:classification`, value: item.event.classification },
          { name: `event:${item.event.id}:score`, value: item.score },
          { name: `event:${item.event.id}:expected-at`, value: item.event.expectedAt },
          { name: `event:${item.event.id}:market-pricing`, value: item.event.marketPricing },
          { name: `event:${item.event.id}:certainty`, value: item.certainty },
          { name: `event:${item.event.id}:materiality`, value: item.materiality },
          { name: `event:${item.event.id}:timing`, value: item.timing },
          { name: `event:${item.event.id}:pricing`, value: item.pricing },
          ...(item.event.impactAsPctTtmRevenue ? [{ name: `event:${item.event.id}:impact`, value: item.event.impactAsPctTtmRevenue.value, unit: item.event.impactAsPctTtmRevenue.unit }] : []),
        ]),
      ],
    },
  };
}

/**
 * Conservative industrial-company solvency rubric. It deliberately declines
 * to score banks/insurers until their regulatory-capital modules are supplied.
 * Maturity coverage uses unrestricted cash only; undrawn facilities are never
 * assumed to exist.
 */
export function scoreFinancialStrength(input: FinancialStrengthAssessment): FinancialStrengthScore {
  if (input.industryModel !== 'industrial-operating-company') return unavailableFinancial('This solvency formula is not suitable for this industry; use its capital/asset-quality model.');
  const metrics = [input.unrestrictedCash, input.totalDebt, input.freeCashFlowTtm, input.operatingIncomeTtm, input.interestExpenseTtm, input.debtDueWithin24Months];
  if (!Number.isFinite(Date.parse(input.asOf)) || metrics.some(metric => !metric || !Number.isFinite(metric.value) || !metric.unit || !isOpportunityProvenanceValid(metric.source, input.asOf))) {
    return unavailableFinancial('Dated unrestricted-cash, debt, TTM cash-flow, operating-income, interest, and maturity evidence is required.');
  }
  if (metrics.some(metric => metric.value < 0 && metric !== input.freeCashFlowTtm && metric !== input.operatingIncomeTtm)) {
    return unavailableFinancial('Cash, debt, interest expense, and scheduled maturities cannot be negative.', ['negative balance-sheet liability or cash conflict']);
  }
  if (new Set(metrics.map(metric => metric.unit.toUpperCase())).size !== 1) {
    return unavailableFinancial('Financial inputs use different currencies or units.', ['currency/unit mismatch']);
  }
  if (!solvencyBalanceAligned(input.unrestrictedCash, input.totalDebt, input.debtDueWithin24Months)
    || !solvencyAnnualFlowAligned(input.freeCashFlowTtm, input.operatingIncomeTtm, input.interestExpenseTtm)
    || !solvencySameEndScope(input.unrestrictedCash, input.freeCashFlowTtm)) {
    return unavailableFinancial('Solvency requires aligned annual/TTM flow windows, instant balance dates, currencies and consolidated scope.', ['solvency period/scope mismatch']);
  }
  const latestPeriod = Math.min(...metrics.map(metric => Date.parse(metric.source.periodEnd)));
  const periodAgeDays = (Date.parse(input.asOf) - latestPeriod) / 86_400_000;
  if (periodAgeDays < 0 || periodAgeDays > 400) return unavailableFinancial('The financial evidence is older than the 400-day freshness limit.');

  const cash = input.unrestrictedCash.value;
  const debt = input.totalDebt.value;
  const fcf = input.freeCashFlowTtm.value;
  const opIncome = input.operatingIncomeTtm.value;
  const interest = input.interestExpenseTtm.value;
  const maturities = input.debtDueWithin24Months.value;
  const runwayMonths = fcf >= 0 ? Number.POSITIVE_INFINITY : cash / (-fcf / 12);
  const cashRunway = fcf >= 0 ? 10 : runwayMonths < 6 ? 0 : runwayMonths < 12 ? 3 : runwayMonths < 18 ? 5 : runwayMonths < 24 ? 6 : runwayMonths < 36 ? 8 : 9;
  let interestCoverage: number;
  if (debt === 0 && interest === 0) interestCoverage = 10;
  else if (interest <= 0) return unavailableFinancial('Debt is reported without a usable positive interest-expense denominator.', ['interest coverage cannot be calculated']);
  else {
    const ratio = opIncome / interest;
    interestCoverage = ratio < 1 ? 0 : ratio < 1.5 ? 2 : ratio < 2 ? 4 : ratio < 4 ? 6 : ratio < 8 ? 8 : 10;
  }
  const maturityCoverage = maturities === 0 ? 10
    : cash / maturities < 0.5 ? 0
      : cash / maturities < 1 ? 3
        : cash / maturities < 2 ? 6
          : cash / maturities < 3 ? 8 : 10;
  const score = rounded(cashRunway * 0.4 + interestCoverage * 0.3 + maturityCoverage * 0.3, 2);
  return {
    score,
    rationale: `Industrial solvency sub-scores: cash runway ${cashRunway}/10, interest coverage ${interestCoverage}/10, 24-month maturity coverage ${maturityCoverage}/10. Runway uses unrestricted cash divided by the negative TTM FCF burn; maturity coverage uses cash only.`,
    sources: metrics.map(metric => metric.source),
    confidence: metrics.every(metric => metric.source.confidence === 'high') ? 'high' : 'medium',
    subScores: { cashRunway, interestCoverage, maturityCoverage },
    calculation: {
      rubricId: 'financial-strength-industrial-v2-aligned',
      inputs: [
        { name: 'unrestricted-cash', value: cash, unit: input.unrestrictedCash.unit },
        { name: 'total-debt', value: debt, unit: input.totalDebt.unit },
        { name: 'ttm-free-cash-flow', value: fcf, unit: input.freeCashFlowTtm.unit },
        { name: 'ttm-operating-income', value: opIncome, unit: input.operatingIncomeTtm.unit },
        { name: 'ttm-interest-expense', value: interest, unit: input.interestExpenseTtm.unit },
        { name: 'debt-due-within-24-months', value: maturities, unit: input.debtDueWithin24Months.unit },
        { name: 'runway-months', value: Number.isFinite(runwayMonths) ? rounded(runwayMonths, 1) : 'positive TTM FCF' },
        { name: 'cash-interest-maturity-weights', value: '0.4/0.3/0.3' },
      ],
    },
  };
}

export type PartialFinancialStrengthAssessment = Pick<FinancialStrengthAssessment, 'asOf' | 'industryModel'>
  & Partial<Pick<FinancialStrengthAssessment, 'unrestrictedCash' | 'totalDebt' | 'freeCashFlowTtm' | 'operatingIncomeTtm' | 'interestExpenseTtm' | 'debtDueWithin24Months'>>;

function solvencyCurrency(metric: SourcedValue | undefined) {
  return !!metric && /^[A-Z]{3}$/.test(metric.unit) && metric.source.currency === metric.unit
    && (metric.source.scope ?? 'consolidated') === 'consolidated';
}
function solvencySameEndScope(...metrics: Array<SourcedValue | undefined>) {
  return metrics.every(solvencyCurrency) && new Set(metrics.map(metric => metric!.source.periodEnd)).size === 1
    && new Set(metrics.map(metric => metric!.source.scope ?? 'consolidated')).size === 1;
}
function solvencyBalanceAligned(...metrics: Array<SourcedValue | undefined>) {
  return metrics.every(solvencyCurrency) && compatibleFinancialSources(metrics.map(metric => metric?.source), 'balance');
}
function solvencyAnnualFlowAligned(...metrics: Array<SourcedValue | undefined>) {
  return metrics.every(solvencyCurrency) && compatibleFinancialSources(metrics.map(metric => metric?.source), 'flow')
    && metrics.every(metric => {
      const days = (Date.parse(metric!.source.periodEnd) - Date.parse(metric!.source.periodStart!)) / 86_400_000;
      return days >= 330 && days <= 380;
    });
}

/** Score only independently computable solvency dimensions; keep missing slices uncovered. */
export function scoreFinancialStrengthPartial(input: PartialFinancialStrengthAssessment): FinancialStrengthScore {
  if (input.industryModel !== 'industrial-operating-company' || !Number.isFinite(Date.parse(input.asOf))) {
    return unavailableFinancial('Verified industrial issuer model and valid as-of time are required for this diagnostic.');
  }
  const validMetric = (metric: SourcedValue | undefined) => !!metric && Number.isFinite(metric.value)
    && !!metric.unit && isOpportunityProvenanceValid(metric.source, input.asOf)
    && (Date.parse(input.asOf) - Date.parse(metric.source.periodEnd)) / 86_400_000 <= 400;
  const unitAligned = (...metrics: Array<SourcedValue | undefined>) => metrics.every(validMetric)
    && new Set(metrics.map(metric => metric!.unit.toUpperCase())).size === 1;
  const scores: Array<{ id: 'cashRunway' | 'interestCoverage' | 'maturityCoverage'; score: number; weight: number; metrics: SourcedValue[]; inputs: Array<{ name: string; value: string | number; unit?: string }> }> = [];
  const cash = input.unrestrictedCash, debt = input.totalDebt, fcf = input.freeCashFlowTtm;
  if (unitAligned(cash, fcf) && cash!.value >= 0 && solvencyBalanceAligned(cash)
    && solvencyAnnualFlowAligned(fcf) && solvencySameEndScope(cash, fcf)) {
    const runwayMonths = fcf!.value >= 0 ? Number.POSITIVE_INFINITY : cash!.value / (-fcf!.value / 12);
    const score = fcf!.value >= 0 ? 10 : runwayMonths < 6 ? 0 : runwayMonths < 12 ? 3 : runwayMonths < 18 ? 5 : runwayMonths < 24 ? 6 : runwayMonths < 36 ? 8 : 9;
    scores.push({ id: 'cashRunway', score, weight: 0.4, metrics: [cash!, fcf!], inputs: [
      { name: 'unrestricted-cash', value: cash!.value, unit: cash!.unit },
      { name: 'ttm-free-cash-flow', value: fcf!.value, unit: fcf!.unit },
      { name: 'cash-runway-months', value: Number.isFinite(runwayMonths) ? rounded(runwayMonths, 1) : 'positive TTM FCF' },
    ] });
  }
  const operating = input.operatingIncomeTtm, interest = input.interestExpenseTtm;
  if (unitAligned(debt, operating, interest) && debt!.value >= 0 && interest!.value >= 0
    && solvencyBalanceAligned(debt) && solvencyAnnualFlowAligned(operating, interest) && solvencySameEndScope(debt, operating)) {
    let score: number | null = null;
    if (debt!.value === 0 && interest!.value === 0) score = 10;
    else if (interest!.value > 0) { const ratio = operating!.value / interest!.value; score = ratio < 1 ? 0 : ratio < 1.5 ? 2 : ratio < 2 ? 4 : ratio < 4 ? 6 : ratio < 8 ? 8 : 10; }
    if (score !== null) scores.push({ id: 'interestCoverage', score, weight: 0.3, metrics: [debt!, operating!, interest!], inputs: [
      { name: 'total-debt', value: debt!.value, unit: debt!.unit },
      { name: 'ttm-operating-income', value: operating!.value, unit: operating!.unit },
      { name: 'ttm-interest-expense', value: interest!.value, unit: interest!.unit },
      { name: 'interest-coverage-ratio', value: interest!.value > 0 ? rounded(operating!.value / interest!.value, 3) : 'zero debt and zero interest reported' },
    ] });
  }
  const maturities = input.debtDueWithin24Months;
  if (unitAligned(cash, maturities) && cash!.value >= 0 && maturities!.value >= 0
    && solvencyBalanceAligned(cash, maturities)) {
    const ratio = maturities!.value === 0 ? Number.POSITIVE_INFINITY : cash!.value / maturities!.value;
    const score = maturities!.value === 0 ? 10 : ratio < 0.5 ? 0 : ratio < 1 ? 3 : ratio < 2 ? 6 : ratio < 3 ? 8 : 10;
    scores.push({ id: 'maturityCoverage', score, weight: 0.3, metrics: [cash!, maturities!], inputs: [
      { name: 'unrestricted-cash', value: cash!.value, unit: cash!.unit },
      { name: 'debt-due-within-24-months', value: maturities!.value, unit: maturities!.unit },
      { name: 'cash-to-maturity-coverage', value: Number.isFinite(ratio) ? rounded(ratio, 3) : 'no principal due within 24 months' },
    ] });
  }
  const coveredWeight = scores.reduce((sum, item) => sum + item.weight, 0);
  if (!coveredWeight) return unavailableFinancial('No complete source-validated solvency dimension is available; partial metrics are not treated as a score.');
  const score = rounded(scores.reduce((sum, item) => sum + item.score * item.weight, 0) / coveredWeight, 2);
  const sources = [...new Map(scores.flatMap(item => item.metrics.map(metric => [JSON.stringify(metric.source), metric.source] as const))).values()];
  const subScores = { cashRunway: 0, interestCoverage: 0, maturityCoverage: 0 };
  for (const item of scores) subScores[item.id] = item.score;
  return {
    score, coveragePct: rounded(coveredWeight * 100, 2),
    rationale: `Source-validated solvency dimensions: ${scores.map(item => `${item.id} ${item.score}/10`).join(', ')}. ${Math.round(coveredWeight * 100)}% of the financial-strength factor is evidenced; unavailable dimensions remain uncovered.`,
    sources, confidence: sources.every(source => source.confidence === 'high') ? 'high' : 'medium', subScores,
    calculation: { rubricId: 'financial-strength-industrial-partial-v2-aligned', inputs: [
      { name: 'covered-solvency-weight', value: rounded(coveredWeight, 2) },
      ...scores.flatMap(item => [...item.inputs, { name: `${item.id}-weight`, value: item.weight }]),
    ] },
  };
}

type UnitDimensions = Record<string, number>;
type EvaluatedFairValueExpression = { value: number; dimensions: UnitDimensions };

function unitDimensions(unit: string): UnitDimensions | null {
  const normalized = unit.trim().toLowerCase().replace(/\s+/g, '');
  if (!normalized || normalized === 'ratio' || normalized === 'dimensionless') return {};
  const parts = normalized.match(/[a-z][a-z0-9]*(?:\^-?\d+)?|[*/]/g);
  if (!parts || parts.join('') !== normalized || parts.length % 2 === 0
    || parts.some((part, index) => index % 2 === 0 ? part === '*' || part === '/' : part !== '*' && part !== '/')) return null;
  const dimensions: UnitDimensions = {};
  let sign = 1;
  for (const part of parts) {
    if (part === '*') { sign = 1; continue; }
    if (part === '/') { sign = -1; continue; }
    const match = /^([a-z][a-z0-9]*)(?:\^(-?\d+))?$/.exec(part);
    if (!match) return null;
    const dimension = match[1] === 'share' || match[1] === 'shares' ? 'shares' : match[1];
    const rawExponent = match[2] ? Number(match[2]) : 1;
    if (!Number.isInteger(rawExponent) || rawExponent === 0 || Math.abs(rawExponent) > 8) return null;
    const exponent = rawExponent * sign;
    dimensions[dimension] = (dimensions[dimension] ?? 0) + exponent;
    if (dimensions[dimension] === 0) delete dimensions[dimension];
    sign = 1;
  }
  return dimensions;
}

function sameDimensions(left: UnitDimensions, right: UnitDimensions) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every(key => (left[key] ?? 0) === (right[key] ?? 0));
}

function sourceCurrencyMatchesUnit(unit: string, source: Provenance) {
  const currency = /^([A-Z]{3})(?:\/|$)/i.exec(unit.trim())?.[1]?.toUpperCase();
  return !currency || source.currency?.toUpperCase() === currency;
}

function recentValuationSource(source: Provenance, asOf: string) {
  const ageDays = (Date.parse(asOf) - Date.parse(source.periodEnd)) / 86_400_000;
  return isOpportunityProvenanceValid(source, asOf) && Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= 400;
}

/** Recalculate a valuation method from dated assumptions and capital inputs. */
function evaluateFairValueExpression(
  expression: FairValueExpression,
  assumptions: FairValueMethod['assumptions'],
  capitalization: ValuationCapitalizationReview,
  asOf: string,
): EvaluatedFairValueExpression | null {
  let nodes = 0;
  const visit = (node: unknown, depth: number): EvaluatedFairValueExpression | null => {
    nodes++;
    if (nodes > 64 || depth > 16 || !node || typeof node !== 'object' || Array.isArray(node)) return null;
    const candidate = node as Record<string, unknown>;
    if (candidate.op === 'assumption' && typeof candidate.name === 'string') {
      const matches = assumptions.filter(item => item.name === candidate.name);
      if (matches.length !== 1 || typeof matches[0].value !== 'number' || !Number.isFinite(matches[0].value)
        || !matches[0].unit || !isOpportunityProvenanceValid(matches[0].source, asOf)
        || !sourceCurrencyMatchesUnit(matches[0].unit, matches[0].source)) return null;
      const dimensions = unitDimensions(matches[0].unit);
      return dimensions ? { value: matches[0].value, dimensions } : null;
    }
    if (candidate.op === 'capitalization' && typeof candidate.metric === 'string'
      && ['dilutedShares', 'unrestrictedCash', 'restrictedCash', 'totalDebt', 'leaseLiabilities'].includes(candidate.metric)) {
      const metric = capitalization[candidate.metric as keyof ValuationCapitalizationReview];
      if (!metric || typeof metric !== 'object' || !('value' in metric) || !('unit' in metric) || !('source' in metric)
        || !Number.isFinite(metric.value) || !isOpportunityProvenanceValid(metric.source, asOf)
        || !sourceCurrencyMatchesUnit(metric.unit, metric.source)) return null;
      const dimensions = unitDimensions(metric.unit);
      return dimensions ? { value: metric.value, dimensions } : null;
    }
    if (!['add', 'subtract', 'multiply', 'divide'].includes(String(candidate.op))) return null;
    const left = visit(candidate.left, depth + 1), right = visit(candidate.right, depth + 1);
    if (!left || !right) return null;
    if ((candidate.op === 'add' || candidate.op === 'subtract') && !sameDimensions(left.dimensions, right.dimensions)) return null;
    if (candidate.op === 'divide' && right.value === 0) return null;
    let dimensions: UnitDimensions;
    if (candidate.op === 'add' || candidate.op === 'subtract') dimensions = left.dimensions;
    else {
      dimensions = { ...left.dimensions };
      for (const [key, exponent] of Object.entries(right.dimensions)) {
        const adjusted = (dimensions[key] ?? 0) + (candidate.op === 'multiply' ? exponent : -exponent);
        if (adjusted === 0) delete dimensions[key]; else dimensions[key] = adjusted;
      }
    }
    const value = candidate.op === 'add' ? left.value + right.value
      : candidate.op === 'subtract' ? left.value - right.value
        : candidate.op === 'multiply' ? left.value * right.value : left.value / right.value;
    return Number.isFinite(value) ? { value, dimensions } : null;
  };
  return visit(expression, 0);
}

function recomputeFairValueScenario(
  scenario: FairValueScenarioCalculation | undefined,
  target: SourcedValue,
  capitalization: ValuationCapitalizationReview,
  asOf: string,
) {
  if (!scenario || !Array.isArray(scenario.assumptions) || scenario.assumptions.length === 0
    || typeof scenario.calculation?.formula !== 'string' || scenario.calculation.formula.trim().length < 12
    || typeof scenario.calculation.version !== 'string' || !scenario.calculation.version.trim()
    || typeof scenario.calculation.unit !== 'string'
    || !Number.isFinite(scenario.calculation.outputValue)
    || scenario.calculation.unit.toUpperCase() !== target.unit.toUpperCase()
    || new Set(scenario.assumptions.map(item => item.name)).size !== scenario.assumptions.length
    || scenario.assumptions.some(item => !item.name?.trim()
      || (typeof item.value === 'string' ? !item.value.trim() : !Number.isFinite(item.value))
      || !recentValuationSource(item.source, asOf)
      || (!!item.unit && !sourceCurrencyMatchesUnit(item.unit, item.source)))) return null;
  const calculated = evaluateFairValueExpression(scenario.calculation.expression, scenario.assumptions, capitalization, asOf);
  const expectedDimensions = unitDimensions(target.unit);
  if (!calculated || !expectedDimensions || !sameDimensions(calculated.dimensions, expectedDimensions)
    || Math.abs(calculated.value - target.value) > Math.max(0.01, target.value * 0.0001)
    || Math.abs(scenario.calculation.outputValue - calculated.value) > Math.max(0.01, calculated.value * 0.0001)) return null;
  return calculated;
}

/**
 * Reproducible valuation factor. It never uses analyst targets as valuation
 * methods and requires two distinct, industry-suitable sourced methods before
 * assigning a score. Absolute-value assumptions remain in the source model.
 */
export function scoreFairValue(input: FairValueAssessment): FairValueScore {
  const requiredValues = [input.currentPrice, input.conservativeValue, input.baseValue, input.optimisticValue];
  if (!Number.isFinite(Date.parse(input.asOf)) || requiredValues.some(item => !item || !finitePositive(item.value) || !item.unit || !isOpportunityProvenanceValid(item.source, input.asOf))) {
    return unavailable('Fair-value cases or current price lack positive, dated, auditable evidence.');
  }
  const units = new Set(requiredValues.map(item => item.unit.toUpperCase()));
  if (units.size !== 1) return unavailable('Fair-value scenarios and price use different currencies or units.', ['unit mismatch']);
  if (requiredValues.some(item => !sourceCurrencyMatchesUnit(item.unit, item.source))) {
    return unavailable('Fair-value source currency does not match its declared per-share unit.', ['source currency mismatch']);
  }
  if (marketWeekdayAge(input.currentPrice.source.periodEnd, input.asOf) > 3
    || marketWeekdayAge(input.currentPrice.source.availableAt, input.asOf) > 3) {
    return unavailable('Fair value requires a completed-session price no more than three market weekdays old.', ['stale valuation quote']);
  }
  if (requiredValues.slice(1).some(item => !recentValuationSource(item.source, input.asOf))) {
    return unavailable('Conservative, base, and optimistic fair-value cases require source-backed assumptions no more than 400 days old.', ['stale valuation scenario']);
  }

  const capital = input.capitalizationReview;
  const capitalValues = capital ? [capital.dilutedShares, capital.unrestrictedCash, capital.restrictedCash, capital.totalDebt, capital.leaseLiabilities] : [];
  const balanceDates = capital ? [capital.unrestrictedCash?.source?.periodEnd, capital.restrictedCash?.source?.periodEnd, capital.totalDebt?.source?.periodEnd, capital.leaseLiabilities?.source?.periodEnd] : [];
  const shareCountDate = capital?.dilutedShares?.source?.periodEnd;
  const balanceDate = capital?.unrestrictedCash?.source?.periodEnd;
  const shareCountAge = balanceDate && shareCountDate
    ? Math.abs(Date.parse(`${shareCountDate}T00:00:00Z`) - Date.parse(`${balanceDate}T00:00:00Z`)) / 86_400_000
    : Number.POSITIVE_INFINITY;
  const capitalValid = !!capital
    && !!capital.rationale?.trim()
    && capital.sources?.length > 0
    && capital.sources.every(source => recentValuationSource(source, input.asOf))
    && capitalValues.every(item => !!item && Number.isFinite(item.value) && item.value >= 0 && !!item.unit && isOpportunityProvenanceValid(item.source, input.asOf) && sourceCurrencyMatchesUnit(item.unit, item.source))
    && capital.dilutedShares?.value > 0
    && capital.dilutedShares?.unit.toLowerCase() === 'shares'
    && capitalValues.every(item => recentValuationSource(item.source, input.asOf))
    && balanceDates.every(date => !!date && date === balanceDate)
    && shareCountAge <= 90
    && new Set([capital.unrestrictedCash?.unit, capital.restrictedCash?.unit, capital.totalDebt?.unit, capital.leaseLiabilities?.unit].map(unit => unit?.toUpperCase())).size === 1;
  const normalizationValid = !!input.normalizationReview?.rationale?.trim()
    && input.normalizationReview.sources?.length > 0
    && input.normalizationReview.sources.every(source => recentValuationSource(source, input.asOf));
  if (!capitalValid || !normalizationValid) {
    return unavailable('Verified diluted shares, unrestricted and restricted cash, debt, lease liabilities, and sourced earnings/asset normalization review are required before per-share valuation can score.');
  }

  const conservativeCalculation = recomputeFairValueScenario(input.scenarioCalculations?.conservative, input.conservativeValue, capital!, input.asOf);
  const optimisticCalculation = recomputeFairValueScenario(input.scenarioCalculations?.optimistic, input.optimisticValue, capital!, input.asOf);
  if (!conservativeCalculation || !optimisticCalculation) {
    return unavailable('Conservative and optimistic fair-value cases each need a recent source-backed expression that recomputes to its stated per-share value.', ['scenario calculation missing or inconsistent']);
  }

  const methods = input.methods.filter(method => method.industryReview?.suitable === true
    && !!method.industryReview.rationale?.trim()
    && method.industryReview.sources?.length > 0
    && method.industryReview.sources.every(source => recentValuationSource(source, input.asOf))
    && method.explanation.trim().length > 0
    && finitePositive(method.valuePerShare.value)
    && method.valuePerShare.unit.toUpperCase() === input.currentPrice.unit.toUpperCase()
    && recentValuationSource(method.valuePerShare.source, input.asOf)
    && sourceCurrencyMatchesUnit(method.valuePerShare.unit, method.valuePerShare.source)
    && Array.isArray(method.assumptions) && method.assumptions.length >= 2
    && method.assumptions.every(assumption => !!assumption.name?.trim()
      && (typeof assumption.value === 'string' ? !!assumption.value.trim() : Number.isFinite(assumption.value))
      && recentValuationSource(assumption.source, input.asOf)
      && (!assumption.unit || sourceCurrencyMatchesUnit(assumption.unit, assumption.source)))
    && typeof method.calculation?.formula === 'string' && method.calculation.formula.trim().length >= 12
    && typeof method.calculation.version === 'string' && !!method.calculation.version.trim()
    && Number.isFinite(method.calculation.outputValue)
    && method.calculation.unit.toUpperCase() === method.valuePerShare.unit.toUpperCase()
    && Array.isArray(method.assumptions)
    && new Set(method.assumptions.map(assumption => assumption.name)).size === method.assumptions.length
    && (() => {
      const calculated = evaluateFairValueExpression(method.calculation.expression, method.assumptions, capital!, input.asOf);
      const expectedDimensions = unitDimensions(method.valuePerShare.unit);
      return !!calculated && !!expectedDimensions
        && sameDimensions(calculated.dimensions, expectedDimensions)
        && Math.abs(calculated.value - method.valuePerShare.value) <= Math.max(0.01, method.valuePerShare.value * 0.0001)
        && Math.abs(method.calculation.outputValue - calculated.value) <= Math.max(0.01, calculated.value * 0.0001);
    })());
  const distinctMethods = [...new Map(methods.map(method => [method.id, method])).values()];
  if (distinctMethods.length < 2) return unavailable('At least two distinct, industry-suitable valuation methods with dated sources are required.');
  const primaries = distinctMethods.filter(method => method.primary);
  if (primaries.length !== 1) return unavailable('Exactly one primary valuation method must be identified.');
  if (Math.abs(primaries[0].valuePerShare.value - input.baseValue.value) > Math.max(0.01, input.baseValue.value * 0.0001)) {
    return unavailable('The base fair-value case does not reconcile to the selected primary valuation method.', ['base case differs from primary method']);
  }

  const methodValues = distinctMethods.map(method => method.valuePerShare.value);
  const methodSpread = Math.max(...methodValues) / Math.min(...methodValues) - 1;
  if (methodSpread > 0.5) return unavailable('Independent valuation methods diverge by more than 50%; reconcile the model conflict before scoring.', ['valuation method spread exceeds 50%']);

  const { value: price } = input.currentPrice;
  const { value: base } = input.baseValue;
  if (input.conservativeValue.value > base || base > input.optimisticValue.value) {
    return unavailable('Conservative, base, and optimistic fair values are not ordered.', ['scenario order conflict']);
  }
  const marginOfSafety = base / price - 1;
  let score = marginOfSafety < -0.5 ? 0
    : marginOfSafety < -0.25 ? 1
      : marginOfSafety < 0 ? 2
        : marginOfSafety < 0.1 ? 3
          : marginOfSafety < 0.2 ? 5
            : marginOfSafety < 0.3 ? 7
              : marginOfSafety < 0.5 ? 8 : 9;

  if (input.conservativeValue.value < price) score = Math.min(score, 4);

  const sources = [...requiredValues.map(item => item.source),
    ...input.scenarioCalculations.conservative.assumptions.map(assumption => assumption.source),
    ...input.scenarioCalculations.optimistic.assumptions.map(assumption => assumption.source),
    ...distinctMethods.flatMap(method => [method.valuePerShare.source, ...method.industryReview.sources, ...method.assumptions.map(assumption => assumption.source)]),
    ...capitalValues.map(item => item.source), ...capital.sources, ...input.normalizationReview.sources];
  const confidence: FairValueScore['confidence'] = methodSpread <= 0.2 ? 'high' : 'medium';
  return {
    score,
    rationale: `Base-case margin of safety ${(marginOfSafety * 100).toFixed(1)}%; ${distinctMethods.length} suitable methods; spread ${(methodSpread * 100).toFixed(1)}%. Capitalization reconciliation and normalization are source-backed.${input.conservativeValue.value < price ? ' Score capped at 4 because conservative value is below the current price.' : ''}`,
    sources,
    confidence,
    marginOfSafety: rounded(marginOfSafety),
    methodSpread: rounded(methodSpread),
    calculation: {
      rubricId: 'fair-value-v3',
      inputs: [
        { name: 'current-price', value: price, unit: input.currentPrice.unit },
        { name: 'conservative-value', value: input.conservativeValue.value, unit: input.conservativeValue.unit },
        { name: 'base-value', value: base, unit: input.baseValue.unit },
        { name: 'optimistic-value', value: input.optimisticValue.value, unit: input.optimisticValue.unit },
        { name: 'primary-method-base-value-reconciled', value: primaries[0].valuePerShare.value, unit: primaries[0].valuePerShare.unit },
        { name: 'base-margin-of-safety', value: rounded(marginOfSafety), unit: 'ratio' },
        { name: 'distinct-method-count', value: distinctMethods.length },
        ...distinctMethods.flatMap(method => [
          { name: `method:${method.id}:formula`, value: `${method.calculation.version} · ${method.calculation.formula}` },
          { name: `method:${method.id}:expression`, value: JSON.stringify(method.calculation.expression) },
          { name: `method:${method.id}:recomputed-output`, value: evaluateFairValueExpression(method.calculation.expression, method.assumptions, capital, input.asOf)!.value, unit: method.calculation.unit },
          ...method.assumptions.map(assumption => ({
            name: `method:${method.id}:assumption:${assumption.name}`,
            value: assumption.value,
            ...(assumption.unit ? { unit: assumption.unit } : {}),
          })),
        ]),
        { name: 'method-spread', value: rounded(methodSpread), unit: 'ratio' },
        { name: 'scenario:conservative:formula', value: `${input.scenarioCalculations.conservative.calculation.version} · ${input.scenarioCalculations.conservative.calculation.formula}` },
        { name: 'scenario:conservative:expression', value: JSON.stringify(input.scenarioCalculations.conservative.calculation.expression) },
        { name: 'scenario:conservative:recomputed-output', value: conservativeCalculation.value, unit: input.scenarioCalculations.conservative.calculation.unit },
        ...input.scenarioCalculations.conservative.assumptions.map(assumption => ({ name: `scenario:conservative:assumption:${assumption.name}`, value: assumption.value, ...(assumption.unit ? { unit: assumption.unit } : {}) })),
        { name: 'scenario:optimistic:formula', value: `${input.scenarioCalculations.optimistic.calculation.version} · ${input.scenarioCalculations.optimistic.calculation.formula}` },
        { name: 'scenario:optimistic:expression', value: JSON.stringify(input.scenarioCalculations.optimistic.calculation.expression) },
        { name: 'scenario:optimistic:recomputed-output', value: optimisticCalculation.value, unit: input.scenarioCalculations.optimistic.calculation.unit },
        ...input.scenarioCalculations.optimistic.assumptions.map(assumption => ({ name: `scenario:optimistic:assumption:${assumption.name}`, value: assumption.value, ...(assumption.unit ? { unit: assumption.unit } : {}) })),
        { name: 'fully-diluted-shares', value: capital.dilutedShares.value, unit: capital.dilutedShares.unit },
        { name: 'unrestricted-cash', value: capital.unrestrictedCash.value, unit: capital.unrestrictedCash.unit },
        { name: 'restricted-cash', value: capital.restrictedCash.value, unit: capital.restrictedCash.unit },
        { name: 'total-debt', value: capital.totalDebt.value, unit: capital.totalDebt.unit },
        { name: 'lease-liabilities', value: capital.leaseLiabilities.value, unit: capital.leaseLiabilities.unit },
        { name: 'method-assumption-count', value: distinctMethods.reduce((count, method) => count + method.assumptions.length, 0) },
      ],
    },
  };
}
