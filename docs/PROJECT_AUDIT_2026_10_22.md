# Project-wide system audit — 2026-10-22

## Scope and method

The initial review was read-only and covered the Opportunity evaluator and rating inputs, SEC/market data ingestion and persistence, API/Worker entry points, account and portfolio flows, and the current release notes. Three independent reviewers covered scoring, data acquisition, and API/UI/security paths. The remediation status below records subsequent local changes and verification. References point to the current local source; they do not prove that the same SHA is running in production.

## Highest-priority confirmed findings

### 1. Public imports can become the shared published ranking — High

`POST /api/radar` protects writes with an `Origin` equality check, but its `import` action has no account or publisher authorization. It accepts up to 500 complete snapshots per request and creates a globally visible completed run. The shared state query prefers any completed full run, but if none exists, the newest completed import supplies the public result set. `insertSnapshot` re-evaluates imported fields and provenance claims; it does not independently retrieve or authenticate the cited source. Repeated imports also add persistent rows without a caller or aggregate quota. A remote client can therefore publish unverified user-supplied market/fundamental inputs when no completed full run exists, and grow shared database usage indefinitely.

References: [radar route](../app/api/radar/route.ts#L44), [import schema](../lib/validation.ts#L42), [published-run selection](../lib/storage.ts#L184), [snapshot insertion](../lib/storage.ts#L332).

### 2. Public callers can repeatedly trigger shared scan work — High

The scan API accepts `start` and arbitrary existing-run `step` requests after only checking `Origin`; the Worker start and resume paths use the same check. There is no per-caller authorization or rate limit on `step`/`resume`. `processScanBatch` performs SEC/provider and database work. The start path has a 30-second run-level throttle, but repeated step/resume requests can still compete with the background scheduler, drive shared quota, and create avoidable load. `Origin` checks reduce browser CSRF exposure; they do not authenticate general HTTP clients.

References: [scan route](../app/api/scan/route.ts#L4), [Worker start/resume](../worker/index.ts#L226), [scanner batch processing](../lib/scanner.ts#L140).

### 3. Account signup and password checks have no throttling — Medium

Signup and login have no IP/account-level attempt limit or account-creation cap. Each password hash/verification runs PBKDF2 for 120,000 iterations, so repeated public requests can consume CPU; signup can also grow account/session records without bound. This is a capacity-abuse path rather than an identified session ownership bypass.

References: [account route](../app/api/account/route.ts#L46), [PBKDF2 work](../lib/account.ts#L25).

## Data and algorithm defects

### 4. Nasdaq daily history admits impossible dates — Medium

`isoDate` only rearranges a regex-matching `MM/DD/YYYY` string. The Nasdaq history filter then checks lexical range, price, and low, but never round-trips the date through a calendar validator. For example, `02/30/2026` becomes `2026-02-30` and can enter the history series. The durable history-cache validator checks only the same `YYYY-MM-DD` shape and positive close, so such a row can persist. Invalid sessions can distort historical windows and metrics that count bars or compare dates.

References: [date conversion](../lib/providers.ts#L419), [Nasdaq parsing/filter](../lib/providers.ts#L687), [cache validation](../lib/scanner.ts#L38).

### 5. Successful empty Nasdaq responses bypass the dated history fallback — Medium

The bundled dated history fallback is only used when `fetchJson` throws. A successful HTTP response with an empty or changed-schema payload reaches the no-sessions error after the catch, so the available local dated history is not used. When Yahoo and Cboe also fail, the issuer is marked as a history acquisition failure even if the bundled cache contains usable bars. This makes temporary provider/schema failures look like missing coverage.

Reference: [history provider fallback flow](../lib/providers.ts#L676).

### 6. SEC Frames failures advance without a durable retry per failed dataset — Medium

Frames requests are settled independently; a rejected request increments failure counters, but the stage cursor advances once the bounded page completes. Company Facts can later restore some core values, but optional fields and concepts not covered there can remain absent for this run after a transient Frames outage. A later full scan may repair coverage; the current run does not schedule the failed Frames dataset for retry.

References: [Frames outcomes](../lib/bulk.ts#L251), [cursor advancement](../lib/scanner.ts#L211).

### 7. Valuation score does not distinguish bear-case loss severity — Medium

The valuation score is bucketed from base-case margin of safety. If conservative value is below spot, it only caps the result at 4. Holding the price, base case, and methods constant, a bear value at 99% of spot and one at 10% of spot can receive the same score. The model records scenario assumptions, but the score discards almost all variation in downside severity.

Reference: [valuation score](../lib/opportunity-scoring.ts#L1013).

### 8. Missing quote positions can make portfolio diversification look better than it is — Low/Medium

Weights and the HHI are normalized over positions with usable prices only. Positions without quotes have `weight: null` and are excluded from the diversification score, while the alert only says their value is excluded from totals. If a large or concentrated holding has no quote, the displayed diversification/effective-holdings indicators describe the priced subset and can overstate whole-portfolio diversification.

Reference: [portfolio weights and HHI](../lib/portfolio.ts#L181).

## Material product and model limits (not code defects)

- **Predictive performance is unvalidated.** The bundled research data has no point-in-time fundamentals, delisted universe, or forward outcome labels; the project audit records only 12 cached-history symbols. There is no evidence that Opportunity scores predict returns. Keep probabilities and target prices disabled.
- **The final eight-factor ranking is evidence-constrained.** Price-history redistribution terms are unverified, and source coverage/review for valuation, catalysts, downside risk, competitive position, management, and technical timing is incomplete. The code correctly keeps these inputs unknown or zero-credit instead of inferring them, but the complete investment shortlist requested by the product is not yet supported.
- **Risk tolerance is stored as report context only.** The evaluator accepts and versions `riskTolerance`, but it does not change the score or coverage; a regression test explicitly confirms low and medium produce the same result. If users are meant to select a risk profile, the current control has no ranking effect.
- **Portfolio “return” is simple P&L divided by gross purchases.** The interface labels the denominator as total purchase cost, which is internally consistent, but this is not a time-weighted or money-weighted return and can be misleading across staggered contributions and realized sales. Keep the explanatory label prominent or add a standard return measure before using it for performance comparison.

Evidence baseline: [October 21 project audit](PROJECT_AUDIT_2026_10_21.md#data-inventory-and-model-limits), [source registry](../lib/source-registry.ts#L26), [risk context contract](../tests/engine/strategy.test.mjs#L855), [portfolio return calculation](../lib/portfolio.ts#L211).

## Current release and operations risks

- The audit fixes are deployed, but the current full scan has not completed. The rating-publication pass advanced through 7,280/7,538 and then completed. At 17:16 UTC the live status showed the scan in stage 1 at offset 2,500/7,538, still `running` and not paused for capacity. Do not treat this as a completed acquisition scan.
- Railway's October 21 security disclosure remains an operational follow-up. `BACKGROUND_SCAN_SECRET` was regenerated and is active in production. The unused app-side `DATABASE_URL` was removed from Railway's production variable configuration, and redeploy `f005432f-7599-4a7c-94a8-99971e54da7f` succeeded. A read-only remote process check confirmed `DATABASE_URL` is absent and `BACKGROUND_SCAN_SECRET` is configured. The app uses mounted SQLite and the source tree has no `DATABASE_URL` consumer. The separate Postgres service credential remains to be rotated through Railway's supported Database View controls after consumer review. `railway connect Postgres` reports no Railway TCP proxy, and the dashboard browser session is unauthenticated, so that supported rotation control was unavailable during this audit. A bounded application-log review found no explicit credential-leak or unauthorized-access markers, but Railway audit/activity logs were not accessible; app logs cannot establish their absence.
- Cold evaluation remains slow after deployment. A cold `/api/radar?status=1` call took about 67 seconds; first reads in the initial release took up to 256 seconds. Warm `/api/radar` requests were initially 37–81 ms, then 15 ms. Archive maintenance now batches ten issuers per transaction, but scheduled ticks reached 120 seconds and one later tick failed with `TimeoutError` before a 171-second tick; recent warm ticks run around 1–1.6 seconds. This does not clear the latency issue.
- Scanner capacity has failed before with a full SQLite volume and application errors. The unauthenticated import growth path is now gated and globally rate-limited, but storage headroom and retention should still be monitored.

Evidence: [current handoff](../HANDOFF.md#current-verified-state--2026-10-22), [production latency and volume history](PROJECT_AUDIT_2026_10_21.md#continuation-re-audit--2026-10-22).

## Recommended order of remediation

1. Make imports owner-scoped drafts or require an explicit privileged publication path; enforce aggregate retention/quotas and authenticate source claims before shared publication.
2. Put scan start/step/resume and account signup/login behind rate limits that apply to API clients, not just browser origins.
3. Add strict calendar-date validation at provider parsing and durable-cache boundaries; allow dated bundled history for a successful-but-empty provider response under explicit freshness rules.
4. Persist and retry individual failed SEC Frames resources or make their gaps explicit in run acceptance and retry policy.
5. Review the valuation downside mapping against the fixed rubric and disclose/implement risk-profile behavior before presenting it as a user-selectable score control.
6. Complete point-in-time outcome validation and market-data rights review before describing the score as predictive or the source coverage as production-complete.
7. Rotate the remaining Postgres credential through Railway's supported control after reviewing consumers; inspect Railway audit/activity logs when authenticated dashboard access is available. Keep cold-path latency, scan completion, storage headroom, and public ranking parity under production observation.

## Remediation status — 2026-10-22

Core audit fixes were deployed as commit `c68cba7` in Railway deployment `ee4d3e84-7f23-4358-b152-6da4d52236a8`. A scheduler/storage optimization discovered during live acceptance is committed as `dbd1b72` and deployed as Railway deployment `eade0c18-45fd-4519-a94c-f938fba5921a` (`SUCCESS`).

- Public snapshot imports now require an operator-only `RANK_IMPORT_SECRET`; the secret is not persisted by the browser. Publication is limited to three requests per hour per caller and across all callers. The import path therefore fails closed in environments without an operator secret.
- Scan start/step/resume, account signup/login, and radar writes now use database-coordinated fixed-window limits. Signup also has a per-address daily cap and an atomic global 10,000-account ceiling; expired sessions are purged during session creation.
- Nasdaq history dates now round-trip through calendar validation. Successful empty provider responses may use valid, dated bundled bars. Durable history cache rows are validated with the same strict date rule.
- Stage 4 retries transient SEC Frames page failures at the same cursor up to two additional attempts, while permanent HTTP failures advance and remain visible in run failure counters.
- Valuation score now applies explicit bear-case downside caps at 50%, 75%, 90%, and 100% of spot. The rubric identity is versioned `1.5.4-bear-loss-severity`; the markdown rubric and regression expectations were updated.
- Whole-portfolio concentration metrics are withheld whenever any holding lacks a quote. The UI discloses the missing-price limitation and labels the existing P&L denominator as gross purchase cost.
- Fixed the runtime test compilation list to include the new shared request limiter and added cross-client global-quota regression coverage.
- Live acceptance exposed a second storage bottleneck: the scheduler's historical archive maintenance wrote each of up to 50 issuers in its own database transaction. It now compresses and commits bounded groups of 10 issuers (20 SQL statements), reducing per-tick database round trips while keeping each transaction and its memory use bounded.

Final local verification for `c68cba7` plus `dbd1b72`: typecheck and lint passed; 278 engine tests passed; 112 runtime/API tests passed; 21 research-validation tests passed; production build passed as part of `npm test`; 89 repository/UI tests passed; `git diff --check` passed.

Live acceptance: archive batching was deployed as `eade0c18-45fd-4519-a94c-f938fba5921a`; the later credential-clearing redeploy `f005432f-7599-4a7c-94a8-99971e54da7f` is `SUCCESS` and remains the latest release. Home, radar and source-registry routes returned HTTP 200. After archive batching, one cold status request took about 128 seconds and a later cold request about 67 seconds; warm radar requests improved from 37–81 ms to 15 ms. Scheduled ticks first took 129.3, 91.5, 5.1, 2.6, 21.0, 113.4, 120.1, 33.7 and 2.8 seconds as the rating-publication cursor advanced from 6,240 through 7,280 of 7,538. That pass then completed; the scheduler advanced to quote refresh, where one tick timed out and the following tick took 171.2 seconds. Following the new deployment, a cold scheduler tick took 78.2 seconds; latest live status at 17:16 UTC showed run `db9901ac-9a17-4925-8436-d1784acd19ea` running at stage 1, offset 2,500/7,538, not paused for capacity. App logs show home/radar handlers at 198/126 ms, while one external home fetch took 38.1 seconds; source registry took 415 ms and a later warm radar request took 22 ms. The prior read-only volume check showed about 10.7 GB filesystem free and 0.67 GB reusable; it predates the latest release. The production scan is not complete, and archive batching has not eliminated cold-read latency or occasional long scheduler ticks.

### Remaining work that depends on external systems or product evidence

- Railway's October 21 disclosure recommends rotating environment variables and reviewing service/audit logs. The app's `BACKGROUND_SCAN_SECRET` has been rotated without revealing its value. `SEC_USER_AGENT` is a contact identity rather than an authentication secret. The unused app-side `DATABASE_URL` is removed from Railway configuration and absent from the successful runtime. The separate PostgreSQL credential still needs rotation through Railway's supported Database View controls after checking consumers. The CLI reports no PostgreSQL TCP proxy; the authenticated Database View and Railway audit/activity records were unavailable from the current browser session. The Railway environment does not configure `RANK_IMPORT_SECRET`, so public ranking imports continue to fail closed.
- Prediction quality cannot be established from the available data: there is no point-in-time/delisted historical universe or supported market-data redistribution permission. No local code change can supply that evidence; keep return probabilities and price targets disabled until an approved dataset and out-of-sample validation are available.
- Risk tolerance remains report context rather than a score modifier. The existing regression contract and product meaning need an explicit decision before changing score behavior.
- Remaining operational follow-up is to rotate the PostgreSQL credential through Database View after consumer review, and inspect Railway audit/activity records when authenticated access is available. Continue measuring cold reads, scheduler tick durations, scan progression, persistent-volume headroom, and quote/coverage parity. Archive batching is deployed, but current production still shows cold calls above a minute and occasional scheduler ticks near two minutes.

## Follow-up audit — 2026-10-23

Three more confirmed defects were found during independent cold-path, scoring-cadence, and persistence reviews. Their fixes are local and pass focused/full local verification; they are not yet in a Railway release.

### 8. Research-fit cold reads repeatedly evaluate JSON predicates and sort — High

The default radar view requests `fit=research`. Its query tested roughly 30 JSON predicates over the ranked snapshot join and sorted eligible rows using a computed financing-pass expression, despite already having a canonical materialized rank. A production browser request took about 255 seconds before showing 7,538 rows; the page initially remained in its loading state. The initial cold read likely includes other summary/coverage aggregates as well, so the query was a confirmed bottleneck but not necessarily the only contributor to end-to-end latency.

The local fix stores the predicate's exact eligibility and financing-pass results beside each materialized rank and indexes `(run_id, research_fit, research_fit_financing_pass DESC, rank_position)`. A version marker and per-run durable lease make the projection build idempotent and shared across concurrent readers. The page query retains the same filter, financing-first ordering, rank tie-break, search and pagination semantics. Runtime regression coverage compares the eligible set/order and canonical ranks, simulates an old projection version and isolated concurrent readers, and checks `EXPLAIN QUERY PLAN` for the composite index without a temporary sort. Summary and coverage JSON aggregates are still not persisted/indexed.

### 9. Technical timing accepted daily bars in weekly/monthly series — Medium

`intervalCadenceValid` checked only maximum gaps and total span, allowing consecutive weekdays to pass as weekly or monthly bars. The resulting values were then used as MA30w and monthly trend. The fix enforces minimum four-day weekly and twenty-day monthly gaps, with regressions for invalid daily-frequency inputs and valid holiday-shifted intervals. Opportunity spec `1.5.5-technical-bar-cadence` and trace rubric `technical-timing-v2-bar-cadence` invalidate saved evaluations under the prior gate; factor weights are unchanged.

### 10. Portfolio owner merge could bypass revision compare-and-swap — Medium

`mergeOwnerData` previously set the target portfolio revision to the maximum of source and target revisions. When they matched, transferred transaction rows changed the ledger without changing its revision. A concurrent write validated against the pre-merge ledger could then pass its compare-and-swap check. The local fix increments the target revision atomically when new source transaction IDs are actually transferred; runtime coverage verifies that an old revision cannot authorize a write after the merge.

### Follow-up verification and release state

- Verified locally on 2026-10-23: `npm run typecheck`, `npm run lint`, `npm run test:runtime` (279 engine and 113 runtime/API tests), `npm run test:research` (21), and `npm test` (production build and 89 repository/UI tests) all pass under Opportunity spec `1.5.5-technical-bar-cadence`; `git diff --check` passes. The 1.5.5 version bump still awaits its separate commit and deployment.
- The three logic/performance fixes plus the UI regression update are committed and pushed as `381afad`, and Railway deployment `c3d34467-7d5e-44ad-b255-19ce1b93d162` is `SUCCESS`. Deployment logs show `/api/radar` 200 in 211 ms, `/api/source-registry` 200 in 146 ms, and `/` 200 in 254 ms after release; a later radar handler completed in 30 ms. Shell HTTP probes timed out without receiving response bytes, so these confirm app-handler behavior/timing but not external browser round-trip acceptance. The corrected 1.5.5 rubric version is now fully locally verified and awaits separate deployment.
- The earlier browser acceptance independently confirmed a 255-second `/api/radar?fit=research` response with 7,538 rows and a visible loading delay. Concurrent diagnostic requests were also active during some later slow status/scheduler calls, so attribution for those other timeouts remains uncertain.
- The production scan remains unverified as complete. Latest deployment logs show `db9901ac-9a17-4925-8436-d1784acd19ea` in stage 11 at 2,072/5,947. Ticks were uneven at 134.7 seconds and then 9.8 seconds. Do not infer completion from the rating-publication pass or compare this changed stage denominator directly with the earlier stage 1 sample.
- External security follow-up is unchanged: supported Postgres credential rotation and Railway audit/activity log review require the authenticated Database View/dashboard. The outstanding user sign-in request remains unanswered; the app-side unused `DATABASE_URL` was removed and `BACKGROUND_SCAN_SECRET` rotated in the prior release.

### October 23 production stall investigation and remediation

- Railway deployment `b9dc5087-6946-4079-b56c-c9f5b11588fa` starts and listens on port 8080, but is not currently serviceable. After the app-only restart, one internal `/api/source-registry` probe still timed out after 15 seconds. A request in the prior process eventually logged `GET /api/radar 200 OK (714088ms)` before Railway terminated that process. Thus deployment `SUCCESS` is not evidence of a healthy HTTP service.
- Scheduler logs showed repeated request `TimeoutError`s every ~152 seconds, matching the supervisor's 150-second HTTP timeout plus its 2-second retry. The caller timeout does not cancel worker-side work. The scheduled path previously ran archive maintenance before discovering/resuming an active scan, and timed-out scheduler calls could be followed by more calls. This is a credible source of SQLite/runtime contention, but the available logs do not identify the exact blocked await; a DB-independent registry route also stalled.
- Local remediation now advances research-fit projection in durable 75-row slices (maximum 100), returns a retryable 409 while the projection is incomplete, and only selects the current saved rubric release for that work. The scheduler skips archival writes during active scans, serializes its in-process tick, and exponentially backs off after supervisor timeouts. These changes preserve the saved database and scan checkpoints. Runtime, typecheck, lint, research, build/UI, and whitespace gates pass locally.
- The earlier one-shot research-fit projection could hold the first eligible list read while evaluating all 7,538 rows in one write transaction. It is replaced locally by the resumable batches above; ordinary ranked reads no longer trigger the projection. The source registry timeout shows that this query was not the only production stall contributor.
- Production scan status at the last read-only database inspection: new-version run `a47912ef-b1de-4765-a653-9277ecb2f68f` was still running at stage 0, offset 0, total 0. The previous scan `db9901ac-9a17-4925-8436-d1784acd19ea` failed after the scoring-version change at stage 11, offset 2,216/5,947. Do not call the scan complete until a current-hash full scan reaches a terminal status and its saved rating revision is verified.
- A separate account-session credential issue still requires an authenticated Railway Dashboard session: rotate the unused Postgres service credential after checking consumers, and review Railway audit/activity logs. The application volume and active SQLite database were not reset or removed during this work.
