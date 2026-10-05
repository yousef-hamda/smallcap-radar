# Historical proxy method

Superseded by [the complete ranking contract](COMPLETE_RANKING_AUDIT_2026_10_05.md). Version 1.0.2 grades every listing and uses fixed model component denominators; evidence completeness no longer filters rankings. The details below describe the former implementation only.

# Deterministic proxy grades for non-numeric factors

Data cutoff for this study: 2026-10-04T23:44:30Z.

The unified rubric contains eight fixed weights. Six factors do not have one authoritative numeric field for every issuer, so the scan now derives bounded proxy scores from already acquired, source-linked fields:

| Factor | Inputs | Method |
|---|---|---|
| Valuation | EV/Sales or P/S, FCF yield, revenue growth | Multiple bands produce a 0–10 base; cash generation and growth make small capped adjustments. |
| Catalysts | Revenue growth, disclosed backlog/revenue, next earnings date | Growth, backlog scale, and a dated earnings event provide capped signals. Filing counts alone never create a catalyst. |
| Competitive position | Gross margin, operating-margin trend, revenue growth | Margin level, margin direction, and growth form a business-quality proxy. |
| Downside risk | Cash/debt, dilution, financing-risk classification | Balance-sheet capacity starts at 7/10 and is adjusted for leverage, dilution, and financing risk. |
| Management/alignment | Dilution, verified insider purchases, latest earnings status | Capital-discipline and execution signals provide a bounded management proxy. |
| Technical timing | Price versus MA30W, 52-week range position, trailing return | Trend, range position, and 12-month return form the entry-timing proxy. |

Each proxy emits:

- a score from 0 to 10;
- a calculation trace with `rubricId: proxy-v1`;
- the input fields used;
- a source list where provenance exists;
- a coverage percentage based on available inputs;
- low confidence when the input set is incomplete.

An existing reviewed dossier always overrides a proxy. Missing inputs reduce coverage and do not become neutral evidence. A proxy is therefore a reproducible grade, not a claim that the issuer received full qualitative diligence. The fixed 25/20/15/12/10/10/5/3 weights remain unchanged, and ranking still requires complete safety evidence plus 100% factor coverage.

The implementation is in `lib/opportunity-proxies.ts`. Integration occurs in `evaluateOpportunityDossier`; tests cover bounded scores, calculation traces, source handling, and incomplete-input coverage.
