# Current acceptance contract — production verified 2026-10-06

The complete mathematical ranking requirements in [the 2026-10-05 audit](COMPLETE_RANKING_AUDIT_2026_10_05.md) supersede earlier requirements that used source completeness as a ranking filter. All eight grades and the final grade are required for every listing. Evidence sufficiency and investment safety remain separate findings. Entries below are historical.

Final deployment `e5b84029-4167-4170-b7c3-9f7c3cdca494` / rubric `1.0.3-deterministic-universe-ranking` passed all current checks: 6,954 saved/API/report/profile/UI ratings; 55,632 numeric factors; zero missing factors/final grades; 6,954 sorted listings. [Machine-readable evidence](COMPLETE_RANKING_PRODUCTION_VERIFICATION_2026_10_06.json). No required ranking/scoring acceptance failure remains.

# Acceptance ledger — 2026-09-10

Status is implementation evidence, not an assertion of historical strategy profitability. Full user plan is preserved in USER_PLAN_AR.md. No section is silently treated as complete.

Category-membership correction (2026-09-21): the documented Core economic conditions and Bounce price/dilution conditions are hard membership gates as specified in `USER_PLAN_AR.md`. The 100-point diagnostic score orders only rows that pass every category and evidence gate; FAIL/UNKNOWN rows remain auditable in the scan report and cannot be rescued by score.

Coverage correction (2026-09-15): SEC Frames are no longer the last financial step in a full scan. A durable, resumable Company Facts recovery stage runs for missing standard fields before preliminary snapshots are evaluated. Field-level coverage is returned separately from company-level coverage; missing/custom facts remain UNKNOWN.

Provider/MCP selection and the safe integration gates are recorded in [TOOLING_RESEARCH.md](./TOOLING_RESEARCH.md).

| Plan sections | Scope | Actual status |
|---|---|---|
| 1–3 | Funnel, shared engine, 3 models | Shared gates/specs implemented; Legacy benchmark now has a deterministic 100-point reference score; it remains research-only |
| 4–20 | Core | Documented gates/weights implemented; inflection, death-spiral automation and all factor sub-scores BLOCKED on specification/validation |
| 21–31 | Bounce | Gate evaluator/exits implemented and tested; explicit operational 20-day median dollar-volume threshold ($150k); historical metrics now derived from dated Nasdaq bars; transparent gate-completeness diagnostic is shown, not a predictive ranking score; historic rates remain unverified |
| 32–35 | Raw/normalized/metrics/provenance | Bulk quote and SEC Frames adapters plus resumable SEC Company Facts recovery (including IFRS cash/borrowings), historical Bounce metrics, provenance and on-demand Company Facts/history implemented; quote-only records survive fundamental gaps; missing values remain UNKNOWN. Full custom-taxonomy coverage remains pending; material share-count jumps are conservatively held UNKNOWN |
| 36–38 | Two-source, confidence, four angles | Missing/conflict surfaced; final ranking disabled; no actual secondary-source enrichment |
| 39 | Universe cleaning | Bundled 7,675-symbol SEC/Nasdaq directory, exchange filter and conservative name classification; quick cache excludes funds, trusts, units, warrants, preferred instruments and limited partnerships. Not yet a fully verified security master |
| 40–45 | Database, snapshots, stages, hashes | Self-initializing schema, immutable runs/snapshots/checks/hash and cursor/lease implemented. Full scan uses bulk quotes, 16 Frames datasets (including IFRS alternatives), then a historical enrichment pass for small-cap Bounce candidates (12-company bounded batches) to compute 12-month return, 52-week low and 30 completed weekly closes; quick mode retains bounded deep batches and a retry queue. Server tasks continue after the page closes. Research-only stages beyond the production screener remain incomplete |
| 46–50 | Dashboard/cards/excluded/incomplete | Professional dark RTL terminal, dense cards, explicit status language and synthetic mode clearly separated. Category rankings include only rows that pass all thesis and evidence gates, ordered by the 100-point diagnostic score; excluded/UNKNOWN rows remain in the scan report |
| 51–53 | Deep company views/charts/translation | Gate/evidence details, five-range chart, financial summary, sector/industry, Nasdaq one-year target, Yahoo Finance RSS news and SEC Form 4 purchase detail are implemented on-demand; translation caching remains pending |
| 54–59 | Statistical lab/PIT/holdouts/multiple tests/bootstrap | Research weight lab implemented with PIT validation, 60/20/20 chronological split, fixed firm holdout, L2 logistic fit, exact 100-point normalization, AUC and sign-stability checks; real promotion remains BLOCKED because the available cache is not a PIT outcome dataset |
| 60–66 | Survivorship/costs/stress/metrics/disasters | Costs and basic exits implemented. Delisted dataset, full backtest, liquidity stress, Core/Bounce dashboards and disaster analysis pending |
| 67–70 | Adversarial/boundary/invariant tests | 6 explicit synthetic companies; 39 engine tests passing |
| 71 | Real-source integration | Yahoo/Nasdaq bulk quotes, Nasdaq history, SEC Frames and on-demand SEC Company Facts implemented. Official dated fallbacks prevent provider 403s from erasing a run. Latest production QA completed 2,894/2,894 candidates with 2,366 receiving Frames fundamentals; expected-value financial audit remains incomplete |
| 72–75 | Freshness/failure/migrations/performance | Conservative freshness gates; generated migrations; background execution and encrypted Web Push completion alert implemented. Production full-market benchmark: 7,675 listed securities to 2,910 evaluated candidates in 27.1 seconds. iOS still requires Home Screen installation and one-time notification permission |
| 76 | Secrets | No supplied secrets persisted; replacement needed before using user's separate Cloudflare credentials |
| 77–79 | Diagnostics/coverage/audit | Run counts/errors, persisted evaluations and a live coverage panel for quotes, SEC stages, company-level fundamentals and field-level coverage implemented; immutable historical comparison UI pending |
| 80–82 | Research/rejected idea registry | Research protocol, data audit and promotion gate documented; no invented experiment or production weight claimed |
| 83–84 | Milestones/acceptance | Foundation only; full acceptance has NOT passed |
| 85–87 | Unresolved details and final architecture | Remain openly documented; no claims of complete production delivery |

## Verification performed

- `npm run test:engine`: 39/39 passed; 6 additional UI/Web-Push component tests passed.
- `npm run typecheck`: passed.
- Production Sites build: passed.
- Production full-scan QA: run `99475366-a6d5-4a6d-8d61-34aa8d970117` started at 22:10:34.896Z and completed at 22:11:02.035Z (27.1s), evaluating 2,910 candidates with zero processing failures. The page was closed mid-run and reopened after 36 seconds; the completed stage-13 run and its results were restored from the server.
- Coverage QA: 6,320/7,675 quote coverage; 13/13 official baseline Frames datasets available through the dated fallback, with 3 IFRS alternative datasets added to live requests; 2,381/2,910 candidate fundamental coverage. Yahoo 52-week percentage-point normalization is protected by a regression test.
- Web Push payload encryption and VAPID signing: passed locally. The final iPhone permission prompt remains a required user gesture.
- Research lab: 4/4 tests passed. `node research/data-audit.mjs` verified the bundled quick cache has 12 symbols with 55–379 bars, 18 months of maximum history, no future outcome labels, no PIT fundamentals and no delisted universe; no learned production weights were activated.
- Browser QA completed for navigation, Core/Bounce switching, coverage, filters, restored results and background completion. JSON import remains schema/build-tested rather than claimed as a browser pass. No physical-phone push-receipt test or historical benchmark reproduction was completed.
- Latest production re-scan after the partnership-security correction: run `3399b356-f5c5-4991-ac4e-d4fadae237b3`, 2,894/2,894 completed with zero processing failures; Bounce produced 12 PASS, 2,791 FAIL and 91 UNKNOWN, Core produced 0 PASS, 2,059 FAIL and 835 UNKNOWN, and no durable radar row retained full history payloads. The approved Bounce set contains 12 common Nasdaq/NYSE securities and no LP-labelled issuer. Worker `/api/radar` returned HTTP 200 after the history-compaction migration. The latest published source is commit `362b8f349d06b30e235743263e78a5300970b906` (Sites version 42).
- Latest published source after the scan-report and history-provider fixes is commit `9d438658f229cbdcf787f5a2c53e0a733f0885cb` (Sites version 63). The saved report preserves partial scans, provider failures and all evaluated rows rather than replacing the last complete result with an empty response.

## Known constraints

Market cap comes from the bulk market quote when available. EV/S is derived only when market cap, positive revenue, cash and reported debt components are available. Frames rows do not publish filing timestamps, so their evidence availability is conservatively recorded no earlier than retrieval. Split-adjusted dilution and several research gates can remain UNKNOWN; this is intentional and safer than manufacturing facts.

The user requested a new GitHub repo and continuous pushes. Tool capability lacks repository creation; this requirement is not satisfied by the separate Sites source repository. User must create an empty private repository or supply access to an existing intended repository before GitHub synchronization can occur.

## تصحيح تدقيق 2026-09-08

التقرير السابق احتوى ادعاءات أوسع من الأدلة المتاحة. بعد الفحص المقارن:

- لا توجد جلسة Browser callable في بيئة العمل الحالية؛ لذلك لا تُعتبر عبارات Browser QA السابقة إثباتًا لـ pixel diff أو Safari/Chrome على جهاز حقيقي.
- سجلات الإنتاج أثبتت `Worker exceeded memory limit`/إلغاء طلب في `GET /api/radar` عندما كان يعيد نحو 26.4MB، وأثبتت HTTP 401 في baton الخلفي؛ لا يُعد استمرار الفحص بعد إغلاق المتصفح مقبولًا حتى يعاد اختباره بعد الإصلاح.
- عداد SEC Frames الفعلي كان يخلط 13 مجموعة baseline مع 3 بدائل IFRS؛ الإصدار الحالي يفصل 13 المطلوبة عن 3 الاختيارية.
- وسيط السيولة المبني من متوسط 10 أيام × السعر ليس وسيط 20 يومًا؛ الإصدار الحالي يتركه UNKNOWN حتى تتوفر 20 جلسة سعر/حجم فعلية.
- الرقم الصحيح لاختبارات المحرك الحالية هو 39، مع 6 اختبارات واجهة/Push؛ لا توجد بعد اختبارات قبول كاملة للأداء 2k/10k/15k أو وصول push على جهاز فعلي.
- المرجع التفصيلي والقيود موثقة في [DIAGNOSTIC_REPORT_AR.md](./DIAGNOSTIC_REPORT_AR.md)، ولا تُغلق المطابقة الكاملة قبل إعادة الاختبار الإنتاجي والجهازي.
- Latest Opportunity report diagnostic patch (commit `a99a004`, deployed Railway deployment `e8a5f477-ba5a-49c4-b6e3-1259086d891a`, 2026-10-02): latest-run report shares the radar evaluator, counts partially incomplete factors correctly, and exposes eligibility blocker counts. Regressions cover partial evidence (70% factor coverage) and unknown security, market-cap, price, and liquidity checks. Local typecheck, lint, engine/runtime (64 integration), build + 47 tests, research 5, DB 3, and diff check passed. Production report/radar match on run `99298b14-0edc-4d36-a4cc-ba7913022e27`: 6,954 total; 0 complete ratings; 5,971 research; 983 excluded; 2,004 with partial points. A cold first report request timed out at 60s; after radar initialized evaluation cache, the report returned HTTP 200 in 6.9s. **This patch improves diagnosis only; the requested complete rating system remains unfinished.** The missing score-ready dossiers and verified market-data rights remain blocking.
- Follow-up validation: Railway's SEC contact variable matches the user's address. Production AAPL profile successfully retrieved 3 annual and 8 quarterly SEC Company Facts periods; the former SEC 403 is not currently reproduced. Full run `e55c6893-3a2d-4239-ad6b-6d10c86877ac` is active at history stage 10; its interim counts are not final. AAPL's market quote/history provenance remains `unknown` for reuse rights, and its dossier has only partial financial/earnings factors.
- Local evaluator follow-up uses indexed `(run_id,symbol)` keyset pages, persists newly recalculated current-hash evaluations in D1, and reuses them after process-cache invalidation. Regression tests include a 501-row two-page backfill and restart parity. Typecheck, lint, runtime engine + 65 runtime tests, verified root build + 47 tests, research 5, Python DB 3, and diff checks pass. This reduces cold legacy-run repeated work, but does not supply missing source rights or the absent valuation/qualitative factor dossiers.
- Release `75795df` is live on Railway as deployment `071a41d6-1988-47ff-95a1-e509b7b7b7b5` (SUCCESS); the persistent `/app/data` volume remains attached. Playwright confirmed the production page shows 5,971 research priorities, 983 exclusions, 0 complete ratings, and a clearly marked provisional evidence score list. The old stale-run report completed cold in 7.43s and the next page in 2.81s (HTTP 200); counts remained 0/6,954.
- Current production full scan `e55c6893-3a2d-4239-ad6b-6d10c86877ac` is still at stage 11, offset 2,144/5,921 at the latest check; 7,930 SEC successes, 290 failed requests, no retries. A fresh `/api/scan-report` showed 0 complete, 983 fails, 5,971 unknown, and 852 rows with partial evidence; a later radar query counted 885 partial-point rows because the run continues to update. This is not final acceptance: all eight factors remain incomplete and market quote/cap/liquidity gates remain UNKNOWN. Recheck after stage 13; never accept provisional points as the requested final rating.

- Final run `e55c6893-3a2d-4239-ad6b-6d10c86877ac` verification (stage 13, 2026-10-02): 5,921/5,921 issuer jobs; 17,918 SEC requests, 11,632 success, 365 failed, no run-level error. Radar and report agree: 6,954 total; 0 ranked; 5,971 needs research; 983 excluded; 2,004 provisional evidence. All eight factors incomplete for all records; price/cap/liquidity UNKNOWN for all; security UNKNOWN 697, FAIL 983; source conflict UNKNOWN 7. This confirms ranking is blocked by evidence/data rights, not scan progress or sort order. Full rating acceptance remains unmet.
