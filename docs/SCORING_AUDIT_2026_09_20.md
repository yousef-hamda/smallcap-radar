# Scoring and category audit — 2026-09-20

## Production corrections

- Every documented thesis rule now defines category membership: Core revenue/valuation/profitability/financing-risk rules and Bounce decline/off-low/dilution/reversal rules, alongside market-cap, the $150k 20-session median dollar-volume minimum and evidence-safety gates. Previously, failed thesis rows could remain in the category because score was allowed to substitute for membership.
- Core bulk rows no longer become `UNKNOWN` merely because their aggregate confidence grade starts at `C`. The conflict gate now blocks documented conflicts and requires complete dated evidence for the strategy inputs.
- Core and Bounce dilution points require a completed split/corporate-action review. An unadjusted share-count jump can no longer earn ranking points.
- Missing death-spiral review no longer counts the Quality weight as covered while awarding zero points.
- The Core `sizeCoverage` label now states what the code actually measures: size and execution liquidity. It does not claim to score analyst neglect without reliable analyst-history data.
- The model remains diagnostic. No historical hit rate or investment probability is shown.

## Validation corrections

The weight lab now requires source, period-end and availability metadata for every present factor, purges labels not observed at each stability cutoff, and keeps held-out firms out of threshold selection. Candidate approval also requires:

- historical security-master coverage and actual delisted/bankrupt outcomes;
- gross return, execution-cost and net-utility coverage;
- at least 80% active-month coverage;
- a locked benchmark on the final test set;
- positive top-decile net utility and improvement over that benchmark;
- a positive lower 95% bound for firm-clustered AUC improvement;
- no learned negative direction disguised as a positive absolute weight.

## Research basis and limits

- Fama and French document size, value, profitability and investment patterns, while warning about low returns among small firms with aggressive investment and weak profitability: <https://doi.org/10.1016/j.jfineco.2014.10.010>.
- Novy-Marx finds gross profitability informative alongside value; the current feed does not yet have a consistently point-in-time gross-profit/assets panel, so the code does not pretend that net-income/FCF signs reproduce that factor: <https://www.nber.org/papers/w15940>.
- Jegadeesh and Titman document intermediate-horizon momentum, while De Bondt and Thaler study much longer-horizon loser reversal. These are different horizons, so Core's arbitrary contrarian entry score and Bounce's three-month reversal thesis must be validated separately: <https://doi.org/10.1111/j.1540-6261.1993.tb04702.x>, <https://doi.org/10.1111/j.1540-6261.1985.tb05004.x>.
- Hou, Xue and Zhang show that many reported anomalies weaken when microcaps are controlled and returns are value-weighted. This supports hard marketability membership and blocks conclusions from the current surviving-symbol sample: <https://www.nber.org/papers/w23394>.
- Frazzini, Israel and Moskowitz find style-dependent trading capacity, with short-term reversal most constrained by trading costs. Bounce therefore needs explicit cost and liquidity stress tests: <https://pages.stern.nyu.edu/~afrazzin/pdf/Trading%20Cost%20of%20Asset%20Pricing%20Anomalies%20-%20Frazzini%2C%20Israel%20and%20Moskowitz.pdf>.
- Harvey, Liu and Zhu show why multiple testing needs a materially higher hurdle; Bailey et al. formalize backtest-overfitting risk. The exploratory free-price study cannot authorize production weights: <https://www.nber.org/papers/w20592>, <https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf>.
- SEC Company Facts provides updated XBRL facts, not a ready-made survivorship-free point-in-time research panel. Filing timestamps and a historical security master still have to be reconstructed and frozen: <https://www.sec.gov/search-filings/edgar-application-programming-interfaces>.

The unresolved blocker is data, not another round of hand-tuned weights: the repository still lacks a licensed or independently reconstructed point-in-time universe with delisted firms, historical fundamentals, corporate actions and executable prices across the full validation horizon.
