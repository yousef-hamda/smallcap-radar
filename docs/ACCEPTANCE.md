# Acceptance ledger — 2026-09-06

Status is implementation evidence, not an assertion of historical strategy profitability. Full user plan is preserved in USER_PLAN_AR.md. No section is silently treated as complete.

| Plan sections | Scope | Actual status |
|---|---|---|
| 1–3 | Funnel, shared engine, 3 models | Shared gates/specs implemented; final funnel and Legacy normalization incomplete |
| 4–20 | Core | Documented gates/weights implemented; inflection, death-spiral automation and all factor sub-scores BLOCKED on specification/validation |
| 21–31 | Bounce | Gate evaluator/exits implemented and tested; explicit operational 20-day median dollar-volume threshold ($150k); historic rates unverified; no invented Bounce score |
| 32–35 | Raw/normalized/metrics/provenance | Company Facts/price adapters and provenance implemented; quote-only records survive SEC fundamental failures; split events are used when deriving comparable share-count dilution; raw cache persistence, SEC Frames and taxonomy completeness pending |
| 36–38 | Two-source, confidence, four angles | Missing/conflict surfaced; final ranking disabled; no actual secondary-source enrichment |
| 39 | Universe cleaning | Bundled 7,675-symbol SEC/Nasdaq directory, exchange filter and conservative name classification; quick cache excludes funds, trusts, units, warrants, preferred instruments and limited partnerships. Not yet a fully verified security master |
| 40–45 | Database, snapshots, stages, hashes | 9 functional/supporting tables, self-initializing schema, snapshots/run checks/hash, cursor/lease implemented. Quick scan completes a dated 12-symbol sample without live-provider dependency. Quick/full scans run as chained server tasks after the page closes, in concurrent eight-symbol batches. Persistent retry queue implemented (3 attempts); exhausted failures remain partial. Full 14-stage research architecture is not yet implemented |
| 46–50 | Dashboard/cards/excluded/incomplete | Professional dark RTL terminal, dense table, explicit status language and synthetic mode clearly separated. No padding |
| 51–53 | Deep company views/charts/translation | Gate/evidence details and five-range chart implemented; insiders, analyst, news, sector data and translation caching pending |
| 54–59 | Statistical lab/PIT/holdouts/multiple tests/bootstrap | Tested utilities and synthetic exit example; experiment/holdout tables only, no complete research orchestration |
| 60–66 | Survivorship/costs/stress/metrics/disasters | Costs and basic exits implemented. Delisted dataset, full backtest, liquidity stress, Core/Bounce dashboards and disaster analysis pending |
| 67–70 | Adversarial/boundary/invariant tests | 6 explicit synthetic companies; 30 tests passing |
| 71 | Real-source integration | Nasdaq screener/history and SEC Company Facts adapters implemented. A production `www.sec.gov` 403 reported on mobile no longer blocks the universe or quick scan. Browser QA completed 12/12 quick records with price, market cap, 12-month return and cached fundamentals where available; expected-value financial audit remains incomplete |
| 72–75 | Freshness/failure/migrations/performance | Conservative freshness gates; generated migrations; background execution and encrypted Web Push completion alert implemented. iOS requires Home Screen installation and one-time notification permission. No comprehensive 1k–15k benchmark |
| 76 | Secrets | No supplied secrets persisted; replacement needed before using user's separate Cloudflare credentials |
| 77–79 | Diagnostics/coverage/audit | Run counts/errors and persisted evaluations; rich source-coverage UI/immutable historic UI pending |
| 80–82 | Research/rejected idea registry | Research folder and schema; no experiments invented or claimed to be run |
| 83–84 | Milestones/acceptance | Foundation only; full acceptance has NOT passed |
| 85–87 | Unresolved details and final architecture | Remain openly documented; no claims of complete production delivery |

## Verification performed

- `npm run test:engine`: 30/30 passed, plus 3 SQLite transaction/concurrency tests.
- `npm run typecheck`: passed.
- Production Sites build: passed.
- Background browser-close QA: started a quick scan, closed its page, reopened a separate page and observed server completion at 12/12 with 0 failures.
- Web Push payload encryption and VAPID signing: passed locally. The final iPhone permission prompt remains a required user gesture.
- Local browser QA completed for initial, synthetic, Bounce, company evidence, Lab, exit-simulation, navigation, empty-state and filter flows. The live quick scan reached the provider boundary; the local preview environment blocked the external SEC request and displayed the failure without losing the persisted run. Browser automation could open the native file picker, but its isolated browser filesystem could not read the local fixture, so JSON import was validated through schema/build coverage rather than claimed as an end-to-end browser pass. No physical-phone installation test, full market scan or historical benchmark reproduction was completed.

## Known constraints

Market cap begins with the dated Nasdaq screener value and may be replaced by SEC reported shares multiplied by the latest Nasdaq close when the share period is recent. The derived figure is labeled low confidence and is not a verified current share count. EV/S and split-adjusted dilution remain unavailable until reliable debt and corporate-action feeds are integrated. Therefore Core/Bounce candidates can remain incomplete. That is intentional and safer than manufacturing financial facts.

The user requested a new GitHub repo and continuous pushes. Tool capability lacks repository creation; this requirement is not satisfied by the separate Sites source repository. User must create an empty private repository or supply access to an existing intended repository before GitHub synchronization can occur.
