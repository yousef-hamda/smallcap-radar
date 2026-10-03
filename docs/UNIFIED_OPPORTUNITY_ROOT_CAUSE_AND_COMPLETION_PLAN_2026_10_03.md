# Unified Opportunity: root-cause study and completion plan — 2026-10-03

## Goal

Produce one defensible, consistently weighted Opportunity rating for every listed common stock in the scan universe, with a visible score trace, stable ordering, dated source links, missing-data explanations, and a separately visible confidence/completeness level. The fixed weights remain 25 / 20 / 15 / 12 / 10 / 10 / 5 / 3 for fair value, catalysts, financial strength, earnings quality, competitive position, downside risk, management, and technical timing. Missing evidence must never be converted to zero, a negative fact, or an optimistic default.

“All data” is not a finite promise: filings and company sites do not disclose every requested item, data providers have different coverage, and some diligence is judgment rather than a downloadable field. The engineering target is to request every applicable primary-source record, retain its identity/date/source, extract reproducible facts, record completed/empty/failed searches distinctly, and leave genuinely undisclosed or unreviewable claims unknown. A rating is valid only for its stated data cut and audience entitlement.

## Root cause established

1. Production finished its 6,954-security run with zero complete ranks. This was not an ordering defect: price, capitalization, and 20-session dollar liquidity were UNKNOWN for the full universe under the verified-rights evaluator; security identity was UNKNOWN for 697 rows and failed for 983; the remaining material-factor dossiers were also incomplete.
2. The scoring functions exist, but the scan does not construct the complete eight-factor inputs. SEC facts provide standardized reported data, not a reviewed valuation, catalyst-price-in assessment, litigation/accounting risk review, peer moat analysis, or governance judgment.
3. A code/library/API's availability is not permission for Railway to store and show its upstream market data. Yahoo, Nasdaq, Massive personal plans, and several free API tiers have no verified reuse grant for this shared hosted result. “Reachable” is therefore not “rankable.”
4. The full scan had an implementation defect independent of licensing: stage 10 fetched each symbol's history but persisted only a few scalar indicators; stage 11 then built technical diligence from a snapshot with no bars and no SPY benchmark. The timing factor consequently had no usable technical series even to diagnose. This turn repairs that data path: stage 10 caches SPY once per day; stage 11 reuses ticker and benchmark histories, derives timing evidence, then drops the large raw arrays from the per-company snapshot while retaining score, provenance, sample counts, and missing reasons. Rights remain UNKNOWN unless a valid grant is configured.
5. Partial profile enrichment is not equivalent to universe enrichment. A profile may call extra APIs and expose narratives, but the durable scan row and ranking endpoint must have the same dated research payload before its score can be trusted.
6. Existing short scan of recent 8-K item numbers is a discovery aid only. Form type/item-number presence does not prove a binding contract, financial materiality, incremental revenue, catalyst timing, or whether a market expectation has already priced it in.

## Per-stock data contract

Every source observation must have a CIK/security/ticker identity check, canonical HTTPS source URL, provider name, retrieval timestamp, fact period/date, units/currency, amendment/filing context, and explicit reuse classification. Derived values record formula and all dependencies. Each requested evidence domain ends in one of: `complete`, `partial`, `empty-reviewed`, `unavailable`, `not-applicable`, `conflict`, or `not-reviewed`; these are not interchangeable. Historical snapshots are point-in-time: later filings, quotes, events, or corrections cannot flow backward into an earlier score.

### Factor acquisition matrix

| Factor / fixed weight | Required acquisition and calculation | Primary sources | Automatic scoring gate / known gap |
|---|---|---|---|
| Fair value / 25% | Current entitled close and timestamp; fully diluted shares and equivalents; unrestricted cash; all debt; revenue/EBITDA/FCF/equity earnings as appropriate; at least two genuinely suitable independent methods; bear/base/bull ranges and method spread. Exclude customer/restricted cash and normalize one-offs only with sourced bridges. | SEC 10-K/Q, 20-F/6-K, 8-K, S-1/S-3, company IR financials; licensed quote feed. Peer multiples only from similarly dated evidence. | Existing calculator checks the sourced model and exact quote/session linkage. Automated facts do not create growth forecasts or choose a justified multiple by themselves. No market-cap/price entitlement means no current intrinsic-value comparison.
| Catalysts / 20% | Search dated filings, IR releases, contracts, orders/backlog, regulatory calendars, trial results, capacity milestones and earnings dates. Capture binding/nonbinding status, amount, conditions, duration, timing, likely revenue contribution, reliability, prior announcement status, and evidence the event is or is not already reflected in price. | Full SEC filings and exhibits; issuer IR; regulator/government award databases; FDA/clinical-trial databases where relevant; authoritative customer/partner confirmation. | Current 8-K index/item scanner is discovery only. Each event requires body/exhibit retrieval and structured classification; headlines alone cannot score. A truly reviewed empty window differs from failed/unsearched sources.
| Financial strength / 15% | At least 3 annual years and 8 quarters when available: unrestricted cash, restricted/customer funds, current and long debt, debt maturities, interest, covenants, cash burn/runway, working capital, receivables, inventory, financing facilities, covenant stress. Use business-model-specific math. | SEC Company Facts plus original filing tables/notes; IR debt exhibits. Standard XBRL tags are incomplete for custom taxonomies and maturity schedules. | Current input builder supports selected industrial operating issuers. It must not use that solvency model for banks, insurers, REITs, SPACs, pre-revenue biotech or other mismatched models. These need explicit tailored factor calculators.
| Earnings quality / 12% | Last 8 standalone quarters and 3 annual periods; revenue growth, margins, GAAP net/operating earnings, EPS, OCF, capex/FCF, SBC, cash conversion, working capital, recurring vs one-off bridge, GAAP/non-GAAP adjustments, audit/control status. | SEC facts and filing text, 10-K/Q reconciliation tables, auditor opinion, IR earnings release/transcript. | Existing calculator refuses to assert one-off/non-GAAP review without explicit sourced review. Company-defined adjusted metrics must not replace GAAP series.
| Competitive position / 10% | Five independent dimensions: product differentiation, customer/contract evidence, switching advantage, durability, substitution/AI/price risk. Identify competitors (3–5), relative growth/margins/cash/debt/valuation/share, customer/supplier concentration, IP and market structure. | SEC risk/business sections, patent/public procurement databases, company/customer primary evidence, competitor filings, credible industry/regulator sources. | Existing rubric expects analyst judgment and five dated source-backed assessments. Industry growth alone or generated prose cannot fill it. Sector-specific peer groups and missing-peer treatment need an explicit method.
| Downside risk / 10% | Review dilution/ATM/shelf/warrants/convertibles/lockups/Form 144; financing/refinancing; legal/regulatory; audit/accounting; customer concentration; short interest; insider overhang; operations/supply chain; bankruptcy/covenant risks. Quantify severity, probability, persistence, mitigation; maintain issue and search histories. | SEC filings, court/regulator dockets, FINRA official short-interest sets, issuer/auditor statements, primary government notices. | Existing model requires reviewed coverage per area. “No hit” only counts after the correct source and date window were queried successfully. Short sale volume is not short interest.
| Management/governance / 5% | Executive/board history, audit changes, restatements, guidance hit rate, capital allocation, related parties, voting structure, compensation/SBC, insider ownership/transactions. Form 4 transactions require code/P open-market purchase and separation of gifts, awards, vesting, tax withholding, options and 10b5-1 sales. | SEC 10-K/proxy/DEF 14A, Forms 3/4/5, 13D/G, 144, 8-K, company governance pages. | Existing qualitative rubric requires sourced judgment; no manager-quality inference from one buy or analyst prose. Automated transaction extraction can be deterministic; governance conclusion must show its trace.
| Technical timing / 3% | At least 200 completed split-adjusted daily observations, 30 weekly, 12 monthly, at least 64 benchmark observations; 20/50/100/200-day MAs, 30-week MA, RSI, aligned 63-session relative strength, gaps/volume, support/resistance with method and date. | Market-data source with appropriate feed rights, explicit corporate-action method, SPY/sector benchmark history. | History-loss and missing-SPY scan defects fixed in this turn. Current Yahoo/Cboe/Nasdaq feed entitlement is still UNKNOWN; no score can be promoted until source rights, freshness, split handling and aligned history all pass.

## Free and scalable source study

### SEC EDGAR

Company Facts/Submissions are the principal no-key primary dataset and include nightly bulk ZIP archives. Facts are real-time and cover standard taxonomy/entity-wide concepts; custom taxonomy tags are outside Company Facts, so original filings remain necessary. Use `companyfacts.zip`/`submissions.zip` for universe initialization, then targeted per-CIK APIs and filing documents for changes. Honor the SEC's fair-access policy and configured contact User-Agent. Store accession number, filed/accepted time, form, period, tag, unit, frame/context, amendment, and URL. Never call 404 “company has no financials” without issuer identity and coverage classification.

### Market prices: newly found grouped endpoint

Massive's official catalog includes a free Stocks Basic grouped-daily request returning all U.S. stocks' daily OHLCV in one call. This is a meaningful bulk-enumeration path the previous audit had not recorded. However its free Market Data Terms grant personal noncommercial use, bar server/site copying, and bar distributing data or derived analytical work to another user. That conflicts with the shared Railway cache/application even if the account is owner-operated. The API endpoint is technically attractive but not production-authorized. Obtain a written entitlement covering persistent server cache, analytics/derived ratings, display, audience, region, delay, and refresh, or choose a genuinely owner-local architecture that the provider confirms in writing. A request's $0 price does not satisfy these rights.

The Massive catalog lists full market snapshot endpoints as select-plan features. Do not infer the free grouped *daily* endpoint is a free consolidated live snapshot. A historical all-universe backfill by date is technically much more efficient than 6,954 per-symbol calls, but time, retention, corporate actions, quota and permitted use still need to be validated before launch.

### Other providers / open source / MCP

Alpaca IEX-only free market data is not consolidated volume; Twelve Data's free tier is internal non-display; Alpha Vantage free quotas do not refresh this universe and real-time licensing is distinct; Yahoo/Cboe/Nasdaq endpoint access does not itself authorize this reuse. FINRA official datasets can add specifically scoped short-interest fields but do not supply a market-wide OHLCV feed. Open-source adapters, GitHub licenses and MCP servers license software/orchestration, not upstream observations. No discovered zero-cost, bulk market source was verified to grant the hosted app the required rights.

The connected Financial Datasets MCP was directly tested for AAPL price, facts, historical prices, SEC filings, and management KPI guidance. Calls failed because the connected account balance is `$0.00` (the price tool reports no credits; additional endpoints return Unauthorized); no market or filing payload was returned, so it was not used as evidence. The vendor's [current pricing](https://www.financial-datasets.ai/pricing) says $20 for 1,000 pay-as-you-go requests, $200/month for Build/100,000 requests, and $2,000/month for Scale/1,000,000 requests plus end-user redistribution rights. Its [terms](https://www.financialdatasets.ai/terms-of-use) allow data/derived analysis for internal and business use on plans but allow underlying-data redistribution only on a plan that expressly includes it. This offers a potential consolidated integration and has much larger request capacity, but cannot be turned on without funding and a plan that explicitly covers product redistribution. It is not free, and availability of the MCP does not grant credits.

### Non-market open primary datasets

SEC filings and issuer IR are the base. Add data only after source-specific coverage/terms tests: FRED for macro series (not issuer financials), FINRA for the exact short-interest dataset, FDA/ClinicalTrials.gov for applicable biotech events, federal procurement/award sources for applicable contracts, USPTO for patent evidence, court and agency dockets for legal/regulatory risks, and official exchange directories for security classification. A crawler's successful HTTP response is not a reviewed negative result; each source gets an acquisition status, identity match, expected update cadence, legal/use review, and bounded retry behavior.

## Score design and ordering requirements

1. Keep the eight published weights invariant at every level; no sector-specific hidden reweighting.
2. Publish score contribution and source trace per factor. Score is not a probability of return and does not promise outperformance.
3. Separate **hard eligibility** (listed common equity, current source-authorized price/capitalization/liquidity, no disqualifying security/risk state) from **merit ranking**. A high merit score never overrides a hard failure.
4. A final “ranked” state requires the configured completeness contract, not just a positive partial score. Missing evidence remains UNKNOWN. Display `needs research` separately and do not intermix it with the qualified ranking.
5. If the product later offers an exploratory partial-score list, label it as provisional and show factor coverage, lower/upper bounds, and uncertainty prominently; never call that final Opportunity ranking. Rank ties deterministically by score, confidence, coverage, then ticker/CIK; preserve the unrounded score for tie sorting.
6. Freeze a point-in-time data cut, provider/source IDs, weights/spec version, formulas and inputs before computing. Recompute when a source is corrected; retain previous run for audit.
7. Risk tolerance and investment horizon are explicit run parameters. Where a single public list is required, set and display the default horizon and risk profile; do not compare differing horizons as if identical.

## Completion waves and required gates

### Wave 0 — provenance + observability

- Persist the source registry and rights state by provider, feed, dataset, endpoint, account tier, intended app audience and allowed storage/use; fail closed on unknown terms.
- Add API report counts per source/domain: expected, attempted, identity-matched, retrieved, stale, empty-reviewed, conflict, failed, retryable, and withheld for rights.
- Add one endpoint/report export with a ticker-level reason for every unranked record and weighted factor explanation.
- Test: synthetic source status matrix; future data rejection; rights gate; real deployed scan-report comparison and an end-to-end no-leak test for API keys/raw data.

### Wave 1 — broad universe and official financial acquisition

- Replace per-issuer repeated SEC Company Facts requests where appropriate with nightly bulk ZIP sync; targeted refresh on accession changes; keep company-specific fallback for custom tags.
- Build a tag coverage registry with issuer-model support, GAAP/IFRS aliases, quarterly YTD-to-standalone bridges, dates, units, currency, amendments and filing links.
- Parse source tables/notes for debt maturities, restrictions, customers, shares/convertibles, SBC and auditor/control flags only with row/table context and source spans.
- Test: representative industrial, foreign IFRS, bank, insurance, REIT, biotech/pre-revenue, SPAC, recent IPO, delisted/restated filer; expected raw filing values and no future leakage.

### Wave 2 — market-data entitlement + daily history

- Select a documented deployment-appropriate provider contract (or owner-local license-compatible architecture) for daily price, market cap/share count, dollar volume, corporate actions and benchmark. Request written answers on storage, derivation, display/user audience, delay and export.
- For the tested Massive grouped endpoint, prototype only inside a private entitlement-consistent environment; validate adjustment behavior, date omissions, ticker identity, splits, delisted records and full-universe completeness. Do not send it into shared production under personal-only terms.
- Replace unknown-as-valid shortcuts with feed/account-specific provenance and automated entitlement configuration; obtain confirmation before setting a rights state.
- Test: all-ticker date snapshots vs per-symbol independent source across 100 varied equities; split/ADR/symbol changes; suspended/delisted/no-trade symbols; 20-day median dollar value; benchmark alignment; market holidays; stale/future and corrected bars.

### Wave 3 — valuation and forecast assumptions

- Implement method-selection rules by issuer model; require two independent suitable models and diluted equity bridge; estimate scenarios from observable historical and consensus-free public assumptions. Every forecast assumption has a source or is explicitly a model assumption with sensitivity.
- Distinguish quote/feed values, SEC reported facts, management guidance, analyst consensus, and system estimates. Do not use analyst target mean as intrinsic fair value.
- Test arithmetic/property cases, unprofitable and negative FCF companies, banks/insurers/REITs, dilution/warrants/convertibles, restricted cash, stale quotes, contradictory share counts, model spread and source failure.

### Wave 4 — catalysts, management and risks

- Retrieve the actual primary filing/exhibit text for bounded windows and extract event facts, then classify binding status/conditions/revenue contribution/timing; keep source excerpt and reviewer/automation method.
- Expand Form 4/13D/G/144/DEF14A, court/regulator, FINRA and business-model-appropriate event collection with exact coverage windows.
- Either add auditable deterministic assessments with calibrated evidence, or keep named dimensions human-review-required. Do not use generated text as proof of a moat, management quality, “no litigation,” or catalyst pricing-in.
- Test contract-vs-MOU, backlog-vs-orders-vs-revenue, conditional grant-vs-disbursed award, customer-vs-partner, P-vs-A/M/F insider codes, 10b5-1/withholding, no-event-vs-search-failure, legal source outage, and already-priced/old-news scenarios.

### Wave 5 — model validity and ranking behavior

- Build survivorship-bias-aware point-in-time universe/history with delisted and failed issuers; avoid historical data published after the historical score date. Test repeated ticker/CIK and multiple share classes.
- Evaluate rank stability, factor calibration, drawdowns, forward-return buckets for 1/3/6/12 months, turnover, transaction-cost sensitivity, sector/regime splits and out-of-time/firm holdouts. Compare fixed weights to simple baselines without changing the user’s specified production weights.
- Publish discriminative quality: score distribution, coverage distribution, rank turnover and failure rates. A backtest is evidence of historical behavior, not proof of future returns.
- Test repeatability/hash, sort order, score tie precision, deterministic missingness, conflict suppression, PWA state, API schema and mobile view.

### Wave 6 — deployment and operations

- Stage bulk provider loads, bounded concurrency and resumable checkpoints; avoid one request per profile; use idempotency, backpressure, request budgets, circuit breakers and provider-specific TTLs.
- Use background jobs to run daily prices after session completion and issuer filings when SEC submissions change; keep macro/peer/source caches at appropriate cadence; schedule quarterly full audits. Recovery after Railway restart must resume exactly and never mark partial work complete.
- Deploy a canary; run production scan; verify the new run reaches final stage, nonzero domain coverage, correct blockers and valid ranking. Re-open failing rows, fix root cause and rerun before describing the deployment as complete.

## Implemented in this turn

- Stage 10 now caches the SPY benchmark once per day and stage 11 loads each ticker's staged historical response plus that benchmark into the technical-research builder.
- The durable scan stores derived timing score, indicator evidence, provenance, bar counts and missing/rights reasons; it strips raw daily arrays from each per-stock snapshot to keep D1 payloads bounded.
- The dossier adapter now preserves the compact technical result through evaluation. The rights gate still blocks an actual technical score while rights are UNKNOWN.
- Added regression coverage asserting the compact technical result remains unscored for unknown feed rights without losing acquired stock/benchmark coverage.
- A second empty-score root was found in report and browser fallbacks: when a saved evaluation was absent or had an old rubric hash, those callers evaluated an empty evidence set rather than rebuilding from the snapshot's persisted dossier. `currentOpportunityEvaluation` now reuses only current-hash scores and otherwise reevaluates the saved dossier. The radar cards, profile fallback, export, and both scan-report paths use the shared helper; a regression proves a stale evaluation retains a fully evidenced dossier score.
- A real on-demand production profile for symbol A retrieved 3 annual/8 quarterly SEC periods and 1,307 daily, 271 weekly, 63 monthly, and 1,307 benchmark bars. It showed 13.08 weighted evidenced points with 16.2% coverage, while price, cap, and liquidity checks were UNKNOWN and valuation/catalyst/competitive/downside/management evidence remained absent or incomplete. This confirms reachable data and a computable subtotal are not the complete investment rating the user requested.
- The production full scan `9c059528-f468-4086-8c1e-927456f8599a` reached stage 11 after completing stage 10 for 6,954 rows. At the last check it was still running at issuer offset 64/5,921; do not claim full-scan acceptance. Stage 11 is resumable and can be continued via the background-scan endpoint.
- This fixes a real technical research data-path defect; it does **not** resolve market-data licensing, missing price/cap/liquidity eligibility, the unbuilt five research domains, or zero final ranks.

## Release acceptance checklist

- [ ] Current date/time, price session and source rights are explicit for every ranked row.
- [ ] SEC and market data acquisition coverage reports reconcile with universe counts; no missing source is disguised as zero.
- [ ] Eight factor score traces sum exactly to fixed weights and each factor has independent coverage/confidence.
- [ ] Dossier includes price/share/debt model bridges, catalyst contract status, risk-search status, peers and management evidence.
- [ ] Security, price, cap, liquidity, source-conflict, freshness and point-in-time gates pass.
- [ ] Sorting is stable, deterministic, tested against unequal/incomplete fixtures and user-visible API output.
- [ ] Historical validation passes predefined data-integrity, holdout and robustness criteria.
- [ ] Mobile/PWA and account persistence pass cross-device end-to-end checks.
- [ ] Railway full scan completes; live report confirms the expected ranked rows and no source/rights regressions.

## Current status and remaining hard dependency

The code no longer loses market-history inputs before timing research, and stale/missing stored evaluations now preserve available dossier evidence in reports and UI fallbacks. Local tests pass. The product still cannot honestly produce the requested full, source-backed, ranked list from its current shared deployment: the free market-data candidate found at universe scale is personal-use-only and bars shared server/derived-result distribution, while the SEC-based dossiers for catalyst, valuation, risks, competition and management are not complete. The latest production full scan is still unfinished in stage 11 at issuer 64/5,921. The next waves must accelerate/complete durable SEC acquisition, acquire an appropriate market-data entitlement, and build/validate remaining domain adapters. Changing `rightsStatus`, lowering completeness, assigning neutral scores, or inferring analyst judgment from filing counts would fabricate eligibility rather than fix acquisition.
