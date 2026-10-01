import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteJson, persistCompanyFactsCheckpoint } from './company-facts-sync-state.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outputPath = path.join(root, 'lib/sec-frames.generated.json');
const checkpointPath = path.join(root, 'work/company-facts-sync-checkpoint.json');
const universe = JSON.parse(await fs.readFile(path.join(root, 'lib/universe.generated.json'), 'utf8'));
const output = JSON.parse(await fs.readFile(outputPath, 'utf8'));
const now = new Date();
const nowIso = now.toISOString();
const cutoff = now.getTime();
const secAgent = process.env.SEC_USER_AGENT?.trim();
const keys = ['revenue', 'netIncome', 'ocf', 'capex', 'shares', 'priorShares', 'cash', 'debtCurrent', 'debtNoncurrent'];
const tags = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'SalesRevenueGoodsNet', 'Revenue', 'RevenueFromContractsWithCustomers'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  ocf: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations', 'NetCashFlowsFromUsedInOperatingActivities', 'CashFlowsFromUsedInOperatingActivities'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquirePropertyPlantAndEquipmentContinuingOperations', 'PurchaseOfPropertyPlantAndEquipment', 'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'],
  shares: ['EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding'],
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashAndCashEquivalents'],
  debtCurrent: ['LongTermDebtCurrent', 'ShortTermBorrowings', 'BorrowingsCurrent'],
  debtNoncurrent: ['LongTermDebtNoncurrent', 'LongTermDebt', 'BorrowingsNoncurrent', 'Borrowings'],
};
const annualForms = new Set(['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A']);

const listedFilers = universe.companies
  // Price and cap caches are neither identity tests nor reasons to skip small,
  // large, and recently listed issuers. Fetch all SEC-linked listing rows.
  .filter((company) => Number.isSafeInteger(Number(company.cik)) && Number(company.cik) > 0)
  .sort((a, b) => {
    const aPrimary = Number(a.marketCap) >= 25e6 && Number(a.marketCap) <= 2e9 ? 0 : 1;
    const bPrimary = Number(b.marketCap) >= 25e6 && Number(b.marketCap) <= 2e9 ? 0 : 1;
    return aPrimary - bPrimary || String(a.ticker).localeCompare(String(b.ticker));
  });
// Share classes can repeat one issuer CIK in the listing file. SEC facts are
// issuer-scoped, so make one request per CIK and keep all listings eligible
// for later joins in the app.
const candidateByCik = new Map();
for (const company of listedFilers) {
  const cik = Number(company.cik), previous = candidateByCik.get(cik);
  if (!previous || String(company.ticker).length < String(previous.ticker).length) candidateByCik.set(cik, company);
}
const candidates = [...candidateByCik.values()];
const universeFingerprint = createHash('sha256').update(candidates.map(company => `${Number(company.cik)}:${company.ticker}`).join('\n')).digest('hex');
if (process.argv.includes('--dry-run')) {
  console.log(`SEC Company Facts sync dry run: ${universe.companies.length} listing rows, ${listedFilers.length} CIK-linked rows, ${candidates.length} unique issuers; no network calls or files changed. Contact identity configured: ${Boolean(process.env.SEC_USER_AGENT?.trim())}.`);
  process.exit(0);
}
if (!secAgent || !/\([^()\s]+@[^()\s]+\.[^()\s]+\)/.test(secAgent)) {
  throw new Error('Set SEC_USER_AGENT to an application name followed by a reachable email in parentheses before making SEC requests.');
}

const usable = (fact) => fact && Number.isFinite(fact.val) && typeof fact.end === 'string' && Date.parse(fact.end) <= cutoff && typeof fact.filed === 'string' && Date.parse(`${fact.filed}T23:59:59Z`) <= cutoff;
const observations = (facts, requested, unit = 'USD') => requested.flatMap((tag) => ['us-gaap', 'ifrs-full', 'dei'].flatMap((namespace) => {
  const rows = facts?.[namespace]?.[tag]?.units?.[unit] || [];
  return rows.map((row) => ({ ...row, tag }));
}));
const latestInstantPair = (rows) => {
  const eligible = rows.filter((row) => usable(row) && !row.start).sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
  return { current: eligible[0], prior: eligible.find((row) => row.end < eligible[0]?.end) };
};
const trailingAnnual = (rows) => {
  const eligible = rows.filter((row) => usable(row) && row.start);
  const days = (row) => (Date.parse(row.end) - Date.parse(row.start)) / 86_400_000;
  const annual = eligible.filter((row) => annualForms.has(row.form) && days(row) >= 330 && days(row) <= 380).sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed))[0];
  if (!annual) return null;
  const interimForms = ['10-Q', '10-Q/A', '6-K', '6-K/A'];
  const ytd = eligible.filter((row) => interimForms.includes(row.form) && row.start > annual.end && (Date.parse(row.start) - Date.parse(annual.end)) / 86_400_000 <= 7 && days(row) > 50 && days(row) < 330).sort((a, b) => b.end.localeCompare(a.end) || days(b) - days(a) || b.filed.localeCompare(a.filed))[0];
  if (!ytd) return eligible.some((row) => interimForms.includes(row.form) && row.end > annual.end) ? null : annual;
  const prior = eligible.filter((row) => row.start && interimForms.includes(row.form) && Math.abs((Date.parse(ytd.start) - Date.parse(row.start)) / 86_400_000 - 365) <= 3 && Math.abs(days(row) - days(ytd)) <= 7 && row.end < ytd.end && row.tag === ytd.tag).sort((a, b) => b.filed.localeCompare(a.filed))[0];
  if (!prior || annual.tag !== ytd.tag) return null;
  return { ...ytd, val: annual.val + ytd.val - prior.val, start: new Date(Date.parse(ytd.end) - 365 * 86_400_000).toISOString().slice(0, 10), filed: [annual.filed, ytd.filed, prior.filed].sort().at(-1), method: 'annual + current YTD - prior YTD' };
};
const stored = (cik, fact, url) => fact ? { cik, start: fact.start, end: fact.end, val: fact.val, filed: fact.filed, form: fact.form, accn: fact.accn, tag: fact.tag, priority: 0, url, observedAt: nowIso, kind: 'companyfacts' } : undefined;

function parse(cik, payload, url) {
  const responseCik = typeof payload?.cik === 'number' ? payload.cik : typeof payload?.cik === 'string' && /^\d{1,10}$/.test(payload.cik) ? Number(payload.cik) : NaN;
  if (responseCik !== cik) return null;
  const facts = payload?.facts;
  if (!facts || !['us-gaap', 'ifrs-full'].some((namespace) => facts[namespace] && Object.keys(facts[namespace]).length)) return null;
  const result = {};
  for (const key of ['revenue', 'netIncome', 'ocf', 'capex']) result[key] = stored(cik, trailingAnnual(observations(facts, tags[key])), url);
  for (const key of ['cash', 'debtCurrent', 'debtNoncurrent']) result[key] = stored(cik, latestInstantPair(observations(facts, tags[key])).current, url);
  const pair = latestInstantPair(observations(facts, tags.shares, 'shares'));
  result.shares = stored(cik, pair.current, url);
  result.priorShares = stored(cik, pair.prior, url);
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value));
}

async function fetchFacts(company) {
  const cik = Number(company.cik);
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`;
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': secAgent, Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' }, signal: AbortSignal.timeout(20_000) });
      if (response.status === 404) return { cik, ticker: company.ticker, parsed: {}, status: 404 };
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) break;
      } else {
        const parsed = parse(cik, await response.json(), url);
        return parsed === null ? { cik, ticker: company.ticker, parsed: {}, status: 422, error: 'SEC issuer identity or standard taxonomy mismatch' } : { cik, ticker: company.ticker, parsed, status: 200 };
      }
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  return { cik, ticker: company.ticker, parsed: {}, status: 0, error: lastError };
}

await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
let state = { index: 0, success: 0, empty: 0, unavailable: 0, failed: 0 };
try {
  const checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8'));
  if (checkpoint.generatedAt === output.generatedAt && checkpoint.total === candidates.length && checkpoint.universeFingerprint === universeFingerprint) state = checkpoint.state;
} catch {}

for (let index = state.index; index < candidates.length; index += 4) {
  const batch = candidates.slice(index, index + 4);
  const outcomes = await Promise.all(batch.map(fetchFacts));
  for (const outcome of outcomes) {
    if (outcome.status === 200) {
      state.success++;
      if (!Object.keys(outcome.parsed).length) state.empty++;
      const current = output.fundamentals[outcome.cik] || {};
      for (const key of keys) {
        const candidate = outcome.parsed[key], existing = current[key];
        if (candidate && (!existing || String(candidate.filed || '') > String(existing.filed || '') || (candidate.filed === existing.filed && candidate.end > existing.end))) current[key] = candidate;
      }
      if (Object.keys(current).length) output.fundamentals[outcome.cik] = current;
    } else if (outcome.status === 404) state.unavailable++;
    else { state.failed++; console.warn(`${outcome.ticker}: ${outcome.error || 'unavailable'}`); }
  }
  state.index = index + batch.length;
  if (state.index % 40 === 0 || state.index === candidates.length) {
    await persistCompanyFactsCheckpoint(outputPath, checkpointPath, output, { generatedAt: output.generatedAt, total: candidates.length, universeFingerprint, state });
    console.log(`${state.index}/${candidates.length} · success ${state.success} · empty ${state.empty} · 404 ${state.unavailable} · failed ${state.failed}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 450));
}

output.generatedAt = nowIso;
output.companyFactsRequests = state.success + state.unavailable + state.failed;
output.companyFactsSuccess = state.success;
output.companyFactsFailed = state.failed;
await atomicWriteJson(outputPath, output);
console.log(`Merged compact official Company Facts for ${state.success} issuers; ${state.unavailable} had no SEC entity facts; ${state.failed} requests failed.`);
