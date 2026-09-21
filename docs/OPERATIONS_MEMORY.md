# Operations memory — Railway

Last verified: 2026-09-21. Keep this file free of credentials and private recovery links.

## Live configuration

- GitHub source: `yousef-hamda/smallcap-radar`, branch `master`; Railway web service: `smallcap-radar`, production environment.
- Public URL: `https://smallcap-radar-production.up.railway.app/`.
- Persistent Railway web-service volume: `smallcap-radar-volume`, mounted at `/app/data`. The Vite Cloudflare plugin stores local D1/Miniflare state under `${RAILWAY_VOLUME_MOUNT_PATH}/state` (currently `/app/data/state`). The Railway Postgres service is separate and unused by the app.
- Never mount the volume at `/app/.wrangler`: it hides the build's `.wrangler/deploy/config.json` and causes startup `ENOENT`/502. This was the deployment incident fixed on 2026-09-21.
- `npm run build` uses the Linux verified Vinext build script; `npm start` runs Vite preview on Railway's `PORT`. `npm run typecheck`, `npm run lint`, `npm run test:engine`, `npm run test:runtime`, and `node --test tests/*.test.mjs` are the relevant checks.

## Safe checks

1. Check Railway deployment status and logs for a successful release. A green build alone does not prove the service started; check the public URL.
2. Check `GET /api/radar?status=1`: the last verified recovered run was complete with 2,914 processed records.
3. Check `GET /api/radar?strategy=bounce&limit=1&offset=0` and the homepage return 200. The live route should still identify `recovered backup` as its data run until a newer validated scan replaces it.
4. After any storage or runtime change, redeploy and repeat the count check. Do not delete/recreate the volume to fix a deployment.
5. Configure automated Railway volume backups and perform a restore drill. Persistence across redeploy is not a backup.
6. After the current GitHub push, production still returned the older company/logo behavior. Redeploy the latest `master` commit after restoring Railway CLI/project authentication, then repeat the company Arabic-field and PNG logo smoke checks.
7. After deploying the Core financing-risk fix, start a new full-market scan. The old zero-result snapshot may be re-evaluated from saved fundamentals, but only a new scan supplies current quotes and actual 20-session liquidity.

## Recovery and security

- `POST /api/radar` supports a guarded `restore` action for one-off recovery. The temporary `RECOVERY_SECRET` Railway variable was deleted after recovery; a missing secret makes that action return 401. Do not re-enable it without a time-limited operational need.
- `GET /api/recover?token=...` transfers a one-time recovery bundle of favorite symbols to the browser's private visitor identity. The token is sensitive and must never be committed, logged, or pasted into public documentation. The user's claim status is not verified in these files.
- The portfolio logo UI requests real images directly from Financial Modeling Prep's public image endpoint and falls back to the same-origin logo route. The fallback route may show ticker initials when the Worker cannot reach an external logo host.
- The app is backed by D1-style local state on a Railway volume; `DATABASE_URL` is not read by the current runtime. Do not describe the 2,914 records as being in Railway Postgres.

## Migration guardrails

If moving to Postgres, first take and verify a volume backup. Inventory all D1 tables, including runs, snapshots, watchlists, portfolios, cache, and recovery metadata. Preserve private owner keys and transaction order. Import into Postgres, compare counts and selected payloads, run app-level read/write tests, then cut over with a rollback plan. Never point `DATABASE_URL` at Postgres and assume the existing D1 data moved.
## 2026-09-21 deep improvement notes

- `/api/company` cache version is `deep:v7` because the second-cycle payload contract includes the Arabic enrichment guarantee. Older `deep:v6`, `deep:v5`, and `deep:v4` rows remain readable by portfolio quote recovery.
- Translation uses a bounded, in-memory 24-hour cache, in-flight dedupe, a three-request concurrency limit, and a four-second request timeout. It is enrichment only; no sourced financial value, date, or link is translated or altered.
- Portfolio logo requests are same-origin and cacheable for one day with stale-while-revalidate for seven days. The resolver deduplicates concurrent symbol requests, tries FMP, Clearbit, Parqet, CompaniesMarketCap, and FMP's newer endpoint, and follows only validated provider redirects; initials fallback entries expire after ten minutes and `retry=1` bypasses the in-process cache.
- The allocation layout is squarified and clamped to the 0–100 frame. If a browser does not support `color-mix`, the tile still keeps its proportional geometry and readable legend.
- The full second-cycle scope, test matrix, acceptance gates, and deferred operations work are in `docs/DEEP_IMPROVEMENT_PLAN_2026_09_21_V2_AR.md`.
