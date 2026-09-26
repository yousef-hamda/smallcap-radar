# Resource cost and portfolio heatmap plan — 2026-09-26

## Scope

This plan keeps the market scan, live quote refresh, saved account data, favorites, portfolio calculations, company files, logo resolution, and Arabic UI behavior intact while reducing repeated work on Railway and making the portfolio allocation heatmap deterministic and contained.

## Current production findings

- Railway has one active `smallcap-radar` replica in `us-west2`, with no cron schedule and no replica multiplier.
- The service runs a single Vite/Vinext process and stores the D1-style state under the persistent Railway volume.
- The linked Railway Postgres service exists, but the application code does not use it. It must not be removed until the volume is backed up and a verified migration or retirement decision exists.
- Radar reads re-evaluated every matching saved snapshot on every request, even when the run hash already proved that the stored evaluations came from the current engine.
- Radar and portfolio screens each had their own five-minute timer. Both also reacted to focus and visibility events, so opening the portfolio could continue background radar reads and repeated portfolio history work.
- Portfolio quote data already has a five-minute provider cache. The extra work was repeated database reconstruction, JSON parsing, strategy scoring, history assembly, and logo resolution around that cache.
- Logo responses already have browser caching, but the server-side logo byte cache had no bound. A bound is required to prevent long running symbol discovery from growing process memory.
- The heatmap used percentage positioned nodes but did not explicitly clamp coordinates at the component boundary. Its small-cell labels could be taller than their cells, which caused clipped text and apparent out-of-frame tiles.

## Safe changes in this cycle

1. Reuse stored radar evaluations when the saved run hash equals the current engine hash. Stale runs still use the existing full re-evaluation path.
2. Add a five-second bounded server response cache for identical radar reads. Favorite changes, scan writes, imports, and account merges invalidate it.
3. Add a fifteen-second bounded portfolio reconstruction cache. Manual quote refresh still bypasses it, and every portfolio write invalidates it.
4. Stop the radar polling loop while the portfolio tab is open.
5. Change background refresh timers from five minutes to ten minutes and refresh after a meaningful hidden period rather than on every focus event. Manual refresh controls remain available.
6. Do not request portfolio history for an empty portfolio.
7. Bound the in-process logo cache by entry count and byte size. Public browser cache headers remain unchanged.
8. Clamp every heatmap node to the `[0,100]` frame before rendering, use explicit `left/top` coordinates, and use `border-box` geometry.
9. Make heatmap label density depend on the actual rectangle. Large cells show the full ordered label stack; medium and small cells use compact labels; the complete ordered legend remains the readable source for every company name, logo, percentage, and click target.
10. Keep the layout sorted by market value descending with symbol tie-breaking, so the visual order and legend order remain stable when quotes change.

## Follow-up cost controls

### Measurement

Record one normal day and one scan day from Railway Metrics and Usage:

- CPU: average, p95, and scan peaks.
- Memory: idle baseline, normal request peak, and scan peak.
- Network egress: logo traffic, API traffic, and provider traffic.
- Volume size and growth rate.
- Request latency and error logs from the application.

The code does not receive Railway billing metrics directly. Measurements must come from the Railway Metrics and Usage views or the current Railway CLI version. Do not infer cost from one request latency sample.

### Phase 2: request and payload reduction

- Add endpoint-level request counters and duration buckets with bounded in-memory aggregation. Do not log user symbols, account identifiers, cookies, or secrets.
- Verify that radar list responses contain only the requested page and compact snapshots.
- Keep detailed history on the on-demand company and portfolio-history paths.
- Review all provider cache TTLs against freshness requirements before increasing them.
- Add conditional requests or edge caching only for public assets and logo responses. Keep account and portfolio JSON private and uncached at the browser edge.

### Phase 3: scan scheduling

- Keep one durable scan lock and one baton chain.
- Preserve the current resumable stages and retry queue.
- Avoid starting a full scan automatically from page load.
- Consider moving scheduled full scans to a separate scheduled worker only after the current volume backup and background-scan acceptance tests pass.
- Keep quick scans user initiated.

### Phase 4: infrastructure review

- Verify the persistent volume backup and restore drill.
- Confirm row counts and selected payload hashes after a restore.
- If the unused Postgres service is confirmed empty and unnecessary, stop or remove it only after explicit owner approval and a documented rollback path.
- Keep one production replica unless availability requirements justify a second replica; a second replica multiplies baseline memory and CPU usage.
- Set a compute hard limit and alert in Railway after observing a full billing period. A hard limit is a spend guard and can take the service offline when reached, so it is an operational control rather than an application optimization.

## Heatmap acceptance criteria

- Every returned node satisfies `0 <= x,y`, `x + width <= 100`, and `y + height <= 100`.
- No two nodes overlap after padding.
- Node area remains proportional to current market value within the layout's documented padding gutter.
- All nodes remain inside the framed container at desktop and phone widths.
- Large cells show symbol, weight, market value, and company name in that order.
- Smaller cells never render text outside their own rectangle.
- The ordered legend shows every holding with its logo, symbol, company name, and weight.
- A quote update changes area, color, and labels from the same position data without stale geometry.
- A position with no valid current quote is excluded from the area map and remains visible in the positions table with its missing value state.

## Validation gates

Run these gates before deployment:

```text
npm run typecheck
npm run lint
npm run test:engine
npm run test:runtime
npm test
git diff --check
```

Then verify:

1. The public home page returns HTTP 200.
2. Radar list and status endpoints return valid JSON.
3. Portfolio load, manual quote refresh, add, edit, sell, delete, and empty state still work.
4. A four-position fixture produces bounded, non-overlapping, descending heatmap nodes.
5. A narrow viewport keeps the heatmap and legend inside the viewport.
6. A second browser or phone session sees the same account data after login.
7. Railway shows one successful active deployment and no repeated restart or memory-limit errors in the first post-deploy observation window.

## Rollback

The application changes are reversible by reverting the single deployment commit. The state cache is an optimization layer only; clearing it cannot delete user data. Do not roll back by deleting the Railway volume or changing the database service.
