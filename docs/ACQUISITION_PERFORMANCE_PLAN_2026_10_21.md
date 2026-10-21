# Acquisition performance investigation and plan — 2026-10-21

## Finding

The apparent 31% stall is the full-scan `stage=5` Company Facts recovery phase. It is making durable progress. Production run `26af6c3c-f409-4106-91a8-7a0da3221f8b` advanced from 2,232 to 2,292 of 7,532 companies in 25.6 seconds (about 2.34 companies/second). SEC request totals advanced from 1,796 to 1,846 over the same interval. That is roughly one scheduler batch every five seconds, and the UI assigns this phase 30–35% of the progress bar. The percentage is phase-weighted work, not elapsed-time progress or an ETA.

Stage 5 only requests Company Facts for companies whose SEC Frames data is incomplete. Stable SEC HTTP 404 responses indicate that a CIK has no Company Facts resource; these are recorded as permanent gaps and are not retried. The counter in `sec_failed` includes these gaps, so it does not by itself indicate a stalled retry loop. `retryPending` and the durable `updated_at`/`offset` fields distinguish transient retries from forward progress.

The slowdown comes from doing only 12 companies per scheduled HTTP tick. Each tick pays scheduler, D1 checkpoint, and logging overhead around the SEC work. SEC traffic is already coordinated across isolates at 8 requests/second, below the SEC's current 10 requests/second limit. The current code has a durable six-hour SEC response cache keyed by CIK and verifies the CIK before accepting data.

## Changes made in this investigation

- Increased the durable Company Facts cursor batch from 12 to 36 companies, so one scheduled invocation can make progress across multiple SEC request windows.
- Bounded active Company Facts requests and response parsing to 12 workers. This preserves the existing per-issuer request fanout ceiling while the wider cursor reduces scheduler round trips. The global provider queue still controls actual SEC request starts.
- Kept permanent 404 / invalid-resource failures out of the transient retry queue.
- Added the Debian `ca-certificates` package to the production image. Runtime inspection found that the original `node:22-bookworm-slim` image lacked `/etc/ssl/certs/ca-certificates.crt`. Workerd therefore rejected SEC TLS certificates even though the separate Node process could fetch SEC using Node's bundled roots. This caused repeated internal SEC fetch failures and transient retry buildup. The CA-equipped image is now deployed as Railway deployment `71cc6c79-a113-48c7-94bf-57cb9619b66a` (SUCCESS); the bundle is present in the live container.
- Clarified the stage-5 Arabic label and details locally: 30–35% represents the issuer-list cursor, not the fraction of Company Facts requests completed. The details display the transient retry count separately.
- Reduced each stage-5 fundamentals read to the CIKs in the current batch, with a separate row count for coverage, rather than reading and parsing every saved fundamentals payload on every scheduler tick. Also deduplicated retry entries by CIK across the active and queued work. A regression proves unrelated damaged payloads are not read, duplicate listing CIKs make one request per issuer, active/queued retry entries are unique, and request retries stay bounded. Typecheck, lint, all 276 engine tests, all 105 runtime tests, all 21 research tests, all 89 repository/UI tests, and production build passed. This local follow-on change is not yet deployed.

The deployed 36-row cursor advances by listing order and preserves its checkpoint. Before the follow-on targeted-read change, a production sample advanced 216 listings in 44.169 seconds (4.89 listings/second), versus the earlier 60 in 25.6 seconds (2.34/second), about 2.1× faster. Requests advanced by 150 (3.40/sec), 144 succeeded, and 6 failed; the shared request reservation remains 8/sec. The retry queue held at 488 across both observations, so the run is progressing but transient retries have not drained. The second sample's latest error was `HTTP 404` and two successful responses without usable standard facts, rather than the first sample's generic internal failures. HTTP 404/empty facts are legitimate issuer coverage gaps; the aggregate `sec_failed` counter still mixes outcome classes. This measurement shows a speedup, not that every stage is fast or the retry backlog is resolved. The CA fix removes one root cause of SEC failures but does not make every issuer have Company Facts or eliminate permanent missing-resource responses.

The same production run later reached a terminal partial state: stage 13, offset 5,945/5,945, retry queue 0, with `sec_requests=18,375`, `sec_success=11,653`, `sec_failed=777`, and a run error reporting 649 acquisition/data gaps. This confirms it no longer sits at 31% and all queued retry work terminated. Partial status and the 649/777 failure counters remain real coverage gaps; do not call it a clean complete data refresh. The status API returned HTTP 200 in 0.50 seconds; warm homepage and source-registry checks returned HTTP 200 in 0.44 and 0.56 seconds. Railway logs separately show an expensive cold radar read (54.8 seconds) and first homepage render (114 seconds), followed by warm reads under 0.5 seconds. Cold evaluation/rebuild is separate from scan throughput and remains on the plan.

## Full improvement plan

### P0 — validate the bounded batch change and SEC transport

1. Run type, runtime, and production build checks.
2. Deployment `71cc6c79-a113-48c7-94bf-57cb9619b66a` succeeded and the post-deploy sample measured 4.89 listings/sec, about 2.1× the 2.34/sec baseline. SEC request rate was 3.40/sec.
3. Confirm the CA bundle is in the running image (done). Recent status returned 200 and the latest SEC errors were HTTP 404/empty standard facts rather than internal errors. The run later reached terminal stage 13 with retryPending 0; 777 SEC failures and 649 overall data gaps remain in its partial result. No active lease is held by that terminal run.
4. Keep the batch at 36 only if memory, SEC responses, and total progress remain healthy. Otherwise lower the cursor size while retaining the 12-worker cap.

### P1 — show stage-specific operational progress

The local UI change explains that the 30–35% stage-5 bar is the issuer-list cursor, not request completion, and displays transient retry count separately. The persisted SEC request totals still combine Frames and Company Facts, and `sec_failed` does not distinguish permanent 404s from all transient failures. The next instrumentation step is to persist per-stage durations, Company Facts request outcomes, and a durable last-progress timestamp. Keep overall phase-weighted progress beside those stage-specific values, and report a stale checkpoint only after an explicit no-progress threshold; do not infer a stall from the percentage alone.

### P1 — reuse existing source artifacts more broadly

Measure SEC artifact-cache hits and age by source before adding providers. Company Facts already has a durable six-hour positive response cache. Persist per-run request outcomes by CIK so resumed scans do not repeat known permanent 404s or empty standard facts, and distinguish `not-found`, `empty-standard-facts`, `rate-limited`, `timeout`, and `server-error`. The current cursor walks listing rows, while data and provider retry identity are CIK-based; 648 duplicate CIKs appeared in the checked-in dated sample of 7,494 listings. A durable unique-CIK work queue and per-CIK attempt budget should replace repeated issuer work across listing boundaries. Validate counts against the current production directory before choosing its size.

### P2 — evaluate the SEC nightly bulk archive

SEC documents `companyfacts.zip` as the most efficient source for large data pulls and recompiles it nightly. Prototype a disk-backed, verified importer that checks archive size, checksum, CIK identity, and date availability, then emits only the standard concepts needed by this evaluator. Compare coverage, freshness, scan time, storage, and parsing memory against the live per-CIK path before switching. Do not load the entire archive into Worker memory or silently replace fresher live filings with a prior-night snapshot.

### P2 — avoid blocking user requests on cold evaluation publication

Separately from acquisition, cold GET `/api/radar` can run `ensureRunEvaluations` synchronously after a rubric change. That full-universe rebuild explains the observed one-time ~59-second cold request. Run the idempotent publication step as background maintenance before traffic and have reads return a bounded retry response while a new rubric publication is pending. Never label old scores as current. This is a distinct source of slowness from the stage-5 scan.

### P3 — profile later stages independently

Add per-stage durations and throughput for SEC Frames, scoring, history, issuer research, and ranking publication. For each stage, compare network wait, provider quota wait, JSON parse time, database batch time, and scheduler idle time. Tune each batch only after measuring the dominant component, preserving resumable checkpoints and data completeness.

The pushed follow-on release (`9bf74b0`, documentation checkpoint `a48865f`) addresses one measured avoidable cost by reading only the current CIK batch from `bulk_fundamentals`; a separate count keeps coverage exact. It also prevents duplicate CIK retry entries within a queued batch and explains the progress cursor in the UI. Its duplicate-listing regression and all local type/runtime/research/UI/build checks pass. Railway CLI authentication has been restored, but `railway up` was rejected twice with “Deploys have been paused temporarily.” Railway's status page currently declares a major outage affecting the API/dashboard and says builds/deployments are paused. This exact code SHA remains pushed and awaits the first available deployment window; no paid-plan upgrade was attempted. The production app was opened in Playwright: it showed the stored partial completion at 100% with the 649-row warning, not an Internal Server Error, and the browser reported zero console errors. After Railway resumes builds, deploy the pushed commit and use the next scheduled acquisition run to measure this optimization before changing batch or concurrency further.

## External source

The [SEC EDGAR API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) describes the Company Facts endpoint and nightly `companyfacts.zip` bulk archive. The [SEC access guidance](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) currently sets a maximum automated request rate of 10 requests per second. The project keeps a lower shared limit for operational headroom.
