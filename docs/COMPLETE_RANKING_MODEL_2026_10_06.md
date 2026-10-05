# Complete-universe rating model

Active rubric: `1.0.3-deterministic-universe-ranking`. This is the final mathematical research rating used for sorting and display. Source review completeness, confidence and tradability findings are separate diagnostics.

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

Every factor grade is bounded to 0–10 and normalized to two decimals. Its contribution is `grade × weight / 10`. The final grade is the sum, rounded to two decimals. Implementation uses integer hundredths: `round(sum(round(grade × 100) × weight) / 10) / 100`, preventing binary floating point errors at half cents. Contributions retain three-decimal precision internally. All 6,954 listings, including zero grades, are sorted by this saved final grade descending, then symbol ascending using SQLite BINARY ordering. There is no coverage-based reweighting or issuer-specific weight adjustment.

## Deterministic models

Valid reviewed dossier calculators take priority. Reviewed partial grades count their covered share exactly once. When a direct reviewed assessment is unavailable, fixed model components fill the factor. Missing components earn zero with the denominator unchanged; a missing fact remains missing in the factual snapshot. Scores are estimates of the requested investment dimensions, not invented fair values, confirmed future catalysts, durable moats, reviewed governance or predictions of returns.

| Factor | Fixed component shares of its 0–10 grade |
|---|---|
| Valuation | Sales multiple 70%; FCF yield 20%; observed growth with a positive pricing anchor 10% |
| Catalysts | Observed growth 50%; disclosed backlog/revenue 30%; dated earnings window 20% (only 2/10 component credit for timing, no assumed favorable result) |
| Financial strength | Cash/debt 40%; FCF margin 40%; cash runway 20% |
| Earnings quality | Profit margin 30%; FCF margin 40%; FCF/profit cash conversion 30% |
| Competitive position | Gross margin 50%; operating-margin direction 30%; observed growth 20% |
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
