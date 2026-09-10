import fs from 'node:fs/promises';
import path from 'node:path';
import {MINIMUM} from './weight-lab.mjs';

const cachePath = process.argv[2] ?? path.resolve('lib/quick-cache.generated.json');
const cache = JSON.parse(await fs.readFile(cachePath, 'utf8'));
const entries = Object.entries(cache.symbols ?? {});
const bars = entries.map(([symbol, row]) => ({symbol, count: Array.isArray(row.history) ? row.history.length : 0, first: row.history?.[0]?.date ?? null, last: row.history?.at(-1)?.date ?? null, financialKeys: Object.keys(row.financials ?? {})}));
const first = bars.map(row => row.first).filter(Boolean).sort()[0] ?? null;
const last = bars.map(row => row.last).filter(Boolean).sort().at(-1) ?? null;
const months = first && last ? (Date.parse(last) - Date.parse(first)) / (30.44 * 864e5) : 0;
const report = {
  source: cachePath,
  generatedAt: cache.generatedAt ?? null,
  symbols: entries.length,
  history: {minBars: bars.length ? Math.min(...bars.map(row => row.count)) : 0, maxBars: bars.length ? Math.max(...bars.map(row => row.count)) : 0, first, last, months: Number(months.toFixed(1))},
  pointInTimeFundamentals: false,
  delistedUniverse: false,
  futureOutcomeLabels: false,
  blockers: [
    `Bounce requires at least ${MINIMUM.bounce.companies} companies and ${MINIMUM.bounce.rows} point-in-time observations; cache has ${entries.length} symbols and no labeled future outcomes.`,
    `Bounce coverage is ${months.toFixed(1)} months; the research protocol requires ${MINIMUM.bounce.months} months.`,
    'Core requires historical fundamentals with availableAt, periodEnd and filing source; this cache is a current quick snapshot, not a PIT panel.',
    'A survivorship-free study also requires delisted securities and corporate-action history; neither is present in this cache.',
  ],
};
console.log(JSON.stringify(report, null, 2));
