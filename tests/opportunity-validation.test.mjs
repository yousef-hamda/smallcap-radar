import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { WEIGHTS, PROTOCOL, validateObservation, validateOpportunityDataset } from '../research/opportunity-validation.mjs';
const DAY = 864e5, cutoff = Date.parse('2025-01-01');
const iso = at => new Date(at).toISOString().slice(0, 10);
function row(asOf = '2020-01-01') {
  let entryAt = Date.parse(asOf) + DAY;
  while ([0, 6].includes(new Date(entryAt).getUTCDay())) entryAt += DAY;
  const target = entryAt + PROTOCOL.horizonDays * DAY;
  let exitAt = target;
  while ([0, 6].includes(new Date(exitAt).getUTCDay())) exitAt += DAY;
  const bars = [];
  for (let at = entryAt; at <= exitAt; at += DAY) if (![0, 6].includes(new Date(at).getUTCDay())) bars.push({ at: iso(at), close: iso(at) === '2020-04-01' ? 15 : at < Date.parse('2020-04-01') ? 10 : 12, dividend: iso(at) === '2020-04-01' ? 1 : 0 });
  return { symbol: 'FIXTURE', issuerId: 'CIK-1', asOf, factors: Object.fromEntries(Object.keys(WEIGHTS).map(id => [id, { score: 5, sources: [{ id: 'SYNTHETIC', availableAt: '2019-12-01', periodEnd: '2019-09-30' }] }])), coverage: { membershipAsOf: asOf, delistedIncluded: true, corporateActionsComplete: true, outcomesComplete: true }, prices: { adjustment: 'split-adjusted-with-cash-dividends', entry: { at: iso(entryAt), price: 10 }, bars, observedUntil: iso(exitAt) }, costs: { roundTripBps: 100 }, benchmark: { source: 'SYNTHETIC benchmark', entryAt: iso(entryAt), exitAt: iso(exitAt), availableAt: iso(exitAt), totalReturn: .05 } };
}
function terminalRow(proceeds = 0) {
  const r = row(); r.prices.bars = r.prices.bars.filter(bar => bar.at < '2020-03-01');
  r.prices.delisting = { at: '2020-03-01', proceedsPerShare: proceeds }; r.prices.observedUntil = '2020-03-01';
  r.benchmark.exitAt = r.benchmark.availableAt = '2020-03-01'; return r;
}
const setScore = (r, score) => { for (const f of Object.values(r.factors)) f.score = score; return r; };

test('fixed-weight validation includes dividends, costs, executable entries and complete horizon sessions', () => {
  const r = validateObservation(row(), cutoff);
  assert.equal(r.valid, true); assert.equal(r.censored, false); assert.equal(r.score, 50); assert.equal(r.majorUpside, true);
  assert(Math.abs(r.totalReturn - .29) < 1e-10); assert(Math.abs(r.maxDrawdown + 3 / 16) < 1e-10);
  assert.equal(r.end, Date.parse('2020-07-03')); assert.equal(r.exitAt, Date.parse('2020-07-03'));
  assert.equal(validateObservation(row(), Date.parse('2020-06-01')).valid, false);
  assert.deepEqual(WEIGHTS, { valuation: 25, catalysts: 20, financialStrength: 15, earningsQuality: 12, competitivePosition: 10, downsideRisk: 10, management: 5, technicalTiming: 3 });
});

test('future evidence and unsupported membership/actions cannot validate opportunity claims', () => {
  for (const change of [r => r.factors.valuation.sources[0].availableAt = '2020-02-01', r => r.factors.valuation.sources[0].periodEnd = '2020-02-01', r => r.coverage.delistedIncluded = false, r => r.prices.entry.at = '2019-12-31', r => delete r.costs]) {
    const r = row(); change(r); assert.equal(validateObservation(r, cutoff).valid, false);
  }
  const report = validateOpportunityDataset([row(), row()], { cutoff });
  assert.equal(report.status, 'BLOCKED'); assert.equal(report.counts.rejected, 1); assert.equal(report.probability, null);
});

test('terminal payoffs measure both bankruptcy losses and successful takeovers', () => {
  const failure = validateObservation(terminalRow(), cutoff);
  assert.equal(failure.valid, true); assert.equal(failure.censored, false); assert.equal(failure.totalReturn, -1.01); assert.equal(failure.maxDrawdown, -1); assert.equal(failure.majorUpside, false);
  const success = validateObservation(terminalRow(20), cutoff);
  assert.equal(success.valid, true); assert.equal(success.censored, false); assert.equal(success.totalReturn, .99); assert.equal(success.maxReturn, .99); assert.equal(success.majorUpside, true);
  assert.equal(success.exitAt, Date.parse('2020-03-01'));
});

test('post-delisting bars and dividends cannot revive terminal losses', () => {
  const r = terminalRow(); r.prices.bars.push({ at: '2020-04-01', close: 100, dividend: 100 }); r.prices.observedUntil = '2020-04-01';
  const result = validateObservation(r, cutoff); assert.equal(result.valid, false); assert(result.errors.some(e => e.includes('terminal delisting')));
});

test('invalid or impossible dates and weekend entries are rejected instead of NaN bypasses', () => {
  for (const change of [r => r.prices.entry.at = 'invalid-date', r => r.prices.entry.at = '2020-02-30', r => r.prices.entry.at = '2020-01-04', r => r.prices.entry.at = '2020-01-20', r => r.asOf = '2020-02-30', r => r.prices.bars[0].at = '2020-02-30', r => r.factors.valuation.sources[0].availableAt = '2019-11-31', r => r.prices.observedUntil = 'invalid', r => r.costs.roundTripBps = Infinity]) {
    const r = row(); change(r); assert.equal(validateObservation(r, cutoff).valid, false);
  }
  assert.equal(validateObservation(null, cutoff).valid, false);
});

test('observed-through identity must cover all prices and terminal proceeds', () => {
  const r = terminalRow(); r.prices.observedUntil = '2020-01-02'; assert.equal(validateObservation(r, cutoff).valid, false);
  const early = row(); early.prices.observedUntil = '2020-04-01'; assert.equal(validateObservation(early, cutoff).valid, false);
  const future = row(); future.prices.observedUntil = '2026-01-01'; assert.equal(validateObservation(future, cutoff).valid, false);
});

test('declared coverage cannot replace missing price sessions or a completed horizon', () => {
  const sparse = row(); sparse.prices.bars = [sparse.prices.bars[0], sparse.prices.bars.at(-1)];
  assert.equal(validateObservation(sparse, cutoff).censored, true);
  const incomplete = row(); incomplete.prices.bars = incomplete.prices.bars.filter(b => b.at < '2020-07-03'); incomplete.prices.observedUntil = incomplete.prices.bars.at(-1).at;
  const result = validateObservation(incomplete, cutoff); assert.equal(result.valid, true); assert.equal(result.censored, true);
  const payoff = terminalRow(); payoff.prices.delisting.at = '2019-12-31'; assert.equal(validateObservation(payoff, cutoff).valid, false);
});

test('benchmark returns require matching entry/exit and real observed availability', () => {
  for (const change of [r => delete r.benchmark.entryAt, r => delete r.benchmark.exitAt, r => delete r.benchmark.availableAt, r => r.benchmark.entryAt = '2020-01-03', r => r.benchmark.exitAt = '2020-07-02', r => r.benchmark.availableAt = '2020-01-01', r => r.benchmark.availableAt = '2026-01-01', r => r.benchmark.totalReturn = -2]) {
    const r = row(); change(r); assert.equal(validateObservation(r, cutoff).valid, false);
  }
  assert.equal(validateObservation(row(), cutoff).valid, true);
});

test('six-month window starts at executable entry and exits on first nearby completed session', () => {
  const r = row('2020-01-02'); // Entry Friday Jan 3; target Saturday July 4, exit Monday July 6.
  const result = validateObservation(r, cutoff);
  assert.equal(result.valid, true); assert.equal(result.censored, false); assert.equal(result.end, Date.parse('2020-07-04')); assert.equal(result.exitAt, Date.parse('2020-07-06'));
  r.prices.bars = r.prices.bars.filter(b => b.at < '2020-07-04');
  r.prices.bars.push({ at: '2020-07-20', close: 12, dividend: 0 }); r.prices.observedUntil = '2020-07-20'; r.benchmark.exitAt = '2020-07-04'; r.benchmark.availableAt = '2020-07-20';
  const late = validateObservation(r, cutoff); assert.equal(late.valid, true); assert.equal(late.censored, true);
});

test('top decile is selected within every signal date and survives input permutations', () => {
  const rows = [];
  for (const [date, base] of [['2020-01-01', 8], ['2021-01-01', 2]]) for (let i = 0; i < 10; i++) {
    const r = setScore(row(date), base + i / 10); r.symbol = `${date.slice(0, 4)}-${i}`; r.issuerId = r.symbol;
    for (const b of r.prices.bars) { b.close = date === '2021-01-01' && i === 9 ? 20 : 10; b.dividend = 0; }
    rows.push(r);
  }
  const report = validateOpportunityDataset(rows, { cutoff });
  assert.equal(report.counts.accepted, 20); assert.equal(report.metrics.all.signalDates, 2); assert.equal(report.metrics.all.topDecile.rows, 2); assert.equal(report.metrics.all.topDecile.majorUpsideRate, .5);
  assert.deepEqual(report.metrics, validateOpportunityDataset([...rows].reverse(), { cutoff }).metrics);
});

test('research symbol ties use the same BINARY ordering as saved production ranks', () => {
  const upper = row(), lower = row(); upper.symbol = 'Z'; lower.symbol = 'a'; lower.issuerId = 'CIK-2';
  for (const b of upper.prices.bars) { b.close = 10; b.dividend = 0; }
  for (const b of lower.prices.bars) { b.close = 20; b.dividend = 0; }
  const report = validateOpportunityDataset([lower, upper], { cutoff });
  assert.equal(report.counts.accepted, 2); assert.equal(report.metrics.all.topDecile.rows, 1); assert.equal(report.metrics.all.topDecile.majorUpsideRate, 0);
});

test('chronological purging uses actual exit rather than the shorter signal horizon', () => {
  const issuer = Array.from({ length: 100 }, (_, i) => `issuer-${i}`).find(id => parseInt(createHash('sha256').update(id).digest('hex').slice(0, 8), 16) % 100 >= 20);
  const rows = ['2020-01-01', '2020-01-02', '2020-02-01', '2020-07-03', '2021-01-01'].map((date, i) => { const r = row(date); r.symbol = `P${i}`; r.issuerId = issuer; return r; });
  const report = validateOpportunityDataset(rows, { cutoff });
  assert.equal(report.counts.accepted, 5); assert.equal(report.metrics.train.rows, 0); assert.equal(report.counts.purged, 4);
});

test('equivalent timestamp encodings cannot bypass duplicate detection', () => {
  const first = row(), second = row(); second.asOf = second.coverage.membershipAsOf = '2020-01-01T00:00:00.000Z';
  const report = validateOpportunityDataset([first, second], { cutoff }); assert.equal(report.counts.rejected, 1);
});

test('absent historical data remain blocked and never publish synthetic performance probabilities', () => {
  const report = validateOpportunityDataset([], { cutoff }); assert.equal(report.status, 'BLOCKED'); assert.equal(report.probability, null); assert.equal(report.calibrationStatus, 'unvalidated'); assert.equal(report.counts.accepted, 0); assert.equal(report.metrics.all.topDecile.majorUpsideRate, null);
});
