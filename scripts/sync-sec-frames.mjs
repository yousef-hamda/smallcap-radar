import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const universe = JSON.parse(await fs.readFile(path.join(root, 'lib/universe.generated.json'), 'utf8'));
const allowed = new Set(universe.companies.map((company) => Number(company.cik)));
const now = new Date();
const annual = `CY${now.getUTCFullYear() - 1}`;
const currentQuarter = Math.floor(now.getUTCMonth() / 3) + 1;
const quarter = currentQuarter === 1
  ? { year: now.getUTCFullYear() - 1, quarter: 4 }
  : { year: now.getUTCFullYear(), quarter: currentQuarter - 1 };
const instant = `CY${quarter.year}Q${quarter.quarter}I`;
const priorInstant = `CY${quarter.year - 1}Q${quarter.quarter}I`;
const configs = [
  ...[
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
    'SalesRevenueGoodsNet',
  ].map((tag, priority) => ({ key: 'revenue', tag, unit: 'USD', period: annual, priority, taxonomy: 'us-gaap' })),
  { key: 'netIncome', tag: 'NetIncomeLoss', unit: 'USD', period: annual, priority: 0, taxonomy: 'us-gaap' },
  { key: 'ocf', tag: 'NetCashProvidedByUsedInOperatingActivities', unit: 'USD', period: annual, priority: 0, taxonomy: 'us-gaap' },
  { key: 'capex', tag: 'PaymentsToAcquirePropertyPlantAndEquipment', unit: 'USD', period: annual, priority: 0, taxonomy: 'us-gaap' },
  { key: 'shares', tag: 'EntityCommonStockSharesOutstanding', unit: 'shares', period: instant, priority: 0, taxonomy: 'dei' },
  { key: 'priorShares', tag: 'EntityCommonStockSharesOutstanding', unit: 'shares', period: priorInstant, priority: 0, taxonomy: 'dei' },
  { key: 'cash', tag: 'CashAndCashEquivalentsAtCarryingValue', unit: 'USD', period: instant, priority: 0, taxonomy: 'us-gaap' },
  { key: 'debtCurrent', tag: 'LongTermDebtCurrent', unit: 'USD', period: instant, priority: 0, taxonomy: 'us-gaap' },
  { key: 'debtNoncurrent', tag: 'LongTermDebtNoncurrent', unit: 'USD', period: instant, priority: 0, taxonomy: 'us-gaap' },
];

const records = {};
const newer = (candidate, existing) => !existing || candidate.end > existing.end ||
  (candidate.end === existing.end && (candidate.filed > existing.filed ||
    (candidate.filed === existing.filed && candidate.priority < existing.priority)));

for (let index = 0; index < configs.length; index += 5) {
  const group = configs.slice(index, index + 5);
  const outcomes = await Promise.allSettled(group.map(async (config) => {
    const url = `https://data.sec.gov/api/xbrl/frames/${config.taxonomy}/${config.tag}/${config.unit}/${config.period}.json`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'SmallCapRadar/2.1 research-contact:yousef-hamda@users.noreply.github.com', Accept: 'application/json' },
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`${config.tag}: HTTP ${response.status}`);
    return { config, url, payload: await response.json() };
  }));
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') {
      console.warn(outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason));
      continue;
    }
    const { config, url, payload } = outcome.value;
    for (const row of payload.data ?? []) {
      const cik = Number(row.cik);
      if (!allowed.has(cik) || !Number.isFinite(row.val) || !row.end) continue;
      const fact = { ...row, tag: config.tag, priority: config.priority, url };
      records[cik] ??= {};
      if (newer(fact, records[cik][config.key])) records[cik][config.key] = fact;
    }
  }
}

const output = { generatedAt: new Date().toISOString(), annual, instant, requests: configs.length, fundamentals: records };
await fs.writeFile(path.join(root, 'lib/sec-frames.generated.json'), `${JSON.stringify(output)}\n`);
console.log(`Stored official SEC Frames for ${Object.keys(records).length} issuers from ${configs.length} requests.`);
