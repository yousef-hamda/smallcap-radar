# Rating and stock-view correction — 2026-10-13

## Finding

The live 1.2.6 release displayed DLO first of 7,518 at 52.13/100 on its October 12 snapshot. Its eight factor points add correctly. The number is an absolute evidence-weighted research grade, whereas the rank is relative to the saved universe. A first-place rank therefore does not imply a score close to 100 or a validated 50% return. The underlying coverage is limited: on the frozen October 9 universe, the prior 1.5 candidate's mean weighted model-input coverage was 25.17%; no reviewed material catalysts, source-eligible investment cases or thesis-qualified cases were present.

The study found a substantive source-identity error. In 1,208 of 7,517 frozen records, `splitAdjusted` was true while the saved share-ratio source still explicitly said corporate actions were unverified. The flag represented adjusted *price history* in some paths, but valuation, downside, management and older Core/Bounce ratings also used it as proof of reviewed *share dilution*. In 883 of these cases, the SEC share interval began before the scanner's fixed 550-day market-history request. A price chart cannot verify dilution. DLO also has two common share classes in its [2025 SEC 20-F](https://www.sec.gov/Archives/edgar/data/1846832/000207097926000113/dlo-20251231.htm), so a single listed symbol cannot establish its full economic share count.

## Correction

- A single `hasVerifiedShareRatio` check now requires a consistent numeric share ratio/dilution, the matching SEC reported-share interval, a genuine Yahoo split-event response for that interval and dated source lineage. The opportunity valuation and dilution components, financing classification, financial-integrity diagnostics and legacy Core/Bounce credit all use it. An old true flag with raw/unreviewed provenance no longer grants credit. Adverse observed financing signals still survive when a clean finding cannot be established.
- The scanner requests additional Yahoo history only when the saved SEC share interval needs it, with a bounded 1,100-day ceiling. It preserves the original split-event coverage date while retaining only the recent chart bars in the SQLite cache. Unsupported older intervals remain unknown. On-demand research also repairs stale true/raw rows when the full response covers the interval.
- The modeled valuation subgrade now rises continuously through the bear-case break-even boundary and requires meaningful modeled base upside before bear protection can lift a nearly flat opportunity. The eight factor percentages remain **25/20/15/12/10/10/5/3**. An isolated replay rejected a first formula that would have promoted low-upside names too aggressively; the adopted formula has boundary and monotonic tests.
- The card shows rank, an explicitly evidence-weighted score, last completed session close/date/change when the bounded quote endpoint provides them, and a separate saved-snapshot date. Its whole surface opens the file by pointer or keyboard; copy and favorite remain separate buttons. The file opens on the daily chart, then the company explanation, then score and other research. Missing Yahoo descriptions now fall back to the observed Nasdaq company-profile endpoint. For saved ranked companies this description is returned as a separate display-only, dated value; the archived rating snapshot and hash stay unchanged.

## Same-input full-universe result

The [production comparison](ALGORITHM_COMPARISON_2026_10_13_VS_PRODUCTION.json) reproduces all 7,517 saved 1.2.6 evaluations exactly before evaluating the candidate on identical October 9 inputs (SHA-256 `eb3b2e0fb9f01d11f310539bd170f132aff08033de634c9c63df9569758d41ce`). The [isolated 1.5 comparison](ALGORITHM_COMPARISON_2026_10_13_VS_1_5.json) separates this wave from the preceding candidate. Both are deterministic input replays, not investment backtests.

| Audit | Result |
|---|---:|
| Listings retained and sorted | 7,517 / 7,517 |
| Numeric factor grades, missing grades | 60,136 / 60,136; 0 missing |
| Independent conflict-free component reconstructions | 54,428 |
| Changed final scores vs 1.5 candidate | 470: 5 higher, 465 lower |
| Changed final scores vs live 1.2.6 | 2,532, including prior unshipped improvements |
| Top-20 / top-100 overlap vs 1.5 | 18 / 92 |
| Top-20 / top-100 overlap vs 1.2.6 | 5 / 57 |
| Mean weighted model-input coverage | 24.62% |
| Reviewed catalysts / source-eligible / thesis-qualified | 0 / 0 / 0 |

Of the 470 changes relative to 1.5, 463 downside and 463 management factor grades fell after unsupported dilution/financing credit was withheld. Eight valuation grades changed at the bear boundary. On these frozen inputs DLO changes from 46.48, rank 1 under 1.5, to 42.15, rank 3. HRB becomes rank 1 at 43.43 and CISS rank 2 at 43.00. Against saved 1.2.6 on the *same older frozen snapshot*, DLO is 56.46→42.15; the separate October 12 live 52.13 was a later acquisition snapshot and must not be used as a same-input comparison. DLO's intrinsic estimate remains unavailable because its economic share classes and sustained positive owner cash flow are not established. No score was raised merely to satisfy an expected number.

The full ranking still contains large companies and financing-unknown names because it is the complete canonical list. The existing clearly labeled provisional research view applies the user's operating-company, size, liquidity, SEC revenue, valuation and known-risk filters while keeping original scores and ranks. It remains a research queue. A genuinely better six-month return rate cannot be measured without a survivorship-safe point-in-time outcome set including delisted names, corporate actions, actual entry prices and mature horizons; the product's return probability and six-month target remain null.

## Verification and rollout

Local gates passed: 263 engine tests, 93 runtime tests, 21 research tests, 4 SQLite tests, 72 build/root/UI tests, TypeScript, ESLint and whitespace check. Browser verification on the local seeded DLO file confirmed the whole card opens, favorite remains independent, the daily chart precedes the sourced Arabic Nasdaq business explanation, and the last completed session appears on the card. The local `/api/company?symbol=DLO` returned the separate description without changing the saved score.

The latest read-only Railway check on October 13 found **266,846,208 bytes free** on `/app/data`, below the scanner's 256 MiB reserve of 268,435,456 bytes. A 7,517-row changed-rubric reevaluation cannot be safely started at this capacity. The existing private off-host backup is preserved. No production rubric migration, scan, paid volume change or deployment was performed; production still displays 1.2.6 until capacity and rollout are resolved. The source branch and draft PR carry the tested implementation for review.
