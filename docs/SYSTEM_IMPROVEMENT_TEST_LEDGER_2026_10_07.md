# System improvement test ledger — October 7, 2026

Final application archive `6c452e5545b4c78ea25f09374794219f45f81afd`, deployment `7a9f861a-4b77-41aa-a09f-dbc4f9fcbf2e`, rubric `1.2.6-stable-import-identities` / `d21f9710`. [Public production proof](SYSTEM_IMPROVEMENT_PRODUCTION_VERIFICATION_2026_10_07.json) and [execution history](SYSTEM_IMPROVEMENT_EXECUTION_2026_10_06.md) preserve results. Repeated suite runs overlap; counts below must not be summed as unique tests.

## Final release suites and gates

| Executed check | Result |
|---|---|
| `npm run test:engine` (also run by runtime suite) | 196/196 PASS |
| `npm run test:runtime` | 91/91 runtime/API PASS; engine 196/196 PASS |
| `npm test` | Verified production build PASS; root/UI 57/57 PASS |
| `npm run test:research` | 9/9 PASS; also included in root suite |
| `python3 tests/test_database.py` | 4/4 PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `node --check scripts/verify-complete-ranking.mjs` | PASS |
| `node --check scripts/verify-production-ranking.mjs` | PASS |
| `git diff --check` | PASS |
| GitHub exact-archive CI `37568804637` | PASS |
| GitHub implementation CIs `37567199631`, `37567882122` | PASS |

Engine coverage includes all nine stock types × 256 factor-presence combinations (2,304 cases), empty/nonfinite/stale/conflicting/FX inputs, unsupported instrument traces, fixed model denominators and exact weighted arithmetic. Runtime coverage includes 15,000-row directory publication, missing-CIK listings, release revision races, real colon-containing run IDs, D1 row/parameter ceilings, long URLs, cursor migrations, source quotas/leases, complete directory/cache recovery, private ownership, lossless archives and every scan capacity path. Research tests exercise point-in-time outcomes/purging; they are not a real historical calibration.

## Exhaustive final production checks

| Executed check | Coverage / result |
|---|---|
| `scripts/verify-production-ranking.mjs` on production | 7,506 saved/radar/report/profile records, arithmetic, sorting and reload PASS |
| Independent live official directory comparison | 7,494 official, all 6,954 prior listings retained, 12 explicitly unconfirmed zero-grade; no missing membership |
| Full raw source export and `scripts/verify-complete-ranking.mjs --stored` | All 7,506 strict imports, exact field preservation, raw/imported identity, deterministic whole-evaluation Mac/Linux replay and independent components PASS |
| Same verifier grade-preservation check | All 7,506 grades unchanged from pre-canonical-hash release |
| Complete public streamed HTTP export | 7,506 records / 60,048 factors, exact saved evaluation/rank/release parity PASS |
| Actual complete ranking DOM | 7,506 rendered rows / 60,048 grades; zero mismatches; 985 zero grades remain visible; correct descending order PASS |
| Background timer refresh | All loaded pages retained PASS |
| Desktop 1,440 px layout | No horizontal overflow PASS |
| Mobile 390×844 reload and pagination | 40 then 80 canonical rows, ranks 1–80, no overflow PASS |
| Positive IAG and zero ZOOZW profile rendering | Eight matching grades and exact final score each PASS |
| Scan-report rendering / next page | 25 rows / 200 factors; next page first rank 26; no page errors PASS |
| Offline cached-subset reload | 40 rows / 320 factors, exact saved score/rank/release, explicit subset scope, no mobile overflow PASS |
| Full factor/security/source availability audit | All nine security classes fully graded; factual gaps preserved PASS |
| Native restart/unattended progress with browser resume blocked | Stage 11 issuer offset 3,024 → 3,304, +560 SEC requests / +270 successes PASS |
| Durable current pre-recovery off-host backup | Download checksum, actual 4,815,323,136-byte restoration and SQLite integrity PASS |
| Five bounded compaction parity ranges | 117,756 exact saved source/evaluation bytes and private-value parity PASS |
| Six verified database installation blocks | 3,040,825,344 exact bytes and source/private counts PASS |
| Five bounded live archive restoration ranges | All 102,744 archives, identity and every factor grade PASS |
| Final deployment/direct public health and 04:22:25 UTC recheck | SUCCESS / HTTP 200; exact release/ranked 7,506/missing factors and finals zero PASS |
| Public proof JSON and final documentation links/whitespace | PASS |

Private logs and artifacts remain ignored under `.verification`; public proof contains only counts, public listing/run metadata and checksums. Offline coverage is a cached subset, not all 7,506 rows. Source acquisition failures remain recorded independently of complete grading.

## Earlier suite executions and corrected failures

These are historical results from the same campaign, not substitutes for final release checks. The execution history gives their associated code and live findings.

| Checkpoint | Engine | Runtime | Build/root | Other result |
|---|---:|---:|---:|---|
| Initial system implementation | 186 PASS | 76 PASS | 52 PASS | Research 9, SQLite 4, typecheck/lint, 6,954 replay/backup PASS |
| Complete-directory publication | — | 78 PASS | — | 15,000 listing publication/source-date regressions PASS |
| 1.2.4 inventory repair | 194 PASS | 84 PASS | 55 PASS | Typecheck/lint/script syntax PASS |
| 1.2.5 native directory recovery | 195 PASS | 85 PASS | 56 PASS | Typecheck/lint PASS |
| Dated official artifact fallback | 195 PASS | 86 PASS | 57 PASS | Research 9, SQLite 4, typecheck/lint/script syntax PASS |
| Strict import bounds | 195 PASS | 88 PASS | 57 PASS | Full strict-import issue corrected |
| Canonical nested-key hashing | 196 PASS | 89 PASS | 57 PASS | Raw/imported identity corrected |
| All-path capacity guard | 196 PASS | 90 PASS | 57 PASS | Physical reserve and stale-capacity cases PASS |
| Compact archive summary / final implementation | 196 PASS | 91 PASS | 57 PASS | Final gates listed above PASS |

Initial assertions/fixtures failed after valuation-component changes, source-URL typing, compatible-period rules and report role changes; corrected fixtures and reruns passed. Initial publication tests exposed absent-checkpoint retry behavior and run-identity expectations; corrected reruns passed. An initial streamed backup transfer failed; resumable bounded transfer and actual restoration passed. A final documentation helper initially failed Python parsing before any mutation; corrected rerun and document checks passed.

## Rejected production attempts

| Release / deployed attempt | Actual observed result |
|---|---|
| 1.2.0 / `42d9a3d3-4b68-4d87-a1d1-abbd6a6eb52f` | All 6,954 grades persisted, but Mac/Linux power arithmetic changed evaluation identity; FAIL, corrected in 1.2.1 |
| 1.2.1 / `3bd01724-a380-409e-a9b1-bf49ef8e7e53` | All 6,954 grades persisted, but scheduler PRAGMAs caused D1 SQLITE_AUTH; FAIL, native capacity inspection replaced it |
| Scheduler/publication fixes / `48f5bc8f-98fb-440d-a8cb-dd8a46773737` | All 6,954 persistence/API/profile/report checks PASS; insufficient proof of expanded inventory |
| Expanded directory attempts | D1 oversized quote checkpoints, colon-ID HTTP 400, wrong active-run selection, missing quote URLs/current-price ratios and stale-assessment timing suppression; FAIL, each corrected and rerun |
| 1.2.3 / `37bf05e9` | 7,093 evaluations coherent, but independent inventory comparison found missing official listings; FAIL, all exchange codes/alternate symbols repaired |
| 1.2.4 / `337d71f6-1218-4261-8f14-1160c1f97bc3` | Unsupported instrument component trace disagreed with zero factor; official Worker transport failed and old failed-run cleanup removed root quote/fundamental checkpoints; FAIL |
| 1.2.5 native fallback / `71a0a307` | Native and Worker directory downloads returned HTML/403; initialization FAIL, dated exact official artifact added |
| 1.2.5 / `122611c6-9ae6-4288-951c-b98ccec079dd` | All 7,506 ranking/API/UI grades initially PASS; final audit found 1,104 rejected strict imports, field-order-sensitive identities and subsequent full-volume/API 503 outage; rejected final acceptance |
| Initial full-volume recovery attempts | Hole punching recovered 0 bytes; original checkpoint/cache writes hit SQLITE_FULL; long SSH checks interrupted; not accepted as recovery |
| Final 1.2.6 / `7a9f861a-4b77-41aa-a09f-dbc4f9fcbf2e` | Every complete-universe ranking and verified recovery check above PASS |

The preceding tests do not prove complete source diligence, market-data use rights, specialized/fully diluted models or predictive investment success. Those remaining requirements are identified in the [final audit](SYSTEM_IMPROVEMENT_FINAL_AUDIT_2026_10_07.md).
