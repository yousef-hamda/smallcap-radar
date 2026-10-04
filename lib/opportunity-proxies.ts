import type { Snapshot, Provenance } from './engine';
import type { OpportunityEvidence, OpportunityEvidenceSet } from './opportunity-engine';

type NumericKey = keyof Snapshot;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, low = 0, high = 10) => Math.max(low, Math.min(high, value));

function sourceFor(snapshot: Snapshot, keys: NumericKey[]): Provenance[] {
  const sources: Provenance[] = [];
  for (const key of keys) {
    const source = snapshot.provenance[key as string];
    if (!source || !source.url) continue;
    // SEC EDGAR facts are public government records. Market-data sources keep
    // their original rights status and therefore cannot silently become a
    // licensed input merely because a proxy uses them.
    let hostname = '';
    try { hostname = new URL(source.url).hostname; } catch { continue; }
    const isSec = /(^|\.)sec\.gov$/i.test(hostname)
      || /(^|\.)data\.sec\.gov$/i.test(hostname);
    sources.push(isSec && !source.rightsStatus ? { ...source, rightsStatus: 'public-domain' } : source);
  }
  return [...new Map(sources.map(source => [`${source.url}:${source.periodEnd}:${source.tag ?? ''}`, source])).values()];
}

function evidence(
  score: number,
  available: number,
  total: number,
  keys: NumericKey[],
  snapshot: Snapshot,
  rationale: string,
  inputs: Array<{ name: string; value: string | number; unit?: string }>,
): OpportunityEvidence {
  const coveragePct = Math.round((available / total) * 100);
  const sources = sourceFor(snapshot, keys);
  return {
    score: clamp(score),
    coveragePct,
    rationale: `${rationale} Deterministic proxy score; it is not a filing-level qualitative review.`,
    sources,
    confidence: coveragePct === 100 && sources.length > 0 ? 'medium' : 'low',
    calculation: { rubricId: 'proxy-v1', inputs },
  };
}

/**
 * Conservative, reproducible proxies for factors that do not have a single
 * numeric vendor field. They use only values already present on the snapshot;
 * missing inputs lower coverage and never become neutral evidence.
 */
export function proxyOpportunityEvidence(snapshot: Snapshot): OpportunityEvidenceSet {
  const output: OpportunityEvidenceSet = {};

  const valuationInputs: NumericKey[] = [];
  let valuation = 0;
  if (finite(snapshot.evSales) && snapshot.evSales >= 0) {
    valuationInputs.push('evSales');
    valuation = snapshot.evSales <= 1 ? 9 : snapshot.evSales <= 3 ? 7.5 : snapshot.evSales <= 6 ? 5.5 : snapshot.evSales <= 10 ? 3.5 : 1.5;
  } else if (finite(snapshot.ps) && snapshot.ps >= 0) {
    valuationInputs.push('ps');
    valuation = snapshot.ps <= 1 ? 9 : snapshot.ps <= 3 ? 7.5 : snapshot.ps <= 6 ? 5.5 : snapshot.ps <= 10 ? 3.5 : 1.5;
  }
  if (finite(snapshot.fcfYield)) { valuationInputs.push('fcfYield'); valuation += clamp(snapshot.fcfYield * 100 * 0.7, -1.5, 1.5); }
  if (finite(snapshot.revenueGrowth)) { valuationInputs.push('revenueGrowth'); valuation += clamp(snapshot.revenueGrowth * 100 * 0.03, -1, 1); }
  if (valuationInputs.length) output.valuation = evidence(valuation, valuationInputs.length, 3, valuationInputs, snapshot, 'Relative valuation uses EV/Sales or P/S, adjusted modestly for free-cash-flow yield and growth.', valuationInputs.map(key => ({ name: key, value: Number(snapshot[key]) })));

  const catalystKeys: NumericKey[] = [];
  let catalyst = 0;
  if (finite(snapshot.revenueGrowth)) { catalystKeys.push('revenueGrowth'); catalyst += clamp(5 + snapshot.revenueGrowth * 100 * 0.12, 0, 10); }
  if (snapshot.backlog && finite(snapshot.backlog.amount) && finite(snapshot.revenue) && snapshot.revenue > 0) { catalystKeys.push('revenue', 'backlog'); catalyst += clamp(snapshot.backlog.amount! / snapshot.revenue * 2, 0, 2); }
  if (snapshot.nextEarnings) { catalystKeys.push('nextEarnings'); catalyst += 1; }
  if (catalystKeys.length) output.catalysts = evidence(catalyst, catalystKeys.length, 3, catalystKeys, snapshot, 'Catalyst proxy uses forward-dated earnings timing, disclosed backlog relative to revenue, and observed revenue growth.', catalystKeys.map(key => ({ name: key, value: String(snapshot[key]) })));

  const competitiveKeys: NumericKey[] = [];
  let competitive = 0;
  if (finite(snapshot.grossMargin)) { competitiveKeys.push('grossMargin'); competitive += clamp(snapshot.grossMargin * 10, 0, 6); }
  if (finite(snapshot.operatingMarginTrend)) { competitiveKeys.push('operatingMarginTrend'); competitive += clamp(5 + snapshot.operatingMarginTrend * 20, 0, 3); }
  if (finite(snapshot.revenueGrowth)) { competitiveKeys.push('revenueGrowth'); competitive += clamp(1 + snapshot.revenueGrowth * 100 * 0.03, 0, 1); }
  if (competitiveKeys.length) output.competitivePosition = evidence(competitive, competitiveKeys.length, 3, competitiveKeys, snapshot, 'Business-quality proxy combines gross margin, operating-margin direction, and organic growth signals.', competitiveKeys.map(key => ({ name: key, value: Number(snapshot[key]) })));

  const downsideKeys: NumericKey[] = [];
  let downside = 7;
  if (finite(snapshot.cash) && finite(snapshot.debt)) { downsideKeys.push('cash', 'debt'); downside += snapshot.cash >= snapshot.debt ? 2 : snapshot.cash >= snapshot.debt * 0.5 ? 0 : -2; }
  if (finite(snapshot.dilution)) { downsideKeys.push('dilution'); downside += snapshot.dilution <= 0 ? 1 : snapshot.dilution < 0.1 ? 0 : -2; }
  if (snapshot.deathSpiral && snapshot.deathSpiral !== 'unknown') { downsideKeys.push('deathSpiral'); downside += snapshot.deathSpiral === 'clean' ? 1 : snapshot.deathSpiral === 'severe' ? -4 : -1; }
  if (downsideKeys.length) output.downsideRisk = evidence(downside, downsideKeys.length, 3, downsideKeys, snapshot, 'Downside proxy combines cash/debt capacity, dilution, and the financing-risk classification.', downsideKeys.map(key => ({ name: key, value: String(snapshot[key]) })));

  const managementKeys: NumericKey[] = [];
  let management = 5;
  if (finite(snapshot.dilution)) { managementKeys.push('dilution'); management += snapshot.dilution <= 0 ? 2 : snapshot.dilution < 0.1 ? 0 : -2; }
  if (finite(snapshot.insiderBuyValue)) { managementKeys.push('insiderBuyValue'); management += snapshot.insiderBuyValue > 0 ? 2 : -1; }
  if (snapshot.lastEarningsStatus) { managementKeys.push('lastEarningsStatus'); management += snapshot.lastEarningsStatus === 'إيجابي' ? 1 : snapshot.lastEarningsStatus === 'سلبي' ? -1 : 0; }
  if (managementKeys.length) output.management = evidence(management, managementKeys.length, 3, managementKeys, snapshot, 'Management proxy uses dilution discipline, verified open-market insider activity when present, and the latest reported earnings outcome.', managementKeys.map(key => ({ name: key, value: String(snapshot[key]) })));

  const technicalKeys: NumericKey[] = [];
  let technical = 5;
  if (finite(snapshot.price) && finite(snapshot.ma30w) && snapshot.ma30w > 0) { technicalKeys.push('price', 'ma30w'); technical += snapshot.price > snapshot.ma30w ? 2 : -2; }
  if (finite(snapshot.price) && finite(snapshot.low52w) && finite(snapshot.high52w) && snapshot.high52w > snapshot.low52w) { technicalKeys.push('price', 'low52w', 'high52w'); const position = (snapshot.price - snapshot.low52w) / (snapshot.high52w - snapshot.low52w); technical += clamp((position - 0.5) * 4, -2, 2); }
  if (finite(snapshot.return12m)) { technicalKeys.push('return12m'); technical += clamp(snapshot.return12m * 4, -2, 2); }
  if (technicalKeys.length) output.technicalTiming = evidence(technical, technicalKeys.length, 3, technicalKeys, snapshot, 'Technical proxy combines price versus 30-week average, 52-week range position, and trailing return.', technicalKeys.map(key => ({ name: key, value: Number(snapshot[key]) })));

  return output;
}
