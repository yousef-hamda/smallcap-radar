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

### Production findings and corrected release

First improvement deployment `42d9a3d3-4b68-4d87-a1d1-abbd6a6eb52f` (archive from commit `57571e4`) successfully persisted 6,954 complete grades, zero missing factors/final grades and all sorted ranks under `1.2.0` / `3690a5dc`. Initial migration took 171.8 seconds. All radar and report rows matched persistence. Full independent replay found platform-dependent power arithmetic at ADI: a roughly 0.000002-dollar DCF difference changed the evaluation hash despite identical displayed grades. This is a real acceptance failure, not a passing replay.

Corrected rubric `1.2.1-reproducible-opportunity-system` uses repeated multiplication for integer-year discounting and cents for cash-flow currency outputs. Independently computed thesis JSON for all 6,954 original production payloads now has identical SHA-256 on macOS Node 22.21 and production Linux Node 22.23.2: `65b6d6635a658f33f4659bdc7e3a9fc2149ef64ac7bd425ea90809a65a3ed7dc`. All 404 intrinsic models remain available. Final deployed evaluation replay remains required after deployment.

Scheduler correction: compression must not block a fresh scan when at least 512 MiB of reusable SQLite pages exist. Refresh metadata is rubric-specific; failed fresh runs use a 30-minute retry interval. Historical inline records omit bulky history/news/purchase/peer lists while their exact original bytes remain archived. The first deployed maintenance tick freed about 476 MiB of derived terminal checkpoints; source/history compression continues. Offline saved rows now show their exact saved grades, factor values and rank rather than only prices.

Ownership currency rule follows the [SEC Form 4 instructions](https://www.sec.gov/files/form4.pdf): per-share security prices are reported in USD. Every positive purchase aggregate now preserves hashes/accessions/parser identity and dependency records for all contributing filing documents, including purchases omitted from the capped twenty-row UI list. Code P still does not establish public-market execution, alignment quality or absence of amendments.

Browser release compatibility: a client with an older bundled rubric must display the server's validated eight-factor final grade, not rerun its older evaluator against a compact card. The browser now validates immutable factor IDs/weights, exact arithmetic, snapshot date and canonical hashes independent of local rubric version. Search/profile loading does not fabricate an interim zero grade before the canonical response arrives.

Actual-runtime failure: deployment `3bd01724-a380-409e-a9b1-bf49ef8e7e53` persisted all 6,954 `1.2.1` grades (`e723dd3c`) in 105.3 seconds, but scheduler ticks returned `D1_ERROR: not authorized: SQLITE_AUTH`. D1 does not permit native freelist/page-size PRAGMAs. Capacity inspection now runs in the Node supervisor through a read-only SQLite connection, and authenticated headers carry only capacity byte counts to the Worker. Missing capacity on production volumes fails safely; insufficient capacity pauses new scans while historical maintenance continues. This deployment is not final operational acceptance.

Freshness correction (October 7): terminal full runs marked partial because of provider gaps must publish their complete scored listing set. Radar, default profiles, historical protection and verification now choose the newest finished full run by creation time; unfinished rows still cannot replace a published result. A regression compares the default radar, profiles and report for both a sourced stock and a missing-data stock in a newer partial full universe.

### October 7 live audit and complete-directory publication

Deployment `48f5bc8f-98fb-440d-a8cb-dd8a46773737` (commit `38141f4`) passed deep comparison for every saved listing: 6,954 persisted/radar/report/profile evaluations, 55,632 factors, identical hashes/grades/ranks, zero missing factors/final grades, reload PASS. This remains a proof of the saved universe, not the expanded directory.

The resumed acquisition directory contains 7,093 listings. Publication now precedes slow provider enrichment: a restart-safe bounded checkpoint creates an immutable full-directory rating release, carries forward only CIK- and security-type-matching observations with unchanged source dates, retains missing-CIK listings and zero-credit missing facts, and publishes all grades/ranks before external acquisition continues. Incomplete publication cannot replace the prior release. Later completed acquisition publishes another coherent release. The acquisition run stays visible separately. Intermediate publication regressions were corrected: missing checkpoints require bounded failure/retries, and tests must distinguish publication identity from an acquisition fixture in a shared database. Local runtime suite is now 78/78 PASS, including 15,000 listing publication and source-date preservation.

The UI footer describes the actual final fixed-weight grade, automatic saved Form 4 acquisition, and unvalidated return probabilities without labeling the grade a temporary diagnostic. Expanded-directory deployment and proof remain pending at this checkpoint.

Confirmed acquisition failure: `SQLITE_TOOBIG` on quote-page persistence. D1 limits strings/BLOBs/rows to 2,000,000 bytes and 100 bound parameters ([official limits](https://developers.cloudflare.com/d1/platform/limits/)). One thousand quoted records repeat lengthy sanitized batch-source URLs and exceed that limit. New checkpoint format `paged-v2` uses 100 listings per page; an atomic legacy stage-one conversion preserves every listing and offset. Tests enforce the actual parameter/string ceiling and preserve both original source URLs across 1,000 quoted listings. Existing later legacy phases retain their original 1,000-row addressing. Directory publication uses at most 80 symbols (81 query parameters).

Publication-time correction: a scan necessarily starts before its directory rating release. Default selection and historical protection must therefore use terminal `updated_at` (then creation time), so a later enriched finish replaces its directory release. The scheduler's daily due time and failed-run retry start at the last terminal update. The regression proves this with an earlier-created scan finishing after its directory publication. Static offline cache version now changes so existing service workers fetch the saved-grade offline page. Weighted contributions display three decimals (grades and totals two), preserving their mathematical precision.

Expanded live audit failure: all 7,093 saved grades independently replayed, but `runId` validation rejected the generated `:ratings` suffix (HTTP 400), and status polling selected the later-created terminal directory release rather than the active acquisition. Both paths now share valid bounded release identities and active-run selection. The directory regression exercises public radar pagination, company, report, complete export and status handlers with the actual generated release; direct storage-helper success is insufficient. No expanded-universe API acceptance is claimed until that live audit passes.

Source audit found a real grading regression in directory publication: newer Nasdaq screener observations lacked their actual request URL, replaced older sourced observations, and therefore earned zero timing and almost all zero valuation credit. The producer now persists its real request URL; preliminary conversion repairs this exact private acquisition source label, never generic imported snapshot claims. A new immutable `:ratings-v2` release is built from the complete saved quote checkpoints (now containing successful Yahoo quotes), preserving original financial dates. The scanner can finish this publication from any active paged-v2 phase, so the current stage-five acquisition can recover without restarting its SEC progress. All-factor signal variation remains a live acceptance gate.

Directory carry-forward now also selects the most recently finished release by `updated_at`, then creation time. A regression fixture places a newer-created but older-finished directory next to the later-enriched issuer record and checks that the issuer facts are retained.

The expanded audit also found pricing ratios could survive a quote update or skip normalization when no earnings dossier existed. Rubric `1.2.2-current-pricing-opportunity-system` rebuilds P/S, EV/S and FCF yield from current same-currency source inputs and invalidates cached ratings. A narrowly scoped v13/1.2.1 acquisition migration preserves offsets and retry queues instead of restarting current provider requests. Tests check changed capitalization, missing dossiers, currency mismatch, future retrieval and safe cursor migration.

Expanded 1.2.2 replay/API/export parity passed but the deeper factor audit rejected data quality: only 15 timing grades were positive because older technical assessment timestamps incorrectly blocked independently dated model inputs. Equal-date quotes also retained the earlier missing Nasdaq URL. Rubric 1.2.3 keeps stale assessment notes and unavailable reviewed coverage while admitting current model inputs; real source conflicts still withhold points. Matching date/value quote metadata can repair its acquisition URL without changing the factual date. A new immutable `:ratings-v3` publication rebuilds all 7,093 listings. The prior 1.2.2 sweep is superseded, not accepted as final.

Both complete-universe verification scripts now independently reconstruct every conflict-free model factor from its persisted component weights and grades. This catches a lost final factor contribution even when the evaluator, stored grade and UI agree on the same erroneous result. A stale assessment date does not count as an actual source contradiction for this check.


### Complete inventory audit: acceptance failure before repair

Independent comparison of the original 6,954 saved listings with the 7,093-row directory found 6,941 retained, 152 added and 13 absent. Six absent tickers (DDS, DDT, ET, SUN, SUNC, USAC) are present in the current official directory under exchange code F, which Nasdaq identifies as Texas Stock Exchange. Seven (DRCT, GWH, TWOD, VTAK, WALD, WALDW, WKEY) are absent from both current official files; absence alone does not prove delisting. They must remain visible with current listing unconfirmed, no unsupported positive investment credit, and complete numeric grades.

The parser accepted only exchange codes N/A and only ACT symbols. The current other-listed file has 377 non-ETF/test listings whose ACT symbol is invalid under the application format but whose alternate Nasdaq symbol is valid, plus codes P/Z/F. The independently counted current listed universe is approximately 7,498; retaining the seven unconfirmed tracked listings gives approximately 7,505. Counts must be recomputed against the actual published files. Existing 7,093-row verification therefore cannot establish complete-universe acceptance.

Repair contract: include every non-ETF, non-test row across both complete official files; preserve valid alternate security symbols and compound issue classification; prevent a partial directory response from replacing the full inventory; persist the last checksum-verified complete directory with its real retrieval date; retain previously tracked absent listings explicitly; migrate the active acquisition inventory without shifting previously fetched offsets or discarding source checkpoints. Independently compare official/current and prior saved membership with persistence and all ranking surfaces.

Primary documentation: [Nasdaq symbol directory definitions](https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs), [Nasdaq Texas Stock Exchange code F announcement](https://m.nasdaqtrader.com/TraderNews.aspx?id=DTN2026-10). No ETF or test issue is added to the product stock universe.

Inventory repair candidate `1.2.4-complete-inventory-opportunity-system` / `42c3b090`: engine 194/194 PASS; runtime 84/84 PASS; verified build/root 55/55 PASS; typecheck PASS; lint PASS; verification-script syntax PASS. Tests include alternate preferred symbols/all exchange codes, compound units, unconfirmed zero-credit full grades, partial-download rejection, checksum/reload integrity, preserved provider cursor/retries/quotes/fundamentals and history-phase append/persistence. Production complete inventory publication and independent verification remain required.

The `1.2.4` inventory deployment `337d71f6-1218-4261-8f14-1160c1f97bc3` succeeded, but a focused preferred-instrument check found score 0 paired with a financing component grade 10. This is an inconsistent calculation trace and fails the full-component contract even though the final numeric score is conservative. Rubric `1.2.5-complete-instrument-contract` withholds unsupported instrument components explicitly, aligns model traces with final factor grades, and publishes a new immutable `:ratings-v5` release. The audited v13 cursor migration additionally accepts 1.2.4; inventory and provider progress stay intact.

Production transport failure: Worker requests with browser headers returned HTTP 200 non-directory content and no usable rows. Strict complete-inventory validation correctly rejected it, but the existing failed-run cleanup immediately deleted root quote/fundamental checkpoints (confirmed counts 0/0) after three retries. Saved observations and 2,178 compressed SEC artifacts remained. This is an operational acceptance failure. Native Node requests to both exact official URLs returned complete 349,903/542,264-byte files with expected headers/footers. The supervisor now downloads and checksum-persists the same parser's complete official inventory before scheduler ticks, with dated hourly cache reuse; Worker text requests use plain headers. A malformed native download cannot overwrite the last verified cache. Recent recoverable failed acquisitions retain their source checkpoints and snapshots for 24 hours. The failed partial run remains historical; a fresh current full scan uses retained public artifacts and the complete inventory. No invented retrieval or listing date is introduced.

Final local 1.2.5 candidate gates: engine 195/195, runtime 85/85, verified build/root 56/56, typecheck and lint PASS. Added native official transport/cache/non-overwrite tests and recoverable failed-checkpoint preservation. Native directory acquisition uses the same checked-in parser as the Worker. Live publication, full membership/replay/API/UI verification and production scheduler recovery remain pending.
