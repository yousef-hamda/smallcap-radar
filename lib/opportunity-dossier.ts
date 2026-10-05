import type { Snapshot } from './engine';
import { isCurrentOpportunityEvaluation, evaluateOpportunity, type OpportunityEvaluation, type OpportunityEvidence, type OpportunityEvidenceSet } from './opportunity-engine';
import {
  scoreCatalysts,
  scoreDownsideRisk,
  scoreEarningsQuality,
  scoreEarningsQualityPartial,
  scoreFairValue,
  scoreFinancialStrength,
  scoreFinancialStrengthPartial,
  scoreQualitativeFactor,
  scoreTechnicalTiming,
  type CatalystAssessment,
  type DownsideRiskAssessment,
  type EarningsQualityAssessment,
  type EarningsPeriod,
  type FairValueAssessment,
  type FinancialStrengthAssessment,
  type PartialFinancialStrengthAssessment,
  type QualitativeAssessment,
  type TechnicalTimingAssessment,
  type TechnicalTimingScore,
} from './opportunity-scoring';
import { OPPORTUNITY_SPEC, type OpportunityFactorId, type OpportunityRiskTolerance } from './opportunity-spec';
import { proxyOpportunityEvidence } from './opportunity-proxies';

/**
 * Normalized research inputs for the unified score. Each section is populated
 * by a source adapter or analyst review; absent sections use explicit deterministic model grades.
 * This is deliberately separate from the existing compact scan Snapshot.
 */
export type OpportunityDossier = {
  asOf: string;
  valuation?: FairValueAssessment;
  catalysts?: CatalystAssessment;
  financialStrength?: FinancialStrengthAssessment;
  financialStrengthPartial?: PartialFinancialStrengthAssessment;
  earningsQuality?: EarningsQualityAssessment;
  earningsQualityPartial?: EarningsQualityAssessment;
  competitivePosition?: QualitativeAssessment[];
  downsideRisk?: DownsideRiskAssessment;
  management?: QualitativeAssessment[];
  technicalTiming?: TechnicalTimingAssessment;
  /** Compact scan result; keeps derived indicators without persisting hundreds of raw bars per issuer. */
  technicalTimingScore?: TechnicalTimingScore & { asOf: string };
  researchNotes?: Partial<Record<OpportunityFactorId, string>>;
  /** Unresolved source conflicts carried from acquisition into factor scoring. */
  researchConflicts?: Partial<Record<OpportunityFactorId, string[]>>;
};

function assessmentDate(dossier: OpportunityDossier, factor: OpportunityFactorId): string | undefined {
  switch (factor) {
    case 'competitivePosition': case 'management': return dossier.asOf;
    case 'valuation': return dossier.valuation?.asOf;
    case 'catalysts': return dossier.catalysts?.asOf;
    case 'financialStrength': return dossier.financialStrength?.asOf ?? dossier.financialStrengthPartial?.asOf;
    case 'earningsQuality': return dossier.earningsQuality?.asOf ?? dossier.earningsQualityPartial?.asOf;
    case 'downsideRisk': return dossier.downsideRisk?.asOf;
    case 'technicalTiming': return dossier.technicalTiming?.asOf ?? dossier.technicalTimingScore?.asOf;
  }
}

function missingEvidence(factor: OpportunityFactorId, reason: string, conflict?: string): OpportunityEvidence {
  return {
    score: null,
    rationale: reason,
    sources: [],
    confidence: 'low',
    ...(conflict ? { conflicts: [conflict] } : {}),
  };
}

/** Run all supplied factor calculators and make gaps explicit in one result. */
function requestedHorizon(value?: number) {
  return Number.isInteger(value) && (value ?? 0) > 0 ? Math.min(value!, 120) : OPPORTUNITY_SPEC.defaultHorizonMonths;
}

export function scoreOpportunityDossier(dossier: OpportunityDossier, horizonMonths?: number): OpportunityEvidenceSet {
  const output: OpportunityEvidenceSet = {};
  const expectedHorizon = requestedHorizon(horizonMonths);
  for (const factor of [
    'valuation', 'catalysts', 'financialStrength', 'earningsQuality',
    'competitivePosition', 'downsideRisk', 'management', 'technicalTiming',
  ] as const) {
    const unresolved = dossier.researchConflicts?.[factor] ?? [];
    if (unresolved.length) {
      output[factor] = {
        ...missingEvidence(factor, 'Source concepts conflict and require filing-level reconciliation before this factor can contribute points.'),
        conflicts: unresolved.slice(0, 20),
      };
      continue;
    }
    const date = assessmentDate(dossier, factor);
    if (!date) {
      output[factor] = missingEvidence(factor, dossier.researchNotes?.[factor] ?? 'This research section has not been supplied.');
      continue;
    }
    if (!Number.isFinite(Date.parse(dossier.asOf)) || !Number.isFinite(Date.parse(date)) || Date.parse(date) !== Date.parse(dossier.asOf)) {
      output[factor] = missingEvidence(factor, 'This section was not assessed at the dossier as-of time.', `${factor} as-of timestamp does not match the dossier.`);
      continue;
    }
    if (factor === 'catalysts' && dossier.catalysts!.horizonMonths !== expectedHorizon) {
      output[factor] = missingEvidence(factor, `Catalysts were assessed for ${dossier.catalysts!.horizonMonths} months but the requested horizon is ${expectedHorizon} months.`, 'Catalyst horizon does not match the requested investment horizon.');
      continue;
    }

    try {
      switch (factor) {
        case 'valuation': output.valuation = scoreFairValue(dossier.valuation!); break;
        case 'catalysts': output.catalysts = scoreCatalysts(dossier.catalysts!); break;
        case 'financialStrength': output.financialStrength = dossier.financialStrength
          ? scoreFinancialStrength(dossier.financialStrength)
          : scoreFinancialStrengthPartial(dossier.financialStrengthPartial!); break;
        case 'earningsQuality': output.earningsQuality = dossier.earningsQuality
          ? scoreEarningsQuality(dossier.earningsQuality)
          : scoreEarningsQualityPartial(dossier.earningsQualityPartial!); break;
        case 'competitivePosition': output.competitivePosition = scoreQualitativeFactor('competitivePosition', dossier.asOf, dossier.competitivePosition ?? []); break;
        case 'downsideRisk': output.downsideRisk = scoreDownsideRisk(dossier.downsideRisk!); break;
        case 'management': output.management = scoreQualitativeFactor('management', dossier.asOf, dossier.management ?? []); break;
        case 'technicalTiming': output.technicalTiming = dossier.technicalTimingScore
          ?? scoreTechnicalTiming(dossier.technicalTiming!); break;
      }
      const result = output[factor];
      const acquisitionNote = dossier.researchNotes?.[factor];
      if (result && result.score == null && acquisitionNote) result.rationale = `${result.rationale} ${acquisitionNote}`;
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 180) : 'invalid section data';
      output[factor] = missingEvidence(factor, 'This research section could not be evaluated; correct its input shape for source-reviewed coverage.', `${factor} calculator input error: ${detail}`);
    }
  }
  return output;
}

const earningsMetricIds = ['revenue', 'netIncome', 'operatingIncome', 'operatingCashFlow', 'capitalExpenditure', 'stockBasedCompensation'] as const;
type SnapshotEarningsPeriod = NonNullable<Snapshot['opportunityResearch']>['earnings']['annual'][number];

function adaptEarningsPeriods(periods: SnapshotEarningsPeriod[]): EarningsPeriod[] {
  return periods.flatMap(period => {
    const metrics = period?.metrics;
    if(!metrics || typeof metrics!=='object')return [];
    if (!earningsMetricIds.every(metric => {
      const value = metrics[metric];
      return !!value && Number.isFinite(value.value) && !!value.unit && !!value.source;
    })) return [];
    return [{
      revenue: metrics.revenue!, ...(metrics.grossProfit ? { grossProfit: metrics.grossProfit } : {}),
      netIncome: metrics.netIncome!, operatingIncome: metrics.operatingIncome!,
      operatingCashFlow: metrics.operatingCashFlow!, capitalExpenditure: metrics.capitalExpenditure!,
      stockBasedCompensation: metrics.stockBasedCompensation!,
    }];
  });
}

/** Adapt only acquired, source-bearing SEC periods; never infer missing values. */
export function opportunityDossierFromSnapshot(snapshot: Snapshot): OpportunityDossier {
  const research = snapshot.opportunityResearch?.earnings;
  const financialResearch = snapshot.opportunityResearch?.financialStrength;
  const technicalResearch = snapshot.opportunityResearch?.technicalTiming;
  const researchNotes: OpportunityDossier['researchNotes'] = {};
  if (research) {
    const coverage = `${research.coverage?.annualPeriodsFound??0}/3 annual and ${research.coverage?.quarterlyPeriodsFound??0}/8 quarterly periods`;
    const provider = research.providerStatus === 'retrieved'
      ? `SEC Company Facts retrieved ${coverage}. `
      : `SEC Company Facts status is ${research.providerStatus}${research.providerMessage ? ` (${research.providerMessage})` : ''}; ${coverage}. `;
    const gaps = (research.missing??[]).length ? ` Missing: ${(research.missing??[]).slice(0, 5).join('; ')}.` : '';
    const conflicts = (research.conflicts??[]).length ? ` Conflicts: ${(research.conflicts??[]).slice(0, 3).join('; ')}.` : '';
    researchNotes.earningsQuality = `${provider}Dated source-backed GAAP/non-GAAP adjustment and one-off reviews are required before scoring.${gaps}${conflicts}`;
  } else {
    researchNotes.earningsQuality = 'No sourced three-year/eight-quarter SEC earnings history is attached to this snapshot.';
  }
  const financialMetricIds = ['unrestrictedCash', 'totalDebt', 'freeCashFlowTtm', 'operatingIncomeTtm', 'interestExpenseTtm', 'debtDueWithin24Months'] as const;
  const financialMetrics = financialResearch?.metrics;
  const financialComplete = financialResearch?.readyForScoring === true
    && financialResearch.industryModel === 'industrial-operating-company'
    && !!financialMetrics && financialMetricIds.every(id => !!financialMetrics[id]);
  if (financialResearch) {
    const available = financialMetricIds.filter(id => !!financialMetrics?.[id]).length;
    const gaps = (financialResearch.missing??[]).length ? ` Missing: ${(financialResearch.missing??[]).slice(0, 6).join('; ')}.` : '';
    const conflicts = (financialResearch.conflicts??[]).length ? ` Conflicts: ${(financialResearch.conflicts??[]).slice(0, 3).join('; ')}.` : '';
    researchNotes.financialStrength = financialComplete
      ? 'SEC financial inputs are available; the evaluator still validates date, currency, rights, and balance-sheet alignment.'
      : `SEC financial-strength inputs: ${available}/6 available; provider status ${financialResearch.providerStatus}.${gaps}${conflicts}`;
  } else {
    researchNotes.financialStrength = 'No sourced SEC cash, debt, TTM cash-flow, interest, and maturity inputs are attached to this snapshot.';
  }
  researchNotes.technicalTiming = technicalResearch
    ? `Completed price history: ${technicalResearch.dailyBars} daily, ${technicalResearch.weeklyBars} weekly, ${technicalResearch.monthlyBars} monthly, and ${technicalResearch.benchmarkBars} benchmark bars. ${(technicalResearch.missing??[]).join(' ')}`
    : 'Technical review has not acquired multi-timeframe stock and benchmark history.';
  const filingResearch = snapshot.opportunityResearch?.secFilings;
  researchNotes.catalysts = filingResearch
    ? `SEC recent-submission index status: ${filingResearch.providerStatus}; ${(filingResearch.items??[]).length} bounded filing metadata records are attached. ${filingResearch.form8KItemIndex?`${filingResearch.form8KItemIndex.fetchedDocuments} recent 8-K bodies were scanned for item-number references only; those references are discovery aids, not reviewed evidence. `:''}This filing index is a discovery aid only: filings have not been classified for binding status, revenue impact, timing, market expectations, or future catalyst value. No catalyst score may be inferred from filing count, form, or item numbers. ${(filingResearch.limitations??[]).join(' ')} ${filingResearch.form8KItemIndex?.limitations.join(' ')??''}`
    : 'No issuer filing index is attached. Future catalysts require dated, source-reviewed evidence; do not infer them from headlines or filing counts.';
  return {
    asOf: snapshot.asOf,
    ...(research && ((research.annual??[]).length > 0 || (research.quarterly??[]).length > 0) ? { earningsQualityPartial: {
      asOf: snapshot.asOf,
      annual: adaptEarningsPeriods(research.annual??[]),
      quarterly: adaptEarningsPeriods(research.quarterly??[]),
    } } : {}),
    ...(financialComplete ? { financialStrength: {
      industryModel: financialResearch!.industryModel!,
      asOf: snapshot.asOf,
      unrestrictedCash: financialMetrics!.unrestrictedCash!,
      totalDebt: financialMetrics!.totalDebt!,
      freeCashFlowTtm: financialMetrics!.freeCashFlowTtm!,
      operatingIncomeTtm: financialMetrics!.operatingIncomeTtm!,
      interestExpenseTtm: financialMetrics!.interestExpenseTtm!,
      debtDueWithin24Months: financialMetrics!.debtDueWithin24Months!,
    } } : financialResearch?.industryModel === 'industrial-operating-company' ? { financialStrengthPartial: {
      industryModel: financialResearch.industryModel,
      asOf: snapshot.asOf,
      ...financialMetrics,
    } } : {}),
    ...(technicalResearch?.assessment ? { technicalTiming: technicalResearch.assessment } : {}),
    ...(technicalResearch?.score ? { technicalTimingScore: { ...technicalResearch.score, asOf: technicalResearch.asOf ?? snapshot.asOf } } : {}),
    researchConflicts: {
      earningsQuality: research?.conflicts ?? [],
      financialStrength: [
        ...(financialResearch?.conflicts ?? []),
        ...(research?.conflicts ?? []).filter(conflict => /\b(operatingCashFlow|capitalExpenditure|operatingIncome)\b/.test(conflict)),
      ],
    },
    researchNotes,
  };
}

/** One entry point for dossier scoring and broad eligibility checks. */
export function evaluateOpportunityDossier(
  snapshot: Snapshot,
  dossier: OpportunityDossier,
  options: { horizonMonths?: number; riskTolerance?: OpportunityRiskTolerance } = {},
): OpportunityEvaluation {
  if (Date.parse(snapshot.asOf) !== Date.parse(dossier.asOf)) {
    const result = evaluateOpportunity(snapshot, {}, options);
    return {
      ...result,
      researchState: result.researchState === 'excluded' ? 'excluded' : 'needs-research',
      sourceEligible: false,
      status: result.researchState === 'excluded' ? 'FAIL' : 'UNKNOWN',
      reason: 'Snapshot and research dossier timestamps differ; the final model grade is retained, while reviewed evidence awaits reconciliation.',
      checks: [...result.checks, { id: 'dossier-as-of', status: 'UNKNOWN', role: 'evidence', explanation: 'Snapshot and dossier as-of timestamps must match exactly.' }],
    };
  }
  const dossierEvidence = scoreOpportunityDossier(dossier, options.horizonMonths);
  const proxyEvidence = proxyOpportunityEvidence(snapshot);
  const evidence = { ...dossierEvidence };
  for (const [factor, candidate] of Object.entries(proxyEvidence) as Array<[OpportunityFactorId, OpportunityEvidence]>) {
    const existing = evidence[factor];
    // A reviewed dossier outranks an automated proxy. Proxies fill only the
    // previously unscored qualitative factors.
    if (!existing || existing.score == null) {
      // A model supplies a final bounded grade when reviewed
      // evidence has conflicts. Preserve the conflict on the proxy so it stays
      // visible and continues to withhold source-reviewed coverage.
      evidence[factor] = {
        ...candidate,
        ...(existing?.rationale ? { rationale: `${existing.rationale} ${candidate.rationale}` } : {}),
        ...(existing?.conflicts?.length ? { conflicts: existing.conflicts.filter(conflict=>!conflict.startsWith('qualitative dimension not reviewed:')) } : {}),
      };
    }
  }

  const valuation = dossier.valuation;
  if (valuation) {
    const quote = snapshot.provenance.price;
    const valuationQuote = valuation.currentPrice;
    const tolerance = Math.max(0.01, Math.abs(snapshot.price ?? 0) * 0.0001);
    const samePrice = Number.isFinite(snapshot.price) && Number.isFinite(valuationQuote.value)
      && Math.abs(snapshot.price! - valuationQuote.value) <= tolerance;
    const sameSession = !!quote?.periodEnd && quote.periodEnd === valuationQuote.source.periodEnd;
    if (!samePrice || !sameSession) {
      const conflict = !sameSession ? 'valuation price session differs from the screened quote' : 'valuation price differs from the screened quote beyond rounding tolerance';
      const proxy = evidence.valuation;
      evidence.valuation = proxy?.proxy
        ? { ...proxy, rationale: `${proxy.rationale} Fair-value quote does not reconcile to the snapshot completed-session price and date.`, conflicts: [...(proxy.conflicts ?? []), conflict] }
        : proxy?.score != null
          ? { ...proxy, proxy: true, rationale: `${proxy.rationale} Fair-value quote does not reconcile to the snapshot completed-session price and date.`, conflicts: [...(proxy.conflicts ?? []), conflict] }
          : {
            score: null,
            rationale: 'Fair-value quote does not reconcile to the snapshot completed-session price and date.',
            sources: [],
            confidence: 'low',
            conflicts: [conflict],
          };
    }
  }
  return evaluateOpportunity(snapshot, evidence, options);
}

/** Reuse a persisted score only when it was produced by the current rubric.
 * For stale/missing scores, rebuild from the snapshot's saved research dossier
 * instead of silently discarding all evidence and evaluating an empty set. */
export function currentOpportunityEvaluation(
  snapshot: Snapshot,
  saved: unknown,
  dossier: OpportunityDossier = opportunityDossierFromSnapshot(snapshot),
): OpportunityEvaluation {
  if (isCurrentOpportunityEvaluation(saved) && saved.asOf === snapshot.asOf) {
    return saved as OpportunityEvaluation;
  }
  return evaluateOpportunityDossier(snapshot, dossier);
}
