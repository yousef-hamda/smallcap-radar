# Opportunity ranking evidence and thesis audit

Study and replay cutoff: 2026-10-10 UTC. [Plan](ALGORITHM_IMPROVEMENT_PLAN_2026_10_10.md) preceded the code changes. [Full aggregate comparison](ALGORITHM_COMPARISON_2026_10_10.json) is reproducible from the private pinned export using the documented scripts. The private export and account data are excluded from Git. Implementation commit `95700e4` was pushed to `origin/master`; CI run `38028284917` passed. Railway remains on the older rubric because of the capacity block below.

## What changed

- The eight factor weights remain **25/20/15/12/10/10/5/3**; their component denominators, exact score arithmetic, zero credit for missing input, all-listing numeric rank and score-descending/symbol-BINARY order remain fixed.
- Known, field-identified SEC/reconciliation disagreements now withhold only model components that depend on the contradicted field. All raw disagreements remain visible and globally block source eligibility. Unrecognized strings still withhold every model component. A backlog disagreement therefore cannot erase an independent technical grade or intrinsic model; a disputed revenue figure still withholds revenue-dependent components.
- A numerical score can no longer promote a company to `candidate-review` without a source-reviewed, quantified, material in-horizon catalyst and a clean or mild financing review. Growth history, backlog and the earnings calendar remain discovery signals. The thesis UI exposes the intrinsic, catalyst, financing and source-eligibility requirements. This changes the decision label, not the factor weights or numerical rank.
- Rubric version is `1.4.0-scoped-conflicts-thesis-gates` / `55dd2e8a`. The current production deployment is still `1.2.6-stable-import-identities` / `d21f9710`; this report does **not** claim live adoption.

## Same-input full-universe result

The pinned production export has release `74a8e534-9912-4c31-bc64-3eba0ef8d4ad:ratings-v5:15034:d21f9710`, **7,517** saved listings, one common as-of timestamp (`2026-10-09T15:58:28.220Z`), and SHA-256 `e179bffbec4071cee4e87a587d61aa3f0e0bfc604e26556ac6c814633c661cab`. The bounded-memory converter retained 7,517 records and consecutive saved ranks. The replayed JSONL SHA-256 is `eb3b2e0fb9f01d11f310539bd170f132aff08033de634c9c63df9569758d41ce`. The frozen deployed evaluator reproduced **all 7,517 saved evaluations exactly** before comparing the candidate.

| Measure | Observed result |
|---|---:|
| Listings retained/sorted | 7,517 / 7,517 |
| Numeric factors / missing factors | 60,136 / 0 |
| Independent model-component reconstructions | 54,428 |
| Normalization and identifier controls | 163 |
| Changed final grades versus deployed 1.2.6 | 1,451 (1,090 up; 361 down) |
| Unchanged final grades | 6,066 |
| Zero grades, deployed → candidate | 926 → 929 |
| Top 20 and top 100 overlap | 17/20 and 82/100 |

The 1,451 changed grades include the previously prepared, unshipped 1.3 evidence fixes. They cannot be attributed solely to this wave's scoped-conflict repair. Only six saved rows have raw source conflicts, all in unrecognized formats, so the new scoped-recovery branch does not award additional points on this frozen release. Synthetic controls demonstrate that it recovers independent credit for the exact typed conflicts produced by the current SEC/reconciliation code and still fails closed for unfamiliar conflicts.

## Stock-level and top-set audit

The audit inspected the largest increases/decreases and the top 20/100 using only saved model evidence, rather than presenting a price move as proof of quality. TPR's 18-point old grade drops to zero because its unresolved raw contradiction can no longer leave reviewed financial and earnings points standing. CABO drops 11.83 points because valuation falls from 8.11 to 3.38; HITI rises 10 points from financial-strength/downside components. These changes need prospective outcome testing before being called improved stock picks. The top 20 has **zero unresolved raw/factor/earnings conflicts**, but that alone does not establish a buying thesis.

The top 20 has **10** available intrinsic models, **zero** reviewed catalysts, **zero** source-eligible cases, **three** risk-review actions and **three** unknown financing states. In the top 100, the respective counts are **53**, **zero**, **zero**, **10** and **22**. All 7,517 have **zero** reviewed catalysts, **zero** source-eligible cases and **zero** thesis-qualified candidates. Only 374 have an available intrinsic model. Candidate action stays `research-required` when its evidence gates fail, even for a high numerical grade. No verified six-month return probability or target is produced.

The top 100 contains 41 companies with saved capitalization at or above $5B, while the top 20 contains 12. The complete Opportunity ranking has no size quota; this is a product-scope observation, not an argument to distort the fixed weighted score. Likewise, three of the top 20 carry a severe saved financing-risk state. Their numeric ranks are diagnostic and the separate risk action remains visible. Product copy must not market the numerical top list as verified best buys.

## Validation and remaining evidence work

Regression controls cover typed revenue/backlog/debt conflicts, derived-field dependencies, unknown conflict fail-closed behavior, independent final factors, intrinsic preservation, reviewed catalyst trace/materiality/pricing and financing state. The whole-universe comparison checks baseline parity, fixed weights, every final grade, ranking and source-conflict slices. An independent candidate strict-import replay preserved all **7,517** source records exactly, produced 7,517 sorted numeric results, 6,588 positive grades and 929 zero grades, with no missing factor, final grade or import field. Final gates passed: **258/258 engine, 91/91 runtime/API, 67/67 verified-build/root/UI, 19/19 research and 4/4 SQLite**, plus typecheck, lint and `git diff --check`. Suite counts overlap.

The historical validator has **zero usable mature six-month point-in-time observations**. This replay cannot test return prediction because it is one contemporary universe with no historical then-listed/delisted membership and no complete dividend, corporate-action and terminal-payoff record. A valid return comparison still needs those inputs, filing availability cutoffs, next-session execution, matched baselines, purged chronological windows and issuer holdout. Keep probability and six-month target null.

Official SEC filings can support an accession-deduplicated event-review queue, but filing presence is not quantified catalyst economics, funding or market mispricing. No billable Financial Datasets call was made; its current terms and product-use rights need an explicit commercial decision before it can feed public scores or bulk export. On Railway, the old deployment remains live and the 5 GB `/app/data` volume has **253,100,032 bytes free**, below the app's 256 MiB reserve. The active stage-11 acquisition remains paused. Deployment or write-heavy reevaluation is unsafe until capacity and a fresh off-host backup are secured. No volume files were deleted or resized.
