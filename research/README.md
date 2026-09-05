# Research protocol

No statistical findings have been generated for this implementation.

Required before promotion: original immutable dataset (including delisted firms), original factor definitions, permanent firm salt, actual filing availability, adjusted security history, training/validation/locked/final splits, pre-registered hypotheses and rejected tests, company bootstrap, multiplicity correction, costs and liquidity stress. Store experiment parameters and all outcomes, including failures. A final holdout becomes consumed once viewed and must not be reused for tuning.

Known unresolved dimensions: inflection; death-spiral severity; factor normalization; Bounce liquidity/ranking; source tolerance; analyst/sector four-angle verification. Do not hardcode apparently successful settings into production.

`lib/research.ts` contains deterministic building blocks only, not a complete backtesting engine. `simulateExit` requires an already executable entry price (e.g. next trading open after the signal). Do not pass the signal's same-day close and claim a next-day entry backtest.
