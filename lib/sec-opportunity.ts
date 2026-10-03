import type { Provenance } from './engine';
import type { EarningsPeriod, EarningsQualityAssessment, FinancialStrengthAssessment, SourcedValue } from './opportunity-scoring';
import { REVENUE_TAGS } from './sec';
import { isOpportunityProvenanceValid } from './opportunity-engine';

type SecRow = { start?: string; end?: string; val?: number; filed?: string; form?: string; accn?: string };
type FactRow = SecRow & { start: string; end: string; val: number; filed: string; form: string; tag: string; unit: string; priority: number };
type PeriodValue = { start: string; end: string; value: number; unit: string; filed: string; concept: string; tag: string; method: 'reported' | 'ytd-difference' | 'annual-less-ytd' };
type MetricId = keyof EarningsPeriod;
type FinancialMetricId = keyof Omit<FinancialStrengthAssessment, 'asOf' | 'industryModel'>;

export type SecIssuerModelClassification = {
  sic: number;
  sicDescription: string;
  industryModel?: 'industrial-operating-company';
  reason: string;
};

/**
 * SEC submissions metadata is the source of the issuer SIC. Only use the
 * generic operating-company solvency model for a validated, non-specialized
 * SIC group. Sector labels supplied by quote vendors are not classification
 * evidence. SIC alone still cannot prove every accounting nuance, so the
 * model remains deliberately unavailable for financials, utilities, real
 * estate, government and unclassified issuers.
 */
export function classifySecIssuerModel(payload: unknown, expectedCik: number): SecIssuerModelClassification | null {
  if (!payload || typeof payload !== 'object' || !Number.isSafeInteger(expectedCik) || expectedCik <= 0) return null;
  const record = payload as Record<string, unknown>;
  const cik = Number(record.cik);
  const sic = Number(record.sic);
  const sicDescription = typeof record.sicDescription === 'string' ? record.sicDescription.trim() : '';
  if (cik !== expectedCik || !Number.isInteger(sic) || sic <= 0 || sic > 9999 || !sicDescription) return null;
  const specialized = (sic >= 4900 && sic <= 4999)
    || (sic >= 6000 && sic <= 6999)
    || (sic >= 9000 && sic <= 9999);
  return specialized
    ? { sic, sicDescription, reason: 'SEC SIC identifies a specialized or non-operating balance-sheet group; the generic operating-company solvency formula is withheld.' }
    : { sic, sicDescription, industryModel: 'industrial-operating-company', reason: 'SEC SIC is outside the specialized financial, utility, real-estate and government groups excluded from the generic operating-company formula.' };
}

const METRICS: Record<MetricId, readonly string[]> = {
  revenue: REVENUE_TAGS,
  grossProfit: ['GrossProfit', 'GrossProfitLoss'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  operatingIncome: ['OperatingIncomeLoss', 'OperatingProfitLoss', 'ProfitLossFromOperatingActivities'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations', 'NetCashFlowsFromUsedInOperatingActivities', 'CashFlowsFromUsedInOperatingActivities'],
  capitalExpenditure: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquirePropertyPlantAndEquipmentContinuingOperations', 'PurchaseOfPropertyPlantAndEquipment', 'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'],
  stockBasedCompensation: ['ShareBasedCompensation', 'ShareBasedCompensationArrangementByShareBasedPaymentAwardEquityInstrumentsOtherThanOptionsTotalCompensationCostRecognizedInIncomeStatement', 'ExpenseFromSharebasedPaymentTransactionsWithEmployees', 'ExpenseFromSharebasedPaymentTransactionsInWhichGoodsOrServicesReceivedDidNotQualifyForRecognitionAsAssets', 'ExpenseFromEquitysettledSharebasedPaymentTransactionsInWhichGoodsOrServicesReceivedDidNotQualifyForRecognitionAsAssets'],
};
const REQUIRED_EARNINGS_METRICS: readonly MetricId[] = ['revenue', 'netIncome', 'operatingIncome', 'operatingCashFlow', 'capitalExpenditure', 'stockBasedCompensation'];
const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A']);
const INTERIM_FORMS = new Set(['10-Q', '10-Q/A', '6-K', '6-K/A']);

export type EarningsDisclosureReview = { score: number; rationale: string; sources: Provenance[] };
export type SecCompanyFactsStatus = 'retrieved' | 'unavailable' | 'empty' | 'invalid';
const MAX_REVENUE_PERIOD_AGE_DAYS = 210;

/** Validate the issuer identity and standard-fact payload before calling SEC data retrieved. */
export function classifySecCompanyFacts(payload: unknown, expectedCik: number): Exclude<SecCompanyFactsStatus, 'unavailable'> {
  if (!Number.isSafeInteger(expectedCik) || expectedCik <= 0 || !payload || typeof payload !== 'object' || Array.isArray(payload)) return 'invalid';
  const record = payload as { cik?: unknown; facts?: unknown };
  const responseCik = typeof record.cik === 'number' && Number.isSafeInteger(record.cik)
    ? record.cik
    : typeof record.cik === 'string' && /^\d{1,10}$/.test(record.cik) ? Number(record.cik) : null;
  if (responseCik !== expectedCik || !record.facts || typeof record.facts !== 'object' || Array.isArray(record.facts)) return 'invalid';
  const facts = record.facts as Record<string, unknown>;
  const hasUsableStandardFacts = ['us-gaap', 'ifrs-full'].some(namespace => {
    const concepts = facts[namespace];
    if (!concepts || typeof concepts !== 'object' || Array.isArray(concepts)) return false;
    return Object.values(concepts).some((concept: any) => concept?.units && typeof concept.units === 'object'
      && Object.values(concept.units).some((rows: any) => Array.isArray(rows)
        && rows.some((row: any) => row && typeof row === 'object' && Number.isFinite(row.val) && validDate(row.end))));
  });
  return hasUsableStandardFacts ? 'retrieved' : 'empty';
}

export type SecEarningsBuild = {
  assessment?: EarningsQualityAssessment;
  coverage: { annualPeriodsFound: number; quarterlyPeriodsFound: number; selectedUnit: string };
  periods: {
    annual: Array<{ start: string; end: string; metrics: Partial<Record<MetricId, SourcedValue>> }>;
    quarterly: Array<{ start: string; end: string; metrics: Partial<Record<MetricId, SourcedValue>> }>;
  };
  missing: string[];
  conflicts: string[];
  limitations: string[];
};

export type SecFinancialStrengthBuild = {
  assessment?: FinancialStrengthAssessment;
  industryModel?: 'industrial-operating-company';
  metrics: Partial<Record<FinancialMetricId, SourcedValue>>;
  missing: string[];
  conflicts: string[];
  limitations: string[];
};

const validDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const daysBetween = (start: string, end: string) => (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

function collectRows(payload: any, tags: readonly string[], unit: string, asOf: string): FactRow[] {
  const rows: FactRow[] = [];
  for (const [priority, tag] of tags.entries()) {
    for (const namespace of ['us-gaap', 'ifrs-full']) {
      const facts = payload?.facts?.[namespace]?.[tag]?.units?.[unit];
      if (!Array.isArray(facts)) continue;
      for (const row of facts as SecRow[]) {
        if (!validDate(row.start) || !validDate(row.end) || !validDate(row.filed)
          || !Number.isFinite(row.val) || !row.form || !row.accn
          || Date.parse(row.end!) > Date.parse(asOf) || Date.parse(`${row.filed}T23:59:59Z`) > Date.parse(asOf)
          || Date.parse(row.start!) > Date.parse(row.end!)) continue;
        rows.push({ ...row, start: row.start!, end: row.end!, val: row.val!, filed: row.filed!, form: row.form!, tag, unit, priority });
      }
    }
  }
  return rows;
}

function deduplicate(rows: FactRow[], conflicts: string[], metric: MetricId): FactRow[] {
  const selected = new Map<string, FactRow>();
  for (const row of rows) {
    const key = `${row.tag}|${row.start}|${row.end}|${row.form}`;
    const previous = selected.get(key);
    if (!previous || row.filed > previous.filed || (row.filed === previous.filed && (row.accn ?? '') > (previous.accn ?? ''))) selected.set(key, row);
    else if (row.filed === previous.filed && row.accn === previous.accn && row.val !== previous.val) conflicts.push(`${metric}: conflicting values in accession ${row.accn} for ${row.start}..${row.end}`);
  }
  return [...selected.values()];
}

function metricPeriods(raw: FactRow[], conflicts: string[], metric: MetricId): PeriodValue[] {
  const rows = deduplicate(raw, conflicts, metric);
  const periods: PeriodValue[] = [];
  const add = (period: PeriodValue) => {
    if (daysBetween(period.start, period.end) >= 55 && daysBetween(period.start, period.end) <= 400) periods.push(period);
  };

  for (const row of rows) {
    const duration = daysBetween(row.start, row.end);
    if (ANNUAL_FORMS.has(row.form) && duration >= 300 && duration <= 400) {
      add({ start: row.start, end: row.end, value: row.val, unit: row.unit, filed: row.filed, concept: row.tag, tag: `${row.tag}:${row.accn}`, method: 'reported' });
    } else if (INTERIM_FORMS.has(row.form) && duration >= 55 && duration <= 120) {
      add({ start: row.start, end: row.end, value: row.val, unit: row.unit, filed: row.filed, concept: row.tag, tag: `${row.tag}:${row.accn}`, method: 'reported' });
    }
  }

  // Interim cash-flow and some income-statement facts are year-to-date. Convert
  // each cumulative report into a standalone quarter only against the same
  // concept, unit, fiscal-year start, and prior-period family.
  const cumulative = rows.filter(row => INTERIM_FORMS.has(row.form) && daysBetween(row.start, row.end) > 120 && daysBetween(row.start, row.end) < 330);
  const yearToDate = rows.filter(row => INTERIM_FORMS.has(row.form) && daysBetween(row.start, row.end) >= 55 && daysBetween(row.start, row.end) < 330);
  for (const current of cumulative) {
    const prior = yearToDate.filter(row => row.tag === current.tag && row.unit === current.unit && row.start === current.start && row.end < current.end)
      .sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed))[0];
    if (!prior) continue;
    const start = nextDay(prior.end);
    const duration = daysBetween(start, current.end);
    if (duration < 55 || duration > 120) continue;
    add({ start, end: current.end, value: current.val - prior.val, unit: current.unit, filed: current.filed > prior.filed ? current.filed : prior.filed, concept: current.tag, tag: `${current.tag}:${current.accn} minus ${prior.tag}:${prior.accn}`, method: 'ytd-difference' });
  }

  // Fiscal Q4 may only appear in the annual report. Derive it from the annual
  // total less the latest same-tag, same-unit, same-fiscal-year nine-month fact.
  const annualRows = rows.filter(row => ANNUAL_FORMS.has(row.form) && daysBetween(row.start, row.end) >= 300 && daysBetween(row.start, row.end) <= 400);
  for (const annual of annualRows) {
    const ytd = rows.filter(row => INTERIM_FORMS.has(row.form) && row.tag === annual.tag && row.unit === annual.unit && row.start === annual.start
      && row.end < annual.end && daysBetween(row.start, row.end) >= 200 && daysBetween(row.start, row.end) < 330)
      .sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed))[0];
    if (!ytd) continue;
    const start = nextDay(ytd.end);
    const duration = daysBetween(start, annual.end);
    if (duration < 55 || duration > 120) continue;
    add({ start, end: annual.end, value: annual.val - ytd.val, unit: annual.unit, filed: annual.filed > ytd.filed ? annual.filed : ytd.filed, concept: annual.tag, tag: `${annual.tag}:${annual.accn} minus ${ytd.tag}:${ytd.accn}`, method: 'annual-less-ytd' });
  }

  return periods.sort((a, b) => a.end.localeCompare(b.end) || a.start.localeCompare(b.start)
    || a.filed.localeCompare(b.filed) || (a.method === 'reported' ? 1 : 0) - (b.method === 'reported' ? 1 : 0));
}

function selectPeriods(rows: PeriodValue[], isAnnual: boolean, limit: number, preferredConcepts: readonly string[] = []) {
  const selected = new Map<string, PeriodValue>();
  for (const row of rows.filter(period => (daysBetween(period.start, period.end) >= 300) === isAnnual)) {
    const key = `${row.start}/${row.end}`;
    const previous = selected.get(key);
    const priority=(period:PeriodValue)=>{const index=preferredConcepts.indexOf(period.concept);return index<0?Number.MAX_SAFE_INTEGER:index;};
    if (!previous || priority(row)<priority(previous) || (priority(row)===priority(previous)&&(row.filed > previous.filed || (row.filed === previous.filed && row.method === 'reported' && previous.method !== 'reported')))) selected.set(key, row);
  }
  return [...selected.values()].sort((a, b) => a.end.localeCompare(b.end)).slice(-limit);
}

function periodsAreContiguous(periods: Array<Pick<PeriodValue, 'start' | 'end'>>) {
  return periods.every((period, index) => index === 0
    || Math.abs(daysBetween(nextDay(periods[index - 1].end), period.start)) <= 3);
}

function toSourcedValue(metric: MetricId, period: PeriodValue, cik: number, retrievedAt: string): SourcedValue {
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`;
  return {
    value: period.value,
    unit: period.unit,
    source: {
      source: `SEC Company Facts · ${period.method} · ${metric}`,
      url,
      periodStart: period.start,
      periodEnd: period.end,
      availableAt: `${period.filed}T23:59:59Z`,
      retrievedAt,
      rightsStatus: 'redistribution-permitted',
      currency: period.unit,
      tag: period.tag,
      confidence: 'high',
    },
  };
}

const CASH_TAGS = ['CashAndCashEquivalentsAtCarryingValue', 'CashAndCashEquivalents'] as const;
// IFRS Company Facts coverage uses a different split from US-GAAP. Keep the
// aliases mutually exclusive at selection time (instantValue chooses one
// reported concept); never add broad `Borrowings` totals to their components.
const CURRENT_DEBT_TAGS = [
  'LongTermDebtCurrent', 'ShortTermBorrowings', 'BorrowingsCurrent',
  'CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings',
  'CurrentPortionOfLongtermBorrowings',
  'CurrentSecuredBankLoansReceivedAndCurrentPortionOfNoncurrentSecuredBankLoansReceived',
] as const;
const NONCURRENT_DEBT_TAGS = [
  'LongTermDebtNoncurrent', 'BorrowingsNoncurrent', 'LongtermBorrowings',
  'NoncurrentPortionOfOtherNoncurrentBorrowings',
  'NoncurrentPortionOfNoncurrentSecuredBankLoansReceived',
] as const;
// This is the rolling-year-two fact, not the fiscal year-two maturity fact.
// FASB distinguishes the schedules and their tags: https://xbrl.fasb.org/resources/taxonomyfaq.pdf
const YEAR_TWO_MATURITY_TAGS = ['LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo'] as const;
// Prefer explicit borrowing interest; FinanceCosts can include fees and other
// financing components. Evaluate one concept series at a time so issuers that
// report both a specific line and an aggregate do not create duplicate quarters.
const INTEREST_TAGS = ['InterestExpenseNonoperating', 'InterestAndDebtExpense', 'InterestExpenseDebt', 'InterestExpense', 'InterestExpenseOnBorrowings', 'FinanceCosts'] as const;

function instantValue(payload: any, tags: readonly string[], unit: string, asOf: string, cik: number, retrievedAt: string): SourcedValue | undefined {
  const candidates: Array<{ row: any; priority: number; tag: string }> = [];
  for (const [priority, tag] of tags.entries()) for (const namespace of ['us-gaap', 'ifrs-full']) {
    const rows = payload?.facts?.[namespace]?.[tag]?.units?.[unit];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (row?.start || !validDate(row?.end) || !validDate(row?.filed) || !Number.isFinite(row?.val)
        || Date.parse(row.end) > Date.parse(asOf) || Date.parse(`${row.filed}T23:59:59Z`) > Date.parse(asOf)) continue;
      candidates.push({ row, priority, tag });
    }
  }
  const selected = candidates.sort((a, b) => b.row.end.localeCompare(a.row.end) || b.row.filed.localeCompare(a.row.filed) || a.priority - b.priority)[0];
  if (!selected) return;
  const fact = selected.row;
  return {
    value: fact.val,
    unit,
    source: {
      source: `SEC Company Facts · ${selected.tag}`,
      url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`,
      periodEnd: fact.end,
      availableAt: `${fact.filed}T23:59:59Z`,
      retrievedAt,
      currency: unit,
      rightsStatus: 'redistribution-permitted',
      tag: selected.tag,
      confidence: 'high',
    },
  };
}

function derivedSourcedValue(value: number, unit: string, source: string, tag: string, inputs: SourcedValue[]): SourcedValue {
  const latest = (field: 'availableAt' | 'retrievedAt') => inputs.map(item => item.source[field]).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)!;
  return {
    value,
    unit,
    source: {
      source,
      url: inputs[0].source.url,
      periodStart: inputs.map(item => item.source.periodStart).filter((date): date is string => !!date).sort()[0],
      periodEnd: inputs.map(item => item.source.periodEnd).sort().at(-1)!,
      availableAt: latest('availableAt'),
      retrievedAt: latest('retrievedAt'),
      currency: unit,
      rightsStatus: 'redistribution-permitted',
      tag,
      confidence: 'high',
    },
  };
}

/** Assemble only standard SEC facts that are period- and currency-comparable. */
export function buildSecFinancialStrengthInputs(
  cik: number,
  payload: unknown,
  asOf: string,
  retrievedAt: string,
  earnings: SecEarningsBuild,
  industryModel?: 'industrial-operating-company',
): SecFinancialStrengthBuild {
  const empty: SecFinancialStrengthBuild = { metrics: {}, missing: [], conflicts: [], limitations: [], };
  if (!Number.isSafeInteger(cik) || cik <= 0 || classifySecCompanyFacts(payload, cik) !== 'retrieved'
    || !Number.isFinite(Date.parse(asOf)) || !Number.isFinite(Date.parse(retrievedAt)) || Date.parse(retrievedAt) > Date.parse(asOf)) {
    return { ...empty, missing: ['A validated issuer-matched SEC Company Facts payload and valid retrieval/as-of timestamps are required.'] };
  }
  const record = payload as any;
  const unit = earnings.coverage.selectedUnit;
  const metrics: SecFinancialStrengthBuild['metrics'] = {};
  const missing: string[] = [];
  const cash = instantValue(record, CASH_TAGS, unit, asOf, cik, retrievedAt);
  const currentDebt = instantValue(record, CURRENT_DEBT_TAGS, unit, asOf, cik, retrievedAt);
  const noncurrentDebt = instantValue(record, NONCURRENT_DEBT_TAGS, unit, asOf, cik, retrievedAt);
  const yearTwoMaturities = instantValue(record, YEAR_TWO_MATURITY_TAGS, unit, asOf, cik, retrievedAt);
  for (const [name, value] of [['unrestricted cash', cash], ['current debt', currentDebt], ['noncurrent debt', noncurrentDebt], ['year-two debt maturities', yearTwoMaturities]] as const) {
    if (!value) missing.push(`${name}: no standard ${unit} Company Facts value`);
  }
  if (cash) metrics.unrestrictedCash = cash;
  if (currentDebt && noncurrentDebt) {
    if (currentDebt.source.periodEnd !== noncurrentDebt.source.periodEnd) missing.push('total debt: current and noncurrent balances end on different dates');
    else metrics.totalDebt = derivedSourcedValue(currentDebt.value + noncurrentDebt.value, unit, 'SEC Company Facts · current + noncurrent debt', `${currentDebt.source.tag} + ${noncurrentDebt.source.tag}`, [currentDebt, noncurrentDebt]);
  }
  if (currentDebt && yearTwoMaturities) {
    if (currentDebt.source.periodEnd !== yearTwoMaturities.source.periodEnd) missing.push('24-month maturities: current debt and year-two maturity facts end on different dates');
    else metrics.debtDueWithin24Months = derivedSourcedValue(currentDebt.value + yearTwoMaturities.value, unit, 'SEC Company Facts · current debt + year-two principal maturities', `${currentDebt.source.tag} + ${yearTwoMaturities.source.tag}`, [currentDebt, yearTwoMaturities]);
  }

  const recentQuarters = [...earnings.periods.quarterly].sort((a, b) => a.end.localeCompare(b.end)).slice(-4);
  if (recentQuarters.length !== 4 || !periodsAreContiguous(recentQuarters)) {
    missing.push(`TTM cash flow and operating income: only ${recentQuarters.length}/4 consecutive standalone quarters`);
  } else {
    const keys = ['operatingCashFlow', 'capitalExpenditure', 'operatingIncome'] as const;
    const complete = keys.every(key => recentQuarters.every(period => !!period.metrics[key] && period.metrics[key]!.unit === unit));
    if (!complete) missing.push('TTM cash flow or operating income: one or more aligned quarterly values are unavailable in the issuer reporting currency');
    else {
      const sources = (key: typeof keys[number]) => recentQuarters.map(period => period.metrics[key]!);
      const cashFlow = sources('operatingCashFlow');
      const capex = sources('capitalExpenditure');
      const operating = sources('operatingIncome');
      const fcfDeps = [...cashFlow, ...capex];
      metrics.freeCashFlowTtm = derivedSourcedValue(cashFlow.reduce((sum, item) => sum + item.value, 0) - capex.reduce((sum, item) => sum + Math.abs(item.value), 0), unit, 'SEC Company Facts · trailing four completed quarters', 'TTM operating cash flow − absolute TTM capital expenditure', fcfDeps);
      metrics.operatingIncomeTtm = derivedSourcedValue(operating.reduce((sum, item) => sum + item.value, 0), unit, 'SEC Company Facts · trailing four completed quarters', 'TTM operating income', operating);
    }
  }

  const interestSeries = INTEREST_TAGS.map(tag => metricPeriods(collectRows(record, [tag], unit, asOf), [], 'operatingIncome')
    .filter(period => daysBetween(period.start, period.end) >= 55 && daysBetween(period.start, period.end) <= 120)
    .sort((a, b) => a.end.localeCompare(b.end)).slice(-4));
  const recentInterest = interestSeries.find(series => series.length === 4 && periodsAreContiguous(series)) ?? [];
  if (recentInterest.length !== 4) {
    missing.push(`TTM interest expense: only ${recentInterest.length}/4 consecutive standalone quarters under a supported standard concept`);
  } else if (recentInterest.some(period => period.value < 0)) missing.push('TTM interest expense: a selected expense fact is negative and requires filing-level interpretation');
  else {
      const values = recentInterest.map(period => ({ value: period.value, unit: period.unit, source: {
        source: `SEC Company Facts · ${period.method} · interest expense`, url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`,
        periodStart: period.start, periodEnd: period.end, availableAt: `${period.filed}T23:59:59Z`, retrievedAt, currency: unit, rightsStatus: 'redistribution-permitted' as const, tag: period.tag, confidence: 'high' as const,
      } }));
      metrics.interestExpenseTtm = derivedSourcedValue(values.reduce((sum, item) => sum + item.value, 0), unit, 'SEC Company Facts · trailing four completed quarters', `TTM interest expense · ${recentInterest[0].concept}`, values);
  }

  const balanceDates = [metrics.unrestrictedCash, metrics.totalDebt, metrics.debtDueWithin24Months].filter((value): value is SourcedValue => !!value).map(value => value.source.periodEnd);
  if (new Set(balanceDates).size > 1) missing.push('Balance-sheet inputs do not share one reporting date; reconcile before scoring.');
  const limitations = [
    'Debt totals cover supported standard current/noncurrent borrowings; custom-tagged loans, leases, factoring and covenant terms are not inferred.',
    'The rolling year-two maturity concept is not broadly populated; fiscal-year maturity schedules are not interchangeable with rolling schedules. Missing disclosures require filing-level review and keep this factor unscored.',
    'SEC Company Facts standard concepts do not guarantee unrestricted-cash classification or complete foreign-filer coverage.',
    'The solvency formula is not suitable for banks, insurers, REITs, utilities, or issuers without a verified operating-company model classification.',
  ];
  const upstreamConflicts = (earnings.conflicts ?? []).filter(conflict => /\b(operatingCashFlow|capitalExpenditure|operatingIncome)\b/.test(conflict));
  const ids: FinancialMetricId[] = ['unrestrictedCash', 'totalDebt', 'freeCashFlowTtm', 'operatingIncomeTtm', 'interestExpenseTtm', 'debtDueWithin24Months'];
  if (industryModel !== 'industrial-operating-company') missing.push('industry model: a sourced operating-company classification is required; financial institutions, REITs and other specialized balance sheets need a separate formula');
  const complete = industryModel === 'industrial-operating-company' && upstreamConflicts.length === 0 && ids.every(id => !!metrics[id]) && new Set(balanceDates).size === 1 && unit === 'USD'
    && ids.every(id => Date.parse(asOf) - Date.parse(metrics[id]!.source.periodEnd) <= 400 * 86_400_000)
    && ids.every(id => isOpportunityProvenanceValid(metrics[id]!.source, asOf));
  if (unit !== 'USD') missing.push(`financial-strength scoring: reported currency ${unit} has no audited conversion to USD`);
  const assessment = complete ? { industryModel, asOf,
    unrestrictedCash: metrics.unrestrictedCash!, totalDebt: metrics.totalDebt!, freeCashFlowTtm: metrics.freeCashFlowTtm!,
    operatingIncomeTtm: metrics.operatingIncomeTtm!, interestExpenseTtm: metrics.interestExpenseTtm!, debtDueWithin24Months: metrics.debtDueWithin24Months!,
  } : undefined;
  return { ...(assessment ? { assessment } : {}), ...(industryModel ? { industryModel } : {}), metrics, missing: [...new Set(missing)], conflicts: upstreamConflicts, limitations };
}

/**
 * Assemble the exact annual and standalone-quarter series needed by the
 * earnings-quality rubric. YTD flows are differenced only within the same XBRL
 * concept/currency/fiscal-year start. Unsupported or custom-only facts remain
 * missing; this adapter never fills gaps with estimates.
 */
export function buildSecEarningsQualityAssessment(
  cik: number,
  payload: unknown,
  asOf: string,
  retrievedAt: string,
  reviews?: { gaapNonGaapBridgeReview: EarningsDisclosureReview; oneOffsReview: EarningsDisclosureReview },
): SecEarningsBuild {
  if (!Number.isSafeInteger(cik) || cik <= 0 || typeof asOf !== 'string' || !Number.isFinite(Date.parse(asOf))
    || !validDate(asOf.slice(0, 10)) || !Number.isFinite(Date.parse(retrievedAt)) || Date.parse(retrievedAt) > Date.parse(asOf)) {
    return { coverage: { annualPeriodsFound: 0, quarterlyPeriodsFound: 0, selectedUnit: 'USD' }, periods: { annual: [], quarterly: [] }, missing: ['valid CIK and as-of/retrieval dates'], conflicts: [], limitations: [] };
  }
  const identity = classifySecCompanyFacts(payload, cik);
  if (identity !== 'retrieved') {
    const missing = identity === 'empty'
      ? ['SEC Company Facts contains no standard us-gaap/ifrs-full facts.']
      : ['SEC Company Facts identity/schema does not match the requested issuer CIK.'];
    return {
      coverage: { annualPeriodsFound: 0, quarterlyPeriodsFound: 0, selectedUnit: 'USD' },
      periods: { annual: [], quarterly: [] },
      missing,
      conflicts: identity === 'invalid' ? ['SEC payload CIK or facts namespace failed issuer identity validation.'] : [],
      limitations: ['No facts are parsed until response identity matches the requested CIK and a standard taxonomy is present.'],
    };
  }
  const record = payload as any;
  const currencyCandidates = new Map<string, {annual:number;quarterly:number;latestEnd:string}>();
  const asOfMillis = Date.parse(asOf);
  for (const namespace of ['us-gaap', 'ifrs-full']) for (const tag of REVENUE_TAGS) {
    const unitFacts = record?.facts?.[namespace]?.[tag]?.units;
    if (!unitFacts || typeof unitFacts !== 'object') continue;
    for (const [unit, rows] of Object.entries(unitFacts)) {
      if (!/^[A-Z]{3}$/.test(unit) || !Array.isArray(rows)) continue;
      if(!(rows as SecRow[]).some(row=>validDate(row.end)&&validDate(row.filed)&&Date.parse(`${row.end}T23:59:59Z`)<=asOfMillis&&Date.parse(`${row.filed}T23:59:59Z`)<=asOfMillis))continue;
      const periods=metricPeriods(collectRows(record,REVENUE_TAGS,unit,asOf),[],'revenue');
      const annual=selectPeriods(periods,true,3,REVENUE_TAGS),quarterly=selectPeriods(periods,false,8,REVENUE_TAGS),latestEnd=periods.at(-1)?.end??'';
      const previous=currencyCandidates.get(unit);
      const candidate={annual:annual.length,quarterly:quarterly.length,latestEnd};
      if(!previous||candidate.latestEnd>previous.latestEnd||(candidate.latestEnd===previous.latestEnd&&candidate.annual+candidate.quarterly>previous.annual+previous.quarterly))currencyCandidates.set(unit,candidate);
    }
  }
  // Pick the freshest valid revenue reporting currency, not simply the first
  // currency ever used. A historical USD series must not hide newer EUR
  // reporting. Coverage breaks recency ties; prefer USD only when both series
  // end in the same period and provide equal coverage. Non-USD remains visible
  // but cannot enter the USD-denominated score without a sourced conversion.
  const selectedUnit=[...currencyCandidates.entries()].sort((a,b)=>b[1].latestEnd.localeCompare(a[1].latestEnd)
    ||(b[1].annual+b[1].quarterly)-(a[1].annual+a[1].quarterly)
    ||Number(b[0]==='USD')-Number(a[0]==='USD')||a[0].localeCompare(b[0]))[0]?.[0]??'USD';
  const conflicts: string[] = [];
  const series = Object.fromEntries((Object.keys(METRICS) as MetricId[]).map(metric => [metric,
    metricPeriods(collectRows(record, METRICS[metric], selectedUnit, asOf), conflicts, metric),
  ])) as Record<MetricId, PeriodValue[]>;
  const annualAnchors = selectPeriods(series.revenue, true, 3, METRICS.revenue);
  const quarterlyAnchors = selectPeriods(series.revenue, false, 8, METRICS.revenue);
  const missing: string[] = [];
  if (annualAnchors.length < 3) missing.push(`revenue: only ${annualAnchors.length}/3 annual periods`);
  if (quarterlyAnchors.length < 8) missing.push(`revenue: only ${quarterlyAnchors.length}/8 standalone quarters`);
  const annualPeriodsContiguous = periodsAreContiguous(annualAnchors);
  const quarterlyPeriodsContiguous = periodsAreContiguous(quarterlyAnchors);
  if (annualAnchors.length === 3 && !annualPeriodsContiguous) missing.push('revenue: annual period history contains a gap or fiscal-period transition requiring review');
  if (quarterlyAnchors.length === 8 && !quarterlyPeriodsContiguous) missing.push('revenue: eight selected quarterly periods are not consecutive');
  const latestRevenuePeriod = [...annualAnchors, ...quarterlyAnchors].sort((a, b) => b.end.localeCompare(a.end))[0];
  const latestPeriodAgeDays = latestRevenuePeriod ? daysBetween(latestRevenuePeriod.end, asOf.slice(0, 10)) : Infinity;
  if (latestRevenuePeriod && latestPeriodAgeDays > MAX_REVENUE_PERIOD_AGE_DAYS) {
    missing.push(`revenue: latest reported period is stale (${Math.floor(latestPeriodAgeDays)} days old; maximum ${MAX_REVENUE_PERIOD_AGE_DAYS} days)`);
  }

  const assemble = (anchors: PeriodValue[], label: 'annual' | 'quarterly') => anchors.map(anchor => {
    const period = {} as EarningsPeriod;
    for (const metric of Object.keys(METRICS) as MetricId[]) {
      const matches = series[metric].filter(item => item.start === anchor.start && item.end === anchor.end && item.unit === selectedUnit);
      const concepts = new Map<string, PeriodValue>();
      for(const match of matches){
        const previous=concepts.get(match.concept);
        if(!previous||match.filed>previous.filed||(match.filed===previous.filed&&match.method==='reported'&&previous.method!=='reported'))concepts.set(match.concept,match);
      }
      const alternatives=[...concepts.values()].sort((a,b)=>{
        const priority=(period:PeriodValue)=>{const index=METRICS[metric].indexOf(period.concept);return index<0?Number.MAX_SAFE_INTEGER:index;};
        return priority(a)-priority(b)||b.filed.localeCompare(a.filed)||(a.method==='reported'?-1:0)-(b.method==='reported'?-1:0);
      });
      const exact = alternatives[0];
      if(alternatives.length>1){
        const values=alternatives.map(item=>item.value),spread=Math.max(...values)-Math.min(...values),tolerance=Math.max(1,Math.max(...values.map(Math.abs))*1e-6);
        if(spread>tolerance)conflicts.push(`${label} ${anchor.start}..${anchor.end}: competing ${metric} concepts report different values (${alternatives.map(item=>`${item.concept}=${item.value}`).join(', ')})`);
      }
      if (!exact) { missing.push(`${label} ${anchor.start}..${anchor.end}: ${metric}`); continue; }
      period[metric] = toSourcedValue(metric, exact, cik, retrievedAt);
    }
    return { anchor, period, metrics: period as Partial<Record<MetricId, SourcedValue>> };
  });
  const annual = assemble(annualAnchors, 'annual');
  const quarterly = assemble(quarterlyAnchors, 'quarterly');
  for (const metric of Object.keys(METRICS) as MetricId[]) {
    const selected = [...annual.map(item => item.period[metric]), ...quarterly.map(item => item.period[metric])].filter((value): value is SourcedValue => !!value);
    const concepts = new Set(selected.map(value => value.source.tag?.split(':')[0]));
    if (concepts.size > 1) conflicts.push(`${metric}: XBRL concept changes across the selected periods; concept comparability needs a filing-level review`);
  }
  const periodComplete = [...annual, ...quarterly].every(item => REQUIRED_EARNINGS_METRICS.every(metric => !!item.period[metric]));
  if (selectedUnit !== 'USD') missing.push(`currency ${selectedUnit} is not converted to USD; cross-currency scoring is withheld`);
  if (!reviews) missing.push('GAAP/non-GAAP adjustment review and one-off review are required');
  const reviewIsValid = (review?: EarningsDisclosureReview) => !!review && Number.isInteger(review.score) && review.score >= 0 && review.score <= 10
    && !!review.rationale?.trim() && !!review.sources?.length && review.sources.every(source => isOpportunityProvenanceValid(source, asOf));
  const reviewComplete = !!reviews && reviewIsValid(reviews.gaapNonGaapBridgeReview) && reviewIsValid(reviews.oneOffsReview);
  const ready = latestPeriodAgeDays <= MAX_REVENUE_PERIOD_AGE_DAYS && annual.length === 3 && annualPeriodsContiguous && quarterly.length === 8 && quarterlyPeriodsContiguous
    && periodComplete && selectedUnit === 'USD' && reviewComplete && conflicts.length === 0;
  const limitations = [
    'Company Facts omits custom taxonomy concepts; missing SBC or operating-income tags require filing-level XBRL/manual follow-up.',
    'This series uses standard facts and reported accessions; it does not review footnotes, non-GAAP bridges, segment economics, or one-off classification.',
    'Annual and quarterly datasets are separate windows and overlap by design; do not add the two arrays together.',
  ];
  return {
    ...(ready ? { assessment: {
      asOf,
      annual: annual.map(item => item.period),
      quarterly: quarterly.map(item => item.period),
      gaapNonGaapBridgeReview: reviews!.gaapNonGaapBridgeReview,
      oneOffsReview: reviews!.oneOffsReview,
    } } : {}),
    coverage: { annualPeriodsFound: annual.length, quarterlyPeriodsFound: quarterly.length, selectedUnit },
    periods: {
      annual: annual.map(item => ({ start: item.anchor.start, end: item.anchor.end, metrics: item.metrics })),
      quarterly: quarterly.map(item => ({ start: item.anchor.start, end: item.anchor.end, metrics: item.metrics })),
    },
    missing: [...new Set(missing)],
    conflicts: [...new Set(conflicts)],
    limitations,
  };
}
