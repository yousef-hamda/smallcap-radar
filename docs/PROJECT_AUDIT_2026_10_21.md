# Project-wide audit — 2026-10-21

## Scope and result

Three independent code reviews covered SEC/provider parsing and data normalization, scanner/persistence/API/rating calculations, and the frontend/account/portfolio/report flows. The primary product and pipeline paths are implemented and have broad automated regression coverage. The audit found and fixed financial-period validation defects that could turn partial-quarter data into annual or trailing-twelve-month (TTM) values, plus several smaller UI state and validation defects.

This is an audit of the local source tree at commit `71ef4fe` plus the uncommitted fixes listed below. Those fixes have **not** been pushed or deployed. The separate runtime hotfix deployment `346fb0db-2dde-45c6-90c8-c35c0dcd3871` succeeded on 2026-10-21 and the public home/API checks returned HTTP 200, but that proves request serving only; this audit did not revalidate the deployed ranking release, production D1 contents, or the audit fixes in production.

## Verified code defects fixed

### Financial data and ratings

- Four contiguous intervals of roughly 60 days were accepted as a TTM window. This could distort TTM revenue growth, earnings quality, FCF, compact saved financials, and the current-period overlay in valuation scenarios. Every affected path now requires the four-quarter window to span 330–400 days.
- SEC records with impossible dates such as February 30 could pass `Date.parse` normalization. SEC annual/instant facts, technical bars, and Cboe history now validate the written calendar date. Impossible Yahoo split timestamps no longer crash parsing; invalid split coverage is withheld.
- A research period shorter than one year could replace an existing annual compact value when its record was mislabeled as annual. Promotion now requires a valid 330–380 day source period.
- The rubric version is bumped from `1.5.2-reviewed-economic-capitalization` to `1.5.3-validated-period-windows`. Saved evaluations are versioned against this identity, so deployment will invalidate and recompute old ratings instead of silently reusing them after scoring logic changed. That saved-row re-evaluation was not run against production as part of this audit.

Regression coverage was added for the financial alignment, earnings scoring, valuation overlay, revenue growth, SEC facts, market-history parsing, and impossible date cases.

### Frontend and user flows

- Ticker lookup now accepts numeric-leading symbols such as `3M`, matching the API's symbol contract.
- Scan report rows are shown only when the response belongs to the selected run and requested offset, preventing stale rows from appearing under a failed/new page.
- Account mode controls now expose correct pressed-button semantics to assistive technology.
- Login/logout and portfolio transaction/search errors are shown inside their active dialogs, where users can see them and retain focus context.
- Existing offline page scope labels, cancelled portfolio reads, and CSV formula neutralization are covered by UI regressions.

## Data inventory and model limits

The local data coverage scripts are explicit that bundled counts are not a live-provider or source-correctness check. On the local generated files inspected for this audit:

- The bundled listing/quote universe has 7,675 rows and was generated 2026-09-06. It has cached positive prices for 6,725 rows and positive market capitalization for 5,797.
- The bundled SEC Frames data was generated 2026-09-15. It joins 5,235 issuer records to 6,515 listing rows (84.9%); revenue is present for 4,652 listing rows (60.6%), net income for 5,833 (76.0%), capex for 3,941 (51.3%), and current debt for 2,522 (32.9%). Presence does not establish freshness, compatible periods, issuer/class identity, completeness, or correctness; runtime validation must still check those.
- The separate static listing identity fields are absent on the 7,675-row bundled file. A distinct dated live directory parser audit (2026-09-30) reported 5,286 explicit common rows and 382 unresolved rows among 7,102 included rows. These are different snapshots and do not prove the current production inventory's identity coverage.
- The bundled historical cache has only 12 symbols, 55–379 daily bars, and 18 months of price history through 2026-09-04. It has no point-in-time fundamentals, delisted universe, or future outcome labels. The project research protocol requires at least 1,000 firms, 10 years, and 10,000 point-in-time observations before its Bounce study can run. Predictive performance remains unvalidated.

The active rubric's eight weights sum to 100 and its missing-component zero-credit policy creates deterministic numeric ranks. Numeric completeness is not factual completeness: observed model-input coverage, reviewed-source coverage, source rights, and safety findings are separate. Current documentation correctly leaves return probabilities and six-month targets disabled. No measured outcome study establishes that the Opportunity ranking predicts returns.

Major remaining evidence gaps include point-in-time/delisted outcomes, complete annual/interim issuer facts, reviewed capitalization and senior claims, sector-appropriate valuation, independently reviewed catalysts and risk/management/competitive evidence, and verified market-data reuse rights. These are data/research and production-acceptance gaps, not defects that a code-only patch can close.

## Verification run

After combining the audit changes:

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run test:runtime` — passed; engine suite is 276/276 and runtime suite is 104/104.
- `npm run test:research` — passed, 21/21.
- `npm test` — verified production build passed; root/UI suite passed, 89/89.
- `git diff --check` — passed.

The build emitted Vite/Vinext sourcemap warnings for generated virtual modules; the build still completed successfully. Automated tests exercise deterministic fixtures and mocked providers; they do not prove live SEC, quote-provider, Railway-volume, or production-D1 availability.

## Delivery and operational note

No schema or migration change was required for the fixes. No production scan, saved-row reevaluation, volume change, push, or deployment was performed as part of this audit. The historical handoff and acceptance files contain checkpoints from earlier dates; use a fresh read-only production check before treating their stored capacity, active scan, or ranking-version statements as current.
