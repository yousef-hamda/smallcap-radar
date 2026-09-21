# Project memory — Small-Cap Radar

Last verified: 2026-09-21. This is the repository-owned memory for future maintainers; historical research notes in `docs/` may describe older releases. The deep audit and changes from this date are in `docs/DEEP_IMPROVEMENT_PLAN_2026_09_21_AR.md`.

## Product and source of truth

- Arabic RTL stock-research app with Core, Bounce, favorites, and portfolio views. Scores are diagnostic; category membership requires the documented hard gates to pass. Do not present a high score as overriding a failed or unknown gate, or as investment advice.
- Core strategy definitions: `lib/strategy-spec.ts`; evaluation: `lib/engine.ts`. Data acquisition and provenance: `lib/providers.ts`, `lib/reconcile.ts`, `lib/storage.ts`. Portfolio calculations: `lib/portfolio.ts`.
- Code is in `https://github.com/yousef-hamda/smallcap-radar`, branch `master`. The original ChatGPT Site at `https://small-cap-radar-v2.yousef772.chatgpt.site/` is a separate deployment and is not automatically synchronized with Railway.
- Current Railway site: `https://smallcap-radar-production.up.railway.app/`. It runs Vinext/Vite with a Cloudflare-compatible local D1 binding, not a native Postgres driver.

## Recovered data

- A 2026-09-21 recovery copied 2,908 old market snapshots and six additional company snapshots needed for the seven saved symbols. The seventh symbol was already in the market snapshot. The durable recovered run is `7857f783-7749-4000-8f90-b0f0af848331`, source `recovered backup`, with 2,914 records.
- Deep company files now use cache key `deep:v6`, preserve original provider text, and add best effort Arabic fields for the company name, description, sector, industry, and news titles/sources. Translation failure leaves the original text visible and is recorded as a data limitation.
- Portfolio allocation uses a squarified treemap with proportional area and a complete readable legend. Company logos load through `/api/portfolio-logo` so the browser does not depend on a client-side third party request; the resolver tries FMP, website Clearbit, Parqet, then a stable fallback.
- Live `GET /api/radar?status=1` returned `complete` and `processed: 2914` on 2026-09-21, including after redeployments. This verifies app-visible persistence, not an independent database backup.
- The seven historical favorite symbols were APLD, CLBT, DEFT, SOFI, TMDX, XE, and ZTS. A one-time private claim link was given to the owner in chat. Whether the owner clicked it is not verified here. Do not store or publish the claim token.
- The old site's portfolio transaction table had zero rows. No historical portfolio positions were available to recover.
- The recovered snapshot is historical. Re-check quote/fundamental timestamps before research decisions; a new scan should replace it when the production scan pipeline is validated.

## Known limits and next decisions

- `DATABASE_URL` points at a Railway Postgres service but the app does not use it. Setting this variable alone never migrates D1 data. A Postgres move needs a deliberate schema/code/data migration, backup, row-count and owner-scope checks, and a reversible cutover.
- Railway volume persistence is working, but automated volume backups and restore drills have **not** been verified. Configure and test them before relying on this for irreplaceable data.
- Railway is a single volume-backed web instance; do not assume multi-replica availability. The scan and financial data pipelines remain subject to provider outages and stale data. See `docs/ACCEPTANCE.md` and `docs/SCORING_AUDIT_2026_09_20.md` for remaining quality gates.
- A Railway project token was posted in chat. It should be rotated by the owner; never add it or any database URL, recovery token, or secret to Git.

See `docs/OPERATIONS_MEMORY.md` for deployment/storage details and `HANDOFF.md` for the immediate continuation checklist.
