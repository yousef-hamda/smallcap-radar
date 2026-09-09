import type { Company } from './providers';
import { fetchJson } from './providers';
import type { Provenance, Snapshot } from './engine';
import bundledFrames from './sec-frames.generated.json';
import {REVENUE_TAGS} from './sec';
import {derivedEvidence,usableEvidence} from './evidence';
import {NON_TRADABLE_NAME} from './strategy-spec';

type FrameFact = { cik: number; entityName?: string; start?: string; end: string; val: number; filed?: string; form?: string; accn?: string; frame?: string };
type StoredFact = FrameFact & { tag: string; priority: number; url: string; fallback?: boolean; observedAt?:string };
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
type FrameConfig = { key: keyof BulkFundamentals; tag: string; taxonomy?: 'us-gaap' | 'ifrs-full' | 'dei'; unit: string; period: string; priority: number };

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
        const record = {...fundamentals.get(cik)};
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
        for (const key of Object.keys(bundled) as (keyof BulkFundamentals)[]) {
          const candidate = (bundled as BulkFundamentals)[key];
          if (!candidate||Date.parse(candidate.end)>asOf.getTime()) continue;
          const existing = current[key];
          if (!existing) {current[key] = { ...candidate, fallback: true,observedAt:bundledFrames.generatedAt };changed.add(cik);fallbackUsed=true;}
        }
        fundamentals.set(cik, current);
      }
    }
  }
  return { fundamentals, changed:[...changed],nextOffset:stop,totalConfigs:configs.length,done:stop>=configs.length, requests: requiredConfigs.length, optionalRequests: optionalConfigs.length, success, failed, optionalSuccess, optionalFailed, fallbackUsed, errors: [...new Set(errors)].slice(0, 8), annual, instant };
}

function frameProvenance(fact: StoredFact, retrievedAt: string): Provenance {
  return {
    source: fact.fallback ? 'SEC EDGAR XBRL Frames — official dated fallback snapshot' : 'SEC EDGAR XBRL Frames (official)',
    url: fact.url,
    periodStart: fact.start,
    periodEnd: fact.end,
    // Frames rows do not publish the filing timestamp. The fact is known to be
    // available no later than this retrieval, so do not invent an earlier date.
    availableAt: fact.filed ? `${fact.filed}T23:59:59.000Z` : fact.observedAt??(fact.fallback?bundledFrames.generatedAt:retrievedAt),
    retrievedAt:fact.observedAt??(fact.fallback?bundledFrames.generatedAt:retrievedAt),
    currency: 'USD',
    tag: fact.tag,
    confidence: fact.fallback ? 'low' : 'medium',
  };
}

export function preliminarySnapshot(company: Company, facts: BulkFundamentals | undefined, retrievedAt = new Date().toISOString()): Snapshot {
  const quoteDate = retrievedAt.slice(0, 10);
  const quote: Provenance = { source: company.quoteSource || 'Yahoo/Nasdaq bulk quote', periodEnd: quoteDate, availableAt: company.quoteAvailableAt || retrievedAt, retrievedAt, currency: 'USD', confidence: company.quoteSource?.includes('bundled') ? 'low' : 'medium' };
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
  if (snapshot.marketCap != null) snapshot.provenance.marketCap = quote;
  if (company.return52w != null) snapshot.provenance.return12m = quote
  if (company.low52w != null) snapshot.provenance.low52w = quote
  if (company.high52w != null) snapshot.provenance.high52w = quote
  if (!facts) { snapshot.dataIssues?.push('لا توجد تغطية SEC Frames لهذه الشركة في الفترة الجماعية.'); snapshot.dataIssues?.push('وسيط السيولة لـ20 يومًا لا يُستنتج من متوسط 10 أيام؛ يحتاج تاريخًا فعليًا قبل PASS.'); return snapshot }
  snapshot.dataIssues?.push('وسيط السيولة لـ20 يومًا لا يُستنتج من متوسط 10 أيام؛ يحتاج تاريخًا فعليًا قبل PASS.');

  facts=Object.fromEntries(Object.entries(facts).filter(([,fact])=>fact&&Number.isFinite(fact.val)&&usableEvidence(frameProvenance(fact,retrievedAt),retrievedAt))) as BulkFundamentals;
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
  if (snapshot.marketCap && snapshot.revenue && snapshot.revenue > 0 && facts.cash && debt != null && facts.cash.end===facts.debtCurrent?.end && usableEvidence(quote,retrievedAt)) {
    snapshot.evSales = (snapshot.marketCap + debt - facts.cash.val) / snapshot.revenue;
    snapshot.provenance.evSales = derivedEvidence('Derived from bulk market cap + SEC debt − SEC cash / SEC revenue',[snapshot.provenance.revenue,quote,snapshot.provenance.cash,snapshot.provenance.debt],retrievedAt,'(marketCap + debt − cash) / revenue')!;
  }
  if (snapshot.marketCap && snapshot.revenue && snapshot.revenue > 0 && usableEvidence(quote,retrievedAt)) {
    snapshot.ps = snapshot.marketCap / snapshot.revenue;
    snapshot.provenance.ps = derivedEvidence('Derived from bulk market cap / SEC revenue',[snapshot.provenance.revenue,quote],retrievedAt,'marketCap / revenue')!;
  }
  if (facts.shares && facts.priorShares && facts.priorShares.val > 0) {
    snapshot.shareCountRatio = facts.shares.val / facts.priorShares.val;
    snapshot.dilution = snapshot.shareCountRatio - 1;
    snapshot.provenance.dilution = derivedEvidence('SEC reported share ratio; corporate actions unverified',[frameProvenance(facts.shares,retrievedAt),frameProvenance(facts.priorShares,retrievedAt)],retrievedAt,'current / prior − 1')!;
    snapshot.provenance.shareCountRatio=snapshot.provenance.dilution;
    // A material split changes the reported share count by more than 2x (or
    // below 0.5x for a reverse split). Such rows remain UNKNOWN rather than
    // being promoted with an unadjusted dilution figure.
    snapshot.dataIssues?.push('نسبة الأسهم المعلنة ليست دليلًا على مراجعة التجزئة؛ تعديل corporate actions غير متحقق.');
  }
  snapshot.research = { financials: !!snapshot.revenue, valuation: snapshot.evSales != null, analysts: false, sector: !!company.sector };
  return snapshot;
}
