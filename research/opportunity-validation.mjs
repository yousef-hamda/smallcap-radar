import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const WEIGHTS = Object.freeze({ valuation: 25, catalysts: 20, financialStrength: 15, earningsQuality: 12, competitivePosition: 10, downsideRisk: 10, management: 5, technicalTiming: 3 });
export const PROTOCOL = Object.freeze({ version: 'opportunity-pit-six-month-v2', horizonDays: 183, maximumEntryLagDays: 7, maximumExitLagDays: 7, majorUpside: .50, trainFraction: .6, validationFraction: .2, issuerHoldoutPct: 20, minimumRows: 10000, minimumIssuers: 1000, minimumMonths: 60 });
const DAY = 864e5;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const hash = value => createHash('sha256').update(value).digest('hex');
const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const binary = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const issuerBucket = id => parseInt(hash(String(id)).slice(0, 8), 16) % 100;

// Date.parse normalizes impossible calendar dates such as February 30. Those
// dates cannot identify a disclosure, signal or executable market session.
function timestamp(value) {
  if (!nonempty(value) || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return NaN;
  const day = Date.parse(`${value.slice(0, 10)}T00:00:00Z`), result = Date.parse(value);
  return Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === value.slice(0, 10) ? result : NaN;
}

export function validateObservation(row, cutoff = Date.now()) {
  const errors = [], asOf = timestamp(row?.asOf);
  if (!nonempty(row?.symbol) || !nonempty(String(row?.issuerId ?? '')) || !Number.isFinite(asOf) || !finite(cutoff) || asOf > cutoff) errors.push('Missing or invalid security/issuer/as-of identity');
  for (const id of Object.keys(WEIGHTS)) {
    const factor = row?.factors?.[id];
    if (!factor || !finite(factor.score) || factor.score < 0 || factor.score > 10 || !Array.isArray(factor.sources) || !factor.sources.length) {
      errors.push('Missing bounded grade or point-in-time lineage: ' + id);
    } else for (const source of factor.sources) {
      const availableAt = timestamp(source?.availableAt), periodEnd = timestamp(source?.periodEnd);
      if (!nonempty(source?.id) || !Number.isFinite(availableAt) || availableAt > asOf || !Number.isFinite(periodEnd) || periodEnd > asOf || periodEnd > availableAt) errors.push('Future or invalid point-in-time source: ' + id);
    }
  }
  const coverage = row?.coverage;
  if (timestamp(coverage?.membershipAsOf) !== asOf || coverage?.delistedIncluded !== true || coverage?.corporateActionsComplete !== true || coverage?.outcomesComplete !== true) errors.push('Membership, delisted outcomes or corporate actions are not complete');
  if (row?.prices?.adjustment !== 'split-adjusted-with-cash-dividends') errors.push('Explicit split-adjusted prices and cash dividends are required');

  const entry = row?.prices?.entry, entryAt = timestamp(entry?.at);
  if (!entry || !finite(entry.price) || entry.price <= 0 || !Number.isFinite(entryAt) || [0, 6].includes(new Date(entryAt).getUTCDay()) || entryAt <= asOf || entryAt - asOf > PROTOCOL.maximumEntryLagDays * DAY || entryAt > cutoff) errors.push('Entry must be an executable session within seven days after the signal');
  // Holding duration begins at the executable entry, not at the signal.
  const end = entryAt + PROTOCOL.horizonDays * DAY;
  const bars = row?.prices?.bars, observedUntil = timestamp(row?.prices?.observedUntil);
  if (!Number.isFinite(observedUntil) || observedUntil > cutoff || observedUntil < entryAt) errors.push('Invalid observed-through date');
  if (!Array.isArray(bars) || !bars.length || bars.some((bar, index) => {
    const at = timestamp(bar?.at);
    return !finite(bar?.close) || bar.close <= 0 || !finite(bar?.dividend) || bar.dividend < 0 || !Number.isFinite(at) || [0, 6].includes(new Date(at).getUTCDay()) || at > cutoff || at > observedUntil || (index > 0 && at <= timestamp(bars[index - 1]?.at));
  })) errors.push('Invalid chronological price/dividend observations');
  if (!finite(row?.costs?.roundTripBps) || row.costs.roundTripBps < 0 || row.costs.roundTripBps > 10000) errors.push('Explicit bounded execution costs are required');

  const delisting = row?.prices?.delisting, delistingAt = timestamp(delisting?.at);
  if (delisting && (!finite(delisting.proceedsPerShare) || delisting.proceedsPerShare < 0 || !Number.isFinite(delistingAt) || delistingAt > cutoff || delistingAt > observedUntil || delistingAt < entryAt)) errors.push('Delisting payoff and observed timestamp are required');
  if (delisting && Array.isArray(bars) && bars.some(bar => timestamp(bar?.at) > delistingAt)) errors.push('Price/dividend observations cannot follow the terminal delisting payoff');

  const terminal = delisting && Number.isFinite(delistingAt) && delistingAt <= end;
  const exitBar = Array.isArray(bars) ? bars.find(bar => timestamp(bar?.at) >= end && timestamp(bar?.at) <= end + PROTOCOL.maximumExitLagDays * DAY) : undefined;
  const endpoint = terminal ? delistingAt : exitBar ? timestamp(exitBar.at) : end;
  const included = Array.isArray(bars) ? bars.filter(bar => timestamp(bar?.at) >= entryAt && timestamp(bar?.at) <= endpoint) : [];
  const coverageGap = !included.length || timestamp(included[0]?.at) - entryAt > 4 * DAY
    || endpoint - timestamp(included.at(-1)?.at) > 4 * DAY
    || included.some((bar, index) => index > 0 && timestamp(bar.at) - timestamp(included[index - 1].at) > 7 * DAY);
  const censored = coverageGap || (!terminal && (!exitBar || end > cutoff)) || observedUntil < endpoint;

  const benchmark = row?.benchmark;
  if (!nonempty(benchmark?.source) || !finite(benchmark?.totalReturn) || benchmark.totalReturn < -1
    || timestamp(benchmark?.entryAt) !== entryAt || timestamp(benchmark?.exitAt) !== endpoint
    || !Number.isFinite(timestamp(benchmark?.availableAt)) || timestamp(benchmark?.availableAt) < endpoint || timestamp(benchmark?.availableAt) > cutoff) errors.push('Independent benchmark total return must match the executable entry and outcome exit with actual observed availability');
  if (errors.length) return { valid: false, errors, censored };

  let dividends = 0, peak = entry.price, maxDrawdown = 0, maxReturn = 0, lastValue = entry.price;
  const observe = value => {
    lastValue = value;
    peak = Math.max(peak, value);
    maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
    maxReturn = Math.max(maxReturn, value / entry.price - 1);
  };
  for (const bar of included) { dividends += bar.dividend; observe(bar.close + dividends); }
  // Cash proceeds are the final portfolio value for both insolvency and a
  // profitable takeover. No post-delisting quote or dividend can revive it.
  if (terminal) observe(delisting.proceedsPerShare + dividends);
  const cost = row.costs.roundTripBps / 10000;
  const score = Math.round(Object.entries(WEIGHTS).reduce((sum, [id, weight]) => sum + Math.round(row.factors[id].score * 100) * weight, 0) / 10) / 100;
  return { valid: true, errors: [], censored, issuerId: String(row.issuerId), symbol: row.symbol, asOf, entryAt, end, exitAt: endpoint, observedUntil, score, totalReturn: lastValue / entry.price - 1 - cost, maxReturn: maxReturn - cost, maxDrawdown, majorUpside: maxReturn - cost >= PROTOCOL.majorUpside, benchmarkReturn: benchmark.totalReturn };
}

function summaries(rows) {
  return { rows: rows.length, issuers: new Set(rows.map(row => row.issuerId)).size, majorUpsideRate: average(rows.map(row => Number(row.majorUpside))), meanReturn: average(rows.map(row => row.totalReturn)), meanDrawdown: average(rows.map(row => row.maxDrawdown)), benchmarkMeanReturn: average(rows.map(row => row.benchmarkReturn)) };
}
function cohort(rows) {
  const dates = new Map();
  for (const row of rows) { const group = dates.get(row.asOf) ?? []; group.push(row); dates.set(row.asOf, group); }
  const top = [...dates.values()].flatMap(group => group.sort((a, b) => b.score - a.score || binary(a.symbol, b.symbol)).slice(0, Math.ceil(group.length * .1)));
  return { ...summaries(rows), signalDates: dates.size, selection: 'Top decile selected independently at each signal date; SQLite BINARY symbol tie-break', topDecile: summaries(top) };
}

export function validateOpportunityDataset(rows, { cutoff = Date.now() } = {}) {
  const blockers = [], keys = new Set(), accepted = [], rejected = []; let censored = 0;
  for (const row of rows) {
    const key = String(row?.symbol) + ':' + String(timestamp(row?.asOf));
    if (keys.has(key)) { rejected.push({ key, errors: ['Duplicate security/as-of observation'] }); continue; }
    keys.add(key);
    const result = validateObservation(row, cutoff);
    if (!result.valid) rejected.push({ key, errors: result.errors }); else if (result.censored) censored++; else accepted.push(result);
  }
  const sorted = accepted.sort((a, b) => a.asOf - b.asOf || binary(a.symbol, b.symbol)), dates = [...new Set(sorted.map(row => row.asOf))];
  const validationStart = dates[Math.floor(dates.length * PROTOCOL.trainFraction)], testStart = dates[Math.floor(dates.length * (PROTOCOL.trainFraction + PROTOCOL.validationFraction))];
  const holdout = sorted.filter(row => issuerBucket(row.issuerId) < PROTOCOL.issuerHoldoutPct), development = sorted.filter(row => issuerBucket(row.issuerId) >= PROTOCOL.issuerHoldoutPct);
  // Purge through the actual exit, including the allowed calendar/session lag.
  const train = development.filter(row => row.asOf < validationStart && row.exitAt < validationStart), validation = development.filter(row => row.asOf >= validationStart && row.asOf < testStart && row.exitAt < testStart), test = development.filter(row => row.asOf >= testStart);
  const months = dates.length ? (dates.at(-1) - dates[0]) / DAY / 30.4375 : 0, issuers = new Set(sorted.map(row => row.issuerId)).size;
  if (sorted.length < PROTOCOL.minimumRows) blockers.push('Insufficient uncensored point-in-time rows: ' + sorted.length);
  if (issuers < PROTOCOL.minimumIssuers) blockers.push('Insufficient independent issuers: ' + issuers);
  if (months < PROTOCOL.minimumMonths) blockers.push('Insufficient historical coverage in months: ' + months.toFixed(1));
  if (rejected.length) blockers.push('Invalid or duplicate observations: ' + rejected.length);
  if ([train, validation, test, holdout].some(part => !part.length)) blockers.push('Purged chronological or issuer holdout partition is empty');
  return { status: blockers.length ? 'BLOCKED' : 'DIAGNOSTIC-READY', datasetHash: hash(JSON.stringify(rows)), protocol: PROTOCOL, weights: WEIGHTS, probability: null, calibrationStatus: 'unvalidated', counts: { total: rows.length, accepted: sorted.length, rejected: rejected.length, censored, issuers, purged: development.length - train.length - validation.length - test.length }, blockers, metrics: { all: cohort(sorted), train: cohort(train), validation: cohort(validation), test: cohort(test), issuerHoldout: cohort(holdout) }, rejected: rejected.slice(0, 100) };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = process.argv[2]; const rows = input && fs.existsSync(input) ? fs.readFileSync(input, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  console.log(JSON.stringify(validateOpportunityDataset(rows), null, 2));
}
