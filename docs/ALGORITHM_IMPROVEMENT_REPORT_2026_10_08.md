# Opportunity algorithm improvement — October 8, 2026

The fixed-weight algorithm has been improved and verified on the same 7,506 saved production listings. The result is better evidence and calculation integrity, with complete numerical ranking preserved. Realized six-month investment performance remains unvalidated. Live adoption is recorded below only after direct production checks.

## Study and execution

The campaign followed [the written plan](ALGORITHM_IMPROVEMENT_PLAN_2026_10_08.md), starting with current HANDOFF, project/operations memory, the complete scoring contract, the prior deployed audit and the acquisition-to-ranking code path. Three agents independently audited finance/scoring, evidence/acquisition and research validation; cross-review then tested each other's changes. Earlier historical zero-ranking policies were rejected in favor of the current complete-universe contract. Existing local memory edits were retained.

The live system was rechecked on October 8: the source scan had reached terminal stage 13, with 7,506 saved listings and approximately 1.49 GB physical free space. The October 7 directory release was no longer the latest publication. The latest completed root release was frozen before editing production, including each saved source cutoff and canonical evaluation. Its exact input hash and release identity are in [the comparison](ALGORITHM_COMPARISON_2026_10_08.json). A preserved 1.2.6 evaluator reproduced all 7,506 saved evaluations exactly before comparison.

## Contract preserved

Weights remain **25/20/15/12/10/10/5/3**: valuation, catalysts, financial strength, earnings quality, business quality, downside risk, management and technical timing. Every component denominator stays fixed. Missing or unsupported evidence earns zero; there is no reweighting, issuer-specific adjustment, sector quota, capitalization quota or hidden coverage tie-break. All listings, including zeros, sort by saved final score descending, then symbol BINARY ascending. Source-review findings remain separate from mathematical ranking.

Rubric: `1.3.0-evidence-consistent-opportunity`, hash `6ccccbc7`. Changed component traces identify catalyst v2, aligned financial-strength v2, and current-period intrinsic sensitivity v3. Exact final arithmetic remains `Math.round(sum(Math.round(grade * 100) * weight) / 10) / 100`.

## Demonstrated repairs

| Defect reproduced before repair | Corrected behavior |
|---|---|
| One weak nonbinding announcement scored 3/10; twelve copies with different IDs scored 10/10 | Strongest evidenced event anchors the aggregate; repeated weak announcements remain 3/10 and cannot overwhelm a binding event |
| Catalyst value 1 meant 100%, while 1.01 meant 1.01% | Explicit percent and ratio units; unknown economics earn no materiality credit |
| Quarterly cashflow passed as TTM and earned full solvency credit | Annual duration, currency, consolidated scope, flow alignment and balance/maturity dates are checked per dimension |
| Losses prevented severe leverage/burn/dilution from being assessed | Independently evidenced adversity survives incomplete profitability; incomplete inputs cannot establish clean financing |
| Financing recomputation retained old clean provenance; mild/elevated levels were unrecognized | Recompute exact consumed source dependencies and grade actual supported levels |
| Old annual profitability masked current compatible losses or weakening cashflow | Independent current earnings/owner-cashflow checks cap intrinsic normalization or withhold an inappropriate profitable-business model |
| Duplicate/contradictory peer listings could choose favorable economics | Validate SIC provenance, distinct issuers, scope and gross margins; withhold contradictory issuer observations and select economic ties by CIK |
| Standard SEC `xslF345X05/ownership.xml` paths were rejected and could resemble a completed empty search | Precisely allowlisted paths fetch original root XML; malformed/amended/incomplete windows retain uncertainty |
| Contradictory debt aggregate could regain points via component fallback | Preserve the actual contradiction; clear only affected compact debt while retaining independent cash |
| Partial current loan categories could stand in for complete maturities | Require a broad current principal total or explicit nonoverlapping short- and long-term current debt |
| Overlapping/YTD flows looked like comparable growth; old wrappers hid valid newer facts | Validate standalone quarter/annual windows, scope/currency and source trees; selected grade, sources and trace agree |
| Split-adjusted chart history certified unadjusted share-count dilution | Reconcile share observations against actual split events and bounded history coverage separately |
| Future bars, invalid dates or future FX dependencies earned model credit | Strict cutoff/calendar validation, dependency chronology, source identity and FX windows/rates |
| Strict import silently dropped the reported currency and ECB translation label from some saved earnings periods | Preserve and validate both fields; all 7,506 frozen source records now survive strict import with exact field identity |
| Supplied proxy grades could override model arithmetic; invalid reviewed sources were discarded without reducing claimed completeness | Reconstruct proxies from saved facts; require every reviewed source and dependency to be valid; unresolved conflicts cannot bypass the evaluator |
| Source revisions at the same timestamp could reuse an unrelated saved grade | Saved source hash, rubric, grade precision and factor order are validated; explicit dossiers are reassessed |
| Post-delisting dividends created a fictitious +899% return; profitable takeover proceeds missed the upside label | Reject post-terminal observations and measure positive/negative terminal payoffs symmetrically |
| Historical selection pooled scores across dates or mismatched benchmark horizons | Select within each contemporaneous date, use executable entry/actual exit and purge chronologically; require matched dated benchmark returns |

The source-validation choices follow the SEC distinction between units, fiscal durations and reported contexts. A period ending on the same day does not establish equivalent observations. See [SEC API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) and [SEC financial-statement guidance](https://www.sec.gov/about/reports-publications/beginners-guide-financial-statements). Frames and Company Facts are two presentations of SEC data, not independent corroboration.

## Same-input result study and refinement

The final frozen-universe comparison changes **1,310** factor sets: **1,083** final scores increase, **227** decrease, and **6,196** factor sets remain unchanged. All 7,506 listings and 60,048 numeric factors survive. Independent reconstruction checked **54,332** conflict-free model traces; **160** representative normalization/issuer-label controls passed. The top-100 overlap is **79**, and the top-20 overlap is **17**. These are ranking-change diagnostics, not success rates.

Most recovered credit comes from rebuilding actual financing-review provenance. Reduced credit includes incompatible inputs, disputed sources, current deterioration and peer sets with insufficient legitimate issuer evidence. More points are not themselves an acceptance criterion. Original observed source cutoffs remain unchanged, and new filing acquisitions are not mixed into the replay.

Review of large changes found two inherited tiny Frames/Company Facts net-income discrepancies (TPR approximately 0.0196%; JBSS approximately 0.000557%) that earlier reviewed grades had bypassed. The corrected evaluator now respects those persisted unresolved flags. The acquisition merger was then refined to compare only matching issuer, start/end, units, currency, scope and metric scope. Differences at most 1% become explicit diagnostics, with both original values and source metadata preserved; larger comparable differences remain conflicts. Different measurement windows are not contradictions. The saved legacy flags cannot be erased solely from a difference string because original comparison context/precision was not fully preserved; they remain a factual research gap rather than silently receiving credit.

Capitalization/sector composition was inspected without changing selection rules. The top-100 count below $5 billion changes from 58 to 60, and at least $5 billion from 42 to 40; no missing-capitalization company enters that set. The original product deliberately has no capitalization maximum, so these counts are descriptive. A complete ranking cannot substitute for a verified catalyst, fully diluted valuation or appropriate instrument model.

## Validation and reproduction

Local gates: **255/255 engine**, **91/91 runtime/API**, **67/67 build/root/UI**, **19/19 research**, **4/4 SQLite**, typecheck, lint without warnings, syntax and whitespace. Suite counts overlap. The 59 added engine tests include valid-input controls and adversarial/metamorphic cases. Historical protocol tests are synthetic; they do not count as historical stock observations. The streaming source replay imported all **7,506/7,506** saved snapshots without dropped fields, then reproduced deterministic candidate grades and checked all **60,048** numeric factors. The bounded-memory HTTP-export converter reproduced all **7,506** original payloads, saved evaluations and rank positions exactly; a deliberately wrong rank was rejected. This replay did not compare new grades with old saved grades; `--stored` is reserved for the post-deployment export.

[Validation evidence](ALGORITHM_VALIDATION_2026_10_08.json) records test totals, exact frozen identity, synthetic before/after cases and the blocked historical gate. [Whole-universe comparison](ALGORITHM_COMPARISON_2026_10_08.json) records factor/rank changes and composition. Raw exports, databases, baseline compiled artifacts and browser artifacts remain ignored.

```sh
npm run test:runtime
npm run test:research
python3 tests/test_database.py
npm run typecheck
npm run lint
npm test
node research/algorithm-synthetic-acceptance.mjs
node research/opportunity-validation.mjs
node scripts/compare-opportunity-algorithms.mjs FROZEN.jsonl PRESERVED_BASELINE_DIR REPORT.json
node scripts/verify-complete-ranking.mjs FROZEN.jsonl
python3 scripts/convert-ranking-export.py PRIVATE_HTTP_EXPORT.json PRIVATE_HTTP_EXPORT.jsonl
node scripts/verify-complete-ranking.mjs PRIVATE_HTTP_EXPORT.jsonl --stored
```

The comparison accepts JSON or streaming JSONL. A JSONL header identifies `runId`, release and exact `rowCount`; subsequent lines contain symbol, original payload and saved evaluation. It refuses truncated membership, missing saved baseline parity, changed cutoffs, nonnumeric factors, invalid arithmetic, irreproducible normalization or issuer-label-dependent grades. The HTTP-export converter and `--stored` verifier additionally require consecutive saved ranks and exact agreement with evaluated score order; a deliberately mismatched rank was rejected. The baseline directory must contain the independently preserved previous compiled evaluator and dependencies. Baseline source is also recoverable from repository commit `3b17bb88655f8bb97dd183cbf346b89fddc39017`.

## Production delivery

The production delivery gate remains open as of **2026-10-09**. The local candidate is rubric `1.3.0-evidence-consistent-opportunity` / `6ccccbc7`; its whole-universe result is a frozen-input replay, not a claim that production saved grades have adopted it. Direct Railway commands and the public app could not resolve their hosts from the current restricted terminal, and the existing Playwright session had closed. The local GitHub CLI token is invalid. Repository reads through the connected GitHub app succeeded, but its tree-write call was rejected because it requires approval and this session's approval policy is `never`. The local `.git` directory also rejects writes. A validated patch, SHA-256 manifest and Git bundle were prepared under ignored `.verification/` for delivery when access is restored. No new Railway deployment ID, live release token, saved-row repair proof, HTTP export or browser acceptance exists yet. Preserve this distinction until direct production checks pass.

## Remaining factual limits

No survivorship-safe multi-year point-in-time outcome dataset was supplied or available. The historical validator therefore remains **BLOCKED** with zero input rows; probabilities and six-month targets remain null. The single contemporary acquisition release cannot establish a higher future win rate. Reviewed catalyst economics, full governance/risk diligence, specialist sectors/security terms, diluted capitalization and senior claims still require factual research. Unknown market-data rights remain separate from model observations and cannot establish a reviewed trading decision. No subscription, infrastructure capacity, private portfolio/account state or stock-universe membership was changed to obtain a favorable result.
