# Deployment 71 — historical rating study

- Date: 2026-09-11
- Source commit: `a1095b5b0a3345f5f02cd21b0778011312baadca`
- Published URL: https://small-cap-radar-v2.yousef772.chatgpt.site
- Sites project: `appgprj_6a9c1438c28481919bcfaf4c55b47104`
- Version: 71
- Archive SHA-256: `1db1823eff2d23585e0c361efdcccac09d127dda07a2bb0d366ffd4105337ac9`

## Included

- Reproducible, free price-only Bounce backtest with chronological tuning, matched random control, gap/stop/target/time-exit rules, and firm-cluster bootstrap confidence intervals.
- Data Center display of the final exploratory measurements and the explicit Core validation block.
- Arabic report and changelog entry documenting the sample, limitations, data hash, and non-promotion decision.

## Verification

- TypeScript, ESLint, engine, research, runtime/API, SQLite and UI tests passed.
- Production build and archive packaging passed.
- `/api/radar?strategy=bounce&limit=3&offset=0`: HTTP 200 JSON.
- `/api/export?kind=spec`: HTTP 200 JSON with the single strategy specification.
- `/api/chart?symbol=AAPL&period=1d`: HTTP 200 JSON with intraday points.

## Explicit limitations

The published candidate remains exploratory. The study uses a current-symbol universe and lacks point-in-time fundamentals and delisted issuers, so it is not a production probability or a proof of profitability. Core's historical success rate remains blocked rather than fabricated. Physical Safari/Chrome and push-delivery acceptance remain unclaimed.
