import type { Company } from './providers';
import { fetchJson } from './providers';
import type { Provenance, Snapshot } from './engine';
import bundledFrames from './sec-frames.generated.json';
import {REVENUE_TAGS, observations, latestInstant, trailingAnnual} from './sec';
import {derivedEvidence,usableEvidence} from './evidence';
import {NON_TRADABLE_NAME, SEC_FRAME_DATASET_COUNT} from './strategy-spec';
import {applyFinancingRisk} from './financing-risk';

type FrameFact = { cik: number; entityName?: string; start?: string; end: string; val: number; filed?: string; form?: string; accn?: string; frame?: string };
type StoredFact = FrameFact & { tag: string; priority: number; url: string; fallback?: boolean; observedAt?:string; kind?: 'frames'|'companyfacts' };
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
  conflicts?: string[];
};
type FundamentalKey = Exclude<keyof BulkFundamentals, 'conflicts'>;
type FrameConfig = { key: FundamentalKey; tag: string; taxonomy?: 'us-gaap' | 'ifrs-full' | 'dei'; unit: string; period: string; priority: number };

const FRAME_BASE = 'https://data.sec.gov/api/xbrl/frames/us-gaap';
const revenueTags = REVENUE_TAGS;

function lastCompletedQuarter(date = new Date()) {
  const currentQuarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return currentQuarter === 1 ? { year: date.getUTCFullYear() - 1, quarter: 4 } : { year: date.getUTCFullYear(), quarter: currentQuarter - 1 };
}

function newer(candidate: StoredFact, existing?: StoredFact) {
  if (!existing) return true;
  const candidateFiled = candidate.filed ?? '';
  const existingFiled = existing.filed ?? '';
  return candidate.end > existing.end || (candidate.end === existing.end && (candidateFiled > existingFiled || (candidateFiled === existingFiled && candidate.priority < existing.priority)));
}

const COMPANY_FACTS_TAGS = {
  revenue: REVENUE_TAGS,
  netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  ocf: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations', 'NetCashFlowsFromUsedInOperatingActivities'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquirePropertyPlantAndEquipmentContinuingOperations', 'PurchaseOfPropertyPlantAndEquipment'],
  shares: ['EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding'],
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashAndCashEquivalents'],
  debtCurrent: ['LongTermDebtCurrent', 'ShortTermBorrowings', 'BorrowingsCurrent'],
  // LongTermDebt and Borrowings may be totals. Adding either to a current
  // component can double count debt, so only noncurrent concepts are used.
  debtNoncurrent: ['LongTermDebtNoncurrent', 'BorrowingsNoncurrent'],
} as const;

function companyFactsUrl(cik: number) {
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`;
}

function usableCompanyFact(fact: any, asOf: Date): fact is { start?: string; end: string; val: number; filed: string; form: string; accn?: string; tag?: string } {
  return !!fact && Number.isFinite(fact.val) && typeof fact.end === 'string' && Number.isFinite(Date.parse(fact.end)) && Date.parse(fact.end) <= asOf.getTime() && typeof fact.filed === 'string' && Number.isFinite(Date.parse(`${fact.filed}T23:59:59Z`)) && Date.parse(`${fact.filed}T23:59:59Z`) <= asOf.getTime();
}

function toStoredFact(fact: any, cik: number, key: FundamentalKey, url: string, priority: number): StoredFact | undefined {
  if (!fact || !Number.isFinite(fact.val) || !fact.end) return undefined;
  return { cik, start: fact.start, end: fact.end, val: fact.val, filed: fact.filed, form: fact.form, accn: fact.accn, tag: fact.tag || key, priority, url, observedAt: new Date().toISOString(), kind: 'companyfacts' };
}

function latestInstantPair(rows: any[], asOf: Date) {
  const eligible = rows.filter((row) => usableCompanyFact(row, asOf) && !row.start).sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
  return { current: eligible[0], prior: eligible.find((row) => row.end < eligible[0]?.end) };
}

/**
 * Parse one official SEC Company Facts response into the same fact contract as
 * Frames. This is deliberately conservative: only standard US-GAAP/IFRS/DEI
 * facts with a filed date not later than asOf are eligible. Custom tags are
 * left visible as a gap instead of being guessed into a standard metric.
 */
export function parseCompanyFacts(cik: number, payload: any, asOf = new Date()): BulkFundamentals | undefined {
  const facts = payload?.facts;
  if (!facts || typeof facts !== 'object') return undefined;
  const result: BulkFundamentals = {};
  const url = companyFactsUrl(cik);
  const pickAnnual = (key: FundamentalKey, tags: readonly string[], priority = 0) => {
    const rows = observationsFromPayload(facts, tags);
    const annual = trailingAnnual(rows, asOf.toISOString());
    if (annual && usableCompanyFact(annual, asOf)) result[key] = toStoredFact(annual, cik, key, url, priority);
  };
  pickAnnual('revenue', COMPANY_FACTS_TAGS.revenue);
  pickAnnual('netIncome', COMPANY_FACTS_TAGS.netIncome);
  pickAnnual('ocf', COMPANY_FACTS_TAGS.ocf);
  pickAnnual('capex', COMPANY_FACTS_TAGS.capex);
  for (const [key, tags] of Object.entries({ cash: COMPANY_FACTS_TAGS.cash, debtCurrent: COMPANY_FACTS_TAGS.debtCurrent, debtNoncurrent: COMPANY_FACTS_TAGS.debtNoncurrent }) as [FundamentalKey, readonly string[]][]) {
    const instant = latestInstant(observationsFromPayload(facts, tags), asOf.toISOString());
    if (instant && usableCompanyFact(instant, asOf)) result[key] = toStoredFact(instant, cik, key, url, 0);
  }
  const sharePair = latestInstantPair(observationsFromPayload(facts, COMPANY_FACTS_TAGS.shares, 'shares'), asOf);
  if (sharePair.current && usableCompanyFact(sharePair.current, asOf)) result.shares = toStoredFact(sharePair.current, cik, 'shares', url, 0);
  if (sharePair.prior && usableCompanyFact(sharePair.prior, asOf)) result.priorShares = toStoredFact(sharePair.prior, cik, 'priorShares', url, 0);
  const usable = Object.keys(result).filter((key) => key !== 'conflicts').length;
  return usable ? result : undefined;
}

function observationsFromPayload(facts: any, tags: readonly string[], unit = 'USD') {
  return observations(facts, [...tags], unit);
}

export function needsCompanyFacts(facts: BulkFundamentals | undefined) {
  if (!facts) return true;
  return (['revenue', 'netIncome', 'ocf', 'capex', 'shares', 'priorShares', 'cash', 'debtCurrent', 'debtNoncurrent'] as const).some((key) => !facts[key]);
}

function mergeCompanyFacts(existing: BulkFundamentals | undefined, fallback: BulkFundamentals) {
  const merged: BulkFundamentals = { ...(existing || {}) };
  const conflicts = [...(merged.conflicts || [])];
  for (const key of ['revenue', 'netIncome', 'ocf', 'capex', 'shares', 'priorShares', 'cash', 'debtCurrent', 'debtNoncurrent'] as const) {
    const candidate = fallback[key], current = merged[key];
    if (!candidate) continue;
    if (current && current.end === candidate.end && current.val !== candidate.val) conflicts.push(`${key}: ${current.val} (${current.kind || 'frames'}) مقابل ${candidate.val} (Company Facts) في ${candidate.end}`);
    if (!current) merged[key] = candidate;
  }
  if (conflicts.length) merged.conflicts = [...new Set(conflicts)].slice(0, 12);
  return merged;
}

/** Fetch only the missing official fundamentals for a bounded resumable batch. */
export async function fetchCompanyFactsFallback(candidateCiks: number[], asOf = new Date(), initial = new Map<number, BulkFundamentals>()) {
  const fundamentals = new Map(initial);
  const changed = new Set<number>();
  const errors: string[] = [];
  const failedCiks: number[] = [];
  const retryableFailedCiks: number[] = [];
  let success = 0, empty = 0, failed = 0;
  const outcomes = await Promise.all(candidateCiks.map(async (cik) => {
    const url = companyFactsUrl(cik);
    try {
      const payload = await fetchJson(url, 8_000, 6 * 60 * 60_000, 3);
      return { cik, parsed: parseCompanyFacts(cik, payload, asOf), error: null };
    } catch (error) {
      return { cik, parsed: undefined, error: error instanceof Error ? error : Error('SEC Company Facts error') };
    }
  }));
  for (const outcome of outcomes) {
    if (outcome.error) {
      failed++;
      failedCiks.push(outcome.cik);
      errors.push(outcome.error.message);
      // Authentication, permission, and missing-resource responses are stable
      // provider gaps. Retrying thousands of them only delays scoring. Network
      // failures, rate limits, and 5xx responses remain retryable.
      if (!/\bHTTP (400|401|403|404|405|422)\b/.test(outcome.error.message)) retryableFailedCiks.push(outcome.cik);
      continue;
    }
    success++;
    if (!outcome.parsed) { empty++; continue; }
    const current = fundamentals.get(outcome.cik);
    const merged = mergeCompanyFacts(current, outcome.parsed);
    if (JSON.stringify(merged) !== JSON.stringify(current || {})) { fundamentals.set(outcome.cik, merged); changed.add(outcome.cik); }
  }
  return { fundamentals, changed: [...changed], requests: candidateCiks.length, success, empty, failed, failedCiks, retryableFailedCiks, errors: [...new Set(errors)].slice(0, 8) };
}

export async function fetchBulkFundamentals(candidateCiks: number[], asOf = new Date(), page?:{offset:number;limit:number;initial?:Map<number,BulkFundamentals>}) {
  const annualYear = asOf.getUTCFullYear() - 1;
  const quarter = lastCompletedQuarter(asOf);
  const instant = `CY${quarter.year}Q${quarter.quarter}I`;
  const priorInstant = `CY${quarter.year - 1}Q${quarter.quarter}I`;
  const annual = `CY${annualYear}`;
  const requiredConfigs: FrameConfig[] = [
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
  // Optional overlays are kept separate from the 13 required baseline
  // datasets. This keeps the scan contract honest while still supporting
  // foreign filers when SEC exposes the IFRS taxonomy.
  const optionalConfigs: FrameConfig[] = [
    { key: 'cash' as const, tag: 'CashAndCashEquivalents', taxonomy: 'ifrs-full', unit: 'USD', period: instant, priority: 1 },
    { key: 'debtCurrent' as const, tag: 'BorrowingsCurrent', taxonomy: 'ifrs-full', unit: 'USD', period: instant, priority: 1 },
    { key: 'debtNoncurrent' as const, tag: 'BorrowingsNoncurrent', taxonomy: 'ifrs-full', unit: 'USD', period: instant, priority: 1 },
  ];
  const configs = [...requiredConfigs, ...optionalConfigs];
  const allowed = new Set(candidateCiks.map(Number));
  const fundamentals = new Map<number, BulkFundamentals>(page?.initial);
  const changed=new Set<number>();
  const start=page?.offset??0,stop=Math.min(configs.length,start+(page?.limit??configs.length));
  let success = 0, failed = 0, optionalSuccess = 0, optionalFailed = 0;
  let requests = 0, optionalRequests = 0;
  let fallbackUsed = false;
  const errors: string[] = [];

  for (let index = start; index < stop; index += 4) {
    const group = configs.slice(index, Math.min(stop,index + 4));
    const outcomes = await Promise.allSettled(group.map(async (config) => {
      const base = config.taxonomy === 'dei' ? 'https://data.sec.gov/api/xbrl/frames/dei' : config.taxonomy === 'ifrs-full' ? 'https://data.sec.gov/api/xbrl/frames/ifrs-full' : FRAME_BASE;
      const url = `${base}/${config.tag}/${config.unit}/${config.period}.json`;
      const payload = await fetchJson(url, 3_000) as { data?: FrameFact[] };
      return { config, rows: payload.data ?? [], url };
    }));
    for (const [localIndex,outcome] of outcomes.entries()) {
      const required=index+localIndex<requiredConfigs.length;
      if (required) requests++; else optionalRequests++;
      if (outcome.status === 'rejected') {
        if (required) failed++; else optionalFailed++;
        errors.push(outcome.reason instanceof Error ? outcome.reason.message : 'SEC Frames error');
        continue;
      }
      if (required) success++; else optionalSuccess++;
      const { config, rows, url } = outcome.value;
      for (const row of rows) {
        const cik = Number(row.cik);
        if (!allowed.has(cik) || !Number.isFinite(row.val) || !row.end || !Number.isFinite(Date.parse(row.end)) || Date.parse(row.end)>asOf.getTime() || (row.filed&&Date.parse(row.filed+'T23:59:59Z')>asOf.getTime())) continue;
        const stored: StoredFact = { ...row, tag: config.tag, priority: config.priority, url,observedAt:asOf.toISOString() };
        const record: BulkFundamentals = {...fundamentals.get(cik)};
        const current = record[config.key];
        if (newer(stored, current)) {record[config.key] = stored;changed.add(cik);}
        fundamentals.set(cik, record);
      }
    }
  }
  // SEC currently rejects some Cloudflare Worker egress ranges. Keep the
  // official, date-stamped Frames snapshot bundled with the release as a
  // deterministic fallback instead of turning missing fundamentals into zero.
  if (stop===configs.length && Date.parse(bundledFrames.generatedAt)<=asOf.getTime() && bundledFrames.annual === annual && bundledFrames.instant === instant) {
    const bundledCandidates = Object.keys(bundledFrames.fundamentals).filter((cik) => allowed.has(Number(cik))).length;
    // A partially blocked SEC response is still incomplete. Overlay the
    // dated official snapshot so one transient provider failure cannot erase
    // the rest of the market's fundamentals (including foreign filers).
    if (bundledCandidates) {
      for (const [cikText, bundled] of Object.entries(bundledFrames.fundamentals)) {
        const cik = Number(cikText);
        if (!allowed.has(cik)) continue;
        const current = {...fundamentals.get(cik)};
        for (const key of Object.keys(bundled) as FundamentalKey[]) {
          const candidate = (bundled as BulkFundamentals)[key];
          if (!candidate||Date.parse(candidate.end)>asOf.getTime()) continue;
          const existing = current[key];
          if (!existing) {current[key] = { ...candidate, fallback: true,observedAt:bundledFrames.generatedAt };changed.add(cik);fallbackUsed=true;}
        }
        fundamentals.set(cik, current);
      }
    }
  }
  return { fundamentals, changed:[...changed],nextOffset:stop,totalConfigs:SEC_FRAME_DATASET_COUNT,done:stop>=configs.length, requests, optionalRequests, success, failed, optionalSuccess, optionalFailed, fallbackUsed, errors: [...new Set(errors)].slice(0, 8), annual, instant };
}

function frameProvenance(fact: StoredFact, retrievedAt: string): Provenance {
  return {
    source: fact.fallback
      ? fact.kind === 'companyfacts' ? 'SEC EDGAR Company Facts — official dated fallback snapshot' : 'SEC EDGAR XBRL Frames — official dated fallback snapshot'
      : fact.kind === 'companyfacts' ? 'SEC EDGAR Company Facts (official)' : 'SEC EDGAR XBRL Frames (official)',
    url: fact.url,
    periodStart: fact.start,
    periodEnd: fact.end,
    // Frames rows do not publish the filing timestamp. The fact is known to be
    // available no later than this retrieval, so do not invent an earlier date.
    availableAt: fact.filed ? `${fact.filed}T23:59:59.000Z` : fact.observedAt??(fact.fallback?bundledFrames.generatedAt:retrievedAt),
    retrievedAt:fact.observedAt??(fact.fallback?bundledFrames.generatedAt:retrievedAt),
    currency: 'USD',
    tag: fact.tag,
    confidence: fact.fallback ? 'low' : fact.kind === 'companyfacts' ? 'high' : 'medium',
  };
}

export function preliminarySnapshot(company: Company, facts: BulkFundamentals | undefined, retrievedAt = new Date().toISOString()): Snapshot {
  const quoteAvailableAt = company.priceAvailableAt || company.quoteAvailableAt || retrievedAt;
  const quoteSource=company.priceSource||company.quoteSource||'Yahoo/Nasdaq bulk quote';
  const quote: Provenance = { source: quoteSource, periodEnd: quoteAvailableAt.slice(0, 10), availableAt: quoteAvailableAt, retrievedAt, currency: 'USD', confidence: quoteSource.includes('bundled') ? 'low' : 'medium' };
  const marketCapAvailableAt=company.marketCapAvailableAt||company.quoteAvailableAt||retrievedAt;
  const marketCapSource=company.marketCapSource||company.quoteSource||'Yahoo/Nasdaq bulk quote';
  const marketCapQuote:Provenance={source:marketCapSource,periodEnd:marketCapAvailableAt.slice(0,10),availableAt:marketCapAvailableAt,retrievedAt,currency:'USD',confidence:marketCapSource.includes('bundled')?'low':'medium'};
  const snapshot: Snapshot = {
    symbol: company.ticker,
    name: company.name,
    cik: company.cik,
    description: 'الوصف غير متاح من مصدر موثق لهذه اللقطة.',
    asOf: retrievedAt,
    exchange: company.exchange,
    securityType: NON_TRADABLE_NAME.test(company.name)?'unknown':'common',
    price: company.price ?? null,
    dailyChange:company.dailyChange??null,
    marketCap: company.marketCap ?? null,
    volume: company.volume ?? null,
    averageVolume10d: company.averageVolume10d ?? null,
    return12m: company.return52w ?? null,
    low52w: company.low52w ?? null,
    high52w: company.high52w ?? null,
    confidence: 'C',
    deathSpiral: 'unknown',
    provenance: {},
    dataIssues: [],
    research: { financials: false, valuation: false, analysts: false, sector: !!company.sector },
  };
  if (snapshot.price != null) snapshot.provenance.price = quote;
  if(snapshot.dailyChange!=null)snapshot.provenance.dailyChange=quote;
  if (snapshot.marketCap != null) snapshot.provenance.marketCap = marketCapQuote;
  if (company.return52w != null) snapshot.provenance.return12m = quote
  if (company.low52w != null) snapshot.provenance.low52w = quote
  if (company.high52w != null) snapshot.provenance.high52w = quote
  if (!facts) { snapshot.dataIssues?.push('لا توجد تغطية SEC Frames أو Company Facts لهذه الشركة في الفترة الجماعية.'); snapshot.dataIssues?.push('وسيط السيولة لـ20 يومًا لا يُستنتج من متوسط 10 أيام؛ يحتاج تاريخًا فعليًا قبل PASS.'); return snapshot }
  if (facts.conflicts?.length) { snapshot.sourceConflicts = [...facts.conflicts]; snapshot.dataIssues?.push('يوجد تعارض موثق بين مصدرين أو قيمتين لنفس الفترة؛ لم يُخفَ التعارض.'); }
  snapshot.dataIssues?.push('وسيط السيولة لـ20 يومًا لا يُستنتج من متوسط 10 أيام؛ يحتاج تاريخًا فعليًا قبل PASS.');

  const cleanFacts: BulkFundamentals = { conflicts: facts.conflicts };
  for (const key of ['revenue', 'netIncome', 'ocf', 'capex', 'shares', 'priorShares', 'cash', 'debtCurrent', 'debtNoncurrent'] as FundamentalKey[]) {
    const fact = facts[key];
    if (fact && Number.isFinite(fact.val) && usableEvidence(frameProvenance(fact, retrievedAt), retrievedAt)) cleanFacts[key] = fact;
  }
  facts = cleanFacts;
  for (const key of ['revenue', 'netIncome','cash'] as const) if (facts[key]) {
    snapshot[key] = facts[key]!.val;
    snapshot.provenance[key] = frameProvenance(facts[key]!, retrievedAt);
  }
  if (facts.ocf && facts.capex && facts.ocf.end === facts.capex.end && facts.ocf.start===facts.capex.start) {
    snapshot.fcf = facts.ocf.val - Math.abs(facts.capex.val);
    snapshot.provenance.fcf = derivedEvidence('Derived SEC cash flows',[frameProvenance(facts.ocf,retrievedAt),frameProvenance(facts.capex,retrievedAt)],retrievedAt,`${facts.ocf.tag} − ${facts.capex.tag}`)!;
  }
  const debt = facts.debtCurrent && facts.debtNoncurrent && facts.debtCurrent.end===facts.debtNoncurrent.end ? facts.debtCurrent.val + facts.debtNoncurrent.val : null;
  if(debt!=null){snapshot.debt=debt;snapshot.provenance.debt=derivedEvidence('Derived SEC debt',[frameProvenance(facts.debtCurrent!,retrievedAt),frameProvenance(facts.debtNoncurrent!,retrievedAt)],retrievedAt,'current + noncurrent debt')!;}
  if (snapshot.marketCap && snapshot.revenue && snapshot.revenue > 0 && facts.cash && debt != null && facts.cash.end===facts.debtCurrent?.end && usableEvidence(marketCapQuote,retrievedAt)) {
    snapshot.evSales = (snapshot.marketCap + debt - facts.cash.val) / snapshot.revenue;
    snapshot.provenance.evSales = derivedEvidence('Derived from bulk market cap + SEC debt − SEC cash / SEC revenue',[snapshot.provenance.revenue,marketCapQuote,snapshot.provenance.cash,snapshot.provenance.debt],retrievedAt,'(marketCap + debt − cash) / revenue')!;
  }
  if (snapshot.marketCap && snapshot.revenue && snapshot.revenue > 0 && usableEvidence(marketCapQuote,retrievedAt)) {
    snapshot.ps = snapshot.marketCap / snapshot.revenue;
    snapshot.provenance.ps = derivedEvidence('Derived from bulk market cap / SEC revenue',[snapshot.provenance.revenue,marketCapQuote],retrievedAt,'marketCap / revenue')!;
  }
  if (facts.shares && facts.priorShares && facts.priorShares.val > 0) {
    snapshot.shareCountRatio = facts.shares.val / facts.priorShares.val;
    snapshot.dilution = snapshot.shareCountRatio - 1;
    snapshot.provenance.dilution = {...derivedEvidence('SEC reported share ratio; corporate actions unverified',[frameProvenance(facts.shares,retrievedAt),frameProvenance(facts.priorShares,retrievedAt)],retrievedAt,'current / prior − 1')!,periodStart:facts.priorShares.end,periodEnd:facts.shares.end};
    snapshot.provenance.shareCountRatio=snapshot.provenance.dilution;
    snapshot.splitAdjusted=false;
    // A material split changes the reported share count by more than 2x (or
    // below 0.5x for a reverse split). Such rows remain UNKNOWN rather than
    // being promoted with an unadjusted dilution figure.
    snapshot.dataIssues?.push('نسبة الأسهم المعلنة ليست دليلًا على مراجعة التجزئة؛ تعديل corporate actions غير متحقق.');
  }
  snapshot.research = { financials: !!snapshot.revenue, valuation: snapshot.evSales != null, analysts: false, sector: !!company.sector };
  return applyFinancingRisk(snapshot);
}
