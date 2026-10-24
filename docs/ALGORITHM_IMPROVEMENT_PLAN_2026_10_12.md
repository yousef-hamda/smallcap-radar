# Opportunity ranking: catalyst fidelity and evidence coverage

Study cutoff: 2026-10-12. The studied local baseline is rubric 1.4; production still runs 1.2.6. This plan follows a read-only review of `HANDOFF.md`, both current memory files, the October 8 and 10 plans/reports, the evaluator, proxy models, source registry, candidate signals, persistence, UI, validation code and the 7,517-row frozen comparison. Independent system, algorithm and data audits checked the same contract.

## Objective and fixed contract

Find undervalued operating businesses with a defensible value case, a source-reviewed and financeable material catalyst, and manageable downside. The six-month horizon and 50% upside threshold are research hypotheses, not calibrated return estimates. Preserve the eight factor percentages **25/20/15/12/10/10/5/3**, complete numeric ranking of every listing, missing-component zero credit, exact hundredth arithmetic, score descending and symbol BINARY ascending tie order. Do not promote a numerical research rank to a buying recommendation.

## Study findings and baseline

1. The automatic 20% catalyst factor awards credit for historical growth, backlog and the existence of an earnings date. None establishes a reviewed future event with quantified impact, funding and a plausible path to mispricing. The frozen universe has zero reviewed catalysts and zero thesis-qualified cases. The same growth input also contributes to competitive position, compounding the mismatch.
2. All model factors report 100% `algorithmicCoveragePct` because every factor receives a numeric grade, including zero. The proxy model calculates actual input-component coverage, but the UI labels 100% as coverage. Keep the existing complete-grade field for compatibility and add a distinct input-coverage measure.
3. The thesis-financing check treats a `clean` or `mild` string as reviewed without itself checking current, valid financing provenance. The model scoring path does check the source. Align the decision gate with the source checks and fail closed on stale, missing or contradictory review.
4. The existing SEC-backed operating signals do not affect the canonical rank or provide a separate actionable view. The top 100 includes 41 companies at or above $5 billion, 10 risk-review cases and 22 unknown-financing cases. Treat size and safety as transparent research-fit filters, never as hidden changes to the fixed score.
5. The 7,517-row replay proves deterministic score differences, not superior future returns. There are zero usable mature six-month point-in-time outcomes. The old price-only Bounce backtest is survivorship-biased and cannot validate Opportunity. Probability and six-month target must remain null.
   The Opportunity validator also rejected zero-credit factors with empty source lists, which would select only better-covered listings in a future outcome panel.
6. A rubric change can trigger database-heavy saved-row reevaluation on a 5 GB production volume. The last observed free space was roughly 409 MB, with a 256 MiB scanner reserve. Production remains on 1.2.6. Preserve the private off-host backup, source scan, accounts and pinned release; inspect live capacity before any deploy.

## Wave 1 — remove unsupported score credit

- Make the proxy catalyst factor give zero credit to mere historical growth, backlog and calendar presence, while retaining those observations as discovery diagnostics. Leave the factor's 20% weight and internal 50/30/20 denominator explicit; only a source-reviewed material event may earn the factor's points through the existing reviewed-evidence path. Reject a purported reviewed event whose supplied trace fails the economic, timing, certainty, pricing or source gate.
- Add a distinct, bounded `modelInputCoveragePct` from actual usable model components. Keep `algorithmicCoveragePct` as the complete-numeric-grade indicator and `coveragePct` as source-reviewed coverage. Show all three concepts with unambiguous Arabic labels where relevant.
- Require current, auditable financing provenance for a positive thesis-financing decision. Preserve adverse states and fail closed on unresolved contradictions.
- Use adversarial and valid-control fixtures for each change. Bump the rubric so old saved evaluations cannot be silently reused.

## Wave 2 — prioritize the user's research brief

- Add a clearly named **provisional research** view for current common operating listings with observed positive market cap up to $5 billion, observed liquidity, SEC operating evidence, at least some valuation signal, and no severe/elevated financing or unresolved conflict. Retain the full canonical rank and fixed score, show the original rank, and label every case as research until its reviewed catalyst and full source gates pass. The saved market-data rights status is unknown, so this queue must not claim source eligibility, verified market values or investability. A separately strict source-qualified view would be empty on the current frozen data; do not hide that fact by weakening its gate.
- Reuse issuer-linked SEC annual evidence and existing operating-candidate signals only when fiscal periods, units, availability, source rights and issuer identity pass. Avoid assuming unknown sector or missing source means a negative company characteristic.
- Inspect the top 20/100 and the largest rank movers from the frozen replay. Record false positives, missing evidence, overlapping inputs, size and security-class composition. Adjust only reproducible defects; do not hand-pick favorable stock names.

## Wave 3 — full-universe independent measurement

- Freeze the exact 7,517 saved payloads and the old 1.2.6 evaluator; compare 1.2.6, 1.4 and the challenger on identical inputs. Independently recompute all eight factor values, fixed-weight totals, sorting, zero retention and top-set changes. Report source coverage, model-input coverage, catalyst-credit removed, funding-gate changes, fit-view counts, concentration and all missingness.
- Run strict-import exact-source identity and repeatability, relevant engine/runtime/research/SQLite/UI suites, typecheck, lint, build and `git diff --check`. If the replay exposes unacceptable evidence errors, repair and repeat it before release.
- Keep predictive status blocked until a then-listed plus delisted, source-availability-safe, corporate-action and dividend-complete, executable-price dataset provides mature six-month outcomes with issuer and purged chronological holdouts. Do not manufacture labels or infer predictive improvement from same-day rank shifts.
- Preserve explicit zero-credit/missing-factor rows in any future point-in-time panel; require dated lineage for positive credit and report missingness within every evaluated cohort.

## Wave 4 — safe delivery and live acceptance

- Check Railway deployment identity, release token, scan cursor, physical headroom and backup integrity. Do not resize paid capacity or remove saved/private data without authorization. Deploy only when the changed-rubric reevaluation can fit safely with a verified off-host backup; otherwise deliver a fully tested local candidate and document the exact capacity block.
- If deployed, verify every saved factor/final grade and rank plus API, report, export, profile, filter, mobile and reload parity on the new release. Update `HANDOFF.md` and both memory files with observed status, limits and reproducible validation artifacts.

Acceptance is a demonstrable reduction in unsupported catalyst/financing/coverage claims, complete deterministic fixed-weight ranking and a more faithful research queue. Higher realized investment returns remain unproven until a valid historical or prospective outcome study passes.
