# Complete production ranking: diagnosis and acceptance contract

Written before implementation on 2026-10-05. Supersedes historical instructions requiring fully sourced dossiers before a listing may appear in the ranking.

## Wave 1: observed failure

Production is Railway `small-cap` / production / `smallcap-radar`, deployment `4f6dde22-51b5-46c5-b45a-7651b5afbc9e`, repository commit `79a0851`. Persistent data is the Miniflare SQLite D1 database on `/app/data/state`; PostgreSQL is unused. The chosen completed full run is `9c059528-f468-4086-8c1e-927456f8599a`. Two newer failed scans must not replace it.

Every one of its 6,954 payloads and saved evaluations was read from the production database. All have eight numeric factor values and rubric hash `4d293553`; 6,772 have positive scores. States are 0 ranked, 5,971 research, 983 excluded. Listing types: common 5,274; ADR 315; unit 296; warrant 374; right 107; unknown 382; preferred 129; fund 66; debt 11. No listing type may vanish from the new scored universe.

| Factor | Numeric stored | Source evidenced | Source complete | Positive |
|---|---:|---:|---:|---:|
| Valuation | 6954 | 4515 | 0 | 4515 |
| Catalysts | 6954 | 2875 | 0 | 2696 |
| Financial strength | 6954 | 1756 | 0 | 1543 |
| Earnings quality | 6954 | 913 | 0 | 911 |
| Competitive position | 6954 | 0 | 0 | 2367 |
| Downside risk | 6954 | 1575 | 511 | 5380 |
| Management | 6954 | 0 | 0 | 5243 |
| Technical timing | 6954 | 0 | 0 | 5328 |

The evaluator conflates rank availability with dossier completeness and tradability. `rankingEligible` requires every factor's source coverage to be 100%, cleared market-data provenance, identity and liquidity checks. `readState` filters on that state, eliminating every numeric grade from the default radar endpoint. The frontend starts in research, repeats this filter, hides zero grades, and labels positive grades temporary. Report counts use the same incorrect state gate. Partial sourced factors display a 0–10 score but multiply its contribution by coverage, so the displayed grades do not obey the requested formula. Several model components start with positive base scores even if most inputs are missing; coverage denominators count fields rather than model dimensions.

Saved evaluation validity is checked primarily by rubric hash; current-run hash can bypass row validity checks. Older runs are rescored on read, but historical report branches use stale stored state/counts before recalculation. `/api/company` independently enriches and evaluates a different snapshot, so its score can disagree with the radar's saved grade. Radar also overlays fresher cached quotes without updating the saved evaluation. Stale-path and SQL sorting use different secondary keys. No rank position is exposed as a common API contract.

Scanner persistence calls `insertSnapshot`; all later writes must use the complete evaluator. Stale records must be repaired independently of initiating a scan. The existing production universe contains price/range values broadly, SEC revenue on 4,666 rows, net income on 5,577, cash on 5,606, debt on 1,488 and FCF on 3,452. Missing or conflicted facts must remain explicit; no model may assert that a missing debt value means zero debt or that an earnings date proves positive impact.

Source review: [SEC public data API](https://data.sec.gov/) and [SEC data resources](https://www.sec.gov/data-research/sec-data-resources) support the existing factual acquisition; source availability is separate from a model rating. [SQLite JSON functions](https://www.sqlite.org/json1.html) and [SELECT ordering](https://www.sqlite.org/lang_select.html) support persisted mathematical validation and deterministic ordering. Additional libraries cannot resolve the state/filter disagreement: it is an application contract defect.

## Wave 2: required contract

1. Each stored listing has exactly the eight fixed IDs with weights 25/20/15/12/10/10/5/3, numeric grades in [0,10], and a numeric final grade in [0,100].
2. Each factor's points equal `grade * weight / 10` (exact to three decimals for two-decimal grades and integer weights); final score is their sum rounded to two decimals. Partial source coverage reduces a reviewed partial grade once; it never secretly changes the fixed factor weight.
3. Fully reviewed valid assessments take priority. Otherwise bounded deterministic model components use observed inputs; missing, invalid, stale, future, malformed or conflicted inputs earn zero for their component. Every fallback has a persisted calculation trace and rationale. Coverage/confidence describe evidence, not rank eligibility.
4. Every listing is ranked, including zero scores and safety failures. Research and eligibility findings are separate diagnostic fields. No source, exchange, issuer or security type filters the complete rating output.
5. Saved evaluations have current rubric and deterministic evaluation hashes. Read-time repair applies to every row and every requested run, with bounded database batches and no scan prerequisite.
6. All ranking paths order by saved final score descending and symbol ascending for ties. Rank position is computed over the complete run before pagination/search filtering.
7. Radar, company profile, scan report and export reuse the same canonical saved snapshot/evaluation. Company enrichment for listings outside the production universe is evaluated with the same formula.
8. Default UI shows complete final rankings, numeric zero grades, two decimal grade precision, actual ranks and evidence disclosure. It never labels the mathematical final grade temporary.
9. Verify all 6,954 production records against the evaluator, stored arithmetic, radar pages, report pages, profile responses, stable repeated reads and rank positions; verify a real browser at mobile and desktop sizes and after reload.
10. Run engine, runtime/API, repository/UI, research, database, typecheck, lint, build and whitespace gates; commit, push, deploy, check deployment identity and production persistence after restart. Record exact outcomes, counts, files and operational limitations.

The score is a deterministic research rating, not a return probability or a claim of complete qualitative diligence. A low score caused by missing evidence is explicitly traceable to missing components. This distinction must coexist with a complete usable ranking.

## Waves 3–5: implementation and resolved defects

The ranking policy now represents complete mathematical grades separately from source research and safety (`researchState`, `sourceEligible`, factor source coverage, confidence and checks). Fixed factor weights never change. Bounded deterministic component models fill missing assessments, with missing inputs earning zero rather than a positive prior. Valid reviewed partial grades are scaled once, so every displayed grade produces its displayed contribution using the fixed weight. Exact integer arithmetic resolves the 50 half-cent mismatches found in the first production replay.

Canonical saved evaluations and materialized whole-universe ranks now drive the radar, profiles, reports, favorites and exports. Revision triggers detect all snapshot mutations; a version/shape/identity repair processes 100 rows per batch and publishes ranks atomically. The first read repairs old data independently of initiating a scan. Ranking readers share the latest completed full run, retain zero scores and all nine security types, and use saved score descending/symbol BINARY ascending for ties. UI displays the actual final grade to two decimals, including zero, and uses global ranks across pagination/search.

A complete factor audit caught an always-zero valuation factor despite supported P/S values. Compound ratio provenance contains a fiscal period plus market availability; checking that fiscal date as a quote date incorrectly rejected all inputs. Both dependencies are now validated independently. Supported FCF yield is calculated from cash flow, revenue and P/S; growth is calculated from comparable saved reported revenue periods, with leaf inputs and sources persisted. A later cross-runtime deep comparison caught exponentiation differences of two last-decimal bits in annual growth, which changed evaluation hashes despite equal grades. Adjacent annual growth now uses direct division. A profile research section that incorrectly said the technical factor weight was omitted now points to the final factor grid.

State caches are bounded by serialized bytes as well as entry count. Summary/source-coverage caches last until their run revision changes. Saved evaluations are reused before rebuilding dossiers. These changes avoid repeatedly retaining full 335+ MB historical payloads while traversing thousands of company responses. Full model details are in [the current scoring contract](COMPLETE_RANKING_MODEL_2026_10_06.md).

### Local and CI test outcomes

| Command/check | Final result |
|---|---|
| `npm run test:runtime` (includes `test:engine`) | 171 engine + 69 runtime/API tests passed |
| `npm run test:engine` after exact annual-growth regression | 171 passed |
| `npm test` (includes verified build) | Build passed; 48 repository/UI tests passed |
| `npm run test:research` | 5 passed; no learned weights enabled |
| `python3 -m unittest discover -s tests -p '*test*.py'` | 4 database tests passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed, no errors/warnings after ignoring local verification artifacts |
| `git diff --check` | Passed |
| `verify-complete-ranking.mjs` on all original production payloads | 6,954 complete deterministic ratings; no missing factors/finals |
| GitHub Verify radar for deployed code `db67314` | Run `37377375798`, success (Node 24 / Linux) |

Meaningful acceptance coverage includes all nine stock types, 256 missing-factor combinations per type, empty/partial/malformed data, stale/future/invalid provenance, actual conflicts versus absent qualitative review, fixed weights, exact half-cent rounding, saved-corruption repair, materialization revision triggers, search ranks, API/report/profile parity, pagination, reloads, scan completion, favorites and Arabic rendering. Runtime integration checks a 260-listing universe on every surface. Production verification below uses every real listing rather than a sample.

Earlier failed checks were resolved: lint variable declarations, malformed historical research arrays, old state-policy assertions, exact arithmetic expectations, the valuation date defect, and cross-runtime growth hashes. First deployment-transition reads returned 502 while the container was replaced and were repeated after successful deployment. The initial GitHub runs for `0324cb1`/`138be63` could not acquire a hosted runner and executed no tests; later code runs `dc23569`, `1c30427`, `998f79a`, `1ea52cd` and `db67314` succeeded. Old verification attempts interrupted by a replacement deployment are superseded by final full-universe checks.
