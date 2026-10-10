/** Reproduce integrity improvements with synthetic fixtures only.
 * Run npm run test:engine first to transpile the production helper module.
 * This does not measure stock returns, train weights or certify a backtest.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WEIGHTS, validateObservation, validateOpportunityDataset } from './opportunity-validation.mjs';
import { opportunityHistoryMetrics, pointInTime } from '../.test-build/research.mjs';
const DAY = 864e5, cutoff = Date.parse('2021-01-01');
function observation() {
  const bars = Array.from({ length: 184 }, (_, i) => new Date(Date.parse('2020-01-02') + i * DAY)).filter(d => ![0, 6].includes(d.getUTCDay())).map(d => ({ at: d.toISOString().slice(0, 10), close: 10, dividend: 0 }));
  return { symbol: 'SYNTHETIC', issuerId: 'synthetic-issuer', asOf: '2020-01-01', factors: Object.fromEntries(Object.keys(WEIGHTS).map(id => [id, { score: 5, sources: [{ id: 'synthetic', availableAt: '2019-12-01', periodEnd: '2019-09-30' }] }])), coverage: { membershipAsOf: '2020-01-01', delistedIncluded: true, corporateActionsComplete: true, outcomesComplete: true }, prices: { adjustment: 'split-adjusted-with-cash-dividends', entry: { at: '2020-01-02', price: 10 }, bars, observedUntil: '2020-07-03' }, costs: { roundTripBps: 100 }, benchmark: { source: 'synthetic', entryAt: '2020-01-02', exitAt: '2020-07-03', availableAt: '2020-07-03', totalReturn: .05 } };
}
export function syntheticAcceptance() {
  const valid = validateObservation(observation(), cutoff);
  assert.equal(valid.valid, true); assert.equal(valid.censored, false);
  const malformed = observation(); malformed.prices.entry.at = 'invalid-date';
  const invalidEntry = validateObservation(malformed, cutoff); assert.equal(invalidEntry.valid, false);
  const dead = observation(); dead.prices.delisting = { at: '2020-03-01', proceedsPerShare: 0 }; dead.benchmark.exitAt = '2020-03-01'; dead.prices.bars.find(b => b.at === '2020-04-01').dividend = 100;
  const postDelisting = validateObservation(dead, cutoff); assert.equal(postDelisting.valid, false); assert(postDelisting.errors.some(e => e.includes('terminal delisting')));
  const takeover = observation(); takeover.prices.bars = takeover.prices.bars.filter(b => b.at < '2020-03-01'); takeover.prices.delisting = { at: '2020-03-01', proceedsPerShare: 20 }; takeover.prices.observedUntil = takeover.benchmark.exitAt = takeover.benchmark.availableAt = '2020-03-01'; takeover.costs.roundTripBps = 0;
  const positivePayoff = validateObservation(takeover, cutoff); assert.equal(positivePayoff.valid, true); assert.equal(positivePayoff.totalReturn, 1); assert.equal(positivePayoff.majorUpside, true);
  const bars = Array.from({ length: 540 }, (_, i) => ({ date: new Date(Date.parse('2019-01-01') + i * DAY).toISOString().slice(0, 10), close: i < 366 ? 10 : 1000, low: i < 366 ? 9 : 900 })).filter(b => ![0, 6].includes(new Date(b.date).getUTCDay()));
  const historyWithFuture = opportunityHistoryMetrics(bars, '2020-01-02T00:00:00Z'), historyWithoutFuture = opportunityHistoryMetrics(bars.filter(b => b.date < '2020-01-02'), '2020-01-02T00:00:00Z');
  assert.deepEqual(historyWithFuture, historyWithoutFuture); assert.equal(historyWithFuture.return12m, 0);
  const invalidPeriods = pointInTime([{ periodEnd: '2099-01-01', availableAt: '2019-01-01' }, { periodEnd: 'invalid-date', availableAt: '2019-01-01' }], '2020-01-01'); assert.deepEqual(invalidPeriods, []);
  const historical = validateOpportunityDataset([], { cutoff }); assert.equal(historical.status, 'BLOCKED'); assert.equal(historical.probability, null);
  return { scope: 'Synthetic protocol defects only. No investment-performance evidence.', status: 'PASS', weights: WEIGHTS, historicalStatus: historical.status, probability: historical.probability, validControl: valid, invalidEntry, postDelisting, positivePayoff, historyWithFuture, historyWithoutFuture, invalidPeriods };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = syntheticAcceptance();
  const beforePath = process.argv[2];
  if (beforePath) {
    const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
    report.observedBeforeAfter = { invalidEntryPreviouslyAccepted: before.invalidEntry.valid, invalidEntryNowAccepted: report.invalidEntry.valid, postDelistingPreviouslyTotalReturn: before.postDelisting.totalReturn, postDelistingNowAccepted: report.postDelisting.valid, takeoverPreviouslyMajorUpside: before.positivePayoff.majorUpside, takeoverNowMajorUpside: report.positivePayoff.majorUpside, leakedTrailingReturnBefore: before.historyWithFuture.return12m, trailingReturnAfter: report.historyWithFuture.return12m, invalidPeriodsBefore: before.invalidPeriods.length, invalidPeriodsAfter: report.invalidPeriods.length };
  }
  console.log(JSON.stringify(report, null, 2));
}
