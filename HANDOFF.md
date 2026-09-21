# Handoff — Small-Cap Radar

Updated 2026-09-21. Start with `docs/PROJECT_MEMORY.md`, `docs/OPERATIONS_MEMORY.md`, and `docs/DEEP_IMPROVEMENT_PLAN_2026_09_21_V2_AR.md`; this file captures the immediate state and next checks.

## Current state

- GitHub `master` contains the deep strategy, Arabic enrichment, wallet layout, resilient logo resolver, and Core zero-result fix through commit `2f33edc`. The post-push smoke check still served an older Railway release: AAPL returned an initials SVG and company payloads lacked Arabic fields. Railway CLI authentication/project linking is unavailable in this workspace, so redeploying and verifying this commit remains the only external deployment step.
- The web service uses D1-compatible local state on the Railway volume at `/app/data`, not the attached Railway Postgres database. Data survived multiple redeployments. `RECOVERY_SECRET` was removed after recovery.
- Wallet allocation uses a squarified treemap with proportional tile areas, a complete legend, and responsive tile content. Logos load through the same-origin resolver, which tries published logo providers before the stable local fallback.
- Deep company payloads use `deep:v7`; translation requests are bounded and logo requests are cached and deduplicated in-process. The second-cycle plan and its deferred queue are recorded in `docs/DEEP_IMPROVEMENT_PLAN_2026_09_21_V2_AR.md`.
- Seven favorite symbols were recovered into a one-time private claim bundle. The owner must open the previously supplied claim link in their normal Railway browser session to attach them to that visitor identity; completion is unverified. Do not put the token in this repository.
- No portfolio transactions were present in the original site's database, so there was no portfolio ledger to restore.

## Next work

1. Redeploy commit `71bf721` from the linked Railway project, verify `/api/export?kind=spec` reports Core `2.7.0-draft.1-financing-risk-review`, then start a fresh Core full scan and verify its ranked rows.
2. Ask the owner whether the one-time favorite claim succeeded; if not, investigate without exposing the token or another visitor's data.
3. Enable Railway volume backups and verify a restore. Recommend rotation of the project token posted in chat.
4. If the owner wants the attached Postgres database to become active, plan and execute a backed-up D1-to-Postgres migration with validation and rollback. Do not switch storage by changing only `DATABASE_URL`.
5. Continue strategy/data QA using `docs/ACCEPTANCE.md` and `docs/SCORING_AUDIT_2026_09_20.md`; do not treat recovered historical rows as fresh live market observations.

## Reproducing checks

Run typecheck, lint, engine/runtime tests, all `node --test tests/*.test.mjs` tests, the database test, and Vinext build before code deployments. On Railway, check both service health and `GET /api/radar?status=1` after every deployment. This workspace's working directory may not contain `.git`; clone `https://github.com/yousef-hamda/smallcap-radar.git` if a Git worktree is needed rather than assuming a temporary clone path is durable.
