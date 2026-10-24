# Opportunity algorithm study and implementation — 2026-10-12

## Scope and result

The intended search is for undervalued operating businesses with a defensible value case, a material future catalyst supported by source evidence and funding, and manageable downside. The six-month and 50% upside ideas are research hypotheses. No measured return probability or six-month target is available.

This wave read the current handoff and project/operations memory, prior algorithm plans, scoring/evidence/persistence paths, and a frozen 7,517-listing production export before implementation. Three independent audits examined the algorithm, source validation and operational constraints. The [implementation plan](ALGORITHM_IMPROVEMENT_PLAN_2026_10_12.md) records the four waves. The resulting candidate is rubric `1.5.0-material-catalysts-model-coverage` / `4e4b7cc4`; production remains on `1.2.6` / `d21f9710`.

The eight factor weights stay **25/20/15/12/10/10/5/3**. All 7,517 listings keep eight numeric factors, one final score, and deterministic score-descending/symbol-BINARY-ascending ranking. Missing evidence gets zero component credit. The provisional research filter does not change any stock's score or canonical rank.

## Defects corrected

1. The 20% catalyst factor previously gave positive credit for historical growth, backlog and the presence of an earnings date. Those facts can suggest where to look, but none verifies a future material event. Their traces remain visible as discovery inputs while their catalyst score credit is zero. A reviewed event must pass time horizon, economic units/materiality, certainty, pricing, arithmetic and source checks. When multiple events exist, the evaluator selects the strongest *qualifying* event.
2. A 100% numeric-grade completeness indicator had been presented as model coverage. The evaluator now separately reports `modelInputCoveragePct` from observed usable inputs, `coveragePct` for reviewed source evidence, and numeric-grade completeness for the complete-ranking contract. Cards, report and archived summaries carry the distinction. The frozen universe's mean model-input coverage is **25.17%**; 100% means only that all numeric grades exist.
3. The financing thesis check previously trusted a `clean`/`mild` state without verifying current `financing-risk-v2` provenance. A positive financing check now requires matching, current, nonconflicting review; unresolved cases remain visible as unknown.
4. The point-in-time validator previously dropped zero-credit factors lacking a source list. It now retains them as explicitly missing, while positive credit still requires valid point-in-time lineage. This prevents a future outcome panel from selecting only well-covered rows.
5. A new **provisional research** view selects current common operating listings with observed positive market cap up to $5 billion, price and 20-session dollar liquidity at least $150,000, issuer-linked SEC annual USD revenue, an industrial model, a positive valuation signal, and no known severe/elevated financing or unresolved conflict. Reviewed financing PASS cases appear first, then canonical rank. The original rank is shown on every card. Unknown market-data rights and unknown financing are flagged; this is a research queue, not source qualification or a buy list. The full ranking stays the default.

## Independent frozen-universe measurement

The frozen input is one 2026-10-09 acquisition snapshot, SHA-256 `eb3b2e0fb9f01d11f310539bd170f132aff08033de634c9c63df9569758d41ce`. Raw export and backup remain ignored/private. The [production comparison](ALGORITHM_COMPARISON_2026_10_12_VS_PRODUCTION.json) reproduced saved 1.2.6 evaluations for **7,517/7,517** listings, then evaluated the new candidate on the same inputs. The [isolated 1.4 comparison](ALGORITHM_COMPARISON_2026_10_12_VS_1_4.json) used the preserved 1.4 evaluator on those same inputs; it isolates this wave from earlier unshipped fixes.

| Check | Result |
|---|---:|
| Listings retained / sorted | 7,517 / 7,517 |
| Numeric factor grades | 60,136 / 60,136 |
| Missing factor or final grades | 0 / 0 |
| Independent component reconstructions | 54,428 |
| Final scores changed vs live 1.2.6 | 2,325 (includes earlier 1.3/1.4 changes) |
| Final scores changed vs local 1.4 | 1,367, all decreases from catalyst credit removal |
| Other seven factor scores changed vs 1.4 | 0 |
| Positive catalyst factors vs live 1.2.6 → candidate | 1,369 → 0 |
| Top-100 overlap vs live 1.2.6 / vs 1.4 | 61 / 67 |
| Reviewed catalysts / source-eligible / thesis-qualified | 0 / 0 / 0 |

The candidate reduces unsupported catalyst credit and false coverage claims. This is a demonstrated **evidence-fidelity improvement**, not proof of better returns. A blind top-rank audit still found large-cap COST and JNJ and a financing-unknown microcap (CISS) among the top 20; those examples motivated a separate transparent research view rather than changes to fixed weights or hand-selected score exceptions. In the candidate's full top 100, 39 have saved market cap at least $5 billion, 16 have elevated/severe financing state, and 18 have unknown financing state.

The frozen-data research-filter waterfall is 5,283 current common listings, 4,050 within the cap range, 3,016 with observed liquidity, 1,816 with SEC/industrial operating evidence, 193 with positive valuation signal, and **156** after risk/conflict exclusions. Of those 156, saved financing states are 24 clean, 13 mild and 119 unknown. These counts describe the 2026-10-09 snapshot and are not a current verified watchlist. A strict market-rights-qualified queue would be empty on these records because rights status for saved market fields is unresolved. SEC's [Company Facts API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) supports issuer-level evidence retrieval, subject to [SEC fair-access guidance](https://www.sec.gov/about/developer-resources); the data supplier's [terms](https://data.nasdaq.com/terms) and [Nasdaq legal terms](https://www.nasdaq.com/legal) do not justify assuming product-use rights for every saved quote. The provisional view says so explicitly.

## Tests and delivery limit

The same-input comparison passed stored-baseline parity, fixed-weight arithmetic, complete ranking and source/evidence controls. Engine **260/260**, runtime **92/92**, research **21/21**, SQLite **4/4**, production build and root/UI tests **70/70**, typecheck, lint and `git diff --check` passed. Adversarial fixtures cover invalid reviewed events, financing review mismatch, missing-factor point-in-time retention, research filtering and archived coverage fields.

There are **zero usable mature six-month point-in-time outcomes** with then-listed/delisted membership, adjusted actions/dividends, availability-safe inputs and executable price observations. The comparison cannot establish higher realized returns or a high chance of 50% upside. These fields must stay null until a purged chronological and issuer-held-out outcome study is possible. Source acquisition, catalyst review, rights resolution and funding diligence remain work on the research side.

Production deployment is held: the latest read-only `/app/data` check showed **409,227,264** physical bytes free above a 256 MiB scanner reserve. A changed rubric can write/repair all 7,517 saved evaluations, and that headroom has not been proved safe for the migration. The consistent private off-host backup is preserved. A volume-capacity change may carry recurring cost and requires explicit authorization; no resize, live reevaluation or rollout was performed for this candidate. See [operations memory](OPERATIONS_MEMORY.md) before any release attempt.
