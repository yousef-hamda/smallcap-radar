/**
 * Free, reproducible price-only Bounce study.
 *
 * This is intentionally a research tool, not a production model trainer.
 * The universe is selected from the current bundled directory, so the report
 * is explicitly survivorship-biased and cannot approve production weights.
 * It is still useful for testing the one price-only challenger supported by
 * the supplied reference: adding the completed-week MA30W reversal gate.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const STUDY = Object.freeze({
  signalStart: '2015-01-01',
  signalEnd: '2019-12-31',
  downloadStart: '2010-01-01',
  downloadEnd: '2021-05-01',
  returnLookbackDays: 365,
  target: 0.20,
  stop: -0.15,
  expiryMonths: 3,
  maWeeks: 30,
  maMultiplier: 1.05,
  lowDistanceMin: 0.10,
  declineMax: -0.35,
  cooldownTradingDays: 63,
});

const DEFAULT_CONCURRENCY = 12;
const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_RETRIES = 3;
const iso = value => new Date(value).toISOString().slice(0, 10);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');

function stableNumber(seed) {
  return parseInt(sha256(seed).slice(0, 12), 16) / 0x1000000000000;
}

export function expiryDate(entry, months = STUDY.expiryMonths) {
  const date = new Date(`${entry}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return iso(date);
}

function weekKey(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return iso(value);
}

export function completedWeeklyAverage(bars, asOf, weeks = STUDY.maWeeks) {
  const currentWeek = weekKey(asOf);
  const byWeek = new Map();
  for (const bar of bars) {
    if (!bar.date || !finite(bar.close) || bar.close <= 0 || weekKey(bar.date) >= currentWeek) continue;
    const key = weekKey(bar.date);
    const existing = byWeek.get(key);
    if (!existing || existing.date < bar.date) byWeek.set(key, bar);
  }
  const selected = [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-weeks);
  if (selected.length < weeks) return null;
  for (let index = 1; index < selected.length; index += 1) {
    const previous = Date.parse(selected[index - 1][0]);
    const current = Date.parse(selected[index][0]);
    if (current - previous !== 7 * 86_400_000) return null;
  }
  return selected.reduce((sum, [, bar]) => sum + bar.close, 0) / weeks;
}

function validBars(bars) {
  return bars
    .filter(bar => bar?.date && finite(bar.close) && bar.close > 0 && finite(bar.open) && bar.open > 0 && finite(bar.high) && bar.high > 0 && finite(bar.low) && bar.low > 0 && bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function signalAt(bars, index, options = STUDY) {
  const bar = bars[index];
  if (!bar || bar.date < options.signalStart || bar.date > options.signalEnd) return null;
  const prior = bars[index - 252];
  const year = bars.slice(Math.max(0, index - 251), index + 1);
  if (!prior || year.length < 240) return null;
  const return12m = bar.close / prior.close - 1;
  const low52w = Math.min(...year.map(row => row.low));
  const offLow = bar.close / low52w - 1;
  const ma30w = options.ma30ByWeek instanceof Map
    ? options.ma30ByWeek.get(weekKey(bar.date)) ?? null
    : completedWeeklyAverage(bars.slice(0, index + 1), bar.date, options.maWeeks);
  if (!finite(return12m) || !finite(low52w) || !finite(ma30w)) return null;
  const base = return12m < options.declineMax && offLow >= options.lowDistanceMin;
  if (!base) return null;
  return {
    signalDate: bar.date,
    close: bar.close,
    return12m,
    low52w,
    offLow,
    ma30w,
    reversal: bar.close > ma30w * options.maMultiplier,
  };
}

export function simulateOutcome(bars, signalIndex, options = STUDY) {
  const entryBar = bars[signalIndex + 1];
  if (!entryBar || !finite(entryBar.open) || entryBar.open <= 0) return { status: 'CENSORED', reason: 'no_next_open' };
  const entry = entryBar.open;
  const target = entry * (1 + options.target);
  const stop = entry * (1 + options.stop);
  const expiry = expiryDate(entryBar.date, options.expiryMonths);
  for (let index = signalIndex + 1; index < bars.length; index += 1) {
    const bar = bars[index];
    if (bar.date >= expiry) return { status: 'OBSERVED', targetBeforeStop: false, reason: 'time', entryDate: entryBar.date, exitDate: bar.date, entry, exit: bar.open, netReturn: bar.open / entry - 1 };
    // Conservative daily-bar convention from the reference: stop first when
    // both levels are touched and use the real open for a gap through a level.
    if (bar.low <= stop) {
      const exit = bar.open <= stop ? bar.open : stop;
      return { status: 'OBSERVED', targetBeforeStop: false, reason: 'stop', entryDate: entryBar.date, exitDate: bar.date, entry, exit, netReturn: exit / entry - 1 };
    }
    if (bar.high >= target) {
      const exit = bar.open >= target ? bar.open : target;
      return { status: 'OBSERVED', targetBeforeStop: true, reason: 'target', entryDate: entryBar.date, exitDate: bar.date, entry, exit, netReturn: exit / entry - 1 };
    }
  }
  return { status: 'CENSORED', reason: 'history_ends_before_expiry', entryDate: entryBar.date, entry };
}

export function collectSignals(bars, options = STUDY) {
  const clean = validBars(bars);
  // Build the completed-week moving averages once. Calling the historical
  // helper for every daily bar is correct but quadratic on a large cohort.
  const weekly = new Map();
  for (const bar of clean) {
    const key = weekKey(bar.date);
    const existing = weekly.get(key);
    if (!existing || existing.date < bar.date) weekly.set(key, bar);
  }
  const weeks = [...weekly.keys()].sort();
  const ma30ByWeek = new Map();
  for (let index = options.maWeeks; index < weeks.length; index += 1) {
    const previous = weeks.slice(index - options.maWeeks, index).map(key => weekly.get(key).close);
    if (previous.length === options.maWeeks && previous.every(finite)) ma30ByWeek.set(weeks[index], previous.reduce((sum, value) => sum + value, 0) / options.maWeeks);
  }
  const fastOptions = { ...options, ma30ByWeek };
  const result = [];
  for (let index = 0; index < clean.length; index += 1) {
    const signal = signalAt(clean, index, fastOptions);
    if (signal) result.push({ index, ...signal, outcome: simulateOutcome(clean, index, options) });
  }
  return result;
}

function selectCooldown(signals, requireReversal, cooldownTradingDays = STUDY.cooldownTradingDays) {
  const selected = [];
  const lastEntryBySymbol = new Map();
  for (const signal of signals) {
    if (requireReversal && !signal.reversal) continue;
    const lastEntryIndex = lastEntryBySymbol.get(signal.symbol) ?? -Infinity;
    if (signal.index - lastEntryIndex < cooldownTradingDays) continue;
    selected.push(signal);
    lastEntryBySymbol.set(signal.symbol, signal.index);
  }
  return selected;
}

function wilson(successes, observations) {
  if (!observations) return null;
  const z = 1.959963984540054;
  const p = successes / observations;
  const denominator = 1 + z ** 2 / observations;
  const centre = (p + z ** 2 / (2 * observations)) / denominator;
  const spread = z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * observations)) / observations) / denominator;
  return { low: Math.max(0, centre - spread), high: Math.min(1, centre + spread) };
}

function metric(signals) {
  const observed = signals.filter(row => row.outcome.status === 'OBSERVED');
  const successes = observed.filter(row => row.outcome.targetBeforeStop).length;
  return {
    signals: signals.length,
    symbols: new Set(signals.map(row => row.symbol)).size,
    observed: observed.length,
    censored: signals.length - observed.length,
    targetHits: successes,
    hitRate: observed.length ? successes / observed.length : null,
    hitRateCI95: wilson(successes, observed.length),
    meanNetReturn: observed.length ? observed.reduce((sum, row) => sum + row.outcome.netReturn, 0) / observed.length : null,
  };
}

function bootstrapFirmRateDelta(left, right, seed = 'small-cap-radar-bootstrap-v1', iterations = 1000) {
  const byFirm = signals => {
    const grouped = new Map();
    for (const row of signals.filter(item => item.outcome.status === 'OBSERVED')) {
      const current = grouped.get(row.symbol) ?? { observations: 0, successes: 0 };
      current.observations += 1;
      if (row.outcome.targetBeforeStop) current.successes += 1;
      grouped.set(row.symbol, current);
    }
    return grouped;
  };
  const leftByFirm = byFirm(left), rightByFirm = byFirm(right);
  const firms = [...new Set([...leftByFirm.keys()].filter(firm => rightByFirm.has(firm)))].sort();
  if (firms.length < 10) return { firms: firms.length, low: null, high: null, note: 'paired firm bootstrap blocked: fewer than 10 firms with outcomes in both variants' };
  let state = parseInt(sha256(seed).slice(0, 8), 16) >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const deltas = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let leftSuccesses = 0, leftObservations = 0, rightSuccesses = 0, rightObservations = 0;
    for (let index = 0; index < firms.length; index += 1) {
      const firm = firms[Math.floor(random() * firms.length)];
      const l = leftByFirm.get(firm), r = rightByFirm.get(firm);
      leftSuccesses += l.successes; leftObservations += l.observations;
      rightSuccesses += r.successes; rightObservations += r.observations;
    }
    deltas.push(rightSuccesses / rightObservations - leftSuccesses / leftObservations);
  }
  deltas.sort((a, b) => a - b);
  return { firms: firms.length, low: deltas[Math.floor(iterations * 0.025)], high: deltas[Math.min(iterations - 1, Math.floor(iterations * 0.975))], iterations };
}

export function compareSignals(signals, seed = 'small-cap-radar-bounce-study-v1') {
  const baseline = selectCooldown(signals, false);
  const challenger = selectCooldown(signals, true);
  const randomPool = [...baseline].sort((a, b) => stableNumber(`${seed}|${a.symbol}|${a.signalDate}`) - stableNumber(`${seed}|${b.symbol}|${b.signalDate}`));
  const random = randomPool.slice(0, Math.min(challenger.length, randomPool.length));
  const metrics = { baseline: metric(baseline), challenger: metric(challenger), random: metric(random) };
  const rate = name => metrics[name].hitRate;
  metrics.improvementVsBaseline = rate('challenger') == null || rate('baseline') == null ? null : rate('challenger') - rate('baseline');
  metrics.improvementVsRandom = rate('challenger') == null || rate('random') == null ? null : rate('challenger') - rate('random');
  metrics.clusteredRateDeltaCI95 = bootstrapFirmRateDelta(baseline, challenger, `${seed}|clustered`);
  return { metrics, selected: { baseline, challenger, random } };
}

function sliceByDate(signals, start, end) {
  return signals.filter(signal => signal.signalDate >= start && signal.signalDate <= end);
}

function filterHistorySignals(histories, options, requireReversal = false) {
  const signals = [];
  for (const row of histories) {
    for (const signal of row.signals) {
      if (signal.return12m >= options.declineMax || signal.offLow < options.lowDistanceMin) continue;
      const reversal = options.maMultiplier == null ? null : signal.close > signal.ma30w * options.maMultiplier;
      if (requireReversal && !reversal) continue;
      signals.push({ symbol: row.symbol, ...signal, reversal });
    }
  }
  return signals;
}

function chooseTunedVariant(histories, options, seed) {
  const dates = [...new Set(filterHistorySignals(histories, options).map(signal => signal.signalDate))].sort();
  if (dates.length < 20) return { status: 'BLOCKED', reason: 'not enough signal dates for chronological tuning' };
  const developmentEnd = dates[Math.max(0, Math.floor(dates.length * 0.60) - 1)];
  const validationStart = dates[Math.floor(dates.length * 0.60)];
  const validationEnd = dates[Math.max(0, Math.floor(dates.length * 0.80) - 1)];
  const finalStart = dates[Math.floor(dates.length * 0.80)];
  const finalEnd = dates.at(-1);
  const baselineSignals = filterHistorySignals(histories, options);
  const baselineValidation = metric(selectCooldown(sliceByDate(baselineSignals, validationStart, validationEnd), false, options.cooldownTradingDays));
  const grid = [];
  for (const declineMax of [-0.35, -0.45, -0.55]) {
    for (const lowDistanceMin of [0.10, 0.15, 0.20, 0.25]) {
      for (const maMultiplier of [null, 1.05, 1.10, 1.15, 1.20]) {
        const variantOptions = { ...options, declineMax, lowDistanceMin, maMultiplier };
        const signals = filterHistorySignals(histories, variantOptions, false);
        const development = metric(selectCooldown(sliceByDate(signals, options.signalStart, developmentEnd), maMultiplier != null, options.cooldownTradingDays));
        const validation = metric(selectCooldown(sliceByDate(signals, validationStart, validationEnd), maMultiplier != null, options.cooldownTradingDays));
        // Do not retain every variant's full signal list. A 60-variant grid
        // over a thousand histories otherwise turns a bounded study into a
        // multi-gigabyte heap allocation.
        grid.push({ options: { declineMax, lowDistanceMin, maMultiplier }, development, validation });
      }
    }
  }
  const viable = grid.filter(row => row.validation.observed >= 50 && row.development.observed >= 50);
  const better = viable.filter(row => row.validation.hitRate != null && baselineValidation.hitRate != null && row.validation.hitRate > baselineValidation.hitRate);
  const pool = better.length ? better : viable;
  if (!pool.length) return { status: 'BLOCKED', reason: 'no candidate reached 50 observed validation outcomes', split: { developmentEnd, validationStart, validationEnd, finalStart, finalEnd }, baselineValidation, gridSize: grid.length };
  pool.sort((a, b) => (b.validation.hitRate - a.validation.hitRate) || (b.validation.observed - a.validation.observed) || JSON.stringify(a.options).localeCompare(JSON.stringify(b.options)));
  const best = pool[0];
  const bestSignals = filterHistorySignals(histories, { ...options, ...best.options }, false);
  const finalSignals = selectCooldown(sliceByDate(bestSignals, finalStart, finalEnd), best.options.maMultiplier != null, options.cooldownTradingDays);
  const baselineFinal = selectCooldown(sliceByDate(baselineSignals, finalStart, finalEnd), false, options.cooldownTradingDays);
  const randomPool = [...baselineFinal].sort((a, b) => stableNumber(`${seed}|${a.symbol}|${a.signalDate}`) - stableNumber(`${seed}|${b.symbol}|${b.signalDate}`));
  const randomFinal = randomPool.slice(0, Math.min(finalSignals.length, randomPool.length));
  return {
    status: 'TUNED_EXPLORATORY',
    gridSize: grid.length,
    viableCandidates: viable.length,
    candidatesBetterThanBaselineOnValidation: better.length,
    selected: best.options,
    selectionRule: 'validation hit rate, then observed count; final period remained untouched during selection',
    split: { developmentEnd, validationStart, validationEnd, finalStart, finalEnd },
    development: best.development,
    validation: best.validation,
    baselineValidation,
    final: { baseline: metric(baselineFinal), challenger: metric(finalSignals), random: metric(randomFinal), improvementVsBaseline: metric(finalSignals).hitRate == null || metric(baselineFinal).hitRate == null ? null : metric(finalSignals).hitRate - metric(baselineFinal).hitRate, improvementVsRandom: metric(finalSignals).hitRate == null || metric(randomFinal).hitRate == null ? null : metric(finalSignals).hitRate - metric(randomFinal).hitRate, clusteredRateDeltaCI95: bootstrapFirmRateDelta(baselineFinal, finalSignals, `${seed}|tuned-final`) },
  };
}

function parseYahooPayload(payload) {
  const result = payload?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] ?? {};
  const bars = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const value = key => Number(quote[key]?.[index]);
    const date = new Date(timestamps[index] * 1000).toISOString().slice(0, 10);
    const bar = { date, open: value('open'), high: value('high'), low: value('low'), close: value('close'), volume: value('volume') };
    if (validBars([bar]).length) bars.push(bar);
  }
  return bars;
}

async function fetchHistory(symbol, options) {
  const period1 = Math.floor(Date.parse(`${options.downloadStart}T00:00:00Z`) / 1000);
  const period2 = Math.floor(Date.parse(`${options.downloadEnd}T00:00:00Z`) / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplits`;
  let lastError = 'unknown';
  for (let attempt = 0; attempt < options.retries; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'SmallCapRadar research backtest/1.0' }, signal: AbortSignal.timeout(options.timeoutMs) });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const bars = parseYahooPayload(await response.json());
      return { symbol, url, bars, error: null };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt + 1 < options.retries) await new Promise(resolve => setTimeout(resolve, Math.min(5000, 400 * (2 ** attempt))));
    }
  }
  return { symbol, url, bars: [], error: lastError };
}

async function mapConcurrent(items, concurrency, worker) {
  const output = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return output;
}

function eligibleUniverse(universe, limit) {
  const nonTradable = /\b(etf|fund|trust|warrant|right|unit|preferred|depositary|senior note|bond|debenture|limited partnership)\b|(?:,\s*)?L\.?P\.?/i;
  const eligible = universe
    .filter(company => ['Nasdaq', 'NYSE', 'NYSE American'].includes(company.exchange) && finite(company.marketCap) && company.marketCap >= 25e6 && company.marketCap <= 600e6 && company.ticker && !nonTradable.test(company.name ?? ''))
    .sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));
  if (limit >= eligible.length) return eligible;
  // Spread a bounded free download across the whole directory. Taking the
  // first alphabetic symbols would make the study an accidental sector/time
  // slice and would understate the cohort's coverage.
  return Array.from({ length: limit }, (_, index) => eligible[Math.round(index * (eligible.length - 1) / Math.max(1, limit - 1))]);
}

export async function runStudy({ universeFile, cacheFile, outputFile, limit = 500, concurrency = DEFAULT_CONCURRENCY, timeoutMs = DEFAULT_TIMEOUT, retries = DEFAULT_RETRIES, seed } = {}) {
  if (!universeFile) throw Error('universeFile is required');
  const options = { ...STUDY, concurrency, timeoutMs, retries };
  const universe = JSON.parse(await fs.readFile(universeFile, 'utf8')).companies ?? [];
  const companies = eligibleUniverse(universe, limit);
  const cached = cacheFile ? JSON.parse(await fs.readFile(cacheFile, 'utf8').catch(() => '{}')) : {};
  const missing = companies.filter(company => !Array.isArray(cached[company.ticker]?.bars));
  const fetched = await mapConcurrent(missing, concurrency, company => fetchHistory(company.ticker, options));
  for (const row of fetched) cached[row.symbol] = row;
  if (cacheFile) {
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify(cached));
  }
  const allSignals = [];
  const errors = [];
  const histories = [];
  let barsWithHistory = 0;
  for (const company of companies) {
    const history = cached[company.ticker];
    if (!history?.bars?.length) { errors.push({ symbol: company.ticker, error: history?.error ?? 'no history' }); continue; }
    if (history.bars.length >= 500) barsWithHistory += 1;
    const signals = collectSignals(history.bars, options);
    histories.push({ symbol: company.ticker, bars: history.bars, signals });
    for (const signal of signals) allSignals.push({ symbol: company.ticker, ...signal });
  }
  const compared = compareSignals(allSignals, seed);
  const tuned = chooseTunedVariant(histories, options, seed ?? 'small-cap-radar-bounce-study-v1');
  const report = {
    status: 'EXPLORATORY_ONLY',
    createdAt: new Date().toISOString(),
    source: { provider: 'Yahoo Finance chart endpoint', url: 'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}', free: true, userAgent: 'SmallCapRadar research backtest/1.0' },
    universe: { file: universeFile, selected: companies.length, requestedLimit: limit, selection: 'current bundled listed universe; current market-cap filter only; no historical security master' },
    protocol: { ...options, outcome: '+20% target before -15% stop; stop first on same daily bar; gap executes at actual open; time exit at first observed open on/after expiry; censored history excluded from denominator', comparison: 'baseline uses price-only Bounce gates; challenger adds completed 30-week MA > 1.05x reversal gate; 63-session cooldown per symbol; random is deterministic sample from baseline pool matched to challenger count', signalData: 'adjusted daily OHLC from free public endpoint; no PIT fundamentals, delisting or historical market cap' },
    coverage: { companiesRequested: companies.length, companiesWithAtLeast500Bars: barsWithHistory, companiesWithSignals: new Set(allSignals.map(row => row.symbol)).size, rawSignals: allSignals.length, providerErrors: errors.length, errors: errors.slice(0, 100) },
    metrics: compared.metrics,
    tuned,
    limitations: ['Current-universe selection creates survivorship bias.', 'Current market cap is used only to choose the research cohort; historical cap and historical liquidity are not reconstructed.', 'This study measures a price-only Bounce challenger and cannot validate the full production gate set.', 'Yahoo is a free public feed with rate limits; it is not a survivorship-free licensed database.', 'The result is not a calibrated probability and must not promote production weights.'],
    dataHash: sha256(JSON.stringify(Object.fromEntries(companies.map(company => [company.ticker, cached[company.ticker]?.bars ?? []])))),
  };
  if (outputFile) {
    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    await fs.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

if (process.argv[1]?.endsWith('free-price-backtest.mjs')) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((out, value, index, all) => value.startsWith('--') ? [...out, [value.slice(2), all[index + 1]]] : out, []));
  if (!args.universe) {
    console.error('Usage: node research/free-price-backtest.mjs --universe lib/universe.generated.json --cache /tmp/bounce-history.json --output /tmp/bounce-report.json --limit 500');
    process.exit(2);
  }
  const report = await runStudy({ universeFile: args.universe, cacheFile: args.cache, outputFile: args.output, limit: Number(args.limit ?? 500), concurrency: Number(args.concurrency ?? DEFAULT_CONCURRENCY), timeoutMs: Number(args.timeout ?? DEFAULT_TIMEOUT), retries: Number(args.retries ?? DEFAULT_RETRIES), seed: args.seed });
  console.log(JSON.stringify({ status: report.status, coverage: report.coverage, metrics: report.metrics, dataHash: report.dataHash }, null, 2));
}
