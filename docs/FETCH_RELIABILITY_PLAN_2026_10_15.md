# Fetch reliability repair — 2026-10-15

## Observed failure

- The production full scan `114f5e6a-5633-425e-a576-0acb641ec44e` is paused at history stage 10, offset 6,030/7,518, with 399 retries pending. Its last progress was 2026-10-14 00:31 UTC. Railway logs report `pausedForCapacity`; direct `df` gives 263,610,368 physical bytes free, below the 268,435,456-byte reserve. The public radar API still returns HTTP 200, but source freshness has stopped.
- The run logged 400 history failures: 261 reports of no trading sessions, 138 timeouts, and one other. Missing sessions occur heavily on preferred shares, units, and warrants. Retrying a confirmed empty history as a transient error wastes requests and delays completion; timeouts still merit bounded retries.
- The database occupies 4,552,577,024 bytes. `dbstat` attributes roughly 2.07 GB to snapshots, 1.48 GB to lossless archives, 345 MB to raw cache, and 342 MB to filing documents. The active daily history cache holds 254 MB of Yahoo history; active scan checkpoints must remain available. Table pages have roughly 300 MB of internal unused space, but that space does not count toward the physical reserve.
- Saved favorites were delayed behind quote refreshes. Opening a portfolio position could show an empty dark company sheet while its company request was pending or failed. Some foreground quote/history routes wrote fresh provider responses into persistent SQLite during reads.

## Repair sequence

1. Preserve the live state: create a consistent SQLite backup outside the mounted volume, verify integrity and saved/private table counts, transfer the compressed backup off-host, and verify hashes and a restored sample before any production database replacement.
2. Make acquisition failures explicit: distinguish confirmed no-session instruments from timeouts/rate limits/server failures, retain missing-data evidence and zero credit, and retry only the transient cases. Reject malformed cache rows and refetch. Keep SEC errors attributable to their actual response and maintain a durable retry cursor.
3. Make browsing resilient: render saved favorites and company details immediately; refresh quotes asynchronously with visible stale/error status. Bound transient quote and chart caches in process memory and use persisted rows as read-only fallback.
4. Measure a lossless compact database copy and history-cache compression off-volume. Compare every table count, active run/checkpoint, current ranking release, archive restoration, and private-value hashes. Replace the live primary SQLite file only after the backup and exact comparison pass and writers are coordinated. Retain rollback material off-host.
5. Run focused provider, scanner, UI and storage tests, then full typecheck, lint, build and runtime gates. Verify the production scanner can advance above reserve, inspect provider errors and volume after several batches, and prove ranking, favorites, wallet, chart and profile responses. Stop acquisition again if the reserve is threatened. Do not change scoring weights.

## Release gate

The candidate branch has a changed scoring rubric, so deploying it would also rewrite 7,517 saved ratings. Keep a fetch-only hotfix on the deployed 1.2.6 rubric until the physical capacity and backup checks support that separate migration. A paid volume-plan change requires owner authorization; this repair first tests an existing-capacity path.
