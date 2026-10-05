import type { Snapshot, Provenance } from './engine';
import type { OpportunityEvidenceSet } from './opportunity-engine';
import { usableEvidence } from './evidence';
import { OPPORTUNITY_SPEC, type OpportunityFactorId } from './opportunity-spec';

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, low = 0, high = 10) => Math.max(low, Math.min(high, value));
type Component = { name: string; weight: number; grade: number | null; keys: string[]; values: Array<string | number> };

/** Fixed component denominators: missing observations earn zero, never a positive prior.
 * These are model estimates, not assertions of fair value, a moat, or reviewed governance. */
export function proxyOpportunityEvidence(snapshot: Snapshot): OpportunityEvidenceSet {
  const output: OpportunityEvidenceSet = {};
  const observation = (key: string): number | null => {
    const value = snapshot[key as keyof Snapshot], source = snapshot.provenance?.[key];
    if (!finite(value) || !source || !usableEvidence(source, snapshot.asOf)
      || !Number.isFinite(Date.parse(source.retrievedAt)) || Date.parse(source.retrievedAt) > Date.parse(snapshot.asOf)) return null;
    try { if (new URL(source.url!).protocol !== 'https:') return null; } catch { return null; }
    // Retain original rights metadata. Using an observed value in a model does
    // not certify its source, freshness or redistribution entitlement.
    const age = (Date.parse(snapshot.asOf) - Date.parse(source.periodEnd)) / 86_400_000;
    if (!Number.isFinite(age) || age < 0 || age > (['price','ma30w','low52w','high52w','return12m','ps','evSales','fcfYield'].includes(key) ? 7 : 400)) return null;
    return value;
  };
  const component = (name: string, weight: number, keys: string[], calculate: (...values: number[]) => number): Component => {
    const values = keys.map(observation);
    return { name, weight, keys, values: values.map(value => value ?? 'missing-or-ineligible'), grade: values.every(finite) ? clamp(calculate(...values as number[])) : null };
  };
  const set = (id: OpportunityFactorId, rationale: string, components: Component[]) => {
    const conflicts = snapshot.sourceConflicts ?? [];
    const usable = conflicts.length ? [] : components.filter(item => item.grade !== null);
    const coveragePct = usable.reduce((sum, item) => sum + item.weight, 0);
    const sources: Provenance[] = [...new Map(usable.flatMap(item => item.keys.flatMap(key => {
      const source = snapshot.provenance?.[key];
      return source ? [[JSON.stringify(source), source] as const] : [];
    }))).values()];
    output[id] = {
      score: Math.round(usable.reduce((sum, item) => sum + item.grade! * item.weight / 100, 0) * 100) / 100,
      proxy: true, coveragePct, confidence: 'low', sources, conflicts,
      rationale: `${rationale} Model components use a fixed denominator; missing components earn zero. Input coverage ${coveragePct}%; this is a model rating, not a qualitative review.${conflicts.length ? ' Unresolved snapshot conflicts withhold model points.' : ''}`,
      calculation: { rubricId: `${id}-model-v2`, inputs: components.flatMap(item => [
        { name: `${item.name}:weight`, value: item.weight },
        { name: `${item.name}:grade`, value: conflicts.length ? 'withheld-conflict' : item.grade ?? 'missing-zero' },
        ...item.keys.map((key, index) => ({ name: `${item.name}:${key}`, value: item.values[index] })),
      ]) },
    };
  };
  const multiple = observation('evSales') !== null ? 'evSales' : 'ps';
  set('valuation', 'Relative valuation uses sales multiples, FCF yield and growth; no fair value is invented.', [
    component('sales-multiple', 70, [multiple], value => value < 0 ? 0 : value <= 1 ? 9 : value <= 3 ? 7.5 : value <= 6 ? 5.5 : value <= 10 ? 3.5 : 1.5),
    component('fcf-yield', 20, ['fcfYield'], value => value <= 0 ? 0 : clamp(value * 100)),
    component('growth', 10, ['revenueGrowth'], value => value <= 0 ? 0 : clamp(value * 25)),
  ]);
  const earningsDate = Date.parse(snapshot.nextEarnings ?? '');
  const inHorizon = Number.isFinite(earningsDate) && earningsDate > Date.parse(snapshot.asOf)
    && earningsDate <= Date.parse(snapshot.asOf) + OPPORTUNITY_SPEC.defaultHorizonMonths * 30.4375 * 86_400_000
    && !!snapshot.provenance?.nextEarnings && usableEvidence(snapshot.provenance.nextEarnings, snapshot.asOf);
  const backlog = snapshot.backlog;
  const revenue = observation('revenue');
  const backlogEligible = finite(backlog?.amount) && backlog!.amount! >= 0 && revenue !== null && revenue > 0
    && !!snapshot.provenance?.backlog && usableEvidence(snapshot.provenance.backlog, snapshot.asOf);
  set('catalysts', 'Observed growth and disclosed backlog approximate business momentum; a scheduled earnings event earns only limited timing credit, not positive impact.', [
    component('growth-momentum', 50, ['revenueGrowth'], value => clamp(value * 25)),
    { name: 'backlog', weight: 30, grade: backlogEligible ? clamp(backlog!.amount! / revenue! * 5) : null, keys: ['backlog','revenue'], values: [backlog?.amount ?? 'missing', revenue ?? 'missing'] },
    { name: 'earnings-window', weight: 20, grade: inHorizon ? 2 : null, keys: ['nextEarnings'], values: [snapshot.nextEarnings ?? 'missing'] },
  ]);
  set('competitivePosition', 'Margins and growth approximate business quality; they do not establish a durable competitive moat.', [
    component('gross-margin', 50, ['grossMargin'], value => value * 15),
    component('margin-trend', 30, ['operatingMarginTrend'], value => value > 0 ? clamp(value * 100) : 0),
    component('growth', 20, ['revenueGrowth'], value => clamp(value * 25)),
  ]);
  const financingSource = snapshot.provenance?.deathSpiral;
  const financingKnown = !!financingSource && usableEvidence(financingSource, snapshot.asOf)
    && ['clean','moderate','severe'].includes(snapshot.deathSpiral ?? '');
  set('downsideRisk', 'Cash versus debt, dilution and observed financing findings approximate downside resilience.', [
    component('cash-debt', 40, ['cash','debt'], (cash, debt) => cash < 0 || debt < 0 ? 0 : debt === 0 ? 10 : clamp(cash / debt * 5)),
    component('dilution', 30, ['dilution'], value => clamp(10 - Math.max(0, value) * 40)),
    { name: 'financing-review', weight: 30, grade: financingKnown ? snapshot.deathSpiral === 'clean' ? 10 : snapshot.deathSpiral === 'severe' ? 0 : 3 : null, keys: ['deathSpiral'], values: [snapshot.deathSpiral ?? 'missing'] },
  ]);
  set('management', 'Dilution discipline, sourced insider purchases and earnings outcomes approximate alignment; governance diligence remains separate.', [
    component('dilution-discipline', 40, ['dilution'], value => clamp(10 - Math.max(0, value) * 40)),
    component('insider-purchases', 30, ['insiderBuyValue'], value => value > 0 ? 7 : 0),
    { name: 'earnings-outcome', weight: 30, grade: snapshot.provenance?.lastEarningsStatus && usableEvidence(snapshot.provenance.lastEarningsStatus, snapshot.asOf) ? snapshot.lastEarningsStatus === 'إيجابي' ? 7 : snapshot.lastEarningsStatus === 'سلبي' ? 0 : null : null, keys: ['lastEarningsStatus'], values: [snapshot.lastEarningsStatus ?? 'missing'] },
  ]);
  set('technicalTiming', 'Observed trend, range and return approximate entry timing; dates and market-source metadata are retained.', [
    component('moving-average', 40, ['price','ma30w'], (price, average) => price > 0 && average > 0 ? clamp(5 + (price / average - 1) * 20) : 0),
    component('range', 30, ['price','low52w','high52w'], (price, low, high) => price > 0 && low > 0 && high > low ? clamp((price - low) / (high - low) * 10) : 0),
    component('trailing-return', 30, ['return12m'], value => clamp(5 + value * 10)),
  ]);
  set('financialStrength', 'Observed liquidity, FCF margin and cash runway approximate financial capacity when a reviewed industry model is unavailable.', [
    component('cash-debt', 40, ['cash','debt'], (cash, debt) => cash < 0 || debt < 0 ? 0 : debt === 0 ? 10 : clamp(cash / debt * 5)),
    component('fcf-margin', 40, ['fcf','revenue'], (fcf, sales) => sales > 0 ? clamp(fcf / sales * 50) : 0),
    component('runway', 20, ['cash','fcf'], (cash, fcf) => cash < 0 ? 0 : fcf > 0 ? 10 : fcf < 0 ? clamp(cash / -fcf * 5) : 0),
  ]);
  set('earningsQuality', 'Profit margin, FCF margin and cash conversion approximate quantitative earnings quality; no accounting review is inferred.', [
    component('profit-margin', 30, ['netIncome','revenue'], (profit, sales) => sales > 0 ? clamp(profit / sales * 50) : 0),
    component('fcf-margin', 40, ['fcf','revenue'], (fcf, sales) => sales > 0 ? clamp(fcf / sales * 50) : 0),
    component('cash-conversion', 30, ['fcf','netIncome'], (fcf, profit) => profit > 0 ? clamp(fcf / profit * 8) : 0),
  ]);
  return output;
}
