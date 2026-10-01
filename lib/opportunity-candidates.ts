import type { Snapshot } from './engine';

type AnnualPeriod = NonNullable<Snapshot['opportunityResearch']>['earnings']['annual'][number];
type Metric = NonNullable<AnnualPeriod['metrics']['revenue']>;

export type OperatingCandidateSignals = {
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
  // The SEC adapter persists periods in ascending fiscal-end order; consume
  // that canonical array order, matching the indexed SQLite JSON expressions.
  const periods = [...(snapshot.opportunityResearch?.earnings.annual ?? [])].slice(-3);
  const valid = (period: AnnualPeriod, id: keyof AnnualPeriod['metrics']) => validSecMetric(period.metrics[id], snapshot.asOf);
  const comparable = periods.filter(period => valid(period, 'revenue') && valid(period, 'netIncome')
    && valid(period, 'operatingCashFlow') && valid(period, 'capitalExpenditure')
    && period.metrics.revenue!.unit === period.metrics.netIncome!.unit
    && period.metrics.revenue!.unit === period.metrics.operatingCashFlow!.unit
    && period.metrics.revenue!.unit === period.metrics.capitalExpenditure!.unit);
  const latest = periods.at(-1);
  const latestRevenue = latest && valid(latest, 'revenue') ? latest.metrics.revenue : undefined;
  const latestIncome = latest && valid(latest, 'netIncome') ? latest.metrics.netIncome : undefined;
  const latestCashFlow = latest && valid(latest, 'operatingCashFlow') ? latest.metrics.operatingCashFlow : undefined;
  const latestCapex = latest && valid(latest, 'capitalExpenditure') ? latest.metrics.capitalExpenditure : undefined;
  const latestProfitMargin = latestRevenue && latestIncome && latestRevenue.value > 0
    && latestRevenue.unit === latestIncome.unit ? latestIncome.value / latestRevenue.value : null;
  const latestFcf = latestCashFlow && latestCapex && latestCashFlow.unit === latestCapex.unit
    ? latestCashFlow.value - Math.abs(latestCapex.value) : null;
  const latestFcfMargin = latestRevenue && latestFcf !== null && latestRevenue.value > 0
    && latestRevenue.unit === latestCashFlow?.unit ? latestFcf / latestRevenue.value : null;
  const revenues = periods.filter(period => valid(period, 'revenue')).map(period => period.metrics.revenue!);
  const lastRevenue = revenues.at(-1);
  const previousRevenue = revenues.at(-2);
  const revenueGrowth = revenues.length >= 2 && previousRevenue!.value > 0
    && lastRevenue!.unit === previousRevenue!.unit
    ? lastRevenue!.value / previousRevenue!.value - 1 : null;
  const profitPeriods = periods.filter(period => valid(period, 'netIncome'));
  const fcfPeriods = periods.filter(period => valid(period, 'operatingCashFlow') && valid(period, 'capitalExpenditure')
    && period.metrics.operatingCashFlow!.unit === period.metrics.capitalExpenditure!.unit);
  return {
    hasVerifiedRevenue: !!latestRevenue && latestRevenue.value > 0,
    annualEvidenceYears: comparable.length,
    profitableYears: profitPeriods.filter(period => period.metrics.netIncome!.value > 0).length,
    yearsWithProfitEvidence: profitPeriods.length,
    positiveFcfYears: fcfPeriods.filter(period => period.metrics.operatingCashFlow!.value - Math.abs(period.metrics.capitalExpenditure!.value) > 0).length,
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
const sourceIsUsable = (period: number, metric: string) => {
  const source = (field: string) => metricSource(period, metric, field);
  return `(${source('source')} LIKE 'SEC Company Facts%' AND ${source('url')} LIKE 'https://data.sec.gov/api/xbrl/companyfacts/CIK%' AND ${source('rightsStatus')}='redistribution-permitted' AND julianday(${source('availableAt')})<=julianday(json_extract(payload,'$.asOf')) AND julianday(${source('periodEnd')})<=julianday(json_extract(payload,'$.asOf')) AND julianday(${source('retrievedAt')})<=julianday(json_extract(payload,'$.asOf'))) `;
};

export function operatingCandidateOrderSql() {
  const periods = [1, 2, 3];
  const verifiedIncome = periods.map(period => sourceIsUsable(period, 'netIncome'));
  const positiveIncome = periods.map((period, index) => `CASE WHEN ${verifiedIncome[index]} AND ${metricValue(period, 'netIncome')}>0 THEN 1 ELSE 0 END`);
  const incomeCoverage = verifiedIncome.map(valid => `CASE WHEN ${valid} THEN 1 ELSE 0 END`);
  const verifiedFcf = periods.map(period => sourceIsUsable(period, 'operatingCashFlow') && sourceIsUsable(period, 'capitalExpenditure'));
  const positiveFcf = periods.map((period, index) => `CASE WHEN ${verifiedFcf[index]} AND ${metricUnit(period, 'operatingCashFlow')}=${metricUnit(period, 'capitalExpenditure')} AND ${metricValue(period, 'operatingCashFlow')}-abs(${metricValue(period, 'capitalExpenditure')})>0 THEN 1 ELSE 0 END`);
  const fcfCoverage = verifiedFcf.map(valid => `CASE WHEN ${valid} THEN 1 ELSE 0 END`);
  const currentRevenue = metricValue(1, 'revenue'), priorRevenue = metricValue(2, 'revenue');
  const currentRevenueValid = sourceIsUsable(1, 'revenue'), priorRevenueValid = sourceIsUsable(2, 'revenue');
  const currentIncome = metricValue(1, 'netIncome');
  const currentCash = metricValue(1, 'operatingCashFlow'), currentCapex = metricValue(1, 'capitalExpenditure');
  return `CASE WHEN ${currentRevenueValid} AND ${currentRevenue}>0 THEN 1 ELSE 0 END DESC,
    CASE WHEN ${currentRevenueValid} AND ${sourceIsUsable(1, 'netIncome')} AND ${metricUnit(1, 'netIncome')}=${metricUnit(1, 'revenue')} AND ${currentRevenue}>0 THEN 1.0*${currentIncome}/${currentRevenue} END DESC,
    CASE WHEN ${sourceIsUsable(1, 'operatingCashFlow')} AND ${sourceIsUsable(1, 'capitalExpenditure')} AND ${metricUnit(1, 'operatingCashFlow')}=${metricUnit(1, 'capitalExpenditure')} AND ${metricUnit(1, 'operatingCashFlow')}=${metricUnit(1, 'revenue')} AND ${currentRevenueValid} AND ${currentRevenue}>0 THEN 1.0*(${currentCash}-abs(${currentCapex}))/${currentRevenue} END DESC,
    (${positiveIncome.join('+')}) DESC,
    (${positiveFcf.join('+')}) DESC,
    CASE WHEN ${currentRevenueValid} AND ${priorRevenueValid} AND ${metricUnit(1, 'revenue')}=${metricUnit(2, 'revenue')} AND ${currentRevenue}>0 AND ${priorRevenue}>0 THEN 1.0*${currentRevenue}/${priorRevenue}-1 END DESC,
    (${incomeCoverage.join('+')})+(${fcfCoverage.join('+')}) DESC,
    symbol ASC`;
}
