import type { Provenance } from './engine';
import type { SourcedValue } from './opportunity-scoring';

export type EcbDailySeries = { currency: string; observations: Array<{ date: string; unitsPerEur: number }>; rateProvider?: string; sourceUrl?: string };
export type EcbUsdConversion = {
  value: number;
  rate: number;
  sourceCurrency: string;
  targetCurrency: 'USD';
  method: 'period-average-daily-reference-cross-rate' | 'period-end-prior-daily-reference-cross-rate';
  ratePeriodStart: string;
  ratePeriodEnd: string;
  observationCount: number;
  sourceUrl: string;
  rateProvider: string;
};

const ECB_URL = 'https://data-api.ecb.europa.eu/service/data/EXR';
const ECB_SOURCE_URL = 'https://data.ecb.europa.eu/help/api/data';
const MAX_CSV_BYTES = 256_000;
const MAX_CACHE_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 64;
const MAX_ENDPOINT_AGE_DAYS = 5;
const MAX_PERIOD_DAYS = 400;
const MAX_REQUEST_DAYS = 400;
const seriesCache = new Map<string, { expiresAt: number; promise: Promise<EcbDailySeries[] | null> }>();

function ecbSeriesUrl(currency: string, start: string, end: string) {
  const normalized = currency.toUpperCase();
  const key = normalized === 'EUR' ? 'D.USD.EUR.SP00.A' : `D.${normalized}+USD.EUR.SP00.A`;
  const url = new URL(`${ECB_URL}/${key}`);
  url.searchParams.set('startPeriod', start); url.searchParams.set('endPeriod', end); url.searchParams.set('format', 'csvdata');
  return url.toString();
}

function frankfurterSeriesUrl(currency: string, start: string, end: string) {
  const normalized = currency.toUpperCase(), quotes = normalized === 'EUR' ? ['USD'] : [...new Set([normalized, 'USD'])];
  const url = new URL('https://api.frankfurter.dev/v2/providers/ecb/rates');
  url.searchParams.set('from', start); url.searchParams.set('to', end); url.searchParams.set('base', 'EUR'); url.searchParams.set('quotes', quotes.join(','));
  return url.toString();
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function parseCsvRow(row: string): string[] | null {
  const fields: string[] = [];
  let value = '', quoted = false;
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (quoted && char === '"' && row[i + 1] === '"') { value += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { fields.push(value); value = ''; }
    else value += char;
  }
  if (quoted) return null;
  fields.push(value);
  return fields;
}

/** Parses only ECB daily spot reference averages against EUR; other series are rejected. */
export function parseEcbDailyCsv(csv: string, expectedCurrencies: readonly string[]): EcbDailySeries[] | null {
  if (typeof csv !== 'string' || !csv.length || csv.length > MAX_CSV_BYTES) return null;
  const rows = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const header = parseCsvRow(rows[0] ?? '');
  if (!header) return null;
  const index = new Map(header.map((key, position) => [key, position]));
  const needed = ['KEY', 'FREQ', 'CURRENCY', 'CURRENCY_DENOM', 'EXR_TYPE', 'EXR_SUFFIX', 'TIME_PERIOD', 'OBS_VALUE'];
  if (needed.some(key => !index.has(key))) return null;
  const currencies = new Set(expectedCurrencies.map(value => value.toUpperCase()));
  const records = new Map<string, Map<string, number>>();
  for (const line of rows.slice(1)) {
    if (!line.trim()) continue;
    const row = parseCsvRow(line);
    if (!row) return null;
    const get = (key: string) => row[index.get(key)!] ?? '';
    const currency = get('CURRENCY').toUpperCase(), date = get('TIME_PERIOD'), rate = Number(get('OBS_VALUE'));
    if (!currencies.has(currency)) continue;
    if (get('FREQ') !== 'D' || get('CURRENCY_DENOM') !== 'EUR' || get('EXR_TYPE') !== 'SP00' || get('EXR_SUFFIX') !== 'A'
      || !validDate(date) || !Number.isFinite(rate) || rate <= 0) return null;
    const expectedKey = `EXR.D.${currency}.EUR.SP00.A`;
    if (get('KEY') !== expectedKey) return null;
    const series = records.get(currency) ?? new Map<string, number>();
    const previous = series.get(date);
    if (previous != null && previous !== rate) return null;
    series.set(date, rate); records.set(currency, series);
  }
  return [...currencies].map(currency => ({ currency, observations: [...(records.get(currency) ?? new Map())]
    .map(([date, unitsPerEur]) => ({ date, unitsPerEur })).sort((a, b) => a.date.localeCompare(b.date)) }));
}

function dateDays(start: string, end: string) {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
}

function weekdayCount(start: string, end: string) {
  let count = 0;
  for (let day = Date.parse(`${start}T00:00:00Z`); day <= Date.parse(`${end}T00:00:00Z`); day += 86_400_000) {
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}

function exactMaps(series: EcbDailySeries[]) {
  return new Map(series.map(item => [item.currency.toUpperCase(), new Map(item.observations.map(observation => [observation.date, observation.unitsPerEur]))]));
}

async function readBoundedText(response: Response, limit: number): Promise<string | null> {
  if (!response.body) return null;
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } catch { await reader.cancel().catch(() => {}); return null; }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function usdPerSourceCurrency(date: string, currency: string, rates: Map<string, Map<string, number>>) {
  if (currency === 'USD') return 1;
  const usd = rates.get('USD')?.get(date);
  if (!usd) return null;
  if (currency === 'EUR') return usd;
  const source = rates.get(currency)?.get(date);
  return source ? usd / source : null;
}

function rateSource(series: EcbDailySeries[], currency: string, start: string, end: string) {
  const source = series.find(item => item.currency.toUpperCase() === (currency === 'EUR' ? 'USD' : currency)) ?? series[0];
  const rateProvider = source?.rateProvider ?? 'European Central Bank (ECB) Data Portal';
  return { sourceUrl: rateProvider.includes('Frankfurter') ? frankfurterSeriesUrl(currency, start, end) : ecbSeriesUrl(currency, start, end), rateProvider };
}

export function convertFlowToUsd(
  value: number,
  sourceCurrency: string,
  periodStart: string,
  periodEnd: string,
  series: EcbDailySeries[],
): EcbUsdConversion | null {
  const currency = sourceCurrency.toUpperCase();
  if (!Number.isFinite(value) || !/^[A-Z]{3}$/.test(currency) || !validDate(periodStart) || !validDate(periodEnd) || periodStart > periodEnd
    || dateDays(periodStart, periodEnd) > MAX_PERIOD_DAYS) return null;
  if (currency === 'USD') return { value, rate: 1, sourceCurrency: currency, targetCurrency: 'USD', method: 'period-average-daily-reference-cross-rate', ratePeriodStart: periodStart, ratePeriodEnd: periodEnd, observationCount: 0, ...rateSource(series, currency, periodStart, periodEnd) };
  const rates = exactMaps(series), sourceDates = new Set(series.flatMap(item => item.currency === currency || item.currency === 'USD' ? item.observations.map(rate => rate.date) : []));
  const daily = [...sourceDates].filter(date => date >= periodStart && date <= periodEnd)
    .map(date => ({ date, rate: usdPerSourceCurrency(date, currency, rates) }))
    .filter((item): item is { date: string; rate: number } => item.rate != null && Number.isFinite(item.rate) && item.rate > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const expected = weekdayCount(periodStart, periodEnd);
  if (!daily.length || daily.length < Math.ceil(expected * 0.9)
    || dateDays(periodStart, daily[0].date) > MAX_ENDPOINT_AGE_DAYS
    || dateDays(daily.at(-1)!.date, periodEnd) > MAX_ENDPOINT_AGE_DAYS) return null;
  const rate = daily.reduce((sum, item) => sum + item.rate, 0) / daily.length;
  return { value: value * rate, rate, sourceCurrency: currency, targetCurrency: 'USD', method: 'period-average-daily-reference-cross-rate', ratePeriodStart: daily[0].date, ratePeriodEnd: daily.at(-1)!.date, observationCount: daily.length, ...rateSource(series, currency, periodStart, periodEnd) };
}

export function convertInstantToUsd(
  value: number,
  sourceCurrency: string,
  periodEnd: string,
  series: EcbDailySeries[],
): EcbUsdConversion | null {
  const currency = sourceCurrency.toUpperCase();
  if (!Number.isFinite(value) || !/^[A-Z]{3}$/.test(currency) || !validDate(periodEnd)) return null;
  if (currency === 'USD') return { value, rate: 1, sourceCurrency: currency, targetCurrency: 'USD', method: 'period-end-prior-daily-reference-cross-rate', ratePeriodStart: periodEnd, ratePeriodEnd: periodEnd, observationCount: 0, ...rateSource(series, currency, periodEnd, periodEnd) };
  const rates = exactMaps(series);
  const dates = [...new Set(series.flatMap(item => item.currency === currency || item.currency === 'USD' ? item.observations.map(rate => rate.date) : []))]
    .filter(date => date <= periodEnd).sort((a, b) => b.localeCompare(a));
  const date = dates.find(candidate => dateDays(candidate, periodEnd) <= MAX_ENDPOINT_AGE_DAYS
    && usdPerSourceCurrency(candidate, currency, rates) != null);
  if (!date) return null;
  const rate = usdPerSourceCurrency(date, currency, rates)!;
  return { value: value * rate, rate, sourceCurrency: currency, targetCurrency: 'USD', method: 'period-end-prior-daily-reference-cross-rate', ratePeriodStart: date, ratePeriodEnd: date, observationCount: 1, ...rateSource(series, currency, date, date) };
}

export function translateSourcedValue(value: SourcedValue, conversion: EcbUsdConversion, retrievedAt = new Date().toISOString()): SourcedValue {
  const lineage = {
    rate: conversion.rate, sourceCurrency: conversion.sourceCurrency, targetCurrency: conversion.targetCurrency,
    method: conversion.method, ratePeriodStart: conversion.ratePeriodStart, ratePeriodEnd: conversion.ratePeriodEnd,
    observationCount: conversion.observationCount, sourceUrl: conversion.sourceUrl,
    rateProvider: conversion.rateProvider,
    inputAvailableAt: value.source.availableAt, inputRetrievedAt: value.source.retrievedAt,
  };
  const provenance: Provenance = {
    ...value.source,
    source: `${value.source.source} · analytical USD translation using ECB daily reference rates`,
    availableAt: retrievedAt,
    retrievedAt,
    currency: 'USD',
    tag: `${value.source.tag ?? 'SEC fact'}; converted ${conversion.sourceCurrency}→USD at ${conversion.rate}; ${conversion.ratePeriodStart}..${conversion.ratePeriodEnd}; ${conversion.observationCount} observation(s)`,
    conversion: { ...lineage },
  };
  return { ...value, value: conversion.value, unit: 'USD', source: provenance };
}

/** Converts one full reported-currency period as a unit; partial periods stay entirely reported-currency. */
export function convertEarningsPeriodsToUsd<T extends { start: string; end: string; metrics: Record<string, SourcedValue | undefined> }>(
  periods: T[], currency: string, series: EcbDailySeries[], retrievedAt = new Date().toISOString(),
) {
  let convertedCount = 0, withheldCount = 0;
  const translated = periods.map(period => {
    const metrics = Object.entries(period.metrics).filter((entry): entry is [string, SourcedValue] => !!entry[1]);
    if (currency.toUpperCase() === 'USD') return { ...period, reportedCurrency: currency, translation: 'reported-usd' as const };
    const conversions = metrics.map(([, value]) => value.unit.toUpperCase() === currency.toUpperCase()
      ? convertFlowToUsd(value.value, currency, period.start, period.end, series) : null);
    if (!metrics.length || conversions.some(conversion => !conversion)) {
      withheldCount++;
      return { ...period, reportedCurrency: currency, translation: 'withheld-rate-coverage' as const };
    }
    const convertedMetrics = Object.fromEntries(metrics.map(([key, value], index) => [key, translateSourcedValue(value, conversions[index]!, retrievedAt)]));
    convertedCount++;
    return { ...period, metrics: { ...period.metrics, ...convertedMetrics }, reportedCurrency: currency, translation: 'translated-to-usd' as const };
  });
  return { periods: translated, convertedCount, withheldCount, state: withheldCount === 0 ? 'complete' as const : convertedCount ? 'partial' as const : 'unavailable' as const };
}

/** Translate sourced balance-sheet stocks at the prior period-end rate and TTM flows at period-average rates. */
export function convertFinancialMetricsToUsd<T extends Record<string, SourcedValue | undefined>>(
  metrics: T, currency: string, series: EcbDailySeries[], retrievedAt = new Date().toISOString(),
) {
  const translated: Record<string, SourcedValue | undefined> = { ...metrics };
  let convertedCount = 0, withheldCount = 0;
  const instantMetrics = new Set(['unrestrictedCash', 'totalDebt', 'debtDueWithin24Months']);
  for (const [name, value] of Object.entries(metrics)) {
    if (!value) continue;
    const conversion = value.unit.toUpperCase() === currency.toUpperCase()
      ? instantMetrics.has(name)
        ? convertInstantToUsd(value.value, currency, value.source.periodEnd, series)
        : value.source.periodStart
          ? convertFlowToUsd(value.value, currency, value.source.periodStart, value.source.periodEnd, series)
          : null
      : null;
    if (!conversion) { withheldCount++; continue; }
    translated[name] = translateSourcedValue(value, conversion, retrievedAt);
    convertedCount++;
  }
  return { metrics: translated as T, convertedCount, withheldCount, state: withheldCount === 0 ? 'complete' as const : convertedCount ? 'partial' as const : 'unavailable' as const };
}

async function fetchFrankfurterEcbChunk(currency: string, start: string, end: string, onFailure?: (reason: string) => void): Promise<EcbDailySeries[] | null> {
  const quoteCurrencies = currency === 'EUR' ? ['USD'] : [...new Set([currency, 'USD'])];
  const url = new URL(frankfurterSeriesUrl(currency, start, end));
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'SmallCapRadar/2.2' }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) { onFailure?.(`frankfurter-http-${response.status}`); return null; }
    if (Number(response.headers.get('content-length')) > MAX_CSV_BYTES) { onFailure?.('frankfurter-response-too-large'); return null; }
    const body = await readBoundedText(response, MAX_CSV_BYTES);
    if (body == null) { onFailure?.('frankfurter-empty-or-oversized-response'); return null; }
    const rows: unknown = JSON.parse(body);
    if (!Array.isArray(rows)) { onFailure?.('frankfurter-invalid-json'); return null; }
    const rates = new Map<string, Map<string, number>>();
    for (const row of rows) {
      if (!row || typeof row !== 'object') { onFailure?.('frankfurter-invalid-row'); return null; }
      const item = row as Record<string, unknown>, date = item.date, base = item.base, quote = item.quote, rate = item.rate;
      if (base !== 'EUR' || typeof quote !== 'string' || !quoteCurrencies.includes(quote)
        || !validDate(date) || typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0
        || dateDays(date, start) > MAX_ENDPOINT_AGE_DAYS || dateDays(end, date) > 0) { onFailure?.('frankfurter-invalid-observation'); return null; }
      const currencyRates = rates.get(quote) ?? new Map<string, number>(), previous = currencyRates.get(date);
      if (previous != null && previous !== rate) { onFailure?.('frankfurter-conflicting-observation'); return null; }
      currencyRates.set(date, rate); rates.set(quote, currencyRates);
    }
    const sourceUrl = url.toString(), rateProvider = 'European Central Bank (ECB) via Frankfurter API';
    return quoteCurrencies.map(quote => ({ currency: quote, observations: [...(rates.get(quote) ?? new Map())].map(([date, unitsPerEur]) => ({ date, unitsPerEur })).sort((a, b) => a.date.localeCompare(b.date)), rateProvider, sourceUrl }));
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    onFailure?.(/timeout/i.test(name) ? 'frankfurter-timeout' : 'frankfurter-request-failed');
    return null;
  }
}

export async function fetchEcbDailySeries(currency: string, start: string, end: string, onFailure?: (reason: string) => void): Promise<EcbDailySeries[] | null> {
  const normalized = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized) || !validDate(start) || !validDate(end) || start > end || dateDays(start, end) > MAX_PERIOD_DAYS * 3) return null;
  if (normalized === 'USD') return [{ currency: 'USD', observations: [] }];
  const cacheKey = `${normalized}/${start}/${end}`;
  const now = Date.now(), cached = seriesCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.promise;
  const promise = (async () => {
    const expected = normalized === 'EUR' ? ['USD'] : [normalized, 'USD'];
    const merged = new Map<string, Map<string, number>>();
    const sourceMeta = new Map<string, Pick<EcbDailySeries, 'rateProvider' | 'sourceUrl'>>();
    const firstDay = Date.parse(`${start}T00:00:00Z`), lastDay = Date.parse(`${end}T00:00:00Z`);
    for (let chunkStart = firstDay; chunkStart <= lastDay;) {
      const chunkEnd = Math.min(lastDay, chunkStart + (MAX_REQUEST_DAYS - 1) * 86_400_000);
      const chunkStartDate = new Date(chunkStart).toISOString().slice(0, 10), chunkEndDate = new Date(chunkEnd).toISOString().slice(0, 10);
      let parsedChunk: EcbDailySeries[] | null = null;
      let officialFailure = 'invalid-ecb-csv';
      try {
        const response = await fetch(ecbSeriesUrl(normalized, chunkStartDate, chunkEndDate), { headers: { Accept: 'text/csv', 'User-Agent': 'SmallCapRadar/2.2' }, signal: AbortSignal.timeout(8_000) });
        if (!response.ok) officialFailure = `http-${response.status}`;
        else if (Number(response.headers.get('content-length')) > MAX_CSV_BYTES) officialFailure = 'response-too-large';
        else {
          const csv = await readBoundedText(response, MAX_CSV_BYTES);
          if (csv != null) parsedChunk = parseEcbDailyCsv(csv, expected);
          else officialFailure = 'empty-or-oversized-response';
          if (parsedChunk) parsedChunk = parsedChunk.map(item => ({ ...item, sourceUrl: ecbSeriesUrl(normalized, chunkStartDate, chunkEndDate), rateProvider: 'European Central Bank (ECB) Data Portal' }));
        }
      } catch (error) {
        const errorName = error instanceof Error ? error.name : '';
        const cause = error && typeof error === 'object' && 'cause' in error ? (error as { cause?: unknown }).cause : undefined;
        const causeCode = cause && typeof cause === 'object' && 'code' in cause ? String((cause as { code?: unknown }).code ?? '') : '';
        const safeCauseCode = /^[A-Z0-9_]{2,32}$/.test(causeCode) ? causeCode.toLowerCase() : '';
        console.error('[ECB FX] Daily reference request failed', { errorName: errorName || 'unknown', ...(safeCauseCode ? { causeCode: safeCauseCode } : {}), ...(error instanceof Error ? { message: error.message.slice(0, 160) } : {}) });
        officialFailure = /timeout/i.test(errorName) ? 'timeout' : safeCauseCode ? `request-failed-${safeCauseCode}` : /^(AbortError|TypeError|Error)$/.test(errorName) ? `request-failed-${errorName.toLowerCase()}` : 'request-failed';
      }
      if (!parsedChunk) {
        let fallbackFailure: string | undefined;
        parsedChunk = await fetchFrankfurterEcbChunk(normalized, chunkStartDate, chunkEndDate, reason => { fallbackFailure = reason; });
        if (!parsedChunk) { onFailure?.(fallbackFailure ?? officialFailure); return null; }
      }
      for (const series of parsedChunk) {
        sourceMeta.set(series.currency, { rateProvider: series.rateProvider, sourceUrl: series.sourceUrl });
        const observations = merged.get(series.currency) ?? new Map<string, number>();
        for (const item of series.observations) {
          const existing = observations.get(item.date);
          if (existing != null && existing !== item.unitsPerEur) { onFailure?.('conflicting-observation'); return null; }
          observations.set(item.date, item.unitsPerEur);
        }
        merged.set(series.currency, observations);
      }
      chunkStart = chunkEnd + 86_400_000;
    }
    return expected.map(currency => ({ currency, observations: [...(merged.get(currency) ?? new Map())].map(([date, unitsPerEur]) => ({ date, unitsPerEur })).sort((a, b) => a.date.localeCompare(b.date)), ...sourceMeta.get(currency) }));
  })();
  for (const [key, entry] of seriesCache) if (entry.expiresAt <= now) seriesCache.delete(key);
  while (seriesCache.size >= MAX_CACHE_ENTRIES) seriesCache.delete(seriesCache.keys().next().value!);
  seriesCache.set(cacheKey, { expiresAt: now + MAX_CACHE_MS, promise });
  const result = await promise;
  if (!result && seriesCache.get(cacheKey)?.promise === promise) seriesCache.delete(cacheKey);
  return result;
}

export const ecbFxConstants = { sourceUrl: ECB_SOURCE_URL, maxCsvBytes: MAX_CSV_BYTES, maxEndpointAgeDays: MAX_ENDPOINT_AGE_DAYS };
