# Complete-universe rating model

Active rubric: `1.2.1-reproducible-opportunity-system`. This is the final mathematical research rating used for sorting and display. Source review completeness, confidence and tradability findings are separate diagnostics.

## Fixed factor weights and arithmetic

| Factor ID | Weight |
|---|---:|
| valuation | 25% |
| catalysts | 20% |
| financialStrength | 15% |
| earningsQuality | 12% |
| competitivePosition | 10% |
| downsideRisk | 10% |
| management | 5% |
| technicalTiming | 3% |

Every factor grade is bounded to 0–10 and normalized to two decimals. Its contribution is `grade × weight / 10`. The final grade is the sum, rounded to two decimals. Implementation uses integer hundredths: `round(sum(round(grade × 100) × weight) / 10) / 100`, preventing binary floating point errors at half cents. Contributions retain three-decimal precision internally. All production listings, including zero grades, are sorted by this saved final grade descending, then symbol ascending using SQLite BINARY ordering. There is no coverage-based reweighting or issuer-specific weight adjustment.

## Deterministic models

Valid reviewed dossier calculators take priority. Reviewed partial grades count their covered share exactly once. When a direct reviewed assessment is unavailable, fixed model components fill the factor. Missing components earn zero with the denominator unchanged; a missing fact remains missing in the factual snapshot. Scores are estimates of the requested investment dimensions, not invented fair values, confirmed future catalysts, durable moats, reviewed governance or predictions of returns.

| Factor | Fixed component shares of its 0–10 grade |
|---|---|
| Valuation | Normalized intrinsic scenarios 60%; sales multiple 25%; FCF yield 15% |
| Catalysts | Observed growth 50%; explicitly classified backlog/RPO with disclosed recognition in the research horizon 30%; dated earnings window 20% (only 2/10 component credit for timing, no assumed favorable result) |
| Financial strength | Cash/debt 40%; FCF margin 40%; cash runway 20% |
| Earnings quality | Profit margin 30%; FCF margin 40%; FCF/profit cash conversion 30% |
| Competitive position | Gross margin 30%; comparable SEC-SIC gross-margin percentile 20%; operating-margin direction 30%; observed growth 20% |
| Downside risk | Cash/debt 40%; dilution 30%; sourced financing finding 30% |
| Management | Dilution discipline 40%; sourced insider purchases 30%; sourced earnings outcome 30% |
| Technical timing | Price/30-week MA 40%; 52-week range position 30%; trailing return 30% |

Exact bounded bands and formulas live in `lib/opportunity-proxies.ts` and are persisted with input values, component shares, component grades, model IDs, evidence dates, rationale and source records. Cash/debt requires both observations: absent debt is never assumed zero. Sales multiples at zero/negative values receive no cheapness credit. Actual source conflicts withhold model points; absent qualitative reviews are reported as gaps without suppressing independent observed signals.

Revenue growth uses the latest four adjacent reported quarters versus the previous four when eight comparable same-unit quarters exist. Otherwise it uses the ratio of two adjacent reported annual revenue disclosures (same unit and periods 0.9–1.1 years apart). All leaf values and dates are saved in the trace. A direct annual ratio avoids runtime-dependent transcendental calculations. No future outcome is assumed. FCF yield can be reproduced from FCF/revenue/P-S when the three inputs are available; its component grade is bounded `FCF / revenue / P-S × 100`.

Observed inputs require finite numbers and usable dated HTTPS provenance available/retrieved by the snapshot cutoff. Financial periods must be at most 400 days old. Quote/trend observations must be at most 7 days old. Compound valuation ratios carry a fiscal period: their financial period and market availability are checked separately, with a fresh positive quote dependency. Original source rights metadata is preserved; a model does not certify rights or source-review completion. Model confidence is low, even when input coverage is high.

## Persistence and future behavior

Canonical grades are stored in `fundamental_snapshots.evaluation.opportunity` with deterministic `snapshotHash`, `evaluationHash`, rubric version/hash and all eight factor traces. `opportunity_rankings` persists the identical final grade/hash and whole-universe rank. Revision triggers in `opportunity_rating_versions` detect inserts, updates and deletes; `opportunity_rank_versions` records the materialized revision. Readers repair old/invalid evaluations in 100-row batches, then publish all ranks atomically. No scan is required to obtain the basic complete rating. Future scan writes use the same evaluator; the latest completed full run remains canonical while another scan runs or fails.

Radar, company profiles, favorites, reports and exports reuse canonical saved evaluations and ranks. Company profiles for universe members refresh through the scan acquisition pipeline, keeping their grade consistent with the ranking snapshot. Outside-universe research uses the same evaluator. Scored cards keep prices paired with their snapshot. Arabic UI shows two decimal final grades and numeric zero, defaults to complete rankings and exposes source/safety findings independently. A detailed source-review section cannot override the final factor grid.

The rating measures available observations at their stated snapshot dates. It does not establish a positive investment conclusion where evidence is missing, and it does not claim complete qualitative diligence. Existing dated source limitations remain visible.

## Opportunity thesis, publication and operations

Three compatible consecutive annual USD periods, a sourced industrial model, reviewed splits and one common listing in a complete selected universe support conditional intrinsic sensitivities. Owner cash flow subtracts capex and SBC. Fixed five-year bear/base/bull assumptions are cross-checked against normalized earnings; use the lower equity estimate. Senior claims, unlisted classes and fully diluted capitalization remain diligence gaps, so this does not claim an observed fair value or six-month price target. Integer-year discount factors use repeated multiplication, and currency outputs are rounded to cents before hashing.

Peer context uses at least five distinct issuer CIKs with the same SEC SIC, fiscal ends within 45 days, USD revenue/gross profit and revenue within 0.25–4 times. At most twenty peers are chosen by revenue distance. Sources and exact percentile traces are saved. These are industry comparisons, not verified direct competitors or moat findings.

Run/revision/rubric release tokens pin radar pages, profiles, reports and complete streamed exports. Database leases coordinate builders; conditional rank publication rejects concurrent raw mutation. Compact radar cards retain canonical scores and hashes. Historical source snapshots/evaluations are restored losslessly from compressed archives. The independent production scheduler resumes durable jobs, maintains history storage, shares a persistent SEC quota and uses issuer-verified compressed artifact caches. It may begin a refresh during compression when at least 512 MiB of reusable SQLite pages are available.

Probability remains null until a genuine point-in-time study, delisted outcomes, dividend/action coverage, executable entries, costs, purged chronological splits and issuer holdouts pass. Investment evidence and source rights are never certified by numerical completeness alone.

## Directory publication before acquisition

A full scan publishes an immutable `Directory ratings · full` release from the complete saved directory before waiting for SEC/history/filing acquisition. `directory-rating:<scanId>` is a durable bounded cursor; `<scanId>:ratings` owns the saved ratings and rank manifest. Observations are carried forward only across matching positive CIK and security type; original source dates remain unchanged while the evaluation cut advances. Missing CIKs/facts retain numeric conservative grades. Publication validates the entire listing count and materialized ranks before terminal partial status; partial describes evidence acquisition, not absent final grades. The previous release remains usable until publication finishes. Enrichment runs separately and eventually publishes a newer complete full universe. Default radar/profile selection prefers the full run with the latest terminal update (then creation time), so enrichment can supersede its later-created directory release; pagination/profile/report/export use one pinned release.
