import type { Snapshot, Provenance, Status } from './engine';
import { usableEvidence } from './evidence';
import { OPPORTUNITY_SPEC, opportunitySpecHash, type OpportunityFactorId, type OpportunityRiskTolerance } from './opportunity-spec';
import { INVESTABLE_EXCHANGES } from './strategy-spec';

export type OpportunityEvidence = {
  score: number | null;
  /** Share of this factor's fixed weight backed by evidence (0–100). */
  coveragePct?: number;
  rationale: string;
  sources: Provenance[];
  confidence?: 'low' | 'medium' | 'high';
  calculation?: { rubricId: string; inputs: Array<{ name: string; value: string | number; unit?: string }> };
  conflicts?: string[];
};

export type OpportunityEvidenceSet = Partial<Record<OpportunityFactorId, OpportunityEvidence>>;
export type OpportunityState = 'ranked' | 'needs-research' | 'excluded';

export type OpportunityEvaluation = {
  strategy: typeof OPPORTUNITY_SPEC.id;
  version: typeof OPPORTUNITY_SPEC.version;
  hash: string;
  asOf: string;
  horizonMonths: number;
  riskTolerance: OpportunityRiskTolerance;
  state: OpportunityState;
  status: Status;
  score: number;
  evidencedWeight: number;
  coveragePct: number;
  confidence: 'low' | 'medium' | 'high';
  rankingEligible: boolean;
  factors: Array<{
    id: OpportunityFactorId;
    label: string;
    weight: number;
    score: number | null;
    points: number;
    evidenced: boolean;
    complete: boolean;
    coveragePct: number;
    confidence: 'low' | 'medium' | 'high';
    rationale: string;
    sources: Provenance[];
    calculation?: OpportunityEvidence['calculation'];
    conflicts: string[];
  }>;
  checks: Array<{ id: string; status: Status; role: 'eligibility' | 'evidence'; explanation: string }>;
  reason: string;
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function marketWeekdayAge(availableAt: string, asOf: string) {
  const start = Date.parse(availableAt);
  const end = Date.parse(asOf);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return Number.POSITIVE_INFINITY;
  const from = new Date(start);
  const to = new Date(end);
  let cursor = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const final = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  let age = 0;
  while (cursor < final) {
    cursor += 86_400_000;
    const day = new Date(cursor).getUTCDay();
    if (day !== 0 && day !== 6) age += 1;
  }
  return age;
}

export function isOpportunityProvenanceValid(provenance: Provenance, asOf: string) {
  if (!provenance || typeof provenance !== 'object') return false;
  let hasAuditableUrl = false;
  try { hasAuditableUrl = !!provenance.url && new URL(provenance.url).protocol === 'https:'; } catch { /* not a canonical source URL */ }
  const conversion = provenance.conversion;
  const conversionValid = !conversion || (() => {
    try {
      const rateUrl = new URL(conversion.sourceUrl);
      const directEcbSource = conversion.rateProvider === 'European Central Bank (ECB) Data Portal'
        && rateUrl.hostname === 'data-api.ecb.europa.eu' && rateUrl.pathname.startsWith('/service/data/EXR/');
      const frankfurterEcbSource = conversion.rateProvider === 'European Central Bank (ECB) via Frankfurter API'
        && rateUrl.hostname === 'api.frankfurter.dev' && rateUrl.pathname === '/v2/providers/ecb/rates'
        && rateUrl.searchParams.get('base') === 'EUR'
        && (rateUrl.searchParams.get('quotes') ?? '').split(',').includes('USD')
        && (conversion.sourceCurrency === 'EUR' || (rateUrl.searchParams.get('quotes') ?? '').split(',').includes(conversion.sourceCurrency));
      return Number.isFinite(conversion.rate) && conversion.rate > 0
        && /^[A-Z]{3}$/.test(conversion.sourceCurrency) && conversion.targetCurrency === 'USD'
        && provenance.currency === conversion.targetCurrency
        && Number.isInteger(conversion.observationCount) && conversion.observationCount >= 0
        && Number.isFinite(Date.parse(conversion.inputAvailableAt)) && Date.parse(conversion.inputAvailableAt) <= Date.parse(asOf)
        && Number.isFinite(Date.parse(conversion.inputRetrievedAt)) && Date.parse(conversion.inputRetrievedAt) <= Date.parse(asOf)
        && Number.isFinite(Date.parse(`${conversion.ratePeriodStart}T00:00:00Z`))
        && Number.isFinite(Date.parse(`${conversion.ratePeriodEnd}T00:00:00Z`))
        && conversion.ratePeriodStart <= conversion.ratePeriodEnd
        && rateUrl.protocol === 'https:' && (directEcbSource || frankfurterEcbSource)
        && (conversion.method === 'period-average-daily-reference-cross-rate' || conversion.method === 'period-end-prior-daily-reference-cross-rate');
    } catch { return false; }
  })();
  const reusePermitted = provenance.rightsStatus === 'public-domain'
    || provenance.rightsStatus === 'redistribution-permitted'
    || provenance.rightsStatus === 'licensed';
  return usableEvidence(provenance, asOf)
    && hasAuditableUrl
    && conversionValid
    && reusePermitted
    && Number.isFinite(Date.parse(provenance.retrievedAt))
    && Date.parse(provenance.retrievedAt) <= Date.parse(asOf);
}

/** Issuer/listing facts can establish identity even when a market-data vendor's
 * redistribution terms are unresolved. Rights still gate scored market data. */
export function isOpportunityIdentityEvidenceValid(provenance:Provenance,asOf:string){
  if(!provenance||typeof provenance!=='object')return false;
  let auditable=false;
  try{auditable=!!provenance.url&&new URL(provenance.url).protocol==='https:';}catch{/* no canonical URL */}
  return usableEvidence(provenance,asOf)&&auditable
    &&Number.isFinite(Date.parse(provenance.retrievedAt))
    &&Date.parse(provenance.retrievedAt)<=Date.parse(asOf);
}

/**
 * Evidence-first single category evaluator. Missing factors earn no points on
 * the fixed 100-point denominator and remain visibly uncovered. All eight
 * weighted factors must be evidenced before shortlist ranking.
 */
export function evaluateOpportunity(
  snapshot: Snapshot,
  evidence: OpportunityEvidenceSet = {},
  options: { horizonMonths?: number; riskTolerance?: OpportunityRiskTolerance } = {},
): OpportunityEvaluation {
  const horizonMonths = Number.isInteger(options.horizonMonths) && (options.horizonMonths ?? 0) > 0
    ? Math.min(options.horizonMonths!, 120)
    : OPPORTUNITY_SPEC.defaultHorizonMonths;
  const riskTolerance = options.riskTolerance ?? OPPORTUNITY_SPEC.defaultRiskTolerance;
  const checks: OpportunityEvaluation['checks'] = [];
  const add = (id: string, status: Status, explanation: string, role: 'eligibility' | 'evidence' = 'eligibility') => checks.push({ id, status, role, explanation });

  const securityEvidence = snapshot.provenance.securityType;
  const exchangeEvidence = snapshot.provenance.exchange;
  const securityKnown = !!snapshot.securityType && snapshot.securityType!=='unknown' && !!snapshot.exchange
    && !!securityEvidence && isOpportunityIdentityEvidenceValid(securityEvidence, snapshot.asOf)
    && !!exchangeEvidence && isOpportunityIdentityEvidenceValid(exchangeEvidence, snapshot.asOf);
  const securityValid = securityKnown
    && snapshot.securityType === 'common'
    && (INVESTABLE_EXCHANGES as readonly string[]).includes(snapshot.exchange!);
  const adrNeedsConversion=securityKnown&&snapshot.securityType==='adr'&&(INVESTABLE_EXCHANGES as readonly string[]).includes(snapshot.exchange!);
  add('security',!securityKnown?'UNKNOWN':securityValid?'PASS':adrNeedsConversion?'UNKNOWN':'FAIL',adrNeedsConversion?'ADR identified; per-ADR conversion ratio must be reconciled before per-share valuation.':`${snapshot.securityType ?? 'unknown security type'} / ${snapshot.exchange ?? 'unknown exchange'}`);

  const capEvidence = snapshot.provenance.marketCap;
  const capKnown = finite(snapshot.marketCap) && !!capEvidence && isOpportunityProvenanceValid(capEvidence, snapshot.asOf);
  const capFresh = capKnown && marketWeekdayAge(capEvidence!.availableAt, snapshot.asOf) <= OPPORTUNITY_SPEC.marketDataFreshnessMarketDays;
  const capValid = capKnown && snapshot.marketCap! > 0;
  add('market-cap', !capKnown || !capFresh ? 'UNKNOWN' : capValid ? 'PASS' : 'FAIL', !capKnown ? 'Dated market capitalization evidence is unavailable.' : !capFresh ? `Market capitalization is older than ${OPPORTUNITY_SPEC.marketDataFreshnessMarketDays} market weekdays.` : `${snapshot.marketCap} · positive capitalization required; no minimum or maximum`);

  const liquidityEvidence = snapshot.provenance.medianDollarVolume20d;
  const liquidityKnown = finite(snapshot.medianDollarVolume20d) && !!liquidityEvidence && isOpportunityProvenanceValid(liquidityEvidence, snapshot.asOf);
  const liquidityFresh = liquidityKnown && marketWeekdayAge(liquidityEvidence!.availableAt, snapshot.asOf) <= OPPORTUNITY_SPEC.marketDataFreshnessMarketDays;
  const liquidityPass = liquidityKnown && snapshot.medianDollarVolume20d! >= OPPORTUNITY_SPEC.medianDollarVolume20dMin;
  add('liquidity', !liquidityKnown || !liquidityFresh ? 'UNKNOWN' : liquidityPass ? 'PASS' : 'FAIL', !liquidityKnown ? 'Dated 20-session median dollar-volume evidence is unavailable.' : !liquidityFresh ? `20-session median dollar volume is older than ${OPPORTUNITY_SPEC.marketDataFreshnessMarketDays} market weekdays.` : `${snapshot.medianDollarVolume20d} · 20-session median minimum ${OPPORTUNITY_SPEC.medianDollarVolume20dMin}`);

  const priceEvidence = snapshot.provenance.price;
  const priceKnown = finite(snapshot.price) && snapshot.price! > 0 && !!priceEvidence && isOpportunityProvenanceValid(priceEvidence, snapshot.asOf);
  const priceFresh = priceKnown && marketWeekdayAge(priceEvidence!.availableAt, snapshot.asOf) <= OPPORTUNITY_SPEC.quoteFreshnessMarketDays;
  add('price', priceKnown ? (priceFresh ? 'PASS' : 'UNKNOWN') : 'UNKNOWN', priceKnown ? `Completed quote must be no older than ${OPPORTUNITY_SPEC.quoteFreshnessMarketDays} market weekdays.` : 'Positive price and dated price evidence are required.');

  const hardStatuses = checks.filter(check => check.role === 'eligibility').map(check => check.status);
  const hardFailure = hardStatuses.includes('FAIL');
  const hardUnknown = hardStatuses.includes('UNKNOWN');
  const sourceConflict = (snapshot.sourceConflicts ?? []).length > 0;
  if (sourceConflict) add('source-conflict', 'UNKNOWN', (snapshot.sourceConflicts ?? []).join('; '), 'evidence');

  let evidencedWeight = 0;
  const factors = OPPORTUNITY_SPEC.factors.map(spec => {
    const candidate = evidence[spec.id];
    const conflicts = [...(candidate?.conflicts ?? [])];
    const sources = (candidate?.sources ?? []).filter(source => isOpportunityProvenanceValid(source, snapshot.asOf));
    const calculationValid = !!candidate?.calculation?.rubricId?.trim()
      && candidate.calculation.inputs.length > 0
      && candidate.calculation.inputs.every(input => !!input.name.trim() && (typeof input.value === 'string' || finite(input.value)));
    const rawCoverage = candidate?.coveragePct ?? 100;
    const coverageValid = finite(rawCoverage) && rawCoverage > 0 && rawCoverage <= 100;
    const evidenced = conflicts.length === 0
      && finite(candidate?.score)
      && candidate!.score >= 0
      && candidate!.score <= 10
      && coverageValid
      && candidate!.rationale.trim().length > 0
      && calculationValid
      && sources.length > 0;
    const score = evidenced ? clamp(candidate!.score!, 0, 10) : null;
    const coveragePct = evidenced ? rawCoverage : 0;
    const points = score == null ? 0 : score / 10 * spec.weight * coveragePct / 100;
    const complete = evidenced && coveragePct === 100;
    if (evidenced) evidencedWeight += spec.weight * coveragePct / 100;
    return {
      id: spec.id,
      label: spec.label,
      weight: spec.weight,
      score,
      points: Math.round(points * 100) / 100,
      evidenced,
      complete,
      coveragePct,
      // Missing confidence on otherwise auditable evidence is uncertainty, not
      // proof of low-quality evidence. It can never contribute to high overall
      // confidence, but it may support medium confidence for a complete rank.
      confidence: evidenced ? candidate!.confidence ?? 'medium' : 'low',
      rationale: evidenced ? candidate!.rationale : conflicts.length ? `Source conflict: ${conflicts.join('; ')}` : candidate?.rationale?.trim() || 'Evidence is missing, stale, future-dated, or lacks a valid calculation trace, rationale, or source.',
      sources,
      ...(calculationValid ? { calculation: candidate!.calculation } : {}),
      conflicts,
    };
  });

  const coveragePct = evidencedWeight;
  const requiredFactorsPresent = OPPORTUNITY_SPEC.requiredRankedFactors.every(id => factors.find(factor => factor.id === id)?.complete);
  const rankingEligible = !hardFailure
    && !hardUnknown
    && !sourceConflict
    && requiredFactorsPresent
    && coveragePct >= OPPORTUNITY_SPEC.minimumEvidenceCoverage;
  const state: OpportunityState = hardFailure ? 'excluded' : rankingEligible ? 'ranked' : 'needs-research';
  const score = Math.round(factors.reduce((total, factor) => total + factor.points, 0) * 100) / 100;
  const requiredFactorConfidence = factors
    .filter(factor => (OPPORTUNITY_SPEC.requiredRankedFactors as readonly string[]).includes(factor.id))
    .map(factor => factor.confidence);
  const confidence = rankingEligible && coveragePct >= 95 && factors.every(factor => factor.confidence === 'high')
    ? 'high'
    : rankingEligible && requiredFactorConfidence.every(level => level !== 'low') ? 'medium' : 'low';
  const status: Status = state === 'excluded' ? 'FAIL' : rankingEligible ? 'PASS' : 'UNKNOWN';
  const reason = hardFailure
    ? 'Fails the common-security, positive-market-capitalization, liquidity, or verified-price safety screen.'
    : hardUnknown
      ? 'Needs verified security, price, market-cap, liquidity, or freshness evidence before a decision.'
      : rankingEligible
        ? 'Meets safety checks and has sourced evidence for all material diligence factors; score is diagnostic, not a return probability.'
        : 'Visible for research, but one or more material factors or the evidence-coverage threshold is incomplete.';

  return {
    strategy: OPPORTUNITY_SPEC.id,
    version: OPPORTUNITY_SPEC.version,
    hash: opportunitySpecHash(),
    asOf: snapshot.asOf,
    horizonMonths,
    riskTolerance,
    state,
    status,
    score,
    evidencedWeight,
    coveragePct,
    confidence,
    rankingEligible,
    factors,
    checks,
    reason,
  };
}
