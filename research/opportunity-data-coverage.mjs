import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [universe, frames, listingIdentity] = await Promise.all([
  fs.readFile(path.join(root, 'lib/universe.generated.json'), 'utf8').then(JSON.parse),
  fs.readFile(path.join(root, 'lib/sec-frames.generated.json'), 'utf8').then(JSON.parse),
  fs.readFile(path.join(root, 'docs/UNIFIED_OPPORTUNITY_LISTING_IDENTITY_CHECK_2026_10_01.json'), 'utf8').then(JSON.parse),
]);
const rows = universe.companies ?? [];
const facts = frames.fundamentals ?? {};
const metricNames = ['revenue', 'netIncome', 'ocf', 'capex', 'shares', 'priorShares', 'cash', 'debtCurrent', 'debtNoncurrent'];
const count = predicate => rows.filter(predicate).length;
const factCount = metric => count(company => {
  const issuerFacts = facts[String(company.cik)];
  return issuerFacts && Object.hasOwn(issuerFacts, metric) && Number.isFinite(issuerFacts[metric]?.val)
    && typeof issuerFacts[metric]?.end === 'string' && typeof issuerFacts[metric]?.url === 'string';
});
const pct = value => rows.length ? `${(value / rows.length * 100).toFixed(1)}%` : 'n/a';
const metrics = Object.fromEntries(metricNames.map(metric => [metric, factCount(metric)]));
const matchedCiks = new Set(rows.filter(company => facts[String(company.cik)]).map(company => String(company.cik)));
const report = {
  measuredAt: new Date().toISOString(),
  scope: 'Local bundled issuer/quote directory joined by CIK to SEC Frames/Company Facts fallback. This is not a live-provider check and not a complete stock-profile coverage measure.',
  universe: {
    generatedAt: universe.generatedAt,
    listedRows: rows.length,
    withCik: count(company => Number(company.cik) > 0),
    withPositiveCachedPrice: count(company => Number(company.price) > 0),
    withPositiveCachedMarketCap: count(company => Number(company.marketCap) > 0),
    below5mMarketCap: count(company => Number(company.marketCap) > 0 && Number(company.marketCap) < 5e6),
    above5bMarketCap: count(company => Number(company.marketCap) > 5e9),
    missingMarketCap: count(company => !(Number(company.marketCap) > 0)),
  },
  secFacts: {
    generatedAt: frames.generatedAt,
    issuerRecords: Object.keys(facts).length,
    matchedListedCiks: matchedCiks.size,
    matchedListingRows: count(company => !!facts[String(company.cik)]),
    listingRowCoverage: pct(count(company => !!facts[String(company.cik)])),
    fields: Object.fromEntries(Object.entries(metrics).map(([field, value]) => [field, { listingRows: value, percentOfUniverse: pct(value) }])),
  },
  listingIdentity: {
    staticBundleRows: rows.length,
    staticRowsWithExplicitClassAndSource: count(company => !!company.securityType && company.securityType !== 'unknown' && !!company.directoryUrl && !!company.directoryAvailableAt),
    liveExchangeAudit: {
      retrievedAt: listingIdentity.retrievedAt,
      includedRows: listingIdentity.includedRows,
      explicitCommonRows: listingIdentity.securityTypeCounts.common,
      unresolvedRows: listingIdentity.securityTypeCounts.unknown,
      sourceUrls: listingIdentity.sourceUrls,
      scope: 'A dated live directory parse; not the coverage of the older static bundle, all US venues, or the running Railway service.',
    },
  },
  notMeasuredByThisBundle: [
    'valuation methods and fair-value scenarios', 'contract binding status and catalyst pricing-in',
    'eight-quarter earnings bridges and GAAP/non-GAAP reconciliation', 'debt covenants and detailed maturities',
    'customer concentration, peers, market share, and competitive durability', 'litigation and exhaustive governance review',
    'rights-cleared short-interest/borrow data', 'point-in-time chart signals and scenario probabilities',
  ],
  warning: 'Bundled data timestamps predate this measurement date. Counts indicate local field presence only; they do not prove source correctness, freshness, security-class identity, or production-provider health. The live listing audit is a separately dated parser check, not evidence that listing identity has been backfilled into the static bundle or production.',
};
console.log(JSON.stringify(report, null, 2));
