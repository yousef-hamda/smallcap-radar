# Acquisition performance investigation and plan — 2026-10-21

## Finding

The apparent 31% stall is the full-scan `stage=5` Company Facts recovery phase. It is making durable progress. Production run `26af6c3c-f409-4106-91a8-7a0da3221f8b` advanced from 2,232 to 2,292 of 7,532 companies in 25.6 seconds (about 2.34 companies/second). SEC request totals advanced from 1,796 to 1,846 over the same interval. That is roughly one scheduler batch every five seconds, and the UI assigns this phase 30–35% of the progress bar. The percentage is phase-weighted work, not elapsed-time progress or an ETA.

Stage 5 only requests Company Facts for companies whose SEC Frames data is incomplete. Stable SEC HTTP 404 responses indicate that a CIK has no Company Facts resource; these are recorded as permanent gaps and are not retried. The counter in `sec_failed` includes these gaps, so it does not by itself indicate a stalled retry loop. `retryPending` and the durable `updated_at`/`offset` fields distinguish transient retries from forward progress.

The slowdown comes from doing only 12 companies per scheduled HTTP tick. Each tick pays scheduler, D1 checkpoint, and logging overhead around the SEC work. SEC traffic is already coordinated across isolates at 8 requests/second, below the SEC's current 10 requests/second limit. The current code has a durable six-hour SEC response cache keyed by CIK and verifies the CIK before accepting data.

## Changes made in this investigation

- Increased the durable Company Facts cursor batch from 12 to 36 companies, so one scheduled invocation can make progress across multiple SEC request windows.
- Bounded active Company Facts requests and response parsing to 12 workers. This preserves the existing per-issuer request fanout ceiling while the wider cursor reduces scheduler round trips. The global provider queue still controls actual SEC request starts.
- Kept permanent 404 / invalid-resource failures out of the transient retry queue.

These changes preserve row order, checkpoints, data selection, and SEC rate limits. They should reduce the scheduler overhead per issuer; actual scan duration remains bounded by SEC response latency, missing-fact coverage, and later scan stages. Validate with the next production stage-5 throughput sample before claiming a measured speedup.

## Full improvement plan

### P0 — validate the bounded batch change

1. Run type, runtime, and production build checks.
2. Deploy and compare persisted Company Facts cursor movement and request counts over a fixed interval against the baseline above.
3. Confirm `retryPending` drains, no lease remains stuck, request rate stays below the global 8/second reservation, and the Worker remains within memory limits.
4. Keep the batch at 36 only if memory, SEC responses, and total progress remain healthy. Otherwise lower the cursor size while retaining the 12-worker cap.

### P1 — show stage-specific operational progress

Expose stage name, companies examined, actual Company Facts requests, successes, permanent missing-resource responses, transient retries, and last checkpoint time separately. Keep the overall phase-weighted progress, but show it beside the actual stage cursor so a long 30–35% phase cannot look frozen. Report a stale checkpoint only after an explicit no-progress threshold; do not infer a stall from the percentage alone.

### P1 — reuse existing source artifacts more broadly

Measure SEC artifact-cache hits and age by source before adding providers. Company Facts already has a durable six-hour cache. Persist per-run request outcomes by CIK so resumed scans do not repeat known permanent 404s and so aggregate SEC success/failure counters distinguish `not-found`, `empty-standard-facts`, `rate-limited`, `timeout`, and `server-error`.

### P2 — evaluate the SEC nightly bulk archive

SEC documents `companyfacts.zip` as the most efficient source for large data pulls and recompiles it nightly. Prototype a disk-backed, verified importer that checks archive size, checksum, CIK identity, and date availability, then emits only the standard concepts needed by this evaluator. Compare coverage, freshness, scan time, storage, and parsing memory against the live per-CIK path before switching. Do not load the entire archive into Worker memory or silently replace fresher live filings with a prior-night snapshot.

### P2 — avoid blocking user requests on cold evaluation publication

Separately from acquisition, cold GET `/api/radar` can run `ensureRunEvaluations` synchronously after a rubric change. That full-universe rebuild explains the observed one-time ~59-second cold request. Run the idempotent publication step as background maintenance before traffic and have reads return a bounded retry response while a new rubric publication is pending. Never label old scores as current. This is a distinct source of slowness from the stage-5 scan.

### P3 — profile later stages independently

Add per-stage durations and throughput for SEC Frames, scoring, history, issuer research, and ranking publication. For each stage, compare network wait, provider quota wait, JSON parse time, database batch time, and scheduler idle time. Tune each batch only after measuring the dominant component, preserving resumable checkpoints and data completeness.

## External source

The [SEC EDGAR API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) describes the Company Facts endpoint and nightly `companyfacts.zip` bulk archive. The [SEC access guidance](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) currently sets a maximum automated request rate of 10 requests per second. The project keeps a lower shared limit for operational headroom.
