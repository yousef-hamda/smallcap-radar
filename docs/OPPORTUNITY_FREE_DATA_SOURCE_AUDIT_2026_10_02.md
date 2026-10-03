# Free data-source audit for unified Opportunity — 2026-10-02

## Decision

No candidate verified in this review provides, on a free plan, all of the following together: broad US listing coverage, sufficiently consolidated prices/history/volume for the rating's safety and technical calculations, documented display/reuse rights for this Railway-hosted app, and an API quota suitable for refreshing a 6,954-company universe. Do not set `rightsStatus` to `licensed` or `redistribution-permitted` merely because an endpoint is reachable or the project is owner-operated.

This is a source-terms and product-capability audit, not legal advice. A provider may grant a different right in an account-specific contract. Such a contract must be represented explicitly before using that provider's evidence.

## Candidate review

| Source | Free capability documented by first party | Limitation for this product | Decision |
|---|---|---|---|
| SEC EDGAR APIs | No key; filer submissions, standard-taxonomy Company Facts and Frames; real-time filing updates; maximum 10 requests/second fair access. | Not price/OHLCV market data; standard fact APIs exclude issuer custom taxonomies and may omit material line items. It supports a large part of reported financial history, not all eight-factor research. | Continue as the primary free fundamental source, with missing and custom-tag facts left unknown. |
| Alpaca Basic | Free US stocks/ETFs; history since 2016; API up to 200 calls/min; the free real-time equities feed is IEX only. | IEX is one venue, so prices/volume are not consolidated-market measures. Customer agreement says market data may not be reproduced, distributed, sold, or commercially exploited without written consent. Hosted app rights are not established. | Do not use for the universal safety gate or represent volume as consolidated. Possible private-use trial requires written clarification of account/app display rights and acceptance of IEX limitations. |
| Massive / Polygon Stocks Basic | Free plan advertises end-of-day data, two years' history, and reference data. | Basic is a trial/individual-use product; the provider's public page reserves display/redistribution rights for a Business plan and says anything customers can see requires those rights. Request quota and universe scale must also be validated. | Not an eligible public-app feed on the free plan. |
| Twelve Data Basic | Free plan advertises real-time US equities, reference data and 800 daily API credits. | Free plan is labeled “internal non-display”; terms restrict free-tier commercial use and permit external display/redistribution only when explicitly authorized by tier/add-on or separate written agreement. | Not an eligible external-display source under the documented free tier. |
| Alpha Vantage | Free API tier exists; default quote updates end of day. | Realtime/15-minute delayed and intraday access requires a personal premium plan; business/commercial use is routed to sales. Its policy warns that free-looking US real-time feeds may be unlicensed or have very low venue coverage. Free daily quotas cannot refresh the whole universe. | Not a free, universal production source for this app. A private personal paid entitlement still would not authorize commercial/external display by itself. |
| Yahoo Finance endpoints | Existing best-effort chart/history adapter works for many tickers without an API key. | No first-party permission establishing this hosted app's automated retrieval, durable caching, or external reuse was verified. Scraping libraries such as `yfinance` do not create upstream rights. | Continue only as unverified source for non-ranked/display-only uses; its market evidence cannot pass the verified-rights evaluator. |
| Nasdaq / Cboe endpoints | Public pages, directories and historical endpoints exist; they are useful for discovery and data diagnostics. | Public accessibility does not establish a blanket right to redistribute. Exchange products and licensing documents include paid/contractual routes; no applicable free public-display entitlement for this deployment was found. | Do not infer permission from no-key access. |
| FINRA short-interest data | Public regulatory data is available for defined datasets. | Coverage/meaning and terms are dataset-specific; official short-interest is not a complete set of company/legal/operating risks, and API terms are not a universal free redistribution grant. | Keep within applicable terms; no blanket “short interest reviewed” state from absence of records. |

## MCP servers and open-source pipelines

An MCP server or permissively licensed GitHub repository grants rights to its software code, not necessarily to the upstream financial datasets it queries. None of the candidates below independently clears the product's source-rights test.

| Candidate | What it adds | Why it does not remove the blocker |
|---|---|---|
| [Equibles open-source MCP](https://github.com/daniel3303/Equibles) / [hosted service](https://equibles.com/) | Self-hostable SEC/FINRA/FRED/CBOE and other primary-source tools; the hosted free tier is advertised at 100 requests/day. | The self-hosted software's license does not grant market-data rights. The described market-price functions need their own source/terms audit; 100 hosted calls/day cannot refresh a 6,954-row broad universe. Most filing data overlaps the existing SEC pipeline. |
| [Ticker Scout MCP](https://github.com/tickerscout/tickerscout-mcp) | No-key SEC-derived statements, report summaries, and filing event histories; it explicitly does not provide prices. | Could be a financial-statement assembly fallback, but it cannot supply quote, market-cap, consolidated volume or chart evidence required by hard gates and factor calculations. Coverage and hosted service reuse conditions need confirmation before bulk integration. |
| [Public-Filings-Screener](https://github.com/eduardgci/Public-Filings-Screener) | Open-source pipeline combines SEC XBRL with yfinance and Stooq to produce a numbers-only screen and data-quality outputs. | A code license is not Yahoo/Stooq data authorization. Its narrower fundamental score is not equivalent to the required eight-factor assessment, and its own README says it does not produce an investment thesis. |
| [yfinance MCP wrapper](https://github.com/making/yfinance-server) and [other Yahoo-based servers](https://github.com/Niels-8/isofinancial-mcp) | Convenient multi-symbol quote/history/profile tools that wrap Yahoo or other scraped endpoints. | An MCP wrapper changes the interface, not upstream licensing, consolidated-feed coverage, or provider reliability. It is not an eligible route for this Railway site's redisplayed prices without affirmative provider rights. |
| [FinData MCP](https://github.com/sapph1re/findata-mcp) | Live-data tool using pay-per-call micropayments. | Not free; it requires payment infrastructure and its license/coverage would still require evaluation. |

The research search found no MCP-provided free path that supplies both the missing qualitative diligence and a rights-cleared, scalable market feed. MCP is an orchestration protocol, not a data license or a source of independently reviewed company judgments.

## Rating consequences

The current evaluator intentionally fails closed. Price, market cap, and 20-session dollar-volume evidence need fresh, source-valid inputs; technical timing requires split-adjusted price history and a separately sourced benchmark. The price source is consequently a blocking input even when company fundamentals exist.

The other zero-rank causes are independent of market-data licensing. The code has deterministic calculators for the factor rubric, but the broad scan does not produce sourced score-ready assessments for fair value, catalyst quality/pricing-in, eight-domain downside review, peer-backed competitive position, or management/governance. Financial strength and earnings quality can also be partial. The system cannot create those judgments by changing missing values to zero, treating an SEC filing index as a catalyst score, or copying provider analyst targets into intrinsic value.

At the production check on 2026-10-02, the selected run contained 6,954 rows; zero met the complete eight-factor plus safety-evidence contract. The report showed 6,954 unknown market-cap, price and liquidity checks; 697 unknown security classifications; 983 security failures; and 7 unresolved source conflicts. These counts explain the zero; they do not establish that no good businesses exist.

## Next work that does not misstate evidence

1. Keep SEC and official exchange/company sources on their documented free-use paths; improve standard/custom XBRL tag recovery and company-specific filing extraction.
2. Continue the staged D1 evaluation backfill so the current evaluator and blocker counts persist across Railway restarts.
3. For broad market gates, either obtain an explicit appropriate license/plan or limit a source to the documented private use, dataset coverage, and account rights. An owner-only app still needs provider permission for server-side caching/display and a consolidated feed for volume/benchmark calculations.
4. Add reviewed dossier acquisition for the five not-yet-live scoring factors and specialized business models. Keep each score trace, source, date, formula, confidence, and unresolved issue.
5. Backtest complete point-in-time dossiers with delisted securities and frozen source dates before describing the ranking as validated or predictive.

## Primary documentation

- [SEC Developer Resources](https://www.sec.gov/about/developer-resources) and [EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [Alpaca Basic coverage and plans](https://docs.alpaca.markets/us/v1.1/docs/about-market-data-api) and [customer market-data restriction](https://files.alpaca.markets/disclosures/library/AcctAppMarginAndCustAgmt.pdf)
- [Massive / Polygon Stocks pricing and display rights](https://massive.com/stocks) and [market-data terms](https://polygon.io/terms/market_data_terms.pdf)
- [Twelve Data individual pricing](https://twelvedata.com/pricing) and [terms](https://twelvedata.com/terms)
- [Alpha Vantage API documentation](https://www.alphavantage.co/documentation/) and [US market-data policy](https://www.alphavantage.co/realtime_data_policy/)
- [Nasdaq Basic](https://www.nasdaq.com/products/data/equities/nasdaq-basic) and [Cboe market-data document library](https://www.cboe.com/market_data_services/document_library/)
- Open-source candidates: [Equibles](https://github.com/daniel3303/Equibles), [Ticker Scout](https://github.com/tickerscout/tickerscout-mcp), [Public-Filings-Screener](https://github.com/eduardgci/Public-Filings-Screener), [yfinance-server](https://github.com/making/yfinance-server), [FinData MCP](https://github.com/sapph1re/findata-mcp)

## Live verification — 2026-10-02

- One direct request from the development host to Apple's SEC Company Facts endpoint returned HTTP 200 using the configured contact-bearing User-Agent.
- Railway has `SEC_USER_AGENT` configured with the user's supplied email. Production `/api/company?symbol=AAPL` retrieved 3 annual and 8 quarterly Company Facts periods and also returned 60 bounded filing-index rows (provider status `partial`). The previously reported SEC HTTP 403 was not reproduced for this issuer at this time. This does not prove all CIKs are accessible; a missing issuer record yielded HTTP 404 in the full run.
- The live AAPL profile used Yahoo chart history and Nasdaq quote-summary market capitalization, but both market-source records had rights absent/unknown. These numbers therefore remain ineligible for the evaluator's price, market-cap, liquidity, and technical evidence gates. The on-demand profile scored financial strength and earnings quality only partially, and did not contain a score-ready valuation, catalyst classification, downside-risk review, peer analysis, or governance review.
- Active production run `e55c6893-3a2d-4239-ad6b-6d10c86877ac` was still at history stage 10 during review; do not substitute its interim state for the final stage-13 report.

## Supplemental provider review — 2026-10-03

A follow-up review checked two additional potentially relevant no-cost routes:

| Source | Newly verified capability/terms | Why it does not complete this system |
|---|---|---|
| [Market Data Free Forever](https://www.marketdata.app/docs/account/plans/free-forever/) | Official current docs advertise 100 API credits/day, at-least-24-hour delayed prices, standard pricing endpoints, and one year of history. Their docs explicitly permit a personal dashboard/tool only when the owner alone accesses it; their terms prohibit redistribution without a commercial addendum. | A 6,954-symbol full refresh would take at least 70 days at one credit per symbol, before retries or endpoint costs, so it cannot support a fresh full-universe price/cap/liquidity/technical screen. The deployed application currently allows accounts/visitors beyond one private owner, and its stored server-side universe is not the documented owner-only browser dashboard. Its personal license cannot be applied to the present deployment as-is. A separate owner-only/browser-direct design would still be capacity-limited and requires the subscriber to satisfy the provider's non-professional eligibility terms. No integration or rights status change is authorized by mere discovery.
| [FINRA Query API Equity datasets](https://developer.finra.org/catalog) | FINRA documents a public-credential path and dataset-specific Equity terms that permit no-charge redistribution and derivative results for end-users' non-commercial personal/professional use subject to FINRA attribution and end-user restrictions. The Consolidated Short Interest dataset is described specifically as OTC short-interest submissions; Reg SHO is short-sale volume, not short interest. | This can contribute a properly attributed, separately labeled short-interest/OTC-risk field after registration, schema/coverage/date validation, and terms implementation. It is not an all-listed-equity quote, market-cap, or daily OHLCV feed, and daily short-sale volume must never be substituted for official short interest. It does not unblock the universal safety gates or complete factors.

Primary sources: [Market Data free-plan limits](https://www.marketdata.app/docs/account/free-forever/), [Market Data personal dashboard/API use](https://www.marketdata.app/docs/api/cors/), [Market Data terms, personal-use/redistribution clauses](https://www.marketdata.app/terms/), [FINRA dataset catalog](https://developer.finra.org/catalog), [FINRA Public credentials](https://developer.finra.org/fees/public), [FINRA Equity-specific terms](https://developer.finra.org/specific-terms-equity-data), and [FINRA API Terms of Service (March 2026)](https://developer.finra.org/sites/default/files/2026-03/FINRA%20-%20API%20Terms%20of%20Service%20%2803-2026%29.pdf).

Conclusion is unchanged: no newly identified source delivers the free, fresh, universe-scale and deployment-compatible market evidence required here. The 2026-10-02 production run remains the final verified state: 0 complete ranks out of 6,954. Preserve UNKNOWN and provisional labels until both the market-data path and all eight factor dossiers satisfy the source and completeness contract.

## Newly verified bulk market endpoint — 2026-10-03

The official Massive stocks endpoint catalog confirms that `GET /v2/aggs/grouped/locale/us/market/stocks/{date}` returns daily OHLCV for all U.S. stocks in one request and is listed under the free Stocks Basic plan. This corrects the earlier assumption that every market-data call must be per ticker. It materially improves *technical feasibility*: daily current-universe bars can be acquired with a very small request count, and a historical backfill can be performed by date rather than issuing one request per symbol.

It does **not** clear the live product's reuse gate. Massive's Market Data Terms limit the individual grant to the subscriber's own personal, non-business use; prohibit copying the data to another server/site; prohibit transfer to third parties; and prohibit distributing derived charts, analytics, research, or other derived works. Railway stores a shared universe and the current application can serve more than one user. Therefore the grouped endpoint must remain unconfigured for that deployment unless an applicable written entitlement authorizes server storage, derivation, display, and access by the actual audience. The $0 request price is not a data redistribution license.

The endpoint can be evaluated in a private, local-only experiment with a subscriber's own key, subject to the account's actual terms. That experiment must never promote those results into the shared Railway cache or hosted ranking. The Massive API catalog also lists full-market snapshot endpoints as select-plan features, so the grouped daily endpoint must not be confused with a free real-time consolidated full-market snapshot.

Primary documentation: [Grouped daily endpoint catalog](https://massive.com/docs/rest/stocks/overview), [Massive Stocks plans](https://massive.com/stocks), [Market Data Terms](https://massive.com/legal/market-data-terms-of-service).
