import type { Snapshot, Provenance, Status } from './engine';
import { proxyOpportunityEvidence } from './opportunity-proxies';
import { usableEvidence } from './evidence';
import { OPPORTUNITY_SPEC, opportunitySpecHash, type OpportunityFactorId, type OpportunityRiskTolerance } from './opportunity-spec';
import { financialIntegrityFindings, operatingIssuerMetricsApplicable, commonPerShareMetricsApplicable } from './financial-integrity';
import {buildOpportunityThesis,type OpportunityThesis} from './opportunity-thesis';

export type OpportunityEvidence = {
  score: number | null;
  /** A deterministic model grade based on observed inputs, not a reviewed dossier. */
  proxy?: boolean;
  /** Share of this factor's fixed weight backed by source-reviewed evidence (0–100). */
  coveragePct?: number;
  /** Whether the algorithm produced a bounded grade for the factor (0–100). */
  algorithmicCoveragePct?: number;
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
  evaluationHash: string;
  snapshotHash: string;
  researchState: OpportunityState;
  sourceEligible: boolean;
  horizonMonths: number;
  riskTolerance: OpportunityRiskTolerance;
  state: OpportunityState;
  status: Status;
  score: number;
  evidencedWeight: number;
  coveragePct: number;
  algorithmicCoveragePct: number;
  confidence: 'low' | 'medium' | 'high';
  rankingEligible: boolean;
  thesis: OpportunityThesis;
  factors: Array<{
    id: OpportunityFactorId;
    label: string;
    weight: number;
    score: number;
    points: number;
    evidenced: boolean;
    complete: boolean;
    coveragePct: number;
    algorithmicCoveragePct: number;
    confidence: 'low' | 'medium' | 'high';
    rationale: string;
    sources: Provenance[];
    calculation?: OpportunityEvidence['calculation'];
    conflicts: string[];
    proxy?: boolean;
  }>;
  checks: Array<{ id: string; status: Status; role: 'eligibility' | 'evidence'; explanation: string }>;
  reason: string;
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

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
 * Complete single category evaluator. Missing components earn zero on the
 * fixed denominator. Evidence and safety findings never hide a numeric rank.
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
  const securityKnown = snapshot.listingStatus!=='not-confirmed-current' && !!snapshot.securityType && snapshot.securityType!=='unknown' && !!snapshot.exchange
    && !!securityEvidence && isOpportunityIdentityEvidenceValid(securityEvidence, snapshot.asOf)
    && !!exchangeEvidence && isOpportunityIdentityEvidenceValid(exchangeEvidence, snapshot.asOf);
  const securityValid = securityKnown
    && snapshot.securityType === 'common'
    && (OPPORTUNITY_SPEC.supportedExchanges as readonly string[]).includes(snapshot.exchange!);
  const adrNeedsConversion=securityKnown&&snapshot.securityType==='adr'&&(OPPORTUNITY_SPEC.supportedExchanges as readonly string[]).includes(snapshot.exchange!);
  if(snapshot.listingStatus==='not-confirmed-current')add('listing-membership','UNKNOWN','Current official listing is unconfirmed; retained with complete numeric grades and no unsupported investment credit.');
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
  const integrityFindings = financialIntegrityFindings(snapshot);
  if (integrityFindings.length) add('financial-integrity', 'UNKNOWN', integrityFindings.join('; '), 'evidence');

  const models = proxyOpportunityEvidence(snapshot);
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
    const proxy = candidate?.proxy === true && finite(candidate?.score)
      && candidate!.score! >= 0 && candidate!.score! <= 10;
    const evidenced = conflicts.length === 0
      && finite(candidate?.score)
      && candidate!.score >= 0
      && candidate!.score <= 10
      && coverageValid
      && candidate!.rationale.trim().length > 0
      && calculationValid
      && sources.length > 0
      && (!proxy || sources.length === (candidate?.sources ?? []).length);
    // A reviewed partial assessment is normalized to the full factor once.
    // Model grades already use their complete fixed component denominator.
    const model = models[spec.id]!;
    const applicable = snapshot.listingStatus!=='not-confirmed-current' && (spec.id === 'technicalTiming' || (operatingIssuerMetricsApplicable(snapshot)
      && (spec.id !== 'valuation' || commonPerShareMetricsApplicable(snapshot))));
    const useReviewed = applicable && evidenced && !proxy;
    const score = !applicable ? 0 : useReviewed
      ? Math.round(Math.round(candidate!.score! * 100) * Math.round(rawCoverage * 100) / 10000) / 100
      : Math.round((proxy && conflicts.length === 0 ? candidate!.score! : conflicts.length ? 0 : model.score!) * 100) / 100;
    const algorithmicCoveragePct = 100;
    const coveragePct = applicable && evidenced ? rawCoverage : 0;
    const points = Math.round(score * 100) * spec.weight / 1000;
    const complete = applicable && evidenced && !proxy && coveragePct === 100;
    if (applicable && evidenced) evidencedWeight += spec.weight * coveragePct / 100;
    return {
      id: spec.id,
      label: spec.label,
      weight: spec.weight,
      score,
      points,
      evidenced: applicable && evidenced,
      complete,
      coveragePct,
      algorithmicCoveragePct,
      // Missing confidence on otherwise auditable evidence is uncertainty, not
      // proof of low-quality evidence. It can never contribute to high overall
      // confidence, but it may support medium confidence for a complete rank.
      confidence: applicable && evidenced ? candidate!.confidence ?? 'medium' : 'low',
      rationale: !applicable ? 'Instrument payoff or ADR conversion is unverified; operating-company points are withheld. This listing retains its final numeric grade and ranking.' : useReviewed ? `${candidate!.rationale} Final factor grade includes ${rawCoverage}% reviewed coverage; missing dimensions earn zero.` : conflicts.length ? `Source conflict: ${conflicts.join('; ')}; final factor grade is zero until reconciled.` : proxy ? candidate!.rationale : `${candidate?.rationale ?? ''} ${model.rationale}`,
      sources,
      calculation: useReviewed ? { ...candidate!.calculation!, inputs: [...candidate!.calculation!.inputs, { name: 'reviewed-grade', value: candidate!.score! }, { name: 'reviewed-coverage-pct', value: rawCoverage }] } : proxy && calculationValid ? candidate!.calculation : model.calculation,
      conflicts,
      ...(!useReviewed ? { proxy: true } : {}),
    };
  });

  const coveragePct = evidencedWeight;
  const algorithmicCoveragePct = Math.round(factors.reduce((total, factor) => total + (factor.algorithmicCoveragePct * factor.weight / 100), 0) * 100) / 100;
  const requiredFactorsPresent = OPPORTUNITY_SPEC.requiredRankedFactors.every(id => factors.find(factor => factor.id === id)?.complete);
  const sourceEligible = !hardFailure
    && !hardUnknown
    && !sourceConflict
    && requiredFactorsPresent
    && coveragePct >= OPPORTUNITY_SPEC.minimumEvidenceCoverage;
  const researchState: OpportunityState = hardFailure ? 'excluded' : sourceEligible ? 'ranked' : 'needs-research';
  const rankingEligible = true;
  const state: OpportunityState = 'ranked';
  const score = opportunityWeightedScore(factors);
  const requiredFactorConfidence = factors
    .filter(factor => (OPPORTUNITY_SPEC.requiredRankedFactors as readonly string[]).includes(factor.id))
    .map(factor => factor.confidence);
  const confidence = sourceEligible && coveragePct >= 95 && factors.every(factor => factor.confidence === 'high')
    ? 'high'
    : sourceEligible && requiredFactorConfidence.every(level => level !== 'low') ? 'medium' : 'low';
  const status: Status = researchState === 'excluded' ? 'FAIL' : sourceEligible ? 'PASS' : 'UNKNOWN';
  const reason = hardFailure
    ? 'Fails the common-security, positive-market-capitalization, liquidity, or verified-price safety screen.'
    : hardUnknown
      ? 'Needs verified security, price, market-cap, liquidity, or freshness evidence before a decision.'
      : sourceEligible
        ? 'Meets safety checks and has sourced evidence for all material diligence factors; score is diagnostic, not a return probability.'
        : 'Visible for research, but one or more material factors or the evidence-coverage threshold is incomplete.';

  const thesis=buildOpportunityThesis(snapshot,horizonMonths);
  if(!sourceEligible&&thesis.action==='candidate-review')thesis.action='research-required';
  return {
    strategy: OPPORTUNITY_SPEC.id,
    version: OPPORTUNITY_SPEC.version,
    hash: opportunitySpecHash(),
    asOf: snapshot.asOf,
    snapshotHash: opportunitySnapshotHash(snapshot),
    evaluationHash: evaluationFingerprint({ snapshot, factors, score, horizonMonths, riskTolerance,thesis }),
    thesis,
    researchState,
    sourceEligible,
    horizonMonths,
    riskTolerance,
    state,
    status,
    score,
    evidencedWeight,
    coveragePct,
    algorithmicCoveragePct,
    confidence,
    rankingEligible,
    factors,
    checks,
    reason: `Final deterministic research grade; sorted across every listing. ${reason}`,
  };
}

/** Stable evaluation identity for the same saved snapshot and rubric. */
function evaluationFingerprint(value: unknown) {
  let hash = 2166136261;
  for (const character of JSON.stringify(value)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `${opportunitySpecHash()}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Validate persisted shape and arithmetic, not merely a matching version label. */
export function isCurrentOpportunityEvaluation(value: unknown): value is OpportunityEvaluation {
  if (!value || typeof value !== 'object') return false;
  const evaluation = value as OpportunityEvaluation;
  return evaluation.hash === opportunitySpecHash() && !!evaluation.evaluationHash
    && evaluation.state === 'ranked' && evaluation.rankingEligible === true
    && finite(evaluation.score) && evaluation.score >= 0 && evaluation.score <= 100
    && Array.isArray(evaluation.factors) && evaluation.factors.length === 8
    && OPPORTUNITY_SPEC.factors.every(spec => {
      const matches = evaluation.factors.filter(factor => factor.id === spec.id);
      const factor = matches[0];
      return matches.length === 1 && factor.weight === spec.weight && finite(factor.score)
        && factor.score >= 0 && factor.score <= 10 && finite(factor.points)
        && Math.abs(factor.points - Math.round(factor.score * 100) * spec.weight / 1000) < 1e-8
        && !!factor.calculation?.rubricId && factor.calculation.inputs.length > 0;
    }) && Math.abs(evaluation.score - opportunityWeightedScore(evaluation.factors)) < 1e-8;
}

export function opportunitySnapshotHash(snapshot: Snapshot) { return evaluationFingerprint(snapshot); }

/** Factor grades have hundredth precision. Sum integer thousandths and round
 * once to a final hundredth, avoiding floating point half-cent errors. */
export function opportunityWeightedScore(factors: Array<{score:number;weight:number}>) {
  return Math.round(factors.reduce((sum,factor)=>sum+Math.round(factor.score*100)*factor.weight,0)/10)/100;
}
