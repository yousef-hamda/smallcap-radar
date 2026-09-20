import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const FEATURE_IDS = Object.freeze({
  core: Object.freeze(['valuation', 'quality', 'shareDiscipline', 'sizeCoverage', 'growth', 'insider', 'marginTrend', 'entry', 'balance']),
  bounce: Object.freeze(['collapse', 'reversal', 'liquidity', 'dilution', 'offLow', 'size']),
});

export const MINIMUM = Object.freeze({
  bounce: Object.freeze({rows: 10000, companies: 1000, months: 120}),
  core: Object.freeze({rows: 20000, companies: 1500, months: 96}),
});

const SAFETY_KEYS = Object.freeze(['tradable', 'conflict', 'criticalData']);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const sigmoid = value => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

export function firmIdentity(row) {
  const value = row?.firmId ?? row?.firm ?? row?.cik ?? row?.companyId ?? row?.symbol;
  return value == null ? '' : String(value).trim();
}

function firmBucket(firmId) {
  let value = 2166136261;
  for (const character of `fixed-research-salt:${firmId}`) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0) % 100;
}

function auc(rows, score, label = row => row.outcome?.label ?? row.label) {
  const ranked = rows.map(row => ({row, score: score(row), label: label(row)})).sort((a, b) => a.score - b.score);
  const positives = ranked.filter(item => item.label === 1);
  const negatives = ranked.filter(item => item.label === 0);
  if (!positives.length || !negatives.length) return null;
  let index = 0;
  let positiveRankSum = 0;
  while (index < ranked.length) {
    let end = index + 1;
    while (end < ranked.length && ranked[end].score === ranked[index].score) end += 1;
    const averageRank = (index + 1 + end) / 2;
    positiveRankSum += ranked.slice(index, end).filter(item => item.label === 1).length * averageRank;
    index = end;
  }
  return (positiveRankSum - positives.length * (positives.length + 1) / 2) / (positives.length * negatives.length);
}

function validate(rows, strategy) {
  const ids = FEATURE_IDS[strategy];
  const seen = new Set();
  const errors = [];
  const firmDates = new Set();
  for (const row of rows) {
    const key = `${row.symbol ?? ''}:${row.asOf ?? ''}`;
    const firm = firmIdentity(row);
    const firmDateKey = `${firm}:${row.asOf ?? ''}`;
    if (seen.has(key)) errors.push(`${key}: duplicate observation`);
    seen.add(key);
    if (!firm) errors.push(`${key}: firm identity missing`);
    else if (firmDates.has(firmDateKey)) errors.push(`${key}: duplicate firm/date observation`);
    firmDates.add(firmDateKey);

    const asOf = Date.parse(row.asOf ?? '');
    const observedAt = Date.parse(row.outcome?.observedAt ?? '');
    if (!row.symbol || !Number.isFinite(asOf)) errors.push(`${key}: invalid identity/date`);
    if (![0, 1].includes(row.outcome?.label)) errors.push(`${key}: outcome.label must be 0 or 1`);
    if (!Number.isFinite(observedAt) || observedAt <= asOf) errors.push(`${key}: outcome must be dated after asOf`);

    for (const id of ids) {
      const value = row.features?.[id];
      if (value != null && (!finite(value) || value < 0 || value > 1)) errors.push(`${key}: ${id} must be between 0 and 1`);
      const availableAt = row.availableAt?.[id];
      const periodEnd = row.periodEnd?.[id];
      const source = row.sources?.[id];
      if (value != null && availableAt == null) errors.push(`${key}: ${id} availableAt missing`);
      if (value != null && periodEnd == null) errors.push(`${key}: ${id} periodEnd missing`);
      if (value != null && (typeof source !== 'string' || !source.trim())) errors.push(`${key}: ${id} source missing`);
      if (availableAt != null) {
        const available = Date.parse(availableAt);
        if (!Number.isFinite(available)) errors.push(`${key}: ${id} has invalid availableAt`);
        else if (available > asOf) errors.push(`${key}: ${id} is future evidence`);
      }
      if (periodEnd != null) {
        const period = Date.parse(periodEnd);
        if (!Number.isFinite(period)) errors.push(`${key}: ${id} has invalid periodEnd`);
        else if (period > asOf) errors.push(`${key}: ${id} period ends after asOf`);
      }
    }

    for (const safetyKey of SAFETY_KEYS) {
      if (!['PASS', 'FAIL', 'UNKNOWN'].includes(row.safety?.[safetyKey])) errors.push(`${key}: ${safetyKey} safety state missing`);
    }
  }
  return errors;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0.5;
}

function fit(train, ids, lambda = 0.2) {
  const medians = Object.fromEntries(ids.map(id => [id, median(train.map(row => row.features?.[id]).filter(finite))]));
  const coefficients = ids.map(() => 0);
  let intercept = 0;
  if (!train.length) return {ids, coefficients, intercept, medians};

  for (let epoch = 0; epoch < 1800; epoch += 1) {
    const gradient = ids.map(() => 0);
    let biasGradient = 0;
    for (const row of train) {
      const vector = ids.map(id => finite(row.features?.[id]) ? row.features[id] : medians[id]);
      const linear = intercept + coefficients.reduce((sum, coefficient, index) => sum + coefficient * vector[index], 0);
      const error = sigmoid(linear) - row.outcome.label;
      biasGradient += error;
      for (let index = 0; index < coefficients.length; index += 1) gradient[index] += error * vector[index];
    }
    const step = 0.04 / train.length;
    intercept -= step * biasGradient;
    for (let index = 0; index < coefficients.length; index += 1) {
      coefficients[index] -= 0.04 * (gradient[index] / train.length + lambda * coefficients[index]);
    }
  }
  return {ids, coefficients, intercept, medians};
}

function modelScore(model, row) {
  return model.intercept + model.ids.reduce((sum, id, index) => {
    const value = finite(row.features?.[id]) ? row.features[id] : model.medians[id];
    return sum + model.coefficients[index] * value;
  }, 0);
}

function chooseThreshold(model, rows) {
  if (!rows.length) return 0.5;
  const candidates = [...new Set(rows.map(row => sigmoid(modelScore(model, row))))].sort((a, b) => a - b);
  const minimumSelected = Math.max(10, Math.ceil(rows.length * 0.05));
  return candidates.reduce((best, threshold) => {
    const predicted = rows.filter(row => sigmoid(modelScore(model, row)) >= threshold);
    if (predicted.length < minimumSelected) return best;
    const positives = rows.filter(row => row.outcome.label === 1).length;
    const truePositives = predicted.filter(row => row.outcome.label === 1).length;
    const precision = predicted.length ? truePositives / predicted.length : 0;
    const recall = positives ? truePositives / positives : 0;
    const utilities = predicted.map(row => row.outcome?.netUtility).filter(finite);
    // Selection is for net utility when the validation data carries execution
    // costs. Classification quality is only a fallback for incomplete research
    // fixtures and can never approve a model because cost coverage is gated.
    const utility = utilities.length === predicted.length ? mean(utilities) : precision * 0.7 + recall * 0.3;
    return utility > best.utility ? {threshold, utility} : best;
  }, {threshold: 0.5, utility: -1}).threshold;
}

function metrics(model, rows, threshold = 0.5) {
  const scored = rows.map(row => ({row, score: modelScore(model, row), rawProbability: sigmoid(modelScore(model, row))}));
  const predicted = scored.filter(item => item.rawProbability >= threshold);
  const positives = rows.filter(row => row.outcome.label === 1).length;
  const truePositives = predicted.filter(item => item.row.outcome.label === 1).length;
  return {
    rows: rows.length,
    positiveRate: mean(rows.map(row => row.outcome.label)),
    auc: auc(scored, item => item.score, item => item.row.outcome.label),
    threshold,
    precision: predicted.length ? truePositives / predicted.length : 0,
    recall: positives ? truePositives / positives : 0,
    // The logistic output is deliberately not a publishable probability. No
    // calibration model has passed the locked validation protocol yet.
    probability: null,
    calibrationStatus: 'uncalibrated',
    rawProbabilityBrier: rows.length ? mean(scored.map(item => (item.rawProbability - item.row.outcome.label) ** 2)) : null,
    rawProbabilityLogLoss: rows.length ? -mean(scored.map(item => {
      const probability = Math.max(1e-9, Math.min(1 - 1e-9, item.rawProbability));
      return item.row.outcome.label * Math.log(probability) + (1 - item.row.outcome.label) * Math.log(1 - probability);
    })) : null,
    topDecileLift: (() => {
      if (scored.length < 10) return null;
      const top = [...scored].sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.floor(scored.length / 10)));
      const baseRate = mean(rows.map(row => row.outcome.label));
      return baseRate > 0 ? mean(top.map(item => item.row.outcome.label)) / baseRate : null;
    })(),
    topDecileNetUtility: (() => {
      if (scored.length < 10) return null;
      const top = [...scored].sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.floor(scored.length / 10)));
      const values = top.map(item => item.row.outcome?.netUtility).filter(finite);
      return values.length === top.length ? mean(values) : null;
    })(),
  };
}

function rankCorrelation(model, rows) {
  const usable = rows.filter(row => finite(row.outcome?.netUtility));
  if (usable.length < 3) return null;
  const rank = (values) => {
    const ordered = values.map((value, index) => ({value, index})).sort((a, b) => a.value - b.value);
    const result = Array(values.length);
    for (let start = 0; start < ordered.length;) {
      let end = start + 1;
      while (end < ordered.length && ordered[end].value === ordered[start].value) end += 1;
      const average = (start + end - 1) / 2;
      for (let index = start; index < end; index += 1) result[ordered[index].index] = average;
      start = end;
    }
    return result;
  };
  const x = rank(usable.map(row => modelScore(model, row))), y = rank(usable.map(row => row.outcome.netUtility));
  const mx = mean(x), my = mean(y);
  const numerator = x.reduce((sum, value, index) => sum + (value - mx) * (y[index] - my), 0);
  const denominator = Math.sqrt(x.reduce((sum, value) => sum + (value - mx) ** 2, 0) * y.reduce((sum, value) => sum + (value - my) ** 2, 0));
  return denominator ? numerator / denominator : null;
}

function rankingMetrics(rows, score) {
  const usable = rows.filter(row => finite(score(row)));
  const scored = usable.map(row => ({row, score: score(row)})).sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.max(1, Math.floor(scored.length / 10)));
  const baseRate = mean(usable.map(row => row.outcome.label));
  const utility = top.map(item => item.row.outcome?.netUtility).filter(finite);
  return {
    rows: usable.length,
    coverage: rows.length ? usable.length / rows.length : 0,
    auc: auc(usable, score),
    topDecileLift: usable.length >= 10 && baseRate > 0 ? mean(top.map(item => item.row.outcome.label)) / baseRate : null,
    topDecileNetUtility: usable.length >= 10 && utility.length === top.length ? mean(utility) : null,
  };
}

function seededRandom(seedText) {
  let state = 2166136261;
  for (const character of seedText) { state ^= character.charCodeAt(0); state = Math.imul(state, 16777619); }
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}

function firmClusteredAucDelta(rows, candidateScore, benchmarkScore, seed, repetitions = 250) {
  const groups = new Map();
  for (const row of rows) {
    if (!finite(benchmarkScore(row))) continue;
    const firm = firmIdentity(row);
    if (!groups.has(firm)) groups.set(firm, []);
    groups.get(firm).push(row);
  }
  const firms = [...groups.keys()];
  if (firms.length < 20) return null;
  const random = seededRandom(seed), deltas = [];
  for (let iteration = 0; iteration < repetitions; iteration += 1) {
    const sample = [];
    for (let index = 0; index < firms.length; index += 1) sample.push(...groups.get(firms[Math.floor(random() * firms.length)]));
    const candidate = auc(sample, candidateScore), benchmark = auc(sample, benchmarkScore);
    if (candidate != null && benchmark != null) deltas.push(candidate - benchmark);
  }
  if (deltas.length < repetitions * 0.9) return null;
  deltas.sort((a, b) => a - b);
  const percentile = value => deltas[Math.max(0, Math.min(deltas.length - 1, Math.floor((deltas.length - 1) * value)))];
  return {repetitions: deltas.length, lower95: percentile(0.025), median: percentile(0.5), upper95: percentile(0.975)};
}

function exactWeights(model) {
  const magnitudes = model.coefficients.map(Math.abs);
  const total = magnitudes.reduce((sum, value) => sum + value, 0);
  const rows = model.ids.map((id, index) => ({
    id,
    coefficient: model.coefficients[index],
    weight: null,
    direction: model.coefficients[index] === 0 ? 'neutral' : model.coefficients[index] > 0 ? 'positive' : 'negative',
  }));
  if (!total) return {rows, total: 0};

  const basis = magnitudes.map(value => value / total * 10000);
  let assigned = 0;
  for (let index = 0; index < rows.length; index += 1) {
    rows[index].weightBasisPoints = Math.floor(basis[index]);
    assigned += rows[index].weightBasisPoints;
  }
  const remainderOrder = basis.map((value, index) => ({index, remainder: value - Math.floor(value)})).sort((a, b) => b.remainder - a.remainder);
  for (let index = 0; index < 10000 - assigned; index += 1) rows[remainderOrder[index % remainderOrder.length].index].weightBasisPoints += 1;
  for (const row of rows) row.weight = row.weightBasisPoints / 100;
  return {rows, total};
}

function rollingSignStability(rows, strategy) {
  const dates = [...new Set(rows.map(row => Date.parse(row.asOf)).filter(Number.isFinite))].sort((a, b) => a - b);
  if (dates.length < 6) return Object.fromEntries(FEATURE_IDS[strategy].map(id => [id, null]));
  const signs = Object.fromEntries(FEATURE_IDS[strategy].map(id => [id, []]));
  for (const fraction of [0.5, 0.65, 0.8]) {
    const cutoff = dates[Math.floor(dates.length * fraction)];
    // A historical fold may only use labels already observed at its cutoff.
    // Filtering by signal date alone leaked future outcomes into stability.
    const model = fit(rows.filter(row => Date.parse(row.asOf) <= cutoff && Date.parse(row.outcome?.observedAt) <= cutoff), FEATURE_IDS[strategy]);
    model.ids.forEach((id, index) => signs[id].push(Math.sign(model.coefficients[index])));
  }
  return Object.fromEntries(Object.entries(signs).map(([id, values]) => {
    const nonZero = values.filter(value => value !== 0);
    if (!nonZero.length) return [id, 0];
    const positive = nonZero.filter(value => value > 0).length;
    const negative = nonZero.length - positive;
    return [id, Math.max(positive, negative) / nonZero.length];
  }));
}

export async function runLab({strategy, input, output} = {}) {
  if (!FEATURE_IDS[strategy]) throw new Error('strategy must be core or bounce');
  const raw = await fs.readFile(input, 'utf8');
  const rows = raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const errors = validate(rows, strategy);
  const validRows = rows.filter(row => !errors.some(error => error.startsWith(`${row.symbol ?? ''}:${row.asOf ?? ''}:`)) && SAFETY_KEYS.every(key => row.safety?.[key] === 'PASS'));
  const symbols = new Set(validRows.map(row => row.symbol));
  const dates = [...new Set(validRows.map(row => Date.parse(row.asOf)).filter(Number.isFinite))].sort((a, b) => a - b);
  const spanMonths = dates.length ? (dates.at(-1) - dates[0]) / (30.44 * 864e5) : 0;
  const trainEnd = dates[Math.max(0, Math.floor(dates.length * 0.6) - 1)] ?? 0;
  const validationEnd = dates[Math.max(0, Math.floor(dates.length * 0.8) - 1)] ?? 0;
  const validationStart = dates.find(date => date > trainEnd) ?? Infinity;
  const testStart = dates.find(date => date > validationEnd) ?? Infinity;
  // Purge overlapping labels: a row may train a split only when its outcome was
  // fully observed before the next split began.
  const train = validRows.filter(row => Date.parse(row.asOf) <= trainEnd && Date.parse(row.outcome.observedAt) < validationStart);
  const validation = validRows.filter(row => Date.parse(row.asOf) >= validationStart && Date.parse(row.asOf) <= validationEnd && Date.parse(row.outcome.observedAt) < testStart);
  const test = validRows.filter(row => Date.parse(row.asOf) > validationEnd);
  const model = fit(train, FEATURE_IDS[strategy]);
  const threshold = chooseThreshold(model, validation);
  const testMetrics = metrics(model, test, threshold);
  const firms = new Set(validRows.map(firmIdentity));
  const holdoutFirms = new Set([...firms].filter(firm => firmBucket(firm) >= 80));
  const firmTrain = train.filter(row => !holdoutFirms.has(firmIdentity(row)));
  const firmValidation = validation.filter(row => !holdoutFirms.has(firmIdentity(row)));
  const firmTest = test.filter(row => holdoutFirms.has(firmIdentity(row)));
  const holdoutModel = fit(firmTrain, FEATURE_IDS[strategy]);
  const holdoutThreshold = chooseThreshold(holdoutModel, firmValidation);
  const holdout = metrics(holdoutModel, firmTest, holdoutThreshold);
  const weightResult = exactWeights(model);
  const stability = rollingSignStability(validRows, strategy);
  const minimum = MINIMUM[strategy];
  const blockers = [...errors];
  const datasetHash = hash(raw);
  const activeMonths = new Set(dates.map(value => new Date(value).toISOString().slice(0, 7))).size;
  const expectedMonths = dates.length ? Math.max(1, (new Date(dates.at(-1)).getUTCFullYear() - new Date(dates[0]).getUTCFullYear()) * 12 + new Date(dates.at(-1)).getUTCMonth() - new Date(dates[0]).getUTCMonth() + 1) : 0;
  const monthCoverage = expectedMonths ? activeMonths / expectedMonths : 0;
  const utilityCoverage = validRows.length ? validRows.filter(row => finite(row.outcome?.netUtility)).length / validRows.length : 0;
  const executionCostCoverage = validRows.length ? validRows.filter(row => finite(row.outcome?.costBps) && row.outcome.costBps >= 0 && finite(row.outcome?.grossReturn)).length / validRows.length : 0;
  const securityMasterCoverage = validRows.length ? validRows.filter(row => row.securityMaster?.listedAtAsOf === true && ['listed','delisted','acquired','bankrupt'].includes(row.securityMaster?.statusAtOutcome)).length / validRows.length : 0;
  const delistedOutcomes = validRows.filter(row => row.securityMaster?.statusAtOutcome === 'delisted' || row.securityMaster?.statusAtOutcome === 'bankrupt').length;
  const benchmark = rankingMetrics(test, row => row.benchmark?.score);
  const aucDeltaBootstrap = firmClusteredAucDelta(test, row => modelScore(model, row), row => row.benchmark?.score, datasetHash);
  if (validRows.length < minimum.rows) blockers.push(`valid rows ${validRows.length} < ${minimum.rows}`);
  if (symbols.size < minimum.companies) blockers.push(`companies ${symbols.size} < ${minimum.companies}`);
  if (spanMonths < minimum.months) blockers.push(`coverage ${spanMonths.toFixed(1)} months < ${minimum.months}`);
  if (monthCoverage < 0.8) blockers.push(`active-month coverage ${(monthCoverage * 100).toFixed(1)}% < 80%`);
  if (!train.length || !validation.length || !test.length) blockers.push('one or more chronological splits are empty');
  if (testMetrics.auc == null || testMetrics.auc < 0.55) blockers.push(`final test AUC ${testMetrics.auc ?? 'unknown'} < 0.55`);
  if (holdout.auc == null || holdout.auc < 0.53) blockers.push(`firm holdout AUC ${holdout.auc ?? 'unknown'} < 0.53`);
  if (utilityCoverage < 0.95) blockers.push(`netUtility coverage ${(utilityCoverage * 100).toFixed(1)}% < 95%`);
  if (executionCostCoverage < 0.95) blockers.push(`execution-cost coverage ${(executionCostCoverage * 100).toFixed(1)}% < 95%`);
  if (securityMasterCoverage < 0.99) blockers.push(`historical security-master coverage ${(securityMasterCoverage * 100).toFixed(1)}% < 99%`);
  if (!delistedOutcomes) blockers.push('no delisted/bankrupt outcomes; survivorship correction is unproven');
  if (testMetrics.topDecileLift == null || testMetrics.topDecileLift <= 1) blockers.push(`final test top-decile lift ${testMetrics.topDecileLift ?? 'unknown'} <= 1`);
  if (testMetrics.topDecileNetUtility == null || testMetrics.topDecileNetUtility <= 0) blockers.push(`final test top-decile net utility ${testMetrics.topDecileNetUtility ?? 'unknown'} <= 0`);
  if (benchmark.coverage < 0.95) blockers.push(`locked benchmark coverage ${(benchmark.coverage * 100).toFixed(1)}% < 95%`);
  if (testMetrics.auc == null || benchmark.auc == null || testMetrics.auc <= benchmark.auc) blockers.push(`candidate AUC ${testMetrics.auc ?? 'unknown'} does not beat locked benchmark ${benchmark.auc ?? 'unknown'}`);
  if (testMetrics.topDecileNetUtility == null || benchmark.topDecileNetUtility == null || testMetrics.topDecileNetUtility <= benchmark.topDecileNetUtility) blockers.push(`candidate top-decile utility ${testMetrics.topDecileNetUtility ?? 'unknown'} does not beat locked benchmark ${benchmark.topDecileNetUtility ?? 'unknown'}`);
  if (aucDeltaBootstrap == null || aucDeltaBootstrap.lower95 <= 0) blockers.push(`firm-clustered AUC improvement lower bound ${aucDeltaBootstrap?.lower95 ?? 'unknown'} <= 0`);
  if (!weightResult.total) blockers.push('no learned signal; refusing to invent equal weights');
  for (const row of weightResult.rows) if (row.coefficient < 0) blockers.push(`${row.id} learned direction is negative; refusing to publish its absolute magnitude as a positive factor weight`);
  for (const [id, value] of Object.entries(stability)) if (value != null && value < 2 / 3) blockers.push(`${id} sign stability ${value.toFixed(2)} < 0.67`);

  const result = {
    status: blockers.length ? 'BLOCKED' : 'CANDIDATE',
    strategy,
    datasetHash,
    createdAt: new Date().toISOString(),
    protocol: {
      features: FEATURE_IDS[strategy],
      minimum,
      split: '60/20/20 chronological by unique asOf date with outcome-overlap purging',
      holdout: 'fixed 20% firm hash bucket >= 80; firm identity uses firmId/firm/CIK before symbol, and all aliases are excluded from holdout training and threshold selection',
      regularization: 'logistic L2 lambda=0.2',
      labels: 'provided point-in-time future outcomes with gross return, execution cost and net utility; no synthetic labels',
      missingFeatureTreatment: 'training median only; missingness remains in source coverage and cannot become PASS',
      probability: 'not available until post-fit calibration passes the locked validation protocol; raw sigmoid is diagnostics only',
      safety: 'FAIL/UNKNOWN safety rows excluded from learning; they remain non-qualified in production',
    },
    counts: {rawRows: rows.length, validRows: validRows.length, excludedRows: rows.length - validRows.length, companies: symbols.size, firms: firms.size, holdoutFirms: holdoutFirms.size, train: train.length, validation: validation.length, test: test.length, firmHoldout: firmTest.length, activeMonths, expectedMonths, delistedOutcomes},
    metrics: {test: {...testMetrics, rankCorrelation: rankCorrelation(model, test)}, firmHoldout: {...holdout, rankCorrelation: rankCorrelation(holdoutModel, firmTest)}, lockedBenchmark: benchmark, aucDeltaBootstrap},
    coverage: {months: monthCoverage, netUtility: utilityCoverage, executionCosts: executionCostCoverage, securityMaster: securityMasterCoverage, benchmark: benchmark.coverage},
    stability,
    model: {intercept: model.intercept, medians: model.medians},
    weights: weightResult.rows.map(row => ({...row, magnitudeWeight: row.weight})),
    weightInterpretation: 'Magnitude only. A negative coefficient blocks publication and must never be converted into a positive production factor.',
    weightBasisPointsTotal: weightResult.rows.reduce((sum, row) => sum + (row.weightBasisPoints ?? 0), 0),
    blockers,
  };
  if (output) {
    await fs.mkdir(path.dirname(output), {recursive: true});
    await fs.writeFile(output, JSON.stringify(result, null, 2));
  }
  return result;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((values, value, index, all) => value.startsWith('--') ? [...values, [value.slice(2), all[index + 1]]] : values, []));
  if (!args.input || !args.strategy) {
    console.error('Usage: node research/weight-lab.mjs --strategy core|bounce --input dataset.jsonl --output report.json');
    process.exit(2);
  }
  const result = await runLab({strategy: args.strategy, input: args.input, output: args.output});
  console.log(JSON.stringify({status: result.status, counts: result.counts, metrics: result.metrics, stability: result.stability, blockers: result.blockers, weights: result.weights}, null, 2));
  if (result.status === 'BLOCKED') process.exitCode = 3;
}
