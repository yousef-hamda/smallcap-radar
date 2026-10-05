# Historical research checkpoint

Ranking eligibility and zero-ranking completion statements below are superseded by [the current complete-universe contract](COMPLETE_RANKING_MODEL_2026_10_06.md) and [production verification](COMPLETE_RANKING_AUDIT_2026_10_05.md). Rubric `1.0.3-deterministic-universe-ranking` gives every listing eight numeric grades and the actual final fixed-weight rating used for sorting. Source coverage and safety remain separate findings; their gaps cannot remove a listing from the mathematical ranking. Historical source-rights and research limitations remain applicable where not explicitly resolved.

---

# Free stock profile coverage and recovery plan

## Objective

The company profile must attempt every recoverable field independently, retain successful fields when another provider fails, and show a dated source for every value that reaches the UI. “Always fetch all data” cannot mean that every issuer has every metric: a company may not disclose backlog, analyst targets, insider purchases, or a standard XBRL concept. The correct contract is:

1. Attempt the field against every applicable free source.
2. Use a second independent source when the primary source is unavailable.
3. Derive a value only from compatible, dated observations.
4. Keep the value missing when the issuer did not disclose it.
5. Preserve the reason and source in the audit view instead of fabricating a zero.

## Source decision

| Field family | Primary | Free fallback | Runtime policy |
|---|---|---|---|
| Identity, CIK, ticker, exchange | Nasdaq Trader directory + SEC ticker directory | Bundled dated directory | The bundled directory keeps search and scans usable during an outage. |
| Price and daily history | Yahoo chart API (`query1`) | Yahoo chart (`query2`), Cboe delayed history, Nasdaq historical API, bundled history | Yahoo history is split aware. Cboe is independent, no key, and delayed. Nasdaq history is the later fallback because its endpoint is less consistent. |
| Current quote and market cap | Nasdaq screener/summary + Yahoo bulk quote | Company Facts shares × price for market cap; Cboe quote is available for future quote fallback | A current price is accepted only with a provider timestamp. A dated bundled value is marked low confidence. |
| Revenue, net income, cash, debt, shares, cash flow | SEC Company Facts and SEC Frames | Bundled SEC Frames / Company Facts cache | Standard US-GAAP and IFRS concepts only. Missing concepts remain unknown. |
| Gross margin | SEC revenue plus cost of revenue | Alternate standard cost tags in the same Company Facts payload | Requires the same compatible period. |
| Backlog / contracted revenue | SEC Remaining Performance Obligation or Contract With Customer Liability concepts | Alternate standard backlog/liability concepts | Custom taxonomy text is not guessed into a number. |
| Analyst targets and earnings surprises | Yahoo quoteSummary | Nasdaq one-year target, explicitly labeled as a different metric | No target is synthesized when providers omit it. |
| Insider purchases | SEC submissions + Form 4 documents, transaction code P | Empty/unknown with issue recorded | Only open-market purchases are counted. |
| News and company events | Yahoo RSS | Google News RSS, then SEC filing index for 8-K, 10-Q, 10-K, 6-K, 20-F, and 40-F | Google is a low-confidence RSS fallback; SEC filings are event metadata, not sentiment. |
| Arabic translations | Existing translation/cache layer | Original English value remains visible when translation fails | Translation failure never removes the sourced original. |

## What was implemented

- Added independent Cboe daily history recovery at `cdn.cboe.com/api/global/delayed_quotes/charts/historical/{SYMBOL}.json`.
- Added Yahoo `query2` recovery for chart history and intraday data.
- Preserved Yahoo chart metadata as a no-crumb identity and quote fallback.
- Added the bundled official SEC Frames snapshot to the deep-profile financial fallback, so an SEC live 403 can still return dated revenue, net income, cash, debt, FCF, shares, and valuation for covered scan issuers.
- Added standard SEC tags for cost of revenue and backlog/contracted liabilities.
- Added derived gross margin with dated evidence.
- Added derived backlog with source URL and reporting date.
- Added SEC filing events when Yahoo RSS has no usable items.
- Added Google News RSS as a no-key news fallback when Yahoo RSS is rate limited or empty.
- Added gross margin and revenue growth to the financial profile grid.
- Added tests for all new derivations, Cboe parsing, and SEC filing fallback.

## Failure behavior

The profile fetch runs independent work in parallel: history, SEC facts, Yahoo profile, Nasdaq summary, RSS, SEC submissions, and Form 4 documents. A rejection is recorded against that source and does not cancel the other branches. When live SEC facts fail, the dated official SEC Frames release is used for the fields it contains and marked low confidence. The profile may therefore still be partially covered, but the UI keeps the missing fields explicit and the strategy engine keeps incomplete evidence `UNKNOWN`.

The provider cache is bounded and keyed by full URL. In-flight requests are shared inside the Worker isolate. SEC requests remain serialized with headroom under the SEC fair-use rate. Yahoo and Cboe results have separate cache keys, so a Yahoo cooldown cannot suppress the Cboe fallback.

## Free-source research conclusions

- SEC EDGAR APIs are the authoritative free source for issuer filings and XBRL facts, but they require an identifying User-Agent and can reject an egress range. The application therefore needs a bundled/cache fallback and must expose the failure.
- OpenFIGI is a useful free identity mapping service, but it does not supply the financial profile fields needed here. It is not on the hot path.
- The open-source `CohenD/fin-data-mcp` project verified the Cboe endpoints and the Yahoo query1/query2 fallback pattern. Its MCP server is a reference/QA option, not a production dependency: the Worker should not pay the cost or reliability penalty of starting another server for data that can be fetched directly.
- Hosted “free” aggregators and key-based services were not adopted. They either require a key, impose a hosted free-tier quota, use cached third-party data, or cannot provide the provenance needed by the strategy gates.

## Acceptance gates

The implementation is accepted only when all of these hold:

1. `npm run typecheck` passes.
2. Engine tests cover standard facts, future-period rejection, gross margin, backlog, Cboe parsing, and filing fallback.
3. Runtime/API tests pass without provider secrets.
4. UI/component tests pass and the profile still renders when optional fields are absent.
5. Production build and lint pass.
6. Live no-key smoke checks return usable Yahoo, Nasdaq, Cboe, and RSS payloads, or record a bounded provider failure.
7. A live profile request returns a snapshot or a clear partial snapshot; it never returns an empty profile because one provider failed.
8. Every derived value has a provenance entry and every unavailable value remains null/unknown.

## Remaining data limits

No free public source guarantees every field for every issuer. SEC custom tags, foreign issuer presentation differences, private analyst feeds, unavailable company websites, and issuers with no disclosed backlog remain legitimate gaps. The system should improve coverage by adding new standard tags and parsers only when a source contract is documented and testable; it must not fill those gaps with estimates or zeros.
