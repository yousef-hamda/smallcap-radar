# Unified Opportunity scoring rubric

Status: methodology proposal; do not use as a production recommendation engine until the data and historical validation gates pass.

This rubric preserves the owner's weights exactly. Every factor is scored 0–10, where 10 is favorable. The output is a weighted diligence score, not a probability of profit, expected return, or guarantee. Investment horizon defaults to six months. Risk tolerance changes scenario language and risk warnings, not factor weights or historical facts.

## Scoring contract

The broad safety screen treats the quote, market capitalization, and 20-session median dollar volume as session-sensitive inputs. The price must be no older than three market weekdays; market capitalization and liquidity evidence use the same three-market-weekday limit. Stale values produce `UNKNOWN`/`needs research`, not a pass and not an exclusion. A valid current zero or below-floor liquidity value may fail the applicable safety screen.

The valuation assessment must use the same completed market session as the snapshot quote. Its reference price must reconcile within one cent or one basis point of the snapshot price, whichever is larger. A different trading date or larger discrepancy invalidates the valuation factor until both prices are reconciled. This prevents a fresh eligibility quote from being combined with a stale or differently adjusted fair-value calculation.

Technical timing requires separately sourced and dated daily, weekly, monthly, and benchmark series. Each provenance record must identify the final bar in its series; the weekly and monthly end dates must be within 14 and 45 calendar days, respectively, and the benchmark/daily close within three market weekdays. A valid stock-bar source cannot stand in for an unverified benchmark or separate timeframe feed.

1. Store raw observations, source URLs, filing accession/record IDs, fiscal period, publication time, retrieval time, currency, unit, and transformation for each material input.
2. Separate four cases: verified positive/negative evidence; verified absence after a documented search; conflicting evidence; and missing/unavailable evidence. Missing and conflicting data remain null and earn zero displayed points on the fixed denominator, with coverage reduced. A verified absence can inform a low factor score.
3. Never turn a press release's forecast, non-binding MOU, trial registration, analyst target, backlog, grant award, or market-size claim into realized revenue or a binding obligation.
4. If methods conflict, retain both and explain why one is primary; do not average away contradictions. Score only when the conflict is reconciled or explicitly bounded.
5. Every score needs a calculation or rubric path, its material inputs, source links, rationale, and a human-readable uncertainty note. A free-text rationale alone is insufficient evidence of a reproducible score.
6. Keep company facts on an as-of date. A correction/restatement must create a new version, not silently overwrite the original research snapshot.
7. Do not reward a story for being popular, a stock for being volatile, or a sector for rising. Evaluate company-specific evidence.

## Factor rubric

### 1. Price versus fair value — 25%

**Required work:** derive conservative, base, and optimistic per-share values using the fully diluted share count and unrestricted cash/debt. Identify an industry-appropriate primary method plus a genuinely independent cross-check. Reconcile dilution, leases/convertibles where material, non-operating assets, SBC, cyclicality, one-off earnings, and the valuation date. Explain the margin of safety at the dated completed-session price.

**Method selection:** profitable operating firms may use normalized DCF and peer/history multiples; asset-heavy or diversified firms may need sum-of-the-parts; banks/insurers need capital/earnings or book-value methods rather than industrial EV/EBITDA; pre-revenue biotech needs probability-adjusted asset scenarios and explicit binary-risk ranges; commodity cyclicals require through-cycle economics. P/E, EV/EBITDA, EV/Sales, P/FCF and PEG are contextual cross-checks, never interchangeable universal gates.

**Indicative score from base-case margin of safety** (base fair value / current price − 1), after method-quality review:

| Base margin of safety | Starting score |
|---|---:|
| Below −50% | 0 |
| −50% to below −25% | 1 |
| −25% to below 0% | 2 |
| 0% to below 10% | 3 |
| 10% to below 20% | 5 |
| 20% to below 30% | 7 |
| 30% to below 50% | 8 |
| 50% or more | 9 |

The current deterministic calculator requires at least two distinct, industry-suitable, dated methods and exactly one declared primary method; one method alone leaves valuation unscored. Each method carries a bounded arithmetic expression tree that the scorer recomputes from uniquely named dated assumptions and capitalization inputs; units and currency metadata must reconcile, and the primary method must match the base case. Conservative and optimistic cases also each require their own bounded, source-backed expression tree that recomputes to the stated per-share output. The scorer withholds the entire valuation factor when methods diverge by more than 50%, cases are misordered, any method/scenario expression is missing or inconsistent, required capitalization/normalization inputs are absent, quote data are over three market weekdays old, model/capitalization evidence is over 400 days old, cash/restricted cash/debt/leases do not share a balance date, or the diluted-share date is more than 90 days from that balance date. It caps at 4 when conservative value is below price. Recomputing the per-share bridge does not certify the economic reasonableness or independence of upstream forecasts, assumptions, or peer research. A 10 is currently unreachable: the formula tops out at 9 and requires base-case margin of safety of at least 50%. This deliberately conservative implementation must be calibrated and tested before any score-band changes. Do not infer a floor from cash without checking restricted/customer cash, debt, burn, and senior claims. The implemented trace contract is Opportunity spec `0.5.0-recomputed-scenario-valuations`, rubric `fair-value-v3`; its regression tests pass, but it is not connected to complete live valuation inputs.

### 2. Growth catalysts during the selected horizon — 20%

Build a dated event ledger: event, issuer/source, binding status, counterparty, conditions, expected timing, affected revenue/cash flow, probability evidence, prior market disclosure, and failure modes. Label each as realized revenue, binding contract/order, funded but conditional award, regulatory milestone, operational milestone, customer expansion, guidance, non-binding agreement, or unverified claim. Label backlog separately from orders and revenue.

Score the best-supported *portfolio of company-specific catalysts*, not the count of headlines:

| Score | Evidence standard |
|---:|---|
| 0–1 | No identified near-horizon catalyst after a documented search, or the expected event materially damages the thesis. |
| 2–3 | Timing or funding is speculative; evidence is mostly non-binding, repeatedly delayed, or already fully reflected in results. |
| 4–5 | A dated, plausible execution event exists but commercial conversion, customer demand, or financing remains uncertain. |
| 6–7 | A primary-source milestone is funded or contractually supported, has a credible path to revenue/cash flow in the horizon, and has observable progress criteria. |
| 8–9 | Multiple independent, material catalysts are near-term, evidence of execution is strong, and the market has not already priced the full benefit. |
| 10 | Reserved for unusually strong, independently corroborated catalysts with measurable conversion and limited unresolved conditions; requires a written pricing-in and probability case. |

Do not assign a positive catalyst score from sector momentum alone. An absent calendar date or unknown announcement status is null/needs research, not zero. The implemented calculator requires a completed dated search and differentiates an empty searched calendar (score 1) from missing search (unscored). For each valid in-horizon event, it combines certainty (40%), materiality (30%), timing (20%), and market pricing-in (10%), averages event scores with a square-root breadth divisor, and applies explicit ceilings of 3 for non-binding items, 1 for unverified items, and 5 for guidance. Binding status, progress, conditions, source dates, horizon fit, and percentage-of-TTM-revenue materiality are retained in its calculation trace. It does not yet extract real catalysts from issuer filings or score them automatically.

### 3. Financial strength and liquidity — 15%

Assess unrestricted cash, debt principal and maturities, interest cost, covenant headroom, operating cash burn, 12–24-month cash needs, working-capital quality, restricted/customer cash, and funding alternatives. Use ratios appropriate to the business. Score survival capacity and ability to fund the stated plan; do not treat a financing ability as operating revenue.

| Score | General interpretation |
|---:|---|
| 0–1 | Going-concern, covenant, near-term maturity, or cash-runway failure is evidenced with no credible remedy. |
| 2–3 | Likely financing need within 12 months, weak liquidity, or debt service depends on optimistic assumptions. |
| 4–5 | Financeable but constrained; runway, maturities, working capital, or refinancing introduce material risk. |
| 6–7 | Adequate liquidity for the base plan; maturities and debt service appear manageable under moderate stress. |
| 8–9 | Strong net liquidity, durable cash generation, ample maturity headroom, and resilience under a documented downside case. |
| 10 | Exceptional balance-sheet resilience across company-specific stress tests with no material hidden senior claims. |

For banks and insurers, use regulatory capital, asset quality/reserves, liquidity, and liability maturity rather than industrial cash-runway shortcuts. Unknown covenants or restricted cash cap the score and lower confidence. The current industrial-company calculator uses sourced unrestricted cash/negative TTM FCF runway (40%), operating-income/interest coverage (30%), and cash/debt-due-within-24-months coverage (30%). It assumes no undrawn facility, requires six dated values with consistent units and periods no older than 400 days, and refuses unsupported industries. Covenant stress tests, restricted-cash reconciliation, and sector-specific models are not yet implemented.

### 4. Earnings and cash-flow quality — 12%

Review the latest eight comparable quarters and at least three fiscal years when available. Align fiscal periods; distinguish annual, year-to-date, and standalone quarters. Review revenue growth and organic/acquisition/currency effects; gross/operating/net margins; GAAP-to-non-GAAP bridges; operating cash flow, capex, FCF; receivables/inventory; SBC; impairments, asset sales, tax benefits, and other one-offs. Compare prior guidance with actual outcomes.

| Score | General interpretation |
|---:|---|
| 0–1 | Persistent cash losses or deteriorating economics are concealed by adjustments, receivables, capitalized costs, or one-offs. |
| 2–3 | Earnings/cash conversion is weak, volatile, or materially below management's adjusted presentation. |
| 4–5 | Mixed but explainable trends; cash conversion, margins, or dilution need continued monitoring. |
| 6–7 | Repeatable operating performance with reasonable cash conversion and transparent reconciliations. |
| 8–9 | Durable organic growth, improving margins, strong cash conversion, disciplined reinvestment, and credible guidance history. |
| 10 | Exceptional multi-year through-cycle quality with minimal accounting judgment risk and independently verified execution. |

Missing quarters, incompatible tags/periods, or an unreconciled GAAP/non-GAAP bridge make the factor incomplete; do not extrapolate one quarter as a trend. The implemented calculator now requires two separate dated, source-backed analyst assessments: the GAAP/non-GAAP adjustment bridge and one-off items. Their actual 0–10 judgments are averaged into the 15% accounting-transparency subscore; the old “reviewed=true means 10/10” shortcut has been removed. Qualitative judgment caps this factor's confidence at medium. `lib/sec-opportunity.ts` reconstructs standalone quarters from same-tag/same-currency YTD facts and uses later amendments, but returns no score-ready series when periods or required assessments are missing. It does not parse custom tags or analyze filing footnotes.

### 5. Competitive position and business quality — 10%

Identify the actual product, buyer, use case, monetization, geography, maturity, customer and supplier concentration, substitution threats, switching costs, IP/regulatory barriers, capacity constraints, and closest three to five comparable competitors where defensible. Distinguish independently sourced market facts from management TAM claims. Do not invent market share.

Score only when the product-market and comparison set are evidenced. A strong position needs observable retention/repeat purchase, durable economics, differentiated capability, or a hard-to-replicate distribution/certification/data/IP advantage. A fashionable category or large stated TAM earns no points by itself. If the business model or peer set cannot be established, leave this factor uncovered.

### 6. Risks and downside protection — 10%

Review dilution instruments and worst-case share count; liquidity/solvency stress; customer/geographic/vendor concentration; cyclicality; litigation/regulatory and accounting-control disclosures; auditor changes; going-concern language; short interest (official position data only); lock-ups/Form 144; and plausible bear-case value loss. Separate issuer-verified facts from allegations and short-seller claims. Consider downside *and* mitigants.

Higher score means lower, better-understood downside risk. Unresolved binary risks or severe permanent-capital-loss paths reduce the score. Missing risk searches do not imply a clean record. Any unreviewed financing instrument, going-concern disclosure, material restatement/control weakness, or imminent senior claim prevents a high score until explained. The implemented calculator requires dated sourced review for eight domains: dilution, financing, customer concentration, legal/regulatory, accounting/auditor, short interest, insider overhang, and operations/supply chain. It withholds the factor for missing/unavailable review or contradictory findings. Each sourced finding records 1–5 severity, 0–1 probability, permanence, and a mitigated fraction. Penalty is ten times the sum of each domain’s weighted, capped residual exposure; score is `10 − penalty`, floored at zero. The weights and mitigation judgments are a deterministic diagnostic policy, not empirically calibrated probabilities. The review/finding schema exists, but source searches are not yet populated automatically.

### 7. Management, governance, and alignment — 5%

Review executive tenure/execution, capital allocation, guidance accuracy, compensation, related parties, board independence, voting structure, ownership changes, and insider Form 4 transactions. Count only code-P open-market purchases as discretionary open-market buying; separate awards, vesting, option exercises, tax withholding, gifts, 10b5-1 sales, and Form 144 notices. Compare buy size with existing ownership and compensation.

An absence of insider buying is not automatically negative. Score clarity, execution, shareholder alignment, controls, and candid disclosure together. Missing proxy/ownership evidence means uncovered; one insider transaction is not a proxy for governance quality.

The implemented management review requires sourced 0–10 analyst judgments for execution record, capital allocation, governance/controls, shareholder alignment, and insider evidence, averaged equally. Competitive-position review similarly averages five source-backed judgments: product differentiation, customer evidence, switching advantage, competitive durability, and substitution risk. Both calculators always label these values as analyst judgments and cap their confidence at medium. They are review templates; no automated assessment is currently generated from issuer documents.

### 8. Chart and entry timing — 3%

Use split-adjusted completed bars and show the exact last completed close and observation time. Review daily/weekly/monthly trend, 20/50/100/200-day averages when enough history exists, weekly 30-period average where applicable, volume, gaps, relative strength against a named benchmark, and explicitly method-derived support/resistance. Intraday frames are shown only for near-term entry work.

Score setup quality, not company quality: 0–2 for broken trend/poor reward-risk; 3–4 for weak or extended entry; 5 for mixed/neutral; 6–7 for improving relative strength and a defined invalidation level; 8–9 for confirmed trend/volume with attractive risk/reward; 10 is rare and requires independent confirmation. No indicator predicts a certain reversal. Insufficient history or incorrect corporate-action adjustment means null.

The implemented technical calculator uses completed split-adjusted history only and requires at least 200 daily, 30 weekly, 12 monthly, and 64 benchmark-aligned daily bars. Its score is 30% daily price versus 20/50/100/200-day averages, 20% weekly price/30-week-average trend, 10% 3-month price direction, 15% RSI(14) band, and 25% 63-session excess return versus the supplied benchmark. It checks freshness and records raw indicators. It does not yet evaluate support/resistance, volume confirmation, gaps, intraday entry, or stop/target reward-risk; do not treat it as a complete chart analysis.

## Decision and scenario rules

- The displayed score is `sum(score × weight / 10)` and never rescales missing factors. Coverage is the total evidenced factor weight. Report both.
- Ranking requires valid common-security identity; positive sourced market cap; recent dated completed price; researched 20-session median dollar volume above the disclosed operational floor; dated evidence and a score for **all eight factors**; exactly 100% evidence coverage; and no unresolved material source conflict. This was tightened in spec v0.2.0 after review: a complete-looking ranking may not omit competition, management, or chart timing.
- Passing the ranking threshold only permits ordering within Opportunity Radar. It does not create a Buy recommendation. A separate action decision needs the user's horizon/risk/holdings, fair-value margin of safety, scenario downside, and a point-in-time validation gate.
- The final 100-point score is not an expected-return metric. A proposed action label must have its own tested decision rules and a clear `insufficient evidence` state.
- One-, three-, six-, and twelve-month bear/base/bull scenarios must state probability assumptions, price ranges, catalysts, failure events, and source dates. Probabilities must be clearly identified as analyst estimates and must sum to 100% per horizon; never derive them mechanically from the 100-point score.
- Until a complete point-in-time backtest includes delisted firms, historical filings as known on each date, corporate actions, transaction costs, and a locked holdout, scores remain diagnostic and no win rate or probability of success is shown.

## Automation boundary

SEC XBRL and market bars can automate numeric inputs when periods, units, share classes, and corporate actions reconcile. Catalyst materiality, peer comparability, moat durability, management quality, and legal significance require structured source review and conservative extraction. The app must mark unautomated or low-confidence work as incomplete. It must not fill a score just to populate a card. Isolated tested calculators now exist for fair value, industrial financial strength, catalysts, earnings quality, and downside risk; none is supplied from live scan/dossier data. This distinction is necessary for a reliable single category; it also explains why replacing the tabs before the dossier and provider gates pass would create a polished but unsupported ranking.
