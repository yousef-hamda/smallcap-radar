import type { Provenance, Snapshot } from './engine';
import { scoreTechnicalTiming, type TechnicalBar, type TechnicalTimingAssessment, type TechnicalTimingScore } from './opportunity-scoring';

type DailyRow = NonNullable<Snapshot['history']>[number];
export type TechnicalResearchState = {
  providerStatus: 'retrieved' | 'unavailable' | 'invalid';
  dailyBars: number;
  weeklyBars: number;
  monthlyBars: number;
  benchmarkBars: number;
  splitAdjusted: boolean;
  rightsStatus: NonNullable<Provenance['rightsStatus']>;
  assessment?: TechnicalTimingAssessment;
  score: TechnicalTimingScore;
  missing: string[];
};

function completedRows(rows: DailyRow[], asOf: string): DailyRow[] {
  const cutoff = Date.parse(asOf);
  const unique = new Map<string, DailyRow>();
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(row.date))
      || Date.parse(`${row.date}T23:59:59.999Z`) > cutoff || !Number.isFinite(row.close) || row.close <= 0) continue;
    if ([0, 6].includes(new Date(`${row.date}T00:00:00Z`).getUTCDay())) continue;
    unique.set(row.date, row);
  }
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function aggregateCompleted(rows: DailyRow[], asOf: string, interval: 'week' | 'month'): TechnicalBar[] {
  const grouped = new Map<string, DailyRow>();
  const cutoff = Date.parse(asOf);
  for (const row of rows) {
    const date = new Date(`${row.date}T00:00:00Z`);
    let key: string;
    let end: number;
    if (interval === 'week') {
      const monday = new Date(date);
      monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      key = monday.toISOString().slice(0, 10);
      end = Date.parse(`${new Date(monday.getTime() + 6 * 86_400_000).toISOString().slice(0, 10)}T23:59:59.999Z`);
    } else {
      key = row.date.slice(0, 7);
      const [year, month] = key.split('-').map(Number);
      end = Date.UTC(year, month, 0, 23, 59, 59, 999);
    }
    if (end > cutoff) continue;
    const previous = grouped.get(key);
    if (!previous || previous.date < row.date) grouped.set(key, row);
  }
  return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date))
    .map(row => ({ date: row.date, close: row.close, volume: row.volume, completed: true }));
}

function sourceFor(source: Provenance, periodEnd: string, label: string, rightsStatus: Provenance['rightsStatus']): Provenance {
  return { ...source, source: `${source.source} · ${label}`, periodEnd, availableAt: `${periodEnd}T21:00:00.000Z`, rightsStatus };
}

function unavailableScore(asOf: string, historySource?: Provenance) {
  return scoreTechnicalTiming({
    asOf, splitAdjusted: false, daily: [], weekly: [], monthly: [], benchmarkDaily: [],
    source: historySource as Provenance, weeklySource: historySource as Provenance,
    monthlySource: historySource as Provenance, benchmarkSource: historySource as Provenance,
  } as TechnicalTimingAssessment);
}

/**
 * Build point-in-time daily/weekly/monthly trend evidence from completed daily
 * bars. The factor scorer still enforces licensing, freshness, split coverage,
 * minimum sample size, and exact benchmark alignment.
 */
export function buildTechnicalTimingResearch(input: {
  history?: DailyRow[];
  benchmarkHistory?: DailyRow[];
  historySource?: Provenance;
  benchmarkSource?: Provenance;
  splitAdjusted: boolean;
  asOf: string;
  rightsStatus?: Provenance['rightsStatus'];
}): TechnicalResearchState {
  const rightsStatus = input.rightsStatus ?? 'unknown';
  const dailyRows = completedRows(input.history ?? [], input.asOf);
  const benchmarkRows = completedRows(input.benchmarkHistory ?? [], input.asOf);
  const weekly = aggregateCompleted(dailyRows, input.asOf, 'week');
  const monthly = aggregateCompleted(dailyRows, input.asOf, 'month');
  const daily: TechnicalBar[] = dailyRows.map(row => ({ date: row.date, close: row.close, volume: row.volume, completed: true }));
  const benchmarkDaily: TechnicalBar[] = benchmarkRows.map(row => ({ date: row.date, close: row.close, volume: row.volume, completed: true }));
  const assessment = input.historySource && input.benchmarkSource && dailyRows.length && weekly.length && monthly.length && benchmarkRows.length
    ? {
      asOf: input.asOf,
      splitAdjusted: input.splitAdjusted,
      daily, weekly, monthly, benchmarkDaily,
      source: sourceFor(input.historySource, daily.at(-1)!.date, 'completed daily bars', rightsStatus),
      weeklySource: sourceFor(input.historySource, weekly.at(-1)!.date, 'last completed session per completed week', rightsStatus),
      monthlySource: sourceFor(input.historySource, monthly.at(-1)!.date, 'last completed session per completed month', rightsStatus),
      benchmarkSource: sourceFor(input.benchmarkSource, benchmarkDaily.at(-1)!.date, 'completed benchmark daily bars', rightsStatus),
    } satisfies TechnicalTimingAssessment
    : undefined;
  const score = assessment
    ? scoreTechnicalTiming(assessment)
    : unavailableScore(input.asOf, input.historySource);
  const missing: string[] = [];
  if (!input.historySource) missing.push('Stock price-history source metadata is unavailable.');
  if (dailyRows.length < 200) missing.push(`Only ${dailyRows.length}/200 completed daily stock bars are available.`);
  if (weekly.length < 30) missing.push(`Only ${weekly.length}/30 completed weekly bars are available.`);
  if (monthly.length < 12) missing.push(`Only ${monthly.length}/12 completed monthly bars are available.`);
  if (!input.benchmarkSource) missing.push('Benchmark price-history source metadata is unavailable.');
  if (benchmarkRows.length < 64) missing.push(`Only ${benchmarkRows.length}/64 completed benchmark bars are available.`);
  if (!input.splitAdjusted) missing.push('Verified split-adjusted price history is unavailable.');
  if (!['public-domain', 'redistribution-permitted', 'licensed'].includes(rightsStatus)) missing.push('Price-history redistribution rights are not verified; the technical factor remains unscored.');
  if (score.score == null && !missing.length) missing.push(score.rationale);
  const providerStatus = dailyRows.length && benchmarkRows.length ? 'retrieved' : 'unavailable';
  return {
    providerStatus,
    dailyBars: dailyRows.length,
    weeklyBars: weekly.length,
    monthlyBars: monthly.length,
    benchmarkBars: benchmarkRows.length,
    splitAdjusted: input.splitAdjusted,
    rightsStatus,
    ...(assessment ? { assessment } : {}),
    score,
    missing,
  };
}
