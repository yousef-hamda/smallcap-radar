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

## Recovery and security

- `POST /api/radar` supports a guarded `restore` action for one-off recovery. The temporary `RECOVERY_SECRET` Railway variable was deleted after recovery; a missing secret makes that action return 401. Do not re-enable it without a time-limited operational need.
- `GET /api/recover?token=...` transfers a one-time recovery bundle of favorite symbols to the browser's private visitor identity. The token is sensitive and must never be committed, logged, or pasted into public documentation. The user's claim status is not verified in these files.
- The portfolio logo UI requests real images directly from Financial Modeling Prep's public image endpoint and falls back to the same-origin logo route. The fallback route may show ticker initials when the Worker cannot reach an external logo host.
- The app is backed by D1-style local state on a Railway volume; `DATABASE_URL` is not read by the current runtime. Do not describe the 2,914 records as being in Railway Postgres.

## Migration guardrails

If moving to Postgres, first take and verify a volume backup. Inventory all D1 tables, including runs, snapshots, watchlists, portfolios, cache, and recovery metadata. Preserve private owner keys and transaction order. Import into Postgres, compare counts and selected payloads, run app-level read/write tests, then cut over with a rollback plan. Never point `DATABASE_URL` at Postgres and assume the existing D1 data moved.
