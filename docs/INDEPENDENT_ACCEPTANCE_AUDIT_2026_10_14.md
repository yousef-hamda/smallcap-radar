# Independent acceptance audit — 2026-10-14

## Scope and source boundary

This audit rechecked the October 13 rating and stock-view candidate against the user's original requests and the repository handoff, project memory, operations memory, scoring plan, implementation report and frozen same-input replays. It separates source-code acceptance from the live Railway release. The eight factor weights remain **25/20/15/12/10/10/5/3**.

## Findings and corrections

| Request | Verified behavior and correction |
|---|---|
| Find relevant small-cap stocks first | The full canonical sort had unrelated large caps such as COST and JNJ near the top. The initial Opportunity view now uses the explicitly provisional operating-company research queue (size, observed liquidity, issuer-linked SEC revenue, positive valuation signal, known financing risk). The complete ranking and original rank numbers remain one click away; export remains complete. Missing data can exclude a promising company, so the queue is labeled as research prioritization. |
| Make the rating evidence-based | An exchange directory count of one listed common symbol was incorrectly treated as proof of a single economic common equity class and complete market capitalization. DLO's [2025 SEC 20-F](https://www.sec.gov/Archives/edgar/data/1846832/000207097926000113/dlo-20251231.htm) demonstrates why this inference fails: it reports both Class A and Class B common shares. Modeled intrinsic valuation now requires a dated, identity-checked SEC equity-capitalization review with one supported class, total shares and a matching observed price/capitalization share count. Basic independently evidenced valuation inputs remain available. |
| Keep the outside of cards simple and current | Cards retain identity, original rank, score, last completed-session close/date/change and a short research cue. The visible quote overlay now refreshes while the Opportunity page stays open, without changing the rated snapshot. Quote and intraday chart overlays use bounded process-local caches instead of repeatedly writing short-lived data to the nearly full SQLite volume. |
| Open the entire card and order the stock file | The whole card opens its file by pointer and keyboard; favorite and copy controls remain independent. The file starts with the daily chart, then a sourced company explanation, followed by score and detailed research. If the intraday provider lags the already observed completed close, the chart uses a dated close-based fallback and labels the stale intraday response. |
| Avoid the earlier blank-page/storage failure | The signed-in wallet render-crash hotfix and page error boundary were already live before this audit. Today's public home, ranking status and anonymous portfolio endpoints returned HTTP 200. Railway is still below the scanner's physical reserve; the scheduler now stops archival writes below that reserve and waits 30 seconds between paused ticks instead of writing every two seconds. |

## Same-input scoring result

The isolated [1.5.1-to-1.5.2 replay](ALGORITHM_COMPARISON_2026_10_14_EQUITY_CAP_VS_PRIOR.json) used the identical frozen 7,517-listing input. It retained all 7,517 ranks and **60,136 numeric factor grades** with zero missing scores. Only eight final scores fell, all in the valuation factor; the top-20 overlap is 19/20 and the top-100 overlap is 98/100. CISS fell from 43.00 (rank 2) to 28.00 (rank 421) because its previously high intrinsic grade depended on unreviewed equity capitalization. HRB remained first, 43.43 to 43.33. The prior candidate exposed 322 intrinsic scenarios on this input; none has the new reviewed capitalization evidence, so all intrinsic scenarios are withheld until that source review is acquired. This is an error correction, **not measured predictive improvement**.

The [comparison against 1.5](ALGORITHM_COMPARISON_2026_10_14_EQUITY_CAP_VS_1_5.json) includes the preceding share-ratio and valuation changes. It must not be used to attribute all changes to the new capitalization gate.

## Remaining acceptance limits

The historical replay tests deterministic grades and rank behavior. It does not show higher future returns: there is no valid point-in-time outcome set, no reviewed future catalysts, no thesis-qualified investment candidates, and market-data redistribution rights remain unresolved. A score around 40 can still rank first because uncovered factors receive no invented credit. A complete economic-share review acquisition or manual review workflow is required to restore modeled intrinsic valuations for supported issuers.

Production still runs rubric **1.2.6**. A read-only October 14 Railway check showed **263,610,368 bytes free** on the 5 GB application volume, below the **268,435,456-byte** scanner reserve. The current stage-10 scan is paused and the 1.5.2 saved-row migration would write thousands of evaluations. No production database, deployment, scan, subscription or volume setting was changed in this audit. The existing private off-host backup is preserved; safe headroom and a fresh verified backup are required before rollout.

## Verification

The final local gates passed: 264 engine tests, 95 runtime tests, 21 research tests, 73 build/root/UI tests, TypeScript, ESLint, production build, scheduler syntax and whitespace. A 390 px browser had no horizontal overflow, console errors or warnings. Desktop/mobile interactions opened the whole card by pointer and keyboard; star and copy did not open the file. The file started with the daily chart and sourced company explanation. Anonymous live browser navigation across Opportunity, wallet and favorites did not reproduce a blank page. A signed-in production session was unavailable for this audit; its earlier populated-wallet fix was verified separately against a private database copy before deployment.
