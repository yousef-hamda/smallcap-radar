#!/usr/bin/env python3
"""Create deterministic research cohorts from externally downloaded data.

The script intentionally writes identifiers and availability strata only. It
never reads future returns, so cohort selection cannot leak the label.
"""
from __future__ import annotations
import argparse, ast, csv, hashlib, json
from pathlib import Path

SALT = "small-cap-radar-free-cohort-v1"

def key(*parts: str) -> str:
    return hashlib.sha256((SALT + "|" + "|".join(parts)).encode()).hexdigest()

def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def survival(last: str) -> str:
    if last < "2019-01-01": return "ended_before_2019"
    if last < "2020-01-01": return "ended_during_2019"
    return "continued_into_2020"

def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--summary", type=Path, required=True)
    p.add_argument("--ticker-ciks", type=Path, required=True)
    p.add_argument("--price-audit", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--core-size", type=int, default=2000)
    a = p.parse_args()
    mapping: dict[str, set[str]] = {}
    malformed = 0
    with a.ticker_ciks.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            try: tickers = ast.literal_eval(row["ISSUERTRADINGSYMBOL"])
            except (ValueError, SyntaxError, TypeError): malformed += 1; continue
            for ticker in tickers:
                t = str(ticker).strip().upper().replace("/", "-")
                if t and all(c.isalnum() or c in ".-" for c in t): mapping.setdefault(t, set()).add(str(int(row["ISSUERCIK"])))
    unique = {t: next(iter(ciks)) for t, ciks in mapping.items() if len(ciks) == 1}
    ambiguous = sum(len(ciks) > 1 for ciks in mapping.values())
    with a.summary.open(newline="", encoding="utf-8-sig") as f: source = list(csv.DictReader(f))
    bounce = [{"symbol": r["symbol"].upper(), "first_price_date": r["stock_from_date"], "last_price_date": r["stock_to_date"], "price_rows": r["total_prices"], "survival_stratum": survival(r["stock_to_date"]), "selection_key": key("bounce", r["symbol"].upper())} for r in source if r["stock_from_date"] not in ("", "NULL") and r["stock_to_date"] not in ("", "NULL")]
    bounce.sort(key=lambda r: r["symbol"])
    candidates = [{**r, "cik": unique[r["symbol"]], "selection_key": key("core-symbol", unique[r["symbol"]], r["symbol"])} for r in bounce if r["symbol"] in unique and int(r["price_rows"]) >= 750]
    by_cik: dict[str, list[dict[str, str]]] = {}
    for r in candidates: by_cik.setdefault(r["cik"], []).append(r)
    firms = [sorted(rows, key=lambda r: r["selection_key"])[0] for rows in by_cik.values()]
    ended = sorted([r for r in firms if r["survival_stratum"] != "continued_into_2020"], key=lambda r: key("core-firm", r["cik"]))
    continuing = sorted([r for r in firms if r["survival_stratum"] == "continued_into_2020"], key=lambda r: key("core-firm", r["cik"]))
    core = sorted(ended[:min(len(ended), a.core_size // 3)] + continuing[:max(0, a.core_size - min(len(ended), a.core_size // 3))], key=lambda r: r["symbol"])
    a.output.mkdir(parents=True, exist_ok=True)
    for name, rows in (("bounce-free-cohort-v1.csv", bounce), ("core-free-cohort-v1.csv", core)):
        with (a.output / name).open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    audit = json.loads(a.price_audit.read_text())
    manifest = {"version":"free-cohort-v1", "selection":"SHA-256 deterministic selection; no outcome/future-return field read", "signalWindow":["2010-01-01","2019-12-31"], "bounce":{"companies":len(bounce),"file":"bounce-free-cohort-v1.csv"}, "core":{"companies":len(core),"eligibleBeforeSampling":len(firms),"tickerRowsBeforeFirmDeduplication":len(candidates),"file":"core-free-cohort-v1.csv"}, "mapping":{"uniqueTickers":len(unique),"ambiguousTickersExcluded":ambiguous,"malformedRowsExcluded":malformed}, "priceAudit":audit, "inputHashes":{"datasetSummarySha256":sha(a.summary),"tickerCikSha256":sha(a.ticker_ciks)}, "limitations":["Early last-price date is a stratum, not proof of delisting.","The source is not an official survivorship-free security master.","No accuracy percentage is publishable until PIT facts, corporate actions, outcomes, and holdouts pass audit."]}
    (a.output / "free-cohort-v1.manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"bounce":manifest["bounce"],"core":manifest["core"],"mapping":manifest["mapping"]}, ensure_ascii=False, indent=2))

if __name__ == "__main__": main()
