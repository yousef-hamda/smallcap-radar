# Opportunity system — final deployed audit

Verified October 7, 2026, UTC. **The complete mathematical ranking contract passes. The broader objective of comprehensive research and validated high-probability buying outcomes remains incomplete.** This report supersedes earlier candidate and zero-ranking checkpoints; intermediate failures remain recorded in the [execution history](SYSTEM_IMPROVEMENT_EXECUTION_2026_10_06.md).

## Deployment and proof identity

| Item | Verified value |
|---|---|
| Production | https://smallcap-radar-production.up.railway.app/ |
| Deployment / status | `7a9f861a-4b77-41aa-a09f-dbc4f9fcbf2e` / SUCCESS |
| Deployed application archive | `6c452e5545b4c78ea25f09374794219f45f81afd` |
| Rubric / hash | `1.2.6-stable-import-identities` / `d21f9710` |
| Exact application GitHub CI | `37568804637` / PASS |
| Saved published run | `ca402eb1-9ba3-424d-a153-ce827c0498db:ratings-v5` |
| Published evaluation revision | 22,518 |
| Release token | `ca402eb1-9ba3-424d-a153-ce827c0498db:ratings-v5:22518:d21f9710` |

The terminal run metadata retains its original acquisition strategy hash; repaired persisted evaluations and the materialized rating revision use `d21f9710`. These fields describe different historical identities. Current APIs/export/UI pin the evaluation release token, not the old acquisition metadata. Subsequent documentation commits record this application deployment without changing runtime code.

## Complete-universe acceptance

| Check | Result |
|---|---:|
| Independent live official non-ETF/non-test listings | 7,494 |
| Previously tracked original listings retained | 6,954 / 6,954 |
| Explicitly unconfirmed retained listings | 12, all zero-grade |
| Complete production universe | 7,506 |
| Saved complete evaluations and stable hashes | 7,506 |
| Required numeric factor grades | 60,048 |
| Missing factor grades | 0 |
| Missing final grades | 0 |
| Missing stable hashes or rank positions | 0 |
| Strict imports preserving all source fields | 7,506 |
| Listings sorted by actual saved final grade | 7,506, ranks 1–7,506 |
| Positive / zero final grades, both displayed | 6,521 / 985 |
| Radar / report / company profile / HTTP export parity | 7,506 each, PASS |
| Real browser rendered rows and factor grades | 7,506 / 60,048, zero mismatches |
| Weighted arithmetic and independent component reconstruction | PASS |
| Raw/imported identity and Mac/Linux deterministic replay | PASS |
| Scan needed to finish basic grading | No |
| Required mathematical scoring/ranking acceptance failures | 0 |

Independent official files were downloaded at `2026-10-07T03:57:11.817Z`. Retained unconfirmed symbols: DRCT, GWH, TWOD, VTAK, WALD, WALDW, WKEY, LESL, NHPBP, PSKY, QRVO, UWMC.V. Absence from a current file is not itself proof of delisting. All nine instrument classes are included: common, ADR, unit, warrant, right, preferred, fund, debt and unknown. ETFs/test issues are not newly added; existing non-ETF fund-labelled listings remain visible.

[Machine-readable evidence](SYSTEM_IMPROVEMENT_PRODUCTION_VERIFICATION_2026_10_07.json) includes factor/type counts, factual coverage, rendering/export proofs, lossless storage checks and remaining limitations. [Changed-file manifest](SYSTEM_IMPROVEMENT_CHANGED_FILES_2026_10_07.md) lists every changed path. [Test ledger](SYSTEM_IMPROVEMENT_TEST_LEDGER_2026_10_07.md) records final suites, production checks and rejected release attempts. Private databases, backups, raw exports and browser artifacts remain ignored.

Final direct recheck at `2026-10-07T04:22:25.089Z`: deployment remains SUCCESS; radar HTTP 200, exact revision 22,518 / `d21f9710`, ranked/sorted 7,506, missing factors/final grades zero, actual primary research/excluded ranking counts zero. Native issuer offset advanced to 4,488/5,929; SEC successes 10,233, recorded SEC failures 348, historical-bar failures 481. Physical filesystem free space was 1,626,980,352 bytes. These later counters supplement the dated exhaustive proof above.

## What changed

- **Financial normalization:** compatible currency, scope and annual/TTM periods; total debt separated from components; contract liabilities separated from backlog/RPO; unsupported/stale financing findings cannot pass as current evidence.
- **Evidence and sources:** issuer-deduplicated SEC acquisition, global quotas and resumable leases; bounded original filing documents with compressed bytes, parser version and SHA-256 identity; conservative Form 4 transaction/amendment checks. Unreviewed event economics receive zero credit. Both complete official listing files, exchange codes and valid alternate symbols are verified; dated durable and generated source fallbacks preserve inventory through HTML/403 failures.
- **Models:** deterministic normalized intrinsic sensitivities and SEC-SIC peer contexts with persisted inputs, eligibility, assumptions and component traces. Model applicability and missing evidence remain explicit. Current price ratios are rebuilt from compatible sourced inputs.
- **Ranking and persistence:** complete grading publication precedes slow enrichment; saved evaluation/rank revisions are materialized atomically. Repair recalculates old cached evaluations under the current rubric. All listings remain rankable, including those with missing issuer identifiers or zero grades.
- **API and interface:** radar, profiles, scan reports and streaming exports select one release. Pages use indexed ranks; compact cards preserve the canonical eight grades, final score and hash. Arabic screens display actual final grades to two decimals and contributions to three decimals. Timer refresh preserves loaded pages. Offline reads identify their cached subset.
- **Import and reproducibility:** valid SEC identifiers use the SEC-specific bound; official long names are preserved. Canonical nested object keys eliminate field-order-dependent hashes; arrays retain meaningful ordering. Fixed integer-power discounting and rounded modeled currency remove Mac/Linux hash divergence.
- **Operations:** native unattended scheduler, source checkpoints and every scanner entry path observe physical disk reserves. Lossless archive summary version 2 removes duplicated historical prose/source trees without altering original source/evaluation bytes or private data.
- **Research validation:** point-in-time availability, delisting proceeds, cash dividends, costs, censoring, history gaps, chronological purging and issuer holdout have explicit protocol/tests. No unvalidated probability is enabled.

## Final scoring and data contract

Eight factor weights remain **25/20/15/12/10/10/5/3**, corresponding to valuation, catalysts, financial strength, earnings quality, business quality, downside risk, management and entry timing. Every factor is numeric 0–10, normalized to hundredths. Final score is:

```js
Math.round(sum(Math.round(factorGrade * 100) * factorWeight) / 10) / 100
```

Sort uses final score descending, then symbol ascending with SQLite BINARY ordering. The displayed grade is the same saved value used for sorting. Missing factual inputs remain missing and earn zero component credit without redistributing weights. Reviewed dossier grades take precedence where valid; deterministic bounded models provide remaining grades with persisted components. There is no neutral or positive factual invention to make coverage look complete. See the [complete model contract](COMPLETE_RANKING_MODEL_2026_10_06.md) for every component.

Valuation model shares are fixed: intrinsic sensitivity 60%, sales multiple 25%, FCF yield 15%. Owner cash flow is OCF minus capex minus SBC; supported industrial models require three compatible USD years, reviewed splits and one common class. Fixed bear/base/bull assumptions and the lower normalized earnings cross-check yield intrinsic sensitivities. They are not six-month price targets or fully diluted/senior-claim conclusions. Peer comparisons use distinct issuers, identical SEC SIC, annual USD metrics, fiscal ends within 45 days, comparable revenue and 5–20 peers; they do not establish a moat or direct competitors.

Canonical evaluations remain in `fundamental_snapshots.evaluation.opportunity`; lossless archived payload/evaluation bytes restore before historical reads and repair. `opportunity_rankings` stores final score, hash, rubric and whole-universe rank. `opportunity_rating_versions` records raw snapshot revisions; `opportunity_rank_versions` records materialized release revisions. Compact responses are presentation views of these evaluations. Latest finished full publication is selected by terminal update time then creation time; newer unfinished/quick acquisitions cannot replace it. Source eligibility, safety, confidence and research checks are independent from mathematical ranked state.

## Evidence coverage and remaining research work

All mathematical factors are complete; factual evidence is not. The final saved universe has 394 supported intrinsic model contexts and 535 peer contexts. Secondary source-review findings are 6,041 needs-research / 1,465 excluded, while the actual ranking contains all 7,506. These findings remain visible and do not reinterpret the final grade as a placeholder.

| Factual field | Missing saved observations |
|---|---:|
| Price | 533 |
| Market capitalization | 1,121 |
| Revenue | 2,833 |
| FCF | 4,044 |
| Net income | 1,928 |
| Cash | 1,904 |
| Debt | 5,942 |
| Verified insider purchase value | 7,506 |

These counts include unsupported instruments and missing sources. Numeric availability itself does not prove current eligibility, comparable fiscal periods, reviewed economics or redistribution rights. Zero insider-purchase coverage is not a verified finding of no purchases.

Source enrichment is separate from basic completed scoring. At `2026-10-07T04:02:36.031Z`, the resumed full root scan was at stage 11, issuer offset 3,304/5,929, with 12,701 SEC requests, 9,064 successes, 333 recorded SEC failures and 481 carried historical-bar failures. It advanced 280 issuers after restart while browser resume requests were blocked. Those counters are dated acquisition progress, not missing final grades or a completed fresh-source scan.

The broader improvement plan is **not fully certified**: reviewed catalyst economics, comprehensive governance/risk diligence, fully diluted/senior-claim and specialized sector/instrument models, market-data product-use rights, and a survivorship-safe point-in-time historical calibration remain incomplete. The six-month/50% upside objective is a research assumption. Buying-success probabilities and six-month targets stay null/unvalidated; no calibrated high-probability return claim is made. A complete numeric ranking cannot establish that claim by itself.

## Full-volume outage and verified recovery

The preceding `1.2.5` deployment passed all ranking surfaces but subsequently exhausted physical storage, causing SQLite shared-memory errors and HTTP 503. It was rejected as final acceptance. Reusable SQLite pages did not provide physical WAL/SHM reserve. Hole punching recovered no space; native checkpoint/cache eviction on the full original failed; SSH timeouts interrupted initial long recovery checks. These attempts are recorded failures, not recovery proof.

Before replacement, the current complete database was downloaded privately off-host: 1,514,277,608 compressed bytes, restored 4,815,323,136 bytes, SQLite integrity `ok`, SHA-256 `8103eb52f91f4ec0a6838dbd6d947e5ae0bc5778aff4c43c4db765ead26dfcac`. Five bounded ranges proved exact restored source/evaluation byte parity for all 117,756 saved records and exact private-value parity. The compacted database was 3,040,825,344 bytes, installed only after six copy blocks passed byte parity, with writers stopped and the backup durable. Run IDs and active checkpoints survived; metadata storage was untouched. Private record counts remained 14 watchlist entries, 6 transactions, 1 account, 3 sessions and 1 recovery bundle; no private values or secrets are published.

All 102,744 archives on the final live deployment passed decompression, identity and every-factor grade parity. Summary version 2 is queryable compact metadata; original detailed payload/evaluation archives remain exact. Re-fetchable SEC response cache is capped at 64 MiB. Only the latest published full run remains inline. Installation freed 1,779,519,488 physical bytes; at 04:02:36 UTC actual filesystem headroom remained 1,743,847,424 bytes during native acquisition.

The existing 5,000 MB volume is unchanged and finite. Capacity samples missing, invalid, future-dated, older than five minutes or below 256 MiB physical free space pause every scanner path without advancing checkpoints. New scans require 512 MiB physical headroom. Reusable database pages cannot replace these limits. Monitor pauses and use verified reclamation or explicitly approved capacity changes. No new paid source/infrastructure was introduced.
