# Small-Cap Radar V2

**Current deployments:** GitHub `master` is the code source for the live [Railway app](https://smallcap-radar-production.up.railway.app/). The original ChatGPT Site is a separate historical deployment. Earlier Sites release records remain under `docs/DEPLOYMENT_*.md`; they do not prove the Railway release passed physical-phone notification acceptance.

For maintainers, read the [project memory](docs/PROJECT_MEMORY.md), [operations memory](docs/OPERATIONS_MEMORY.md), and [handoff](HANDOFF.md) first. These files record the verified Railway storage/recovery state without secrets.

**حملة التحسين الحالية:** راجع [التغييرات والأدلة والفجوات](docs/IMPROVEMENT_CAMPAIGN_2026_09_08.md). ملاحظات الإصدارات الأقدم أدناه تاريخية؛ لا تثبت أداء النسخة الحالية أو اكتمال القبول.

**دراسة التقييم الجديدة (2026-09-11):** أضيف مختبر Backtest مجاني قابل لإعادة التشغيل في [free-price-backtest.mjs](research/free-price-backtest.mjs) وتقرير نتائجه في [ALGORITHM_IMPROVEMENT_REPORT_2026_09_11_AR.md](docs/ALGORITHM_IMPROVEMENT_REPORT_2026_09_11_AR.md). النتيجة النهائية الاستكشافية لـBounce هي `44.85%` مقابل خط أساس `41.87%` وعشوائي مطابق `42.01%` على 388 نتيجة/174 شركة؛ فاصل فرق الشركات يشمل الصفر، لذلك لم تُفعّل الأوزان الجديدة في الإنتاج. Core محجوب إلى أن تتوفر عينة Point-in-Time تشمل الأساسيات والنتائج والشركات المشطوبة.

للدليل العربي الكامل الذي يغطي المنتج، المحرك، البيانات، الفحص الخلفي، الواجهة، الإشعارات، الاختبارات، النشر، والفجوات المتبقية، راجع [README_FULL_AR.md](docs/README_FULL_AR.md).

Arabic RTL mobile-first PWA, currently deployed on Railway with an older separate ChatGPT Site deployment. It is a working research platform; the visible qualified-category scores are diagnostic rankings, not validated predictions or investment recommendations. Do not interpret synthetic fixtures or referenced historical benchmark rates as market results.

## Implemented

- Professional Arabic RTL research terminal with desktop stock cards, responsive mobile layout, Core/Bounce/favorites/portfolio tabs, company gate/evidence sheet, seven chart periods including an on-demand 1D intraday view, persistent favorites, JSON snapshot import and audit export.
- Private durable portfolio ledger with stock search, buy/sell transactions, weighted-average cost, fees, realized/unrealized P&L, live batched quotes with dated fallback, sourced historical performance, allocation treemap, company logos with deterministic fallback, concentration/sector alerts, strategy-weighted diagnostics and CSV export. See [PORTFOLIO_AR.md](docs/PORTFOLIO_AR.md).
- Cloudflare D1 self-initializing schema and migrations, immutable run identifiers and per-run snapshots/evaluations, explicit provider errors and a server-owned cursor with lease/offset concurrency protection. The background baton is implemented, but its production continuation must be re-verified after the authentication fix; see `docs/DIAGNOSTIC_REPORT_AR.md`.
- Standards-based Web Push completion notifications with VAPID signing and an explicit subscribe-and-test panel. On iPhone, install the PWA on the Home Screen, open it from the icon, and use the separate **تفعيل الإشعارات** and **اختبار الإشعار** buttons.
- The full scan follows a bulk-first architecture: the current Nasdaq/NYSE directory and SEC ticker-to-CIK map are loaded in bulk, quotes are requested in groups, 13 SEC XBRL Frames datasets plus optional IFRS overlays are merged, and a resumable Company Facts recovery stage fills missing standard facts per CIK before evaluation. Evaluation runs in bounded pages of 200 companies. Exact 20-session liquidity and historical Bounce metrics are verified from dated bars only for surviving candidates; a 10-day volume proxy never passes a gate. Bundled official SEC/Nasdaq data remain a dated, labeled fallback.
- Historical pre-rebuild benchmark recorded on 2026-09-06 (not proof of the current full-history scan): 7,675 exchange-listed securities loaded; 6,320 had quote coverage; 4,765 were removed by preliminary gates; all 2,910 candidates were evaluated in 27.1 seconds with zero processing failures. The 13 Frames datasets covered 2,381 candidates (81.8%). The browser was closed mid-run for 36 seconds; the same server run completed at stage 13 and appeared after reopening.
- Shared versioned engine, Core/Legacy documented weights, and transparent scores from 100 with per-factor points and coverage. Core and Bounce category membership requires every documented thesis, marketability and data-integrity gate to pass; the diagnostic score only orders qualified members. Failed/unknown rows remain in the scan report with reasons and a high score cannot rescue them.
- Conservative SEC annual + current YTD − prior YTD normalization, provenance, foreign-filer flag, unavailable-data handling. Some issuers require custom taxonomy support and remain incomplete.
- PIT availability filter, deterministic firm holdout assignment, firm bootstrap, Bonferroni correction, conservative Bounce exit simulation and costs.
- Web manifest and icons; device cache stores the last viewed snapshot; offline fallback reading is not implemented in the rebuilt UI. Installation and notification receipt still require final verification on the owner's physical phone; server-side VAPID request generation is covered by automated tests.
- The engine, runtime/API/provider, UI, TypeScript, ESLint, and production-build checks passed for the September 2026 QA changes. Re-run the full suite for each release; historical counts in older reports are not a substitute for a current run.

## Not complete / not validated

Read [the requirement ledger](docs/ACCEPTANCE.md). Major remaining gaps: complete Form 4 ingestion (P-only utility exists), a licensed secondary fundamentals source, company news/analyst enrichment, production factor normalization, full historical backtesting/reporting UI, immutable consumed holdout workflow, failure-injection gates and shadow run. Current SEC Frames provide debt/cash/share fields where reported, but coverage is not universal and split-adjusted dilution remains review-only.

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

On Railway this app still runs the Cloudflare-compatible local D1 binding. Attach a Railway volume to the web service at `/app/data`; the Vite configuration explicitly stores Miniflare state inside that runtime volume. Do not mount over `/app/.wrangler`: the build's deployment configuration lives there and hiding it prevents startup. `DATABASE_URL` alone does not replace D1 and must not be treated as persistence for this build.

Current implementation uses **Vinext/React instead of the plan's TanStack Start**, matching the available supported hosting starter. Strategy/data modules are framework-independent. This is a documented architectural deviation, not a claim of exact plan compliance.

## Strategy contract

`lib/strategy-spec.ts` is the single strategy configuration source and `lib/engine.ts` is the evaluator. All absent, future-dated, stale or unsupported critical metrics become UNKNOWN. Positive net income OR FCF satisfies the Core profitability gate. Core and Bounce expose auditable gate outcomes plus factor scores; only fully qualified rows enter their category ranking. UI ranking is not an investment recommendation. Draft versions identify unvalidated research conventions.

Operational conventions: 20-day median dollar volume for Core and Bounce (Bounce requires at least $150k); 3 calendar days quote freshness; 200-day fundamental period freshness; 30 fully completed consecutive weekly closing prices; calendar-month expiry clamped at month end, then first observed tradable open. These are conservative implementation choices, **not reproduced original settings**. SEC date-only filing records become available at end of filing day, intentionally conservative.

## Data and API

- `GET /api/radar?strategy=core|bounce|favorites&limit=150&offset=0`: paged qualified snapshots for Core/Bounce (highest current 0–100 diagnostic score first), or the owner's saved rows for favorites, plus full-run qualified/failed/unknown counts. Every excluded row remains available in the bounded scan report.
- `GET /api/company?symbol=...`: on-demand deep verification using detailed history and SEC Company Facts, cached for 30 minutes; this deliberately stays outside the market-wide hot path.
- `GET /api/chart?symbol=...`: on-demand current-session 5-minute chart data for the 1D period, with bounded caching and explicit Arabic provider errors.
- `GET|POST|PUT|DELETE /api/portfolio`: private owner-scoped ledger, bounded company-directory search and recalculated position/return summary. Mutations are same-origin and overselling is rejected against the full chronological ledger.
- `GET /api/portfolio-history`: aggregate performance series from sourced historical bars, cached for six hours. Stale or absent prices are not converted to zero and cannot silently bridge a chart gap.
- Wallet logos first load from a public company-logo image endpoint in the browser. `GET /api/portfolio-logo?symbol=...` remains the bounded same-origin fallback; it can return a ticker-mark when external logos are unavailable.
- `POST /api/radar`: same-origin `{action:'favorite',symbol,saved:boolean}` or `{action:'import',records: Snapshot[]}`. Favorites are private by platform identity or opaque visitor cookie and stored in D1. A new visitor starts with zero; legacy global favorites are not migrated to an arbitrary owner. Import max 500 records / 4MB; rejects duplicate symbols and malformed provenance.
- `POST /api/background-scan/start`: starts or revives a server-owned quick/full scan and returns immediately. The Worker passes a signed internal baton between bounded stages/pages, so browser suspension does not control progress.
- `POST /api/background-scan/resume`: same-origin recovery kick for an expired scan lease. The client may call it after observing a stale run; the scan cursor, retry queue and results remain server-owned.
- `GET /api/push/key` and `POST /api/push/subscribe`: create the device subscription used for the completion alert. Expired subscriptions are removed automatically.
- `POST /api/scan`: retained as a bounded diagnostic/manual recovery API. Failed symbols enter a persistent queue with up to three total attempts; exhausted failures keep the run partial.
- `GET /api/export?kind=spec`, `?kind=schema`, or `?kind=audit`: strategy JSON, documented synthetic schema example, or bounded run/audit log export.

Do not import the schema wrapper itself: import the actual array of sourced snapshots. Data are research inputs, not independently verified simply because they have been imported.

## GitHub ownership and backup

The owner repository exists at `https://github.com/yousef-hamda/smallcap-radar`; the deployment branch is `master`. Keep `.openai/hosting.json` for the original Site identity, but do not copy credentials, `.env` files, dependency directories, runtime caches, or built archives into GitHub. The current Railway storage and backup caveats are in `docs/OPERATIONS_MEMORY.md`.

## Secrets and access

No supplied Cloudflare token or R2 key is used or embedded. The Sites publication is public at the owner's explicit request. Scan state remains shared; new favorites are scoped server-side and use idempotent explicit save/remove operations. Anonymous visitors retain their list through an HttpOnly cookie; deleting that cookie loses access to that anonymous list. Broader scan/push authorization and production failure-injection testing remain open work.

## Sources

[SEC EDGAR API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), [SEC developer resources](https://www.sec.gov/about/developer-resources), [Nasdaq Trader symbol directory](https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs). Live provider requests can still fail or rate-limit; dated fallback data are labeled and no paid data license or service guarantee is included.
