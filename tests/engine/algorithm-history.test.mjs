import test from 'node:test';
import assert from 'node:assert/strict';
import { completedSessionQuote, opportunityHistoryMetrics, ma30Weeks, pointInTime } from '../../.test-build/research.mjs';
import { syntheticAcceptance } from '../../research/algorithm-synthetic-acceptance.mjs';
import { evidenceTimestamp, validEvidenceDate, usableEvidence, derivedEvidence, validEvidenceConversion } from '../../.test-build/evidence.mjs';
import { modelEvidenceAvailable } from '../../.test-build/financial-integrity.mjs';
import { isOpportunityProvenanceValid } from '../../.test-build/opportunity-engine.mjs';
const DAY = 864e5;
const iso = at => new Date(at).toISOString().slice(0, 10);
function history() {
  return Array.from({ length: 540 }, (_, i) => ({ date: iso(Date.parse('2019-01-01') + i * DAY), close: i < 366 ? 10 : 1000, low: i < 366 ? 9 : 900 })).filter(r => ![0, 6].includes(new Date(r.date).getUTCDay()));
}
const cutoff = '2020-01-02T00:00:00Z';

test('future prices cannot change point-in-time returns, lows or completed-week averages', () => {
  const rows = history(), known = rows.filter(r => r.date < '2020-01-02');
  const expected = opportunityHistoryMetrics(known, cutoff);
  assert.equal(expected.return12m, 0); assert.equal(expected.low52w, 9); assert.equal(expected.ma30w, 10);
  assert.deepEqual(opportunityHistoryMetrics(rows, cutoff), expected);
  assert.deepEqual(opportunityHistoryMetrics([...rows].reverse(), cutoff), expected);
  assert.equal(ma30Weeks(rows, cutoff), ma30Weeks(known, cutoff));
});

test('daily closes enter history only after the conservative completed-session availability', () => {
  const rows = [{ date: '2020-01-06', close: 10 }, { date: '2020-01-07', close: 11 }, { date: '2020-01-08', close: 15 }];
  assert.deepEqual(completedSessionQuote(rows, '2020-01-08T20:59:59Z'), { price: 11, dailyChange: 11 / 10 - 1, periodEnd: '2020-01-07' });
  const completed = completedSessionQuote(rows, '2020-01-08T21:00:00Z');
  assert.equal(completed.price, 15); assert.equal(completed.periodEnd, '2020-01-08'); assert.equal(completed.dailyChange, 15 / 11 - 1);
});

test('identical duplicates count once, while conflicting duplicate closes withhold derived history', () => {
  const rows = history(), expected = opportunityHistoryMetrics(rows, cutoff);
  assert.deepEqual(opportunityHistoryMetrics([...rows, ...structuredClone(rows)], cutoff), expected);
  const known = rows.find(r => r.date === '2019-12-31');
  assert.deepEqual(opportunityHistoryMetrics([...rows, { ...known, close: 100 }], cutoff), { return12m: null, low52w: null, ma30w: null });
  assert.equal(ma30Weeks([...rows, { ...known, close: 100 }], cutoff), null);
  assert.equal(completedSessionQuote([...rows, { ...known, close: 100 }], cutoff), null);
  // Future conflicting duplicates remain unknown and cannot affect today's grade.
  const future = rows.find(r => r.date > '2020-02-01');
  assert.deepEqual(opportunityHistoryMetrics([...rows, { ...future, close: 1 }], cutoff), expected);
});

test('conflicting duplicated daily lows also withhold range evidence', () => {
  const rows = history(), known = rows.find(r => r.date === '2019-12-31');
  assert.deepEqual(opportunityHistoryMetrics([...rows, { ...known, low: 1 }], cutoff), { return12m: null, low52w: null, ma30w: null });
});

test('duplicate bars cannot manufacture a full year of range observations', () => {
  const rows = history().filter(r => r.date < '2020-01-02').slice(-200);
  assert.equal(opportunityHistoryMetrics([...rows, ...rows], cutoff).low52w, null);
});

test('invalid dates, invalid closes and weekends cannot contribute market history', () => {
  const rows = history(), expected = opportunityHistoryMetrics(rows, cutoff);
  const malformed = [{ date: '2019-02-30', close: 1, low: .5 }, { date: 'invalid', close: 1 }, { date: '2019-12-29', close: 1, low: .5 }, { date: '2019-12-30', close: Infinity }, { date: '2019-12-30', close: 0 }];
  assert.deepEqual(opportunityHistoryMetrics([...rows, ...malformed], cutoff), expected);
  assert.deepEqual(opportunityHistoryMetrics(rows, '2020-02-30'), { return12m: null, low52w: null, ma30w: null });
  assert.equal(completedSessionQuote(rows, 'invalid'), null);
});

test('point-in-time facts require valid periods known by both disclosure and evaluation cutoffs', () => {
  const valid = { periodEnd: '2019-09-30', availableAt: '2019-11-01', value: 5 };
  const invalid = [{ periodEnd: '2099-01-01', availableAt: '2019-01-01' }, { periodEnd: 'invalid', availableAt: '2019-01-01' }, { periodEnd: '2019-02-30', availableAt: '2019-03-31' }, { periodEnd: '2019-09-30', availableAt: '2019-11-31' }, { periodEnd: '2019-09-30', availableAt: '2019-09-01' }, { periodEnd: '2019-12-31', availableAt: '2020-03-01' }];
  assert.deepEqual(pointInTime([valid, ...invalid], cutoff), [{ ...valid, availabilityEstimated: false }]);
  assert.throws(() => pointInTime([valid], '2020-02-30'), /Invalid cutoff/);
});

test('estimated disclosure lag remains explicit and never becomes verified availability', () => {
  const rows = [{ periodEnd: '2019-09-30' }, { periodEnd: '2019-12-31' }];
  assert.deepEqual(pointInTime(rows, cutoff), [{ periodEnd: '2019-09-30', availabilityEstimated: true }]);
  assert.equal(pointInTime([{ periodEnd: '2019-12-31', availableAt: '2020-01-01T21:00:00Z' }], cutoff).length, 1);
});

test('reusable synthetic acceptance tool passes positive controls without publishing historical claims', () => {
  const report = syntheticAcceptance();
  assert.equal(report.status, 'PASS'); assert.equal(report.historicalStatus, 'BLOCKED'); assert.equal(report.probability, null);
  assert.equal(report.validControl.valid, true); assert.equal(report.invalidEntry.valid, false); assert.equal(report.postDelisting.valid, false); assert.equal(report.positivePayoff.majorUpside, true);
});

const datedSource = () => ({ source: 'Synthetic SEC fact', url: 'https://www.sec.gov/Archives/edgar/data/1/a.htm', periodEnd: '2026-06-30', availableAt: '2026-07-01', retrievedAt: '2026-07-02', currency: 'USD', rightsStatus: 'unknown' });
const convertedSource = () => ({ ...datedSource(), conversion: { rate: .01, sourceCurrency: 'JPY', targetCurrency: 'USD', method: 'period-average-daily-reference-cross-rate', ratePeriodStart: '2026-01-01', ratePeriodEnd: '2026-01-03', observationCount: 3, sourceUrl: 'https://data-api.ecb.europa.eu/service/data/EXR/D.JPY+USD.EUR.SP00.A', rateProvider: 'European Central Bank (ECB) Data Portal', inputAvailableAt: '2026-07-01', inputRetrievedAt: '2026-07-02' } });
const evidenceCutoff = '2026-10-08T12:00:00Z';

test('shared evidence dates reject normalized impossible dates while preserving valid timezone timestamps', () => {
  for (const date of ['2026-02-30', '2026-11-31', '2026-01-01T24:00:00Z', '2026-01-01T12:60:00Z', '2026-01-01T12:00:60Z', 'invalid']) assert.equal(validEvidenceDate(date), false, date);
  assert.equal(validEvidenceDate('2024-02-29'), true); assert.equal(validEvidenceDate('2026-01-01T01:00:00+03:00'), true);
  assert.equal(evidenceTimestamp('2026-01-01T01:00:00+03:00'), Date.parse('2025-12-31T22:00:00Z'));
  assert.equal(usableEvidence({ ...datedSource(), periodEnd: '2026-02-30' }, evidenceCutoff), false);
  assert.equal(usableEvidence({ ...datedSource(), periodStart: '2025-02-30' }, evidenceCutoff), false);
  assert.equal(usableEvidence({ ...datedSource(), periodStart: '2026-07-01' }, evidenceCutoff), false);
  assert.equal(usableEvidence({ ...datedSource(), availableAt: '2026-06-01' }, evidenceCutoff), false);
});

test('derived provenance cannot hide invalid or future retrieval dates', () => {
  const valid = datedSource(); assert(derivedEvidence('Synthetic derived', [valid], evidenceCutoff, 'test'));
  for (const retrievedAt of ['2026-02-30', '2027-01-01', 'invalid']) assert.equal(derivedEvidence('Synthetic derived', [{ ...valid, retrievedAt }], evidenceCutoff, 'test'), undefined);
});

test('shared FX validation rejects future windows, impossible dates, nonpositive rates and unrelated rate series', () => {
  const good = convertedSource(); assert.equal(validEvidenceConversion(good, evidenceCutoff), true);
  assert.equal(modelEvidenceAvailable(good, evidenceCutoff), true, 'valid model evidence retains explicitly unknown rights');
  assert.equal(isOpportunityProvenanceValid({ ...good, rightsStatus: 'public-domain' }, evidenceCutoff), true);
  for (const changes of [{ ratePeriodStart: '2027-01-01', ratePeriodEnd: '2027-01-03' }, { ratePeriodEnd: '2026-02-30' }, { rate: 0 }, { rate: -1 }, { rate: Infinity }, { inputRetrievedAt: '2027-01-01' }, { inputAvailableAt: '2026-08-01' }, { inputRetrievedAt: '2026-08-01' }, { sourceUrl: 'https://data-api.ecb.europa.eu/service/data/EXR/D.GBP+USD.EUR.SP00.A' }, { sourceUrl: 'https://other.test/service/data/EXR/D.JPY+USD.EUR.SP00.A' }]) {
    const bad = { ...good, conversion: { ...good.conversion, ...changes } };
    assert.equal(validEvidenceConversion(bad, evidenceCutoff), false); assert.equal(modelEvidenceAvailable(bad, evidenceCutoff), false); assert.equal(isOpportunityProvenanceValid({ ...bad, rightsStatus: 'public-domain' }, evidenceCutoff), false);
  }
  assert.equal(modelEvidenceAvailable({ ...datedSource(), retrievedAt: '2026-02-30' }, evidenceCutoff), false);
  const frankfurter = { ...good, conversion: { ...good.conversion, sourceUrl: 'https://api.frankfurter.dev/v2/providers/ecb/rates?from=2026-01-01&to=2026-01-03&base=EUR&quotes=JPY%2CUSD', rateProvider: 'European Central Bank (ECB) via Frankfurter API' } };
  assert.equal(validEvidenceConversion(frankfurter, evidenceCutoff), true);
});
