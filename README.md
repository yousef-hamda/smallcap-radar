# Small-Cap Radar V2

**Deployment update:** version 60 is published at the user's explicit request on 2026-09-08. [Release record](docs/DEPLOYMENT_60.md). Browser acceptance remains pending; the source-checkpoint note below records the earlier state.

**حملة التحسين الحالية:** راجع [التغييرات والأدلة والفجوات](docs/IMPROVEMENT_CAMPAIGN_2026_09_08.md). ملاحظات الإصدارات الأقدم أدناه تاريخية؛ لا تثبت أداء النسخة الحالية أو اكتمال القبول.

للدليل العربي الكامل الذي يغطي المنتج، المحرك، البيانات، الفحص الخلفي، الواجهة، الإشعارات، الاختبارات، النشر، والفجوات المتبقية، راجع [README_FULL_AR.md](docs/README_FULL_AR.md).

Arabic RTL mobile-first PWA, published through Sites. It is a working research platform with a deliberately disabled final ranking until the remaining research requirements are validated. Do not interpret synthetic fixtures or referenced historical benchmark rates as market results.

## Implemented

- Professional Arabic RTL research terminal with a desktop stock cards, responsive mobile layout, Core/Bounce/favorites tabs, company gate/evidence sheet, seven chart period controls (intraday unavailable), persistent favorites, JSON snapshot import and audit export.
- Cloudflare D1 self-initializing schema and migrations, immutable run identifiers and per-run snapshots/evaluations, explicit provider errors and a server-owned cursor with lease/offset concurrency protection. The background baton is implemented, but its production continuation must be re-verified after the authentication fix; see `docs/DIAGNOSTIC_REPORT_AR.md`.
- Standards-based Web Push completion notifications with VAPID signing and an explicit subscribe-and-test panel. On iPhone, install the PWA on the Home Screen, open it from the icon, and use the separate **تفعيل الإشعارات** and **اختبار الإشعار** buttons.
- The full scan follows the legacy system's bulk-first architecture: Yahoo quotes in groups of 250 symbols, 13 required SEC XBRL Frames datasets plus optional IFRS overlays, then deterministic local evaluation in pages of 600 companies. Exact 20-session liquidity and historical Bounce metrics are verified from dated bars when a candidate reaches the history stage; a 10-day volume proxy never passes a gate. A bundled official SEC/Nasdaq directory and a dated official Frames snapshot are labeled as fallback data.
- Historical pre-rebuild benchmark recorded on 2026-09-06 (not proof of the current full-history scan): 7,675 exchange-listed securities loaded; 6,320 had quote coverage; 4,765 were removed by preliminary gates; all 2,910 candidates were evaluated in 27.1 seconds with zero processing failures. The 13 Frames datasets covered 2,381 candidates (81.8%). The browser was closed mid-run for 36 seconds; the same server run completed at stage 13 and appeared after reopening.
- Shared versioned gate engine, Core/Legacy documented weights, and a transparent Core diagnostic score from 100 with per-factor points and coverage. The score is deliberately diagnostic until the point-in-time validation gates are approved; failed hard gates cannot be rescued by a score. Bounce remains documented gates plus research ranking, not an invented production score.
- Conservative SEC annual + current YTD − prior YTD normalization, provenance, foreign-filer flag, unavailable-data handling. Some issuers require custom taxonomy support and remain incomplete.
- PIT availability filter, deterministic firm holdout assignment, firm bootstrap, Bonferroni correction, conservative Bounce exit simulation and costs.
- Web manifest and icons; device cache stores the last viewed snapshot; offline fallback reading is not implemented in the rebuilt UI. Installation and notification receipt still require final verification on the owner's physical phone; server-side VAPID request generation is covered by automated tests.
- 39 engine/normalization tests, 22 runtime/API/provider tests, 9 UI/Web-Push component tests, and 3 SQLite tests, TypeScript checking, ESLint and a verified production build.

## Not complete / not validated

Read [the requirement ledger](docs/ACCEPTANCE.md). Major remaining gaps: complete Form 4 ingestion (P-only utility exists), a licensed secondary fundamentals source, company news/analyst enrichment, production factor normalization, paper portfolio, full historical backtesting/reporting UI, immutable consumed holdout workflow, failure-injection gates and shadow run. Current SEC Frames provide debt/cash/share fields where reported, but coverage is not universal and split-adjusted dilution remains review-only.

The supplied README PDFs and ten screenshots were located. The old website and its public client code were inspected directly. Its server implementation and original point-in-time historical dataset remain unavailable here. Original historical success rates cannot be reproduced or asserted. Inflection, death spiral, factor normalization and several operating conventions were explicitly unresolved in the supplied plan. Final research ranking remains disabled.

## Run and verify

```bash
npm ci
npm run typecheck
npm run test:engine
npm run test:runtime
npm run build
```

The bundled verified build and install scripts target Linux. Use the supplied Sites development tooling for its supported runtime. Standard npm dev uses Vite/Vinext, with a logical D1 binding declared in `.openai/hosting.json`.

Current implementation uses **Vinext/React instead of the plan's TanStack Start**, matching the available supported hosting starter. Strategy/data modules are framework-independent. This is a documented architectural deviation, not a claim of exact plan compliance.

## Strategy contract

`lib/strategy-spec.ts` is the strategy configuration source and `lib/engine.ts` is the evaluator. All absent critical metrics become UNKNOWN. Positive net income OR FCF passes the definitive profitability branch. Inflection has no invented substitute. Core/Legacy expose diagnostic factor scores, returning null after hard-gate failure; Bounce exposes gate completion and no validated predictive score. UI candidate qualification is not a final research rank. Draft versions identify unvalidated implementation conventions.

Operational conventions: 20-day median dollar volume for Core and Bounce (Bounce requires at least $150k); 3 calendar days quote freshness; 200-day fundamental period freshness; 30 fully completed consecutive weekly closing prices; calendar-month expiry clamped at month end, then first observed tradable open. These are conservative implementation choices, **not reproduced original settings**. SEC date-only filing records become available at end of filing day, intentionally conservative.

## Data and API

- `GET /api/radar?strategy=core|bounce|favorites&limit=150&offset=0`: paged qualified/favorite snapshots plus counts; explicit `dataRunId` identifies displayed data. This bounded contract avoids returning the full historical snapshot table in one response.
- `GET /api/company?symbol=...`: on-demand deep verification using detailed history and SEC Company Facts, cached for 30 minutes; this deliberately stays outside the market-wide hot path.
- `POST /api/radar`: same-origin `{action:'favorite',symbol,saved:boolean}` or `{action:'import',records: Snapshot[]}`. Favorites are private by platform identity or opaque visitor cookie and stored in D1. A new visitor starts with zero; legacy global favorites are not migrated to an arbitrary owner. Import max 500 records / 4MB; rejects duplicate symbols and malformed provenance.
- `POST /api/background-scan/start`: starts or revives a server-owned quick/full scan and returns immediately. The Worker passes a signed internal baton between bounded stages/pages, so browser suspension does not control progress.
- `GET /api/push/key` and `POST /api/push/subscribe`: create the device subscription used for the completion alert. Expired subscriptions are removed automatically.
- `POST /api/scan`: retained as a bounded diagnostic/manual recovery API. Failed symbols enter a persistent queue with up to three total attempts; exhausted failures keep the run partial.
- `GET /api/export?kind=spec`, `?kind=schema`, or `?kind=audit`: strategy JSON, documented synthetic schema example, or bounded run/audit log export.

Do not import the schema wrapper itself: import the actual array of sourced snapshots. Data are research inputs, not independently verified simply because they have been imported.

## GitHub ownership and backup

Connected account discovered: `yousef-hamda`. The available connector can write to an existing repository but has **no create-repository tool**, and no GitHub CLI credential is installed. No GitHub repository has been created. Source is checkpointed to this Site's source repository, which is not the user's requested GitHub backup.

After an empty private `yousef-hamda/small-cap-radar-v2` exists, synchronize this complete source tree to it. Keep `.openai/hosting.json` for this Site's identity. Do not copy site credentials, .env files, dependency directories, runtime caches or built archives into GitHub. The CI workflow runs typecheck, engine tests and build.

## Secrets and access

No supplied Cloudflare token or R2 key is used or embedded. The Sites publication is public at the owner's explicit request. Scan state remains shared; new favorites are scoped server-side and use idempotent explicit save/remove operations. Anonymous visitors retain their list through an HttpOnly cookie; deleting that cookie loses access to that anonymous list. Broader scan/push authorization and production failure-injection testing remain open work.

## Sources

[SEC EDGAR API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), [SEC developer resources](https://www.sec.gov/about/developer-resources), [Nasdaq Trader symbol directory](https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs). Live provider requests can still fail or rate-limit; dated fallback data are labeled and no paid data license or service guarantee is included.
