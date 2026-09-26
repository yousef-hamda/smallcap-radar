# Project memory — Small-Cap Radar

Last verified: 2026-09-26. This is the repository-owned memory for future maintainers; historical research notes in `docs/` may describe older releases. The deep audit and changes from this date are in `docs/DEEP_IMPROVEMENT_PLAN_2026_09_21_AR.md`, `docs/DEEP_IMPROVEMENT_PLAN_2026_09_21_V2_AR.md`, and `docs/RESOURCE_COST_AND_PORTFOLIO_LAYOUT_PLAN_2026_09_26.md`.

## Product and source of truth

- Arabic RTL stock-research app with Core, Bounce, favorites, and portfolio views. Scores are diagnostic; category membership requires the documented hard gates to pass. Do not present a high score as overriding a failed or unknown gate, or as investment advice.
- Core strategy definitions: `lib/strategy-spec.ts`; evaluation: `lib/engine.ts`. Data acquisition and provenance: `lib/providers.ts`, `lib/reconcile.ts`, `lib/storage.ts`. Portfolio calculations: `lib/portfolio.ts`.
- Code is in `https://github.com/yousef-hamda/smallcap-radar`, branch `master`. The original ChatGPT Site at `https://small-cap-radar-v2.yousef772.chatgpt.site/` is a separate deployment and is not automatically synchronized with Railway.
- Current Railway site: `https://smallcap-radar-production.up.railway.app/`. It runs Vinext/Vite with a Cloudflare-compatible local D1 binding, not a native Postgres driver.

## Recovered data

- A 2026-09-21 recovery copied 2,908 old market snapshots and six additional company snapshots needed for the seven saved symbols. The seventh symbol was already in the market snapshot. The durable recovered run is `7857f783-7749-4000-8f90-b0f0af848331`, source `recovered backup`, with 2,914 records.
- Deep company files now use cache key `deep:v7`, preserve original provider text, and add best effort Arabic fields for the company name, description, sector, industry, and news titles/sources. Translation failure leaves the original text visible and is recorded as a data limitation. Portfolio reads v7 first and retains v6/v5/v4 compatibility.
- Portfolio allocation uses a squarified treemap with proportional area and a complete readable legend. Company logos load through `/api/portfolio-logo` so the browser does not depend on a client-side third party request; the resolver tries FMP, website Clearbit, Parqet, CompaniesMarketCap, the newer FMP endpoint, then a short-lived fallback. Provider redirects are followed only for fixed, validated image endpoints.
- Portfolio heatmap coordinates are explicitly clamped to the frame, use fixed left/top geometry, and adapt label density to each rectangle. The complete legend remains ordered by market value and contains every logo, symbol, company name, and weight.
- Live `GET /api/radar?status=1` returned `complete` and `processed: 2914` on 2026-09-21, including after redeployments. This verifies app-visible persistence, not an independent database backup.
- The seven historical favorite symbols were APLD, CLBT, DEFT, SOFI, TMDX, XE, and ZTS. A one-time private claim link was given to the owner in chat. Whether the owner clicked it is not verified here. Do not store or publish the claim token.
- The old site's portfolio transaction table had zero rows. No historical portfolio positions were available to recover.
- The recovered snapshot is historical. Re-check quote/fundamental timestamps before research decisions; a new scan should replace it when the production scan pipeline is validated.

## Known limits and next decisions

- `DATABASE_URL` points at a Railway Postgres service but the app does not use it. Setting this variable alone never migrates D1 data. A Postgres move needs a deliberate schema/code/data migration, backup, row-count and owner-scope checks, and a reversible cutover.
- Railway volume persistence is working, but automated volume backups and restore drills have **not** been verified. Configure and test them before relying on this for irreplaceable data.
- Railway is a single volume-backed web instance; do not assume multi-replica availability. The scan and financial data pipelines remain subject to provider outages and stale data. See `docs/ACCEPTANCE.md` and `docs/SCORING_AUDIT_2026_09_20.md` for remaining quality gates.
- Repeated radar scoring and portfolio reconstruction are now bounded by current-run evaluation reuse and short-lived invalidated caches. Automatic visible-screen refresh is ten minutes; manual quote refresh still bypasses portfolio cache.
- A Railway project token was posted in chat. It should be rotated by the owner; never add it or any database URL, recovery token, or secret to Git.

## Second-cycle implementation notes — 2026-09-21

- Translation requests are limited to three active external calls per process, and repeated news sources are translated once per snapshot. The in-memory translation cache remains a performance layer, not a durable source of truth.
- Logo resolution now deduplicates concurrent requests and caches verified image bytes for one day. Initials SVG fallbacks expire after ten minutes so a recovered provider logo can appear without waiting a day.
- Logo retry now invalidates the in-process fallback cache, and the resolver follows provider image redirects after checking the final content type and 500KB size limit. Local smoke testing returned a real PNG for AAPL.
- Treemap tests now verify proportional area, frame bounds, total area, and pairwise non-overlap. Arabic tests verify source preservation, translated company/news fields, and visible failure limitations.
- The broad second-cycle plan, future work, and acceptance gates are in `docs/DEEP_IMPROVEMENT_PLAN_2026_09_21_V2_AR.md`.
- The previous local audit commit `843d6b4` and the Core zero-result fix commit `2f33edc` are pushed to GitHub. The Railway URL was checked after the earlier push and still served the previous release: no Arabic enrichment fields in a fresh company response and an initials SVG for AAPL. Railway CLI authentication/project linking is unavailable in this workspace, so production adoption of `2f33edc` is not claimed.
- A later public smoke check after commits `2f33edc` and `71bf721` confirmed that Railway still exports Core spec `2.6.0-draft.1-category-alignment`; the repository is `2.7.0-draft.1-financing-risk-review`. The production run `a68789e7-f053-49d9-9033-95cecd4b2537` therefore used the old worker and its zero Core result does not test the fix. Redeploy the latest `master` before starting the next full scan.
- Core zero-result investigation is documented in `docs/CORE_ZERO_RESULT_INVESTIGATION_2026_09_21_AR.md`. The full scan previously left every bulk row at `deathSpiral=unknown`; the new financing-risk review derives a transparent risk level from dated SEC cash, debt, profitability, FCF, and reviewed dilution evidence. Financial freshness now separates filing availability from reporting-period age. A fresh full scan is still required to measure real market counts with actual 20-session liquidity.

See `docs/OPERATIONS_MEMORY.md` for deployment/storage details and `HANDOFF.md` for the immediate continuation checklist.
