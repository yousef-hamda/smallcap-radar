# Opportunity system improvement — execution contract

Started: 2026-10-06. Status: active implementation; this document is not a completion claim.

## Objective and immutable contract

Find undervalued securities with evidenced, financeable catalysts for substantial upside. Provisional research horizon: six months; major upside outcome: at least 50%. Risk preference: funded businesses with explicit dilution and insolvency analysis. These are planning assumptions, not measured probabilities or promised returns.

Preserve one complete production ranking: every listing has eight numeric 0–10 grades and the exact fixed-weight 0–100 total, sorted by that total descending then symbol ascending. Weights remain 25/20/15/12/10/10/5/3. Missing facts remain missing; unsupported model components earn zero without reweighting. Confidence, evidence, instrument suitability and action status are separate from mathematical ranking. Never hide valid grades, require a scan for basic scoring, or fabricate qualitative facts/probabilities.

## Pre-change diagnosis

Baseline application: `1.0.3-deterministic-universe-ranking`, hash `b657e2a5`, deployment `e5b84029-4167-4170-b7c3-9f7c3cdca494`; master `8357140`. Saved full run: `9c059528-f468-4086-8c1e-927456f8599a`. Fresh API check confirms 6,954 sorted listings, zero missing factors/final grades; saved snapshots are dated October 3 and the run is stale. Full saved-dataset audit:

- 5,921 distinct CIKs; 5,274 common shares, 315 ADRs, and other instrument types remain included.
- All valuation, catalysts, competitive-position, downside, management and technical factors use model-v3 inputs; reviewed valuation/catalyst calculators lack populated live dossiers.
- Numeric debt 1,488; FCF 3,452; revenue 4,666; net income 5,577. Numeric availability alone does not prove suitability.
- Revenue/net-income period ends differ in 418 paired observations; revenue/FCF in 184; cash/debt in 371. Reconcile compatibility, not merely presence or recency.
- 3,043 backlog fields include 2,218 contract-liability observations. Deferred revenue is not interchangeable with backlog/RPO or a new binding order.
- No saved next-earnings date or insider-buy value in this full run. Missing observations must not be interpreted as an empty verified search.
- All 6,954 quote/cap/liquidity source checks are UNKNOWN; source entitlement remains unverified. Six-factor mathematical coverage is not investment-evidence completion.
- Rank pagination starts from snapshot payloads and uses a temporary ORDER BY structure. Profiles select latest canonical data without a requested release identity.
- Background scanning uses request batons plus browser recovery; independently scheduled restart-safe execution must be established.
- Existing price-only historical research is survivorship-biased and cannot validate Opportunity probabilities.

## Work and acceptance gates

1. **Financial integrity:** canonical observations and dependency lineage; compatible fiscal periods/currency/scope; correct total-versus-component debt; explicit contract semantics; instrument applicability; migration of old records; meaningful regression fixtures and full-universe audit.
2. **Evidence collection:** issuer-deduplicated bulk/incremental SEC ingestion, filing documents and ownership, custom/dimensional parser evaluation, recorded source permissions, source failures and freshness; bounded persistent jobs and global provider limits; full listing participation.
3. **Investment models:** industry/instrument model selection, conservative/base/bull fair-value methods and diluted capitalization; separate intrinsic value and six-month targets; dated catalyst ledger; financial/earnings/business/risk/governance/entry evidence, deterministic component tables, explainable zero fallbacks and fact/model distinction.
4. **Publication and APIs:** release-pinned canonical evaluations, atomic materialized scores/ranks and manifests; index-driven pages, compact radar responses, revision-aware summaries/cache; report/export/profile parity across reloads and release changes.
5. **Product:** Arabic research thesis, valuations/scenarios, catalyst timeline, funding/dilution, downside/invalidation, source dates/gaps and exact grades; all listings stay accessible, including zero/safety findings; portfolio/favorite/account regression protection.
6. **Research:** point-in-time facts/security identities, delisted outcomes, dividends/actions, executable entries/costs, censored observations, overlapping-horizon purging, chronological plus issuer holdouts, baseline comparisons, drawdowns/major-upside outcomes and calibration. Probability claims remain disabled until genuine data and independent validation pass.
7. **Operations/release:** reproducible backups and restoration, failure/restart tests, relevant full suites, whole-universe recalculation/persistence, commit/push/deploy, exact deployed version/ID, all-record production API/browser verification, performance targets and consistent handoff/memory.

## Data/model rules

- Upside = fairValue / price − 1; discount = 1 − price / fairValue. Do not conflate them.
- Two endpoints reflecting one filing are one source, not independent corroboration. Preserve original filings and flags for material disagreements.
- Filing publication time governs information availability; amendments create versions. Do not use future-restated values in historical signals.
- A broad debt total cannot be added to current debt. Cash, debt and senior claims must reconcile to a balance date.
- Contract liabilities, RPO, commercial backlog and orders have distinct types. Dates/timing and conditions are required before a commercial fact becomes a near-horizon catalyst.
- Securities share issuer facts but not payoff/capitalization assumptions. ADR ratios and distinct security terms require sources; unsupported factors cannot inherit favorable operating-company scores silently.
- No new paid source, billable connector or third-party message is authorized. Legitimate free acquisition, existing runtime deployment and reversible implementation are authorized.
- A free data path must establish coverage, access and product-use rights; public endpoint visibility is insufficient. Document unresolved limits; never claim completion around them.

## Verification ledger

Implementation results, tests, migrations, production counts, deployment identity, remaining failures and research-data limitations will be appended as waves finish. Completion requires observed evidence, not this checklist or a successful build alone.

### Implementation and local evidence checkpoint

Complete saved-universe replay: 6,954 stocks, 55,632 bounded numeric factor grades, zero missing final grades/factors, deterministic sorted positions for all 6,954. Raw import schema accepts all 6,954 snapshots. Debt recovered for 80 records; 2,218 contract liabilities retyped. The migration does not claim to resolve every reporting-period discrepancy: newer available metrics can reveal incompatibility, and conflicting components are withheld. Intrinsic sensitivities available for 404; peer comparisons for 317. Quote currency is restored only where the saved price and currency-bearing history share matching source URL and end date.

Backup: remote online SQLite snapshot, off-volume private compressed download and restored SQLite integrity/count verification passed. SHA-256: `58ca02eb324956e5dbc0e649b4f3a3142c5a2e7fbd8851048aa6ba8425baa59c`. Source/restore private counts: 14 favorites, 6 portfolio transactions, 1 account, 3 sessions, 1 recovery bundle. Backup artifacts remain ignored and private.

Research-data constraints: no valid historical point-in-time membership/delisting dataset is present; probability publication is blocked. All-universe free quote redistribution rights, fully diluted/senior-claim reconciliation, specialized sector/instrument valuations, reviewed catalyst economics and comprehensive governance/litigation coverage remain incomplete. The application must state these limits while preserving the actual complete numeric rating.

Final test results, deployment identity and live complete-universe proof will follow; this checkpoint is not a production acceptance claim.

### Local release gates (before deployment)

- TypeScript typecheck: PASS.
- ESLint: PASS.
- Engine: 186/186 PASS.
- Runtime/API/scanner/storage/private-state/publication: 76/76 PASS.
- Verified build and repository/UI/research-unit root suite: 52/52 PASS.
- Explicit research suites: 9/9 PASS.
- SQLite schema/query tests: 4/4 PASS.
- Full saved-universe model replay and import-schema audit: PASS for all 6,954.
- Backup download/checksum, actual restoration/integrity and private-state counts: PASS.

Intermediate failures were corrected and rerun: legacy valuation assertions after the fixed 60/25/15 model, missing Company source-URL typing, incomplete financing-period fixtures, and report blocker role/label mismatches. Initial streamed backup transfer failed; the bounded resumable transfer and restoration passed. No predictive-validation claim follows from these tests.
