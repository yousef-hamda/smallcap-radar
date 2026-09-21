# Handoff — Small-Cap Radar

Updated 2026-09-21. Start with `docs/PROJECT_MEMORY.md` and `docs/OPERATIONS_MEMORY.md`; this file captures the immediate state and next checks.

## Current state

- GitHub `master` contains the deep strategy, Arabic enrichment, wallet layout, and logo resolver changes through commit `457ad83`. Railway production still needs a deployment from this commit before the live service can be considered updated. The last verified live status returned recovered run `7857f783-7749-4000-8f90-b0f0af848331`, `complete`, 2,914 records.
- The web service uses D1-compatible local state on the Railway volume at `/app/data`, not the attached Railway Postgres database. Data survived multiple redeployments. `RECOVERY_SECRET` was removed after recovery.
- Wallet allocation uses a squarified treemap with proportional tile areas, a complete legend, and responsive tile content. Logos load through the same-origin resolver, which tries published logo providers before the stable local fallback.
- Seven favorite symbols were recovered into a one-time private claim bundle. The owner must open the previously supplied claim link in their normal Railway browser session to attach them to that visitor identity; completion is unverified. Do not put the token in this repository.
- No portfolio transactions were present in the original site's database, so there was no portfolio ledger to restore.

## Next work

1. Ask the owner whether the one-time favorite claim succeeded; if not, investigate without exposing the token or another visitor's data.
2. Enable Railway volume backups and verify a restore. Recommend rotation of the project token posted in chat.
3. If the owner wants the attached Postgres database to become active, plan and execute a backed-up D1-to-Postgres migration with validation and rollback. Do not switch storage by changing only `DATABASE_URL`.
4. Continue strategy/data QA using `docs/ACCEPTANCE.md` and `docs/SCORING_AUDIT_2026_09_20.md`; do not treat recovered historical rows as fresh live market observations.

## Reproducing checks

Run typecheck, lint, engine/runtime tests, and Vinext build before code deployments. On Railway, check both service health and `GET /api/radar?status=1` after every deployment. This workspace's working directory may not contain `.git`; clone `https://github.com/yousef-hamda/smallcap-radar.git` if a Git worktree is needed rather than assuming a temporary clone path is durable.
