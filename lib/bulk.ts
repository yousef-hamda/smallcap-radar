import type { Company } from './providers';
import { fetchJson } from './providers';
import type { Provenance, Snapshot } from './engine';

type FrameFact = { cik: number; entityName?: string; start?: string; end: string; val: number; filed: string; form?: string; accn?: string; frame?: string };
type StoredFact = FrameFact & { tag: string; priority: number; url: string };
export type BulkFundamentals = {
  revenue?: StoredFact;
  netIncome?: StoredFact;
  ocf?: StoredFact;
  capex?: StoredFact;
  shares?: StoredFact;
  priorShares?: StoredFact;
  cash?: StoredFact;
  debtCurrent?: StoredFact;
  debtNoncurrent?: StoredFact;
};
type FrameConfig = { key: keyof BulkFundamentals; tag: string; taxonomy?: 'us-gaap' | 'dei'; unit: string; period: string; priority: number };

const FRAME_BASE = 'https://data.sec.gov/api/xbrl/frames/us-gaap';
const revenueTags = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'Revenues',
  'SalesRevenueNet',
  'SalesRevenueGoodsNet',
];

function lastCompletedQuarter(date = new Date()) {
  const currentQuarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return currentQuarter === 1 ? { year: date.getUTCFullYear() - 1, quarter: 4 } : { year: date.getUTCFullYear(), quarter: currentQuarter - 1 };
}

function newer(candidate: StoredFact, existing?: StoredFact) {
  if (!existing) return true;
  return candidate.end > existing.end || (candidate.end === existing.end && (candidate.filed > existing.filed || (candidate.filed === existing.filed && candidate.priority < existing.priority)));
}

export async function fetchBulkFundamentals(candidateCiks: number[], asOf = new Date()) {
  const annualYear = asOf.getUTCFullYear() - 1;
  const quarter = lastCompletedQuarter(asOf);
  const instant = `CY${quarter.year}Q${quarter.quarter}I`;
  const priorInstant = `CY${quarter.year - 1}Q${quarter.quarter}I`;
  const annual = `CY${annualYear}`;
  const configs: FrameConfig[] = [
    ...revenueTags.map((tag, priority) => ({ key: 'revenue' as const, tag, unit: 'USD', period: annual, priority })),
    { key: 'netIncome' as const, tag: 'NetIncomeLoss', unit: 'USD', period: annual, priority: 0 },
    { key: 'ocf' as const, tag: 'NetCashProvidedByUsedInOperatingActivities', unit: 'USD', period: annual, priority: 0 },
    { key: 'capex' as const, tag: 'PaymentsToAcquirePropertyPlantAndEquipment', unit: 'USD', period: annual, priority: 0 },
    { key: 'shares' as const, tag: 'EntityCommonStockSharesOutstanding', taxonomy: 'dei', unit: 'shares', period: instant, priority: 0 },
    { key: 'priorShares' as const, tag: 'EntityCommonStockSharesOutstanding', taxonomy: 'dei', unit: 'shares', period: priorInstant, priority: 0 },
    { key: 'cash' as const, tag: 'CashAndCashEquivalentsAtCarryingValue', unit: 'USD', period: instant, priority: 0 },
    { key: 'debtCurrent' as const, tag: 'LongTermDebtCurrent', unit: 'USD', period: instant, priority: 0 },
    { key: 'debtNoncurrent' as const, tag: 'LongTermDebtNoncurrent', unit: 'USD', period: instant, priority: 0 },
  ];
  const allowed = new Set(candidateCiks.map(Number));
  const fundamentals = new Map<number, BulkFundamentals>();
  let success = 0, failed = 0;
  const errors: string[] = [];

  for (let index = 0; index < configs.length; index += 5) {
    const group = configs.slice(index, index + 5);
    const outcomes = await Promise.allSettled(group.map(async (config) => {
      const base = config.taxonomy === 'dei' ? 'https://data.sec.gov/api/xbrl/frames/dei' : FRAME_BASE;
      const url = `${base}/${config.tag}/${config.unit}/${config.period}.json`;
      const payload = await fetchJson(url) as { data?: FrameFact[] };
      return { config, rows: payload.data ?? [], url };
    }));
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        failed++;
        errors.push(outcome.reason instanceof Error ? outcome.reason.message : 'SEC Frames error');
        continue;
      }
      success++;
      const { config, rows, url } = outcome.value;
      for (const row of rows) {
        const cik = Number(row.cik);
        if (!allowed.has(cik) || !Number.isFinite(row.val) || !row.end || !row.filed) continue;
        const stored: StoredFact = { ...row, tag: config.tag, priority: config.priority, url };
        const record = fundamentals.get(cik) ?? {};
        const current = record[config.key];
        if (newer(stored, current)) record[config.key] = stored;
        fundamentals.set(cik, record);
      }
    }
  }
  return { fundamentals, requests: configs.length, success, failed, errors: [...new Set(errors)].slice(0, 8), annual, instant };
}

function frameProvenance(fact: StoredFact, retrievedAt: string): Provenance {
  return {
    source: 'SEC EDGAR XBRL Frames (official)',
    url: fact.url,
    periodStart: fact.start,
    periodEnd: fact.end,
    availableAt: `${fact.filed}T23:59:59.000Z`,
    retrievedAt,
    currency: 'USD',
    tag: fact.tag,
    confidence: 'medium',
  };
}

export function preliminarySnapshot(company: Company, facts: BulkFundamentals | undefined, retrievedAt = new Date().toISOString()): Snapshot {
  const quoteDate = retrievedAt.slice(0, 10);
  const quote: Provenance = { source: 'Yahoo/Nasdaq bulk quote', periodEnd: quoteDate, availableAt: retrievedAt, retrievedAt, currency: 'USD', confidence: 'medium' };
  const snapshot: Snapshot = {
    symbol: company.ticker,
    name: company.name,
    asOf: retrievedAt,
    exchange: company.exchange,
    securityType: 'common',
    price: company.price ?? null,
    marketCap: company.marketCap ?? null,
    confidence: 'C',
    deathSpiral: 'unknown',
    provenance: {},
    dataIssues: [],
    research: { financials: false, valuation: false, analysts: false, sector: !!company.sector },
  };
  if (snapshot.price != null) snapshot.provenance.price = quote;
  if (snapshot.marketCap != null) snapshot.provenance.marketCap = quote;
  if (company.averageVolume10d && snapshot.price) {
    snapshot.medianDollarVolume20d = company.averageVolume10d * snapshot.price;
    snapshot.provenance.medianDollarVolume20d = { ...quote, source: 'Yahoo 10-day average volume × price (bulk liquidity proxy)', confidence: 'low' };
    snapshot.dataIssues?.push('السيولة في الفحص السريع وكيل جماعي؛ يُحسب وسيط 20 يومًا في التحقق العميق.');
  }
  if (company.return52w != null) { snapshot.return12m = company.return52w; snapshot.provenance.return12m = quote }
  if (company.low52w != null) { snapshot.low52w = company.low52w; snapshot.provenance.low52w = quote }
  if (!facts) { snapshot.dataIssues?.push('لا توجد تغطية SEC Frames لهذه الشركة في الفترة الجماعية.'); return snapshot }

  for (const key of ['revenue', 'netIncome'] as const) if (facts[key]) {
    snapshot[key] = facts[key]!.val;
    snapshot.provenance[key] = frameProvenance(facts[key]!, retrievedAt);
  }
  if (facts.ocf && facts.capex && facts.ocf.end === facts.capex.end) {
    snapshot.fcf = facts.ocf.val - Math.abs(facts.capex.val);
    snapshot.provenance.fcf = { ...frameProvenance(facts.ocf, retrievedAt), tag: `${facts.ocf.tag} − ${facts.capex.tag}`, confidence: 'medium' };
  }
  const debt = (facts.debtCurrent?.val ?? 0) + (facts.debtNoncurrent?.val ?? 0);
  if (snapshot.marketCap && snapshot.revenue && snapshot.revenue > 0 && facts.cash) {
    snapshot.evSales = (snapshot.marketCap + debt - facts.cash.val) / snapshot.revenue;
    snapshot.provenance.evSales = { ...frameProvenance(facts.revenue!, retrievedAt), source: 'Derived from bulk market cap + SEC debt − SEC cash / SEC revenue', confidence: 'low' };
  }
  if (snapshot.marketCap && snapshot.revenue && snapshot.revenue > 0) {
    snapshot.ps = snapshot.marketCap / snapshot.revenue;
    snapshot.provenance.ps = { ...frameProvenance(facts.revenue!, retrievedAt), source: 'Derived from bulk market cap / SEC revenue', confidence: 'low' };
  }
  if (facts.shares && facts.priorShares && facts.priorShares.val > 0) {
    snapshot.dilution = facts.shares.val / facts.priorShares.val - 1;
    snapshot.splitAdjusted = false;
  }
  snapshot.research = { financials: !!snapshot.revenue, valuation: snapshot.evSales != null, analysts: false, sector: !!company.sector };
  return snapshot;
}
