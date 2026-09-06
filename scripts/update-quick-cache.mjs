import fs from 'node:fs/promises';

const [universePath, outputPath] = process.argv.slice(2);
if (!universePath || !outputPath) throw new Error('Usage: node scripts/update-quick-cache.mjs UNIVERSE_JSON OUTPUT_JSON');
const universe = JSON.parse(await fs.readFile(universePath, 'utf8'));
const excludedSecurity = /\b(etf|fund|trust|warrant|right|unit|preferred|depositary|senior note|bond|debenture|limited partnership)\b|,\s*L\.P\./i;
const eligible = universe.companies.filter((company) => company.marketCap >= 25e6 && company.marketCap <= 2e9 && !excludedSecurity.test(company.name));
const selected = Array.from({ length: Math.min(12, eligible.length) }, (_, index) => eligible[Math.floor(index * eligible.length / Math.min(12, eligible.length))]);
const now = new Date().toISOString();
const from = new Date(Date.now() - 550 * 864e5).toISOString().slice(0, 10);
const to = now.slice(0, 10);
const revenueTags = ['RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'SalesRevenueGoodsNet'];
const forms = new Set(['10-K', '20-F', '40-F']);

const rows = (facts, tags, unit = 'USD') => tags.flatMap((tag) => (facts?.['us-gaap']?.[tag]?.units?.[unit] ?? facts?.['ifrs-full']?.[tag]?.units?.[unit] ?? facts?.dei?.[tag]?.units?.[unit] ?? []).map((row) => ({ ...row, tag })));
const annual = (facts, tags) => rows(facts, tags).filter((row) => row.start && forms.has(row.form) && Number.isFinite(row.val) && (Date.parse(row.end) - Date.parse(row.start)) / 864e5 >= 330 && (Date.parse(row.end) - Date.parse(row.start)) / 864e5 <= 380).sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed))[0];
const evidence = (fact, url) => fact ? { source: 'SEC EDGAR cached snapshot', url, periodStart: fact.start, periodEnd: fact.end, availableAt: `${fact.filed}T23:59:59Z`, retrievedAt: now, currency: 'USD', tag: fact.tag, confidence: 'high' } : undefined;
const number = (value) => { const parsed = Number(String(value ?? '').replace(/[$,%+,]/g, '').trim()); return Number.isFinite(parsed) ? parsed : null };
const isoDate = (value) => { const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value); return match ? `${match[3]}-${match[1]}-${match[2]}` : '' };

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`${new URL(url).hostname}: HTTP ${response.status}`);
  return response.json();
}

async function build(company) {
  const historyUrl = `https://api.nasdaq.com/api/quote/${encodeURIComponent(company.ticker)}/historical?assetclass=stocks&fromdate=${from}&todate=${to}&limit=5000`;
  const factsUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(company.cik).padStart(10, '0')}.json`;
  const [historyResult, factsResult] = await Promise.allSettled([
    fetchJson(historyUrl, { 'User-Agent': 'Mozilla/5.0 Chrome/124 Safari/537.36', Accept: 'application/json, text/plain, */*', Referer: 'https://www.nasdaq.com/' }),
    fetchJson(factsUrl, { 'User-Agent': 'SmallCapRadar/2.1 research-contact:yousef-hamda@users.noreply.github.com', Accept: 'application/json' }),
  ]);
  const result = { history: [], financials: {}, provenance: {}, issues: [] };
  if (historyResult.status === 'fulfilled') {
    result.history = (historyResult.value.data?.tradesTable?.rows ?? []).map((row) => ({ date: isoDate(row.date), close: number(row.close), open: number(row.open), high: number(row.high), low: number(row.low), volume: number(row.volume) })).filter((row) => row.date && row.close > 0 && row.low > 0).sort((a, b) => a.date.localeCompare(b.date));
  } else result.issues.push(String(historyResult.reason?.message ?? historyResult.reason));
  if (factsResult.status === 'fulfilled') {
    const facts = factsResult.value.facts;
    const revenue = annual(facts, revenueTags), netIncome = annual(facts, ['NetIncomeLoss', 'ProfitLoss']), ocf = annual(facts, ['NetCashProvidedByUsedInOperatingActivities']), capex = annual(facts, ['PaymentsToAcquirePropertyPlantAndEquipment']);
    for (const [key, fact] of Object.entries({ revenue, netIncome, ocf, capex })) if (fact) { result.financials[key] = fact.val; result.provenance[key] = evidence(fact, factsUrl) }
    if (ocf && capex && ocf.end === capex.end) { result.financials.fcf = ocf.val - capex.val; result.provenance.fcf = { ...evidence(ocf, factsUrl), tag: 'OperatingCashFlow − PaymentsToAcquirePropertyPlantAndEquipment', availableAt: [result.provenance.ocf.availableAt, result.provenance.capex.availableAt].sort().at(-1) } }
  } else result.issues.push(String(factsResult.reason?.message ?? factsResult.reason));
  console.log(company.ticker, result.history.length, Object.keys(result.financials).length);
  return [company.ticker, result];
}

const entries = [];
for (let index = 0; index < selected.length; index += 4) entries.push(...await Promise.all(selected.slice(index, index + 4).map(build)));
await fs.writeFile(outputPath, `${JSON.stringify({ generatedAt: now, symbols: Object.fromEntries(entries) })}\n`);
console.log(`Wrote ${entries.length} cached quick-scan symbols to ${outputPath}`);
