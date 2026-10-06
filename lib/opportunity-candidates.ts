import type { Snapshot } from './engine';

type AnnualPeriod = NonNullable<Snapshot['opportunityResearch']>['earnings']['annual'][number];
type Metric = NonNullable<AnnualPeriod['metrics']['revenue']>;

export type OperatingCandidateSignals = {
  eligibleForOperatingQueue: boolean;
  hasVerifiedRevenue: boolean;
  annualEvidenceYears: number;
  profitableYears: number;
  yearsWithProfitEvidence: number;
  positiveFcfYears: number;
  yearsWithFcfEvidence: number;
  revenueGrowth: number | null;
  latestProfitMargin: number | null;
  latestFcfMargin: number | null;
};

// Annual-only SEC facts are normally 9–12 months behind. Anything older than
// this is too stale to drive even a research-priority order.
const MAX_ANNUAL_FACT_AGE_DAYS = 450;
const PLAUSIBLE_PROFIT_MARGIN_MIN = -1;
const PLAUSIBLE_PROFIT_MARGIN_MAX = 1;
const PLAUSIBLE_FCF_MARGIN_MIN = -3;
// Ratios outside these broad ranges can be real, but often reflect one-offs,
// working-capital reversals, extraordinary income, or an incompatible XBRL
// line. Keep the company visible and show the reported trend; withhold the
// outlier from automated ordering pending filing-level review.
const PLAUSIBLE_FCF_MARGIN_MAX = 1;
const MAX_ANNUAL_REVENUE_GROWTH = 1;

function validSecMetric(metric: Metric | undefined, asOf: string): metric is Metric {
  if (!metric || !Number.isFinite(metric.value) || !metric.unit || !metric.source) return false;
  const source = metric.source;
  let secUrl = false;
  try {
    const url = new URL(source.url ?? '');
    secUrl = url.protocol === 'https:' && url.hostname === 'data.sec.gov' && url.pathname.startsWith('/api/xbrl/companyfacts/CIK');
  } catch { /* malformed source */ }
  const cutoff = Date.parse(asOf);
  return source.source.startsWith('SEC Company Facts')
    && secUrl
    && source.rightsStatus === 'redistribution-permitted'
    && Number.isFinite(cutoff)
    && Number.isFinite(Date.parse(source.availableAt))
    && Number.isFinite(Date.parse(source.periodEnd))
    && Number.isFinite(Date.parse(source.retrievedAt))
    && Date.parse(source.availableAt) <= cutoff
    && Date.parse(source.periodEnd) <= cutoff
    && Date.parse(source.retrievedAt) <= cutoff;
}

/**
 * A research-order signal built only from dated, issuer-linked SEC annual
 * facts. It is intentionally not the fixed eight-factor investment score.
 */
export function operatingCandidateSignals(snapshot: Snapshot): OperatingCandidateSignals {
  if(snapshot.operatingSignals)return snapshot.operatingSignals;
  if ((snapshot.opportunityResearch?.earnings.conflicts?.length ?? 0) > 0
    || (snapshot.sourceConflicts?.length ?? 0) > 0) {
    return {
      eligibleForOperatingQueue: false, hasVerifiedRevenue: false,
      annualEvidenceYears: 0, profitableYears: 0, yearsWithProfitEvidence: 0,
      positiveFcfYears: 0, yearsWithFcfEvidence: 0,
      revenueGrowth: null, latestProfitMargin: null, latestFcfMargin: null,
    };
  }
  // The SEC adapter persists periods in ascending fiscal-end order; consume
  // that canonical array order, matching the indexed SQLite JSON expressions.
  const periods = [...(snapshot.opportunityResearch?.earnings.annual ?? [])].slice(-3);
  const valid = (period: AnnualPeriod, id: keyof AnnualPeriod['metrics']) => validSecMetric(period.metrics[id], snapshot.asOf);
  const ageDays = (period: AnnualPeriod) => (Date.parse(snapshot.asOf) - Date.parse(`${period.end}T00:00:00Z`)) / 86_400_000;
  const fresh = (period: AnnualPeriod) => Number.isFinite(ageDays(period)) && ageDays(period) >= 0 && ageDays(period) <= MAX_ANNUAL_FACT_AGE_DAYS;
  const reasonableProfit = (period: AnnualPeriod) => {
    const revenue = period.metrics.revenue, income = period.metrics.netIncome;
    if (!revenue || !income || revenue.value <= 0 || revenue.unit !== income.unit) return false;
    const margin = income.value / revenue.value;
    return Number.isFinite(margin) && margin >= PLAUSIBLE_PROFIT_MARGIN_MIN && margin <= PLAUSIBLE_PROFIT_MARGIN_MAX;
  };
  const reasonableFcf = (period: AnnualPeriod) => {
    const revenue = period.metrics.revenue, cashFlow = period.metrics.operatingCashFlow, capex = period.metrics.capitalExpenditure;
    if (!revenue || !cashFlow || !capex || revenue.value <= 0 || revenue.unit !== cashFlow.unit || cashFlow.unit !== capex.unit) return false;
    const margin = (cashFlow.value - Math.abs(capex.value)) / revenue.value;
    return Number.isFinite(margin) && margin >= PLAUSIBLE_FCF_MARGIN_MIN && margin <= PLAUSIBLE_FCF_MARGIN_MAX;
  };
  const comparable = periods.filter(period => reasonableProfit(period) && reasonableFcf(period)
    && valid(period, 'revenue') && valid(period, 'netIncome')
    && valid(period, 'operatingCashFlow') && valid(period, 'capitalExpenditure')
    && period.metrics.revenue!.unit === period.metrics.netIncome!.unit
    && period.metrics.revenue!.unit === period.metrics.operatingCashFlow!.unit
    && period.metrics.revenue!.unit === period.metrics.capitalExpenditure!.unit);
  const latest = periods.at(-1);
  const issuerModelVerified = snapshot.opportunityResearch?.financialStrength?.industryModel === 'industrial-operating-company';
  const latestRevenue = latest && fresh(latest) && valid(latest, 'revenue') ? latest.metrics.revenue : undefined;
  const latestIncome = latest && valid(latest, 'netIncome') ? latest.metrics.netIncome : undefined;
  const latestCashFlow = latest && valid(latest, 'operatingCashFlow') ? latest.metrics.operatingCashFlow : undefined;
  const latestCapex = latest && valid(latest, 'capitalExpenditure') ? latest.metrics.capitalExpenditure : undefined;
  const rawProfitMargin = latestRevenue && latestIncome && latestRevenue.value > 0
    && latestRevenue.unit === latestIncome.unit ? latestIncome.value / latestRevenue.value : null;
  const latestProfitMargin = rawProfitMargin !== null && rawProfitMargin >= PLAUSIBLE_PROFIT_MARGIN_MIN
    && rawProfitMargin <= PLAUSIBLE_PROFIT_MARGIN_MAX ? rawProfitMargin : null;
  const latestFcf = latestCashFlow && latestCapex && latestCashFlow.unit === latestCapex.unit
    ? latestCashFlow.value - Math.abs(latestCapex.value) : null;
  const rawFcfMargin = latestRevenue && latestFcf !== null && latestRevenue.value > 0
    && latestRevenue.unit === latestCashFlow?.unit ? latestFcf / latestRevenue.value : null;
  const latestFcfMargin = rawFcfMargin !== null && rawFcfMargin >= PLAUSIBLE_FCF_MARGIN_MIN
    && rawFcfMargin <= PLAUSIBLE_FCF_MARGIN_MAX ? rawFcfMargin : null;
  const revenues = periods.filter(period => valid(period, 'revenue') && period.metrics.revenue!.value > 0).map(period => period.metrics.revenue!);
  const lastRevenue = revenues.at(-1);
  const previousRevenue = revenues.at(-2);
  const rawRevenueGrowth = revenues.length >= 2 && previousRevenue!.value > 0
    && lastRevenue!.unit === previousRevenue!.unit
    ? lastRevenue!.value / previousRevenue!.value - 1 : null;
  const revenueGrowth = rawRevenueGrowth !== null && rawRevenueGrowth <= MAX_ANNUAL_REVENUE_GROWTH ? rawRevenueGrowth : null;
  const profitPeriods = periods.filter(period => valid(period, 'revenue') && valid(period, 'netIncome') && reasonableProfit(period));
  const fcfPeriods = periods.filter(period => valid(period, 'revenue') && period.metrics.revenue!.value > 0 && valid(period, 'operatingCashFlow') && valid(period, 'capitalExpenditure')
    && period.metrics.operatingCashFlow!.unit === period.metrics.capitalExpenditure!.unit);
  const eligibleForOperatingQueue = issuerModelVerified && !!latestRevenue && latestRevenue.value > 0 && latestProfitMargin !== null;
  return {
    eligibleForOperatingQueue,
    hasVerifiedRevenue: eligibleForOperatingQueue,
    annualEvidenceYears: comparable.length,
    profitableYears: profitPeriods.filter(period => period.metrics.netIncome!.value > 0).length,
    yearsWithProfitEvidence: profitPeriods.length,
    positiveFcfYears: fcfPeriods.filter(period => {
      const margin = (period.metrics.operatingCashFlow!.value - Math.abs(period.metrics.capitalExpenditure!.value)) / period.metrics.revenue!.value;
      return margin > 0 && margin <= PLAUSIBLE_FCF_MARGIN_MAX;
    }).length,
    yearsWithFcfEvidence: fcfPeriods.length,
    revenueGrowth: Number.isFinite(revenueGrowth) ? revenueGrowth : null,
    latestProfitMargin: Number.isFinite(latestProfitMargin) ? latestProfitMargin : null,
    latestFcfMargin: Number.isFinite(latestFcfMargin) ? latestFcfMargin : null,
  };
}

// SQLite evaluates the same visible research ordering before LIMIT/OFFSET, so
// page 2 continues the global order without loading the full universe in JS.
const metricValue = (period: number, metric: string) => `json_extract(payload,'$.opportunityResearch.earnings.annual[#-${period}].metrics.${metric}.value')`;
const metricUnit = (period: number, metric: string) => `json_extract(payload,'$.opportunityResearch.earnings.annual[#-${period}].metrics.${metric}.unit')`;
const metricSource = (period: number, metric: string, field: string) => `json_extract(payload,'$.opportunityResearch.earnings.annual[#-${period}].metrics.${metric}.source.${field}')`;
const periodEnd = (period: number) => `json_extract(payload,'$.opportunityResearch.earnings.annual[#-${period}].end')`;
const sourceIsUsable = (period: number, metric: string) => {
  const source = (field: string) => metricSource(period, metric, field);
  return `(${source('source')} LIKE 'SEC Company Facts%' AND ${source('url')} LIKE 'https://data.sec.gov/api/xbrl/companyfacts/CIK%' AND ${source('rightsStatus')}='redistribution-permitted' AND julianday(${source('availableAt')})<=julianday(json_extract(payload,'$.asOf')) AND julianday(${source('periodEnd')})<=julianday(json_extract(payload,'$.asOf')) AND julianday(${source('retrievedAt')})<=julianday(json_extract(payload,'$.asOf'))) `;
};

export function operatingCandidateOrderSql() {
  const periods = [1, 2, 3];
  const industryEligible = `json_extract(payload,'$.opportunityResearch.financialStrength.industryModel')='industrial-operating-company' AND COALESCE(json_array_length(payload,'$.opportunityResearch.earnings.conflicts'),0)=0 AND COALESCE(json_array_length(payload,'$.sourceConflicts'),0)=0`;
  const freshRevenue = (period: number) => `${sourceIsUsable(period, 'revenue')} AND ${metricValue(period, 'revenue')}>0 AND julianday(json_extract(payload,'$.asOf'))-julianday(${periodEnd(period)}) BETWEEN 0 AND ${MAX_ANNUAL_FACT_AGE_DAYS}`;
  const plausibleHistoricalProfit = (period: number) => `${sourceIsUsable(period, 'revenue')} AND ${sourceIsUsable(period, 'netIncome')} AND ${metricValue(period, 'revenue')}>0 AND ${metricUnit(period, 'netIncome')}=${metricUnit(period, 'revenue')} AND 1.0*${metricValue(period, 'netIncome')}/${metricValue(period, 'revenue')} BETWEEN ${PLAUSIBLE_PROFIT_MARGIN_MIN} AND ${PLAUSIBLE_PROFIT_MARGIN_MAX}`;
  const plausibleProfit = (period: number) => `${freshRevenue(period)} AND ${sourceIsUsable(period, 'netIncome')} AND ${metricUnit(period, 'netIncome')}=${metricUnit(period, 'revenue')} AND 1.0*${metricValue(period, 'netIncome')}/${metricValue(period, 'revenue')} BETWEEN ${PLAUSIBLE_PROFIT_MARGIN_MIN} AND ${PLAUSIBLE_PROFIT_MARGIN_MAX}`;
  const verifiedIncome = periods.map(period => sourceIsUsable(period, 'netIncome'));
  const positiveIncome = periods.map((period, index) => `CASE WHEN ${index === 0 ? plausibleProfit(period) : plausibleHistoricalProfit(period)} AND ${verifiedIncome[index]} AND ${metricValue(period, 'netIncome')}>0 THEN 1 ELSE 0 END`);
  const incomeCoverage = periods.map(period => `CASE WHEN ${sourceIsUsable(period, 'revenue')} AND ${sourceIsUsable(period, 'netIncome')} AND ${metricValue(period, 'revenue')}>0 AND ${metricUnit(period, 'netIncome')}=${metricUnit(period, 'revenue')} AND 1.0*${metricValue(period, 'netIncome')}/${metricValue(period, 'revenue')} BETWEEN ${PLAUSIBLE_PROFIT_MARGIN_MIN} AND ${PLAUSIBLE_PROFIT_MARGIN_MAX} THEN 1 ELSE 0 END`);
  const verifiedFcf = periods.map(period => `(${sourceIsUsable(period, 'operatingCashFlow')} AND ${sourceIsUsable(period, 'capitalExpenditure')})`);
  const fcfMargin = (period: number) => `1.0*(${metricValue(period, 'operatingCashFlow')}-abs(${metricValue(period, 'capitalExpenditure')}))/${metricValue(period, 'revenue')}`;
  const plausibleHistoricalFcf = (period: number) => `${sourceIsUsable(period, 'revenue')} AND ${verifiedFcf[periods.indexOf(period)]} AND ${metricValue(period, 'revenue')}>0 AND ${metricUnit(period, 'operatingCashFlow')}=${metricUnit(period, 'capitalExpenditure')} AND ${metricUnit(period, 'operatingCashFlow')}=${metricUnit(period, 'revenue')} AND ${fcfMargin(period)} BETWEEN ${PLAUSIBLE_FCF_MARGIN_MIN} AND ${PLAUSIBLE_FCF_MARGIN_MAX}`;
  const plausibleFcf = (period: number) => `${freshRevenue(period)} AND ${verifiedFcf[periods.indexOf(period)]} AND ${metricUnit(period, 'operatingCashFlow')}=${metricUnit(period, 'capitalExpenditure')} AND ${metricUnit(period, 'operatingCashFlow')}=${metricUnit(period, 'revenue')} AND ${fcfMargin(period)} BETWEEN ${PLAUSIBLE_FCF_MARGIN_MIN} AND ${PLAUSIBLE_FCF_MARGIN_MAX}`;
  const positiveFcf = periods.map((period, index) => `CASE WHEN ${index === 0 ? plausibleFcf(period) : plausibleHistoricalFcf(period)} AND ${fcfMargin(period)}>0 THEN 1 ELSE 0 END`);
  const fcfCoverage = periods.map(period => `CASE WHEN ${plausibleHistoricalFcf(period)} THEN 1 ELSE 0 END`);
  const currentRevenue = metricValue(1, 'revenue'), priorRevenue = metricValue(2, 'revenue');
  const currentRevenueValid = freshRevenue(1), priorRevenueValid = sourceIsUsable(2, 'revenue');
  const currentIncome = metricValue(1, 'netIncome');
  const growth = `1.0*${currentRevenue}/${priorRevenue}-1`;
  return `CASE WHEN ${industryEligible} AND ${plausibleProfit(1)} THEN 1 ELSE 0 END DESC,
    CASE WHEN ${industryEligible} THEN (${positiveFcf.join('+')}) ELSE 0 END DESC,
    CASE WHEN ${industryEligible} THEN (${positiveIncome.join('+')}) ELSE 0 END DESC,
    CASE WHEN ${industryEligible} THEN (${incomeCoverage.join('+')})+(${fcfCoverage.join('+')}) ELSE 0 END DESC,
    CASE WHEN ${industryEligible} AND ${currentRevenueValid} AND ${priorRevenueValid} AND ${metricUnit(1, 'revenue')}=${metricUnit(2, 'revenue')} AND ${currentRevenue}>0 AND ${priorRevenue}>0 AND ${growth}<=${MAX_ANNUAL_REVENUE_GROWTH} THEN ${growth} END DESC,
    CASE WHEN ${industryEligible} AND ${plausibleFcf(1)} THEN ${fcfMargin(1)} END DESC,
    CASE WHEN ${industryEligible} AND ${plausibleProfit(1)} THEN 1.0*${currentIncome}/${currentRevenue} END DESC,
    symbol ASC`;
}
