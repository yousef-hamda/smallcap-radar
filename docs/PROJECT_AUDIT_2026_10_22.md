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

- The authoritative handoff says the local cross-batch outcome/recovery follow-up is pushed, but production still runs the earlier deployment because Railway builds are paused. Do not treat local scanner fixes or local checks as production acceptance until the code is deployed and a live scan is observed.
- The same handoff records Railway's October 21 security disclosure concerning possible encrypted environment-variable access. It says no variables were rotated in that continuation; the app still depends on `BACKGROUND_SCAN_SECRET`, SEC identity, and storage credentials/configuration. This is an unresolved operational security action, not a confirmed compromise.
- Cold radar evaluation remains a separate latency risk: the previous production sample took 54.8 seconds for one cold radar read and 114 seconds for first home render, with warm reads below 0.5 seconds. Current handoff's sub-second checks are warm/status paths and do not clear the cold-cache issue.
- Scanner capacity has failed before with a full SQLite volume and application errors. The unauthenticated import growth path makes aggregate storage limits and retention policy especially important.

Evidence: [current handoff](../HANDOFF.md#current-verified-state--2026-10-22), [production latency and volume history](PROJECT_AUDIT_2026_10_21.md#continuation-re-audit--2026-10-22).

## Recommended order of remediation

1. Make imports owner-scoped drafts or require an explicit privileged publication path; enforce aggregate retention/quotas and authenticate source claims before shared publication.
2. Put scan start/step/resume and account signup/login behind rate limits that apply to API clients, not just browser origins.
3. Add strict calendar-date validation at provider parsing and durable-cache boundaries; allow dated bundled history for a successful-but-empty provider response under explicit freshness rules.
4. Persist and retry individual failed SEC Frames resources or make their gaps explicit in run acceptance and retry policy.
5. Review the valuation downside mapping against the fixed rubric and disclose/implement risk-profile behavior before presenting it as a user-selectable score control.
6. Complete point-in-time outcome validation and market-data rights review before describing the score as predictive or the source coverage as production-complete.
7. Resume deployment only after Railway permits it; rotate affected secrets, deploy the reviewed SHA, then verify fresh acquisition, cold reads, storage headroom, and public ranking parity.

## Remediation status — 2026-10-22

Core audit fixes were deployed as commit `c68cba7` in Railway deployment `ee4d3e84-7f23-4358-b152-6da4d52236a8`. A further scheduler/storage optimization discovered during live acceptance is implemented locally and is awaiting its final verification and deployment.

- Public snapshot imports now require an operator-only `RANK_IMPORT_SECRET`; the secret is not persisted by the browser. Publication is limited to three requests per hour per caller and across all callers. The import path therefore fails closed in environments without an operator secret.
- Scan start/step/resume, account signup/login, and radar writes now use database-coordinated fixed-window limits. Signup also has a per-address daily cap and an atomic global 10,000-account ceiling; expired sessions are purged during session creation.
- Nasdaq history dates now round-trip through calendar validation. Successful empty provider responses may use valid, dated bundled bars. Durable history cache rows are validated with the same strict date rule.
- Stage 4 retries transient SEC Frames page failures at the same cursor up to two additional attempts, while permanent HTTP failures advance and remain visible in run failure counters.
- Valuation score now applies explicit bear-case downside caps at 50%, 75%, 90%, and 100% of spot. The rubric identity is versioned `1.5.4-bear-loss-severity`; the markdown rubric and regression expectations were updated.
- Whole-portfolio concentration metrics are withheld whenever any holding lacks a quote. The UI discloses the missing-price limitation and labels the existing P&L denominator as gross purchase cost.
- Fixed the runtime test compilation list to include the new shared request limiter and added cross-client global-quota regression coverage.
- Live acceptance exposed a second storage bottleneck: the scheduler's historical archive maintenance wrote each of up to 50 issuers in its own database transaction. It now compresses and commits bounded groups of 10 issuers (20 SQL statements), reducing per-tick database round trips while keeping each transaction and its memory use bounded.

Final local verification for `c68cba7` plus the archive batching follow-up: typecheck and lint passed; 278 engine tests passed; 112 runtime/API tests passed; 21 research-validation tests passed; production build passed as part of `npm test`; 89 repository/UI tests passed; `git diff --check` passed. The archive batching follow-up is ready for a second deployment; it is not yet in production.

Live acceptance: Railway reports `ee4d3e84-7f23-4358-b152-6da4d52236a8` as `SUCCESS`. Home, radar, and source-registry routes returned HTTP 200. First reads took 165.7–256.4 seconds; subsequent observed reads took 7–137 ms. Railway logs show the first scheduled tasks taking 474.2, 213.4, 122.9, and 108.1 seconds, then normal ticks at roughly 1.4–2.7 seconds as the new run warmed and published ratings. The scan advanced from stage 0 to stage 1 across 7,538 listings; its rating-publication cursor reached at least 720. Direct read-only filesystem inspection showed about 10.7 GB free and 0.67 GB reusable, so the initial delay was not caused by the volume reserve. A fresh production scan is still in progress; do not interpret it as complete coverage.

### Remaining work that depends on external systems or product evidence

- Railway's October 21 disclosure recommends rotating all environment variables and reviewing service/audit logs. The app's `BACKGROUND_SCAN_SECRET` has been rotated without revealing its value, and the successful deployment now runs with the new value. `DATABASE_URL` and `SEC_USER_AGENT` remain set in the app environment; the app uses its mounted SQLite store and does not reference `DATABASE_URL`, but the separate PostgreSQL service credential still needs rotation through Railway's supported Database View controls and its consumers checked. The Railway environment does not currently configure `RANK_IMPORT_SECRET`, so public ranking imports continue to fail closed.
- Prediction quality cannot be established from the available data: there is no point-in-time/delisted historical universe or supported market-data redistribution permission. No local code change can supply that evidence; keep return probabilities and price targets disabled until an approved dataset and out-of-sample validation are available.
- Risk tolerance remains report context rather than a score modifier. The existing regression contract and product meaning need an explicit decision before changing score behavior.
- The new archive batching hotfix needs final verification and a production deployment. Afterward, measure cold and warm reads, archive-maintenance tick durations, scan progression, persistent-volume headroom, and quote/coverage parity again. The first release's cold path reached 256 seconds; the warm path was under 150 ms.
