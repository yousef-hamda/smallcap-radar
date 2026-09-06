# Small-Cap Radar V2 — professional research terminal

Arabic RTL mobile-first PWA, hosted privately on Cloudflare Workers through Sites. **This is not the completed/validated V2 described in the supplied plan.** It is a working research foundation with a deliberately disabled final ranking. Do not interpret synthetic fixtures or referenced historical benchmark rates as market results.

## Implemented

- Professional Arabic RTL research terminal with a dense desktop table, responsive mobile layout, Core/Bounce filters, company gate/evidence detail, five-range historical chart, persistent favorites, JSON snapshot import and audit export.
- Cloudflare D1 self-initializing schema and migrations, immutable run identifiers and per-run snapshots/evaluations, explicit provider errors and a server-owned cursor with lease/offset concurrency protection. Chained Worker tasks continue after the browser closes; production verification on 2026-09-06 advanced the same run from offset 24 to 144 while the browser was closed.
- Standards-based Web Push completion notifications with VAPID signing and an explicit subscribe-and-test panel. On iPhone, install the PWA on the Home Screen, open it from the icon, and press **تفعيل واختبار** once.
- Nasdaq is the primary market-data source. A bundled official SEC/Nasdaq directory prevents a `403` or temporary provider outage from blocking scan startup. Quick mode evaluates 12 representative small-cap symbols from a bundled, dated Nasdaq history/SEC fundamentals cache. Full mode first applies security-type, valid-price and $25M–$2B size gates to the complete 7,675-symbol directory, then deep-scans only the surviving candidates (2,597 in the 2026-09-06 snapshot; 5,078 removed before expensive requests). Each step processes up to 12 symbols concurrently and keeps a durable cursor/retry queue. The complete end-to-end market run is still in progress and has not yet been benchmarked to completion.
- Shared versioned gate engine, Core/Legacy documented weights, no fabricated normalization/score. Bounce documented gates; unresolved liquidity requires explicit review.
- Conservative SEC annual + current YTD − prior YTD normalization, provenance, foreign-filer flag, unavailable-data handling. Some issuers require custom taxonomy support and remain incomplete.
- PIT availability filter, deterministic firm holdout assignment, firm bootstrap, Bonferroni correction, conservative Bounce exit simulation and costs.
- Web manifest and icons; offline fallback reads the last snapshot saved on the device. Installation and notification receipt still require final verification on the owner's physical phone; server-side VAPID request generation is covered by automated tests.
- 30 meaningful engine/normalization tests, TypeScript checking, production build.

## Not complete / not validated

Read [the requirement ledger](docs/ACCEPTANCE.md). Major gaps: full 14-stage bulk pipeline, SEC Frames integration, current verified shares and EV data, complete Form 4 ingestion (P-only utility exists), second source comparisons, company news/analyst/sector enrichment, production factor normalization, paper portfolio, full historical backtesting/reporting UI, immutable consumed holdout workflow, performance/failure-injection gates, and shadow run.

The original historical dataset and PDF are absent. Original 47.2%/37.2%/54.8% figures cannot be reproduced or asserted. Inflection, death spiral, factor normalization and several operating conventions were explicitly unresolved in the supplied plan. Final ranking is unconditionally disabled until these requirements are implemented and validated.

## Run and verify

```bash
npm ci
npm run typecheck
npm run test:engine
npm run build
```

The bundled verified build and install scripts target Linux. Use the supplied Sites development tooling for its supported runtime. Standard npm dev uses Vite/Vinext, with a logical D1 binding declared in `.openai/hosting.json`.

Current implementation uses **Vinext/React instead of the plan's TanStack Start**, matching the available supported hosting starter. Strategy/data modules are framework-independent. This is a documented architectural deviation, not a claim of exact plan compliance.

## Strategy contract

`lib/engine.ts` is the single strategy configuration/evaluator source. All absent critical metrics become UNKNOWN. Positive net income OR FCF passes the definitive profitability branch. Inflection has no invented substitute. Core/Legacy score returns null; Bounce returns gates only. UI candidate qualification is not a final research rank. Version suffix `draft.1` identifies unvalidated implementation conventions.

Operational conventions: 20-day median dollar volume for Core and Bounce (Bounce requires at least $150k); 3 calendar days quote freshness; 200-day fundamental period freshness; 30 fully completed consecutive weekly closing prices; calendar-month expiry clamped at month end, then first observed tradable open. These are conservative implementation choices, **not reproduced original settings**. SEC date-only filing records become available at end of filing day, intentionally conservative.

## Data and API

- `GET /api/radar`: most recent run and last available snapshots; explicit `dataRunId` identifies displayed data.
- `POST /api/radar`: same-origin `{action:'favorite',symbol}` or `{action:'import',records: Snapshot[]}`. Import max 500 records / 4MB; rejects duplicate symbols and malformed provenance.
- `POST /api/background-scan/start`: starts or revives a server-owned quick/full scan and returns immediately. The Worker passes a signed internal baton between bounded batches, so browser suspension does not control progress.
- `GET /api/push/key` and `POST /api/push/subscribe`: create the device subscription used for the completion alert. Expired subscriptions are removed automatically.
- `POST /api/scan`: retained as a bounded diagnostic/manual recovery API. Failed symbols enter a persistent queue with up to three total attempts; exhausted failures keep the run partial.
- `GET /api/export?kind=spec` and `?kind=schema`: strategy JSON or documented synthetic schema example.

Do not import the schema wrapper itself: import the actual array of sourced snapshots. Data are research inputs, not independently verified simply because they have been imported.

## GitHub ownership and backup

Connected account discovered: `yousef-hamda`. The available connector can write to an existing repository but has **no create-repository tool**, and no GitHub CLI credential is installed. No GitHub repository has been created. Source is checkpointed to this Site's source repository, which is not the user's requested GitHub backup.

After an empty private `yousef-hamda/small-cap-radar-v2` exists, synchronize this complete source tree to it. Keep `.openai/hosting.json` for this Site's identity. Do not copy site credentials, .env files, dependency directories, runtime caches or built archives into GitHub. The CI workflow runs typecheck, engine tests and build.

## Secrets and access

No supplied Cloudflare token or R2 key is used or embedded. The user's plan §76 specifically treats previously exposed credentials as compromised; replace those in Cloudflare before configuring a separate deployment. The Sites publication is public at the owner's explicit request so server-owned batches can re-enter the Worker without the private Sign in with ChatGPT gateway. Mutations enforce same-origin requests, but favorites and scan state are shared globally. Before using this as a multiuser service, add application-level authorization and per-user database scope.

## Sources

[SEC EDGAR API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), [SEC developer resources](https://www.sec.gov/about/developer-resources), [Nasdaq Trader symbol directory](https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs). Live provider requests can still fail or rate-limit; dated fallback data are labeled and no paid data license or service guarantee is included.
