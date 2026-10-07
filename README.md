# Small-Cap Radar V2

**Verified production (2026-10-07):** rubric `1.2.6-stable-import-identities` ranks **all 7,506 listings**, with 60,048 numeric factor grades, zero missing factors/final grades and exact persistence/API/report/profile/export/UI agreement. Deployment `7a9f861a-4b77-41aa-a09f-dbc4f9fcbf2e`; application archive `6c452e5`. Source collection, financial normalization, intrinsic/peer models, unattended scanning, pinned ranking releases and lossless storage recovery are implemented. Read the [final audit](docs/SYSTEM_IMPROVEMENT_FINAL_AUDIT_2026_10_07.md), [verification record](docs/SYSTEM_IMPROVEMENT_PRODUCTION_VERIFICATION_2026_10_07.json), [test ledger](docs/SYSTEM_IMPROVEMENT_TEST_LEDGER_2026_10_07.md) and [changed files](docs/SYSTEM_IMPROVEMENT_CHANGED_FILES_2026_10_07.md). Factual source gaps and predictive probabilities remain unvalidated; the broader buying-success objective is not certified complete.

**Historical production proof (2026-10-06):** rubric `1.0.3-deterministic-universe-ranking` ranks all 6,954 listings using their final fixed-weight 100-point grades. All 55,632 factor grades are numeric; missing factors/final grades: zero. Persistence, all radar/report/profile responses and every displayed ranking row agree. Deployment `e5b84029-4167-4170-b7c3-9f7c3cdca494`, application commit `434b3a3`. See the [complete audit](docs/COMPLETE_RANKING_AUDIT_2026_10_05.md), [model contract](docs/COMPLETE_RANKING_MODEL_2026_10_06.md) and [verification record](docs/COMPLETE_RANKING_PRODUCTION_VERIFICATION_2026_10_06.json). Historical zero-ranking checkpoints below are superseded.

For maintainers, read the [project memory](docs/PROJECT_MEMORY.md), [operations memory](docs/OPERATIONS_MEMORY.md), and [handoff](HANDOFF.md) first. These files record the verified Railway storage/recovery state without secrets.

**حملة التحسين الحالية:** راجع [التغييرات والأدلة والفجوات](docs/IMPROVEMENT_CAMPAIGN_2026_09_08.md). ملاحظات الإصدارات الأقدم أدناه تاريخية؛ لا تثبت أداء النسخة الحالية أو اكتمال القبول.

**دراسة 2026-09-11 تاريخية فقط:** تقرير [ALGORITHM_IMPROVEMENT_REPORT_2026_09_11_AR.md](docs/ALGORITHM_IMPROVEMENT_REPORT_2026_09_11_AR.md) يخص مناهج Core/Bounce التي أُزيلت من واجهة الفئات الحالية؛ لا تمثل نتيجته اختبارًا للفئة الموحدة ولا دليلًا على صلاحيتها. المتطلبات الحالية للتحقق التاريخي والتغطية مدونة في [خطة الفئة الموحدة](docs/UNIFIED_OPPORTUNITY_CATEGORY_PLAN_2026_09_30.md).

للدليل العربي الكامل الذي يغطي المنتج، المحرك، البيانات، الفحص الخلفي، الواجهة، الإشعارات، الاختبارات، النشر، والفجوات المتبقية، راجع [README_FULL_AR.md](docs/README_FULL_AR.md).

Arabic RTL mobile-first PWA, currently deployed on Railway with an older separate ChatGPT Site deployment. It is a working research platform; the visible ranking uses the actual final fixed-weight grade for every listing. Return probabilities and buying outcomes are unvalidated. Do not interpret synthetic fixtures or referenced historical benchmark rates as market results.

## Implemented

- Professional Arabic RTL research terminal with one Opportunity category, separate favorites and portfolio tools, responsive company evidence sheet, seven chart periods including on-demand 1D intraday view, persistent favorites, JSON snapshot import and audit export.
- Private durable portfolio ledger with stock search, buy/sell transactions, weighted-average cost, fees, realized/unrealized P&L, live batched quotes with dated fallback, sourced historical performance, allocation treemap, company logos with deterministic fallback, concentration/sector alerts, strategy-weighted diagnostics and CSV export. See [PORTFOLIO_AR.md](docs/PORTFOLIO_AR.md).
- Cloudflare D1 self-initializing schema and migrations, immutable run identifiers and per-run snapshots/evaluations, explicit provider errors and a server-owned cursor with lease/offset concurrency protection. The secret-protected native scheduler advances durable scan checkpoints without an open browser; global provider quotas and SQLite leases coordinate requests.
- Standards-based Web Push completion notifications with VAPID signing and an explicit subscribe-and-test panel. On iPhone, install the PWA on the Home Screen, open it from the icon, and use the separate **تفعيل الإشعارات** and **اختبار الإشعار** buttons.
- The full scan follows a bulk-first architecture: both complete official Nasdaq Trader directories and the SEC ticker-to-CIK map are loaded in bulk, quotes are requested in groups, SEC XBRL Frames are merged, and a resumable issuer-deduplicated Company Facts stage attempts standard facts for CIK-linked common shares. Evaluation runs in bounded pages. Market safety fields remain separate from SEC acquisition; missing evidence does not pass a gate. The checksum-verified last complete official directory remains a dated fallback; partial directory downloads cannot replace full membership. Unconfirmed tracked listings remain scored and visible.
- Historical pre-rebuild benchmark recorded on 2026-09-06 (not proof of the current full-history scan): 7,675 exchange-listed securities loaded; 6,320 had quote coverage; 4,765 were removed by preliminary gates; all 2,910 candidates were evaluated in 27.1 seconds with zero processing failures. The 13 Frames datasets covered 2,381 candidates (81.8%). The browser was closed mid-run for 36 seconds; the same server run completed at stage 13 and appeared after reopening.
- The active versioned Opportunity evaluator uses fixed 25/20/15/12/10/10/5/3 weights, produces all eight final factor grades for every listing and exposes research/safety findings separately from ranked state. Historical Core/Bounce evaluators are retained for research and old saved data only; they do not drive current app navigation or ranking.
- Conservative SEC annual + current YTD − prior YTD normalization, provenance, foreign-filer flag, unavailable-data handling. Some issuers require custom taxonomy support and remain incomplete.
- Point-in-time availability filters, deterministic firm holdout assignment, firm bootstrap and Bonferroni correction. Forward outcome measurement supports 1/3/6/12-month price-only returns and does not validate the Opportunity model.
- Web manifest and icons; device cache stores the last viewed snapshot; offline reading displays the cached subset with its exact saved factors, final grades, ranks and release identity. Installation and notification receipt still require final verification on the owner's physical phone; server-side VAPID request generation is covered by automated tests.
- The engine, runtime/API/provider, UI, TypeScript, ESLint, and production-build checks passed for the September 2026 QA changes. Re-run the full suite for each release; historical counts in older reports are not a substitute for a current run.

## Not complete / not validated

Read [the requirement ledger](docs/ACCEPTANCE.md) and [the unified category plan](docs/UNIFIED_OPPORTUNITY_CATEGORY_PLAN_2026_09_30.md). Major remaining gaps: fully diluted/senior-claim and specialized-sector valuation, reviewed catalyst economics, complete risk/governance and management diligence, rights-cleared market history, and point-in-time/delisted total-return calibration. Production was backed up privately and restoration was verified. Incomplete source dossiers reduce coverage; every listing still receives a complete model rating and rank. Free endpoint access does not imply commercial reuse or display rights.

The original site's server implementation and point-in-time historical dataset remain unavailable here. Original historical success rates cannot be reproduced or asserted. The complete final ranking includes every saved listing, with source completeness and safety findings shown separately; no prediction/probability claim is enabled or validated.

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

`lib/opportunity-spec.ts` is the sole active category contract. It uses the fixed 25/20/15/12/10/10/5/3 factor weights, a six-month default horizon, no market-cap floor/ceiling, and a separately stated $150,000 20-session median-dollar-volume tradability floor. Every listing has eight numeric grades and one final score; ranking includes all listings. Unknown, stale or missing components receive zero model credit. Valid reviewed partial grades include their known proportion once. Evidence coverage and safety checks describe diligence separately from rating availability. Score is `round(sum(factorGrade * fixedWeight / 10), 2)`; ties use symbol ascending. Profiles, reports and ranking reuse canonical saved evaluations. The rating is not an expected return or recommendation. Old Core/Bounce evaluators remain historical artifacts.

Point-in-time outcome utilities now measure price-only forward returns at 1, 3, 6, or 12 months, selecting the first observed close on or after the horizon. They do not apply the former Bounce target/stop rule and do not claim total return because dividends are not included. They are measurement helpers, not proof that the unified score predicts returns. SEC date-only filing records become available at end of filing day, intentionally conservative.

## Data and API

- `GET /api/radar?strategy=opportunity&state=ranked|needs-research|excluded|all&limit=40&offset=0`: paged unified results. The UI starts at `ranked`, including every listing. Diagnostic research/exclusion filters remain API compatibility options without changing the final ranked universe. `strategy=favorites` is the separate saved-items view. Legacy query values resolve to Opportunity for old clients; no legacy evaluation is returned.
- `GET /api/company?symbol=...`: returns the canonical production snapshot, saved grade and universe rank for scanned listings. Companies outside the saved universe use on-demand source acquisition with a 30-minute cache; evidence limitations remain explicit.

SEC requests use a configured `SEC_USER_AGENT` with a reachable administrator contact; it is stored as a host secret and must not be committed. Live requests previously returned identity-matched HTTP 200 for eight sampled CIKs. That sample does not prove complete issuer coverage; 403s and missing or nonstandard facts remain possible and are surfaced per company.
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
