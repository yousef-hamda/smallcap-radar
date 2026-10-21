# Project deep audit — 2026-10-21

## Scope

Reviewed the project map and maintainer/acceptance documentation, then audited the client UI, API/auth/account/portfolio routes, core financial and ranking logic, and the build, storage, migration, and test setup. Changes were limited to reproducible defects and their regressions; no production data or deployment was changed.

## Architecture reviewed

- **Client:** Vinext/React Arabic RTL PWA, radar and company views, charts, favorites, portfolio, offline behavior, and export.
- **API and identity:** app-router endpoints, same-origin checks, anonymous visitor identity, account sessions, portfolio operations, recovery, scan controls, and push notifications.
- **Research engine:** listing universe and acquisition stages, SEC/provider normalization, provenance and conflict handling, financial/research factor models, canonical opportunity ratings, ranking releases, and historical validation helpers.
- **Persistence and operations:** Cloudflare D1 schema initialization, Drizzle migrations, scan leases/checkpoints, recovery/archive behavior, Worker scheduling, build configuration, CI, and scripts.

## Defects fixed

| Area | Root cause | Correction |
|---|---|---|
| Portfolio ledger | JavaScript date parsing normalized impossible dates (for example, February 31) into a valid later date. | Require an exact ISO calendar-date round trip before accepting transaction dates. |
| Account registration | Username lookup was case-insensitive while SQLite's unique key was case-sensitive; concurrent signups could also race between precheck and insert. | Canonicalize new usernames to lowercase and recheck the unique-conflict case after an insert failure. |
| Account identity | Session lookup swallowed database/schema failures and silently downgraded authenticated requests to anonymous owners. | Propagate infrastructure errors so API handlers return service errors rather than reading or writing under the wrong identity. |
| Share-split reconciliation | `Date.parse` accepted normalized impossible coverage/event dates, which could alter a reported share ratio. | Validate strict calendar dates for coverage bounds and split events before reconciliation. |
| Portfolio export | CSV quoting alone did not stop spreadsheet applications from executing formula-like text. | Prefix formula-like text cells (including those with leading whitespace/control characters/BOM) and keep CSV quoting intact. |
| Recovery links | A mail scanner could consume a one-time recovery token with a GET; restoration also overwrote newer saved favorites and could leave archive payloads unrestored. | GET now renders a no-store confirmation form; only same-origin POST claims the token, restores archived rows, preserves existing favorites, and invalidates cached state. |
| API request boundaries | JSON `null` or array payloads reached object-property access and could surface as server errors. | Validate object request bodies and return 400 across account, radar, scan, and Worker scan entry points. |
| Push resource controls | Subscription storage and completion delivery had no hard size/concurrency bounds, and endpoint ownership could race after the preflight read. | Add atomic per-owner/global quotas, accurate conflict responses, and bounded concurrent delivery. |
| Scan status and migrations | Terminal SEC failures could disappear across pages; transient retries could be counted too early; simultaneous cold isolates could race column additions. | Preserve terminal failure counts through scan completion, classify retries only after exhaustion, and tolerate another isolate winning a conditional migration. |
| Schema model | The Drizzle model omitted the database composite key on `bulk_fundamentals`. | Declare `(run_id, cik)` as the composite primary key. |
| Frontend request races and offline state | Older search/history responses could overwrite newer choices; direct ticker lookups lacked the common retry state; offline cards did not identify their saved scope. | Abort superseded reads, clear stale search results, route direct lookups through the standard loading/error flow, and label the saved view/query/page and omitted results. |
| Dependency security | Pinned Next.js/RSC and build-tool dependencies included advisories; upstream `braces` had no patched release. | Upgrade the framework/toolchain, pin patched `esbuild` and `fflate`, and carry a bounded-nesting patch for `braces` with a regression test until upstream fixes it. `npm audit` is clean after a clean lockfile install. |
| Build-output test | The preview metadata test assumed JSON-style quoting and failed against the new minifier's template-literal output. | Accept both generated string forms while still checking that the preview metadata is present in the production artifact. |

## Verification

- `npm ci` — passed; the locked dependency tree installs reproducibly.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm test` — production build passed; 86 tests passed.
- `npm run test:runtime` — 272 engine tests and 104 runtime/API tests passed.
- `npm run test:research` — 21 tests passed.
- `python3 -m unittest tests/test_database.py` — 4 tests passed.
- `npx drizzle-kit check` — migration journal and snapshots are consistent.
- `npm audit` — 0 vulnerabilities across production and development dependencies.
- `git diff --check` — passed.

The 15,000-row local engine benchmark also passed in the runtime suite. This measures local evaluation throughput, not provider or browser performance. The build now invokes Vite directly as recommended by the installed Vinext version; remaining sourcemap warnings originate in virtual RSC/Vinext plugins and did not prevent the build or tests.

## Remaining limits

The project documentation correctly marks several product/research requirements as incomplete: market-data redistribution rights are not cleared for every source; predictive performance is not validated on a survivorship-correct, point-in-time, delisted total-return dataset; several specialized-sector and fully diluted valuation cases remain unsupported; and physical-device installation/push receipt has not been verified here. Live D1 and external provider behavior were not exercised; those require deployed credentials/services or device acceptance. These are evidence, dataset, rights, or external-environment gaps rather than local failures demonstrated by this audit.
