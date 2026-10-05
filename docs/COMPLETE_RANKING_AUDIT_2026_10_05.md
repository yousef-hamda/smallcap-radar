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
