# رادار الشركات الصغيرة | Small-Cap Radar

## English

**Small-Cap Radar** is an Arabic-language stock screener for the US market that identifies small-cap "explosion" candidates — stocks poised for significant upside moves.

### Technology Stack
- **Frontend**: React 19 + TanStack Start
- **Backend**: Cloudflare Workers (single deployment)
- **Database**: Cloudflare D1 (SQLite)
- **Deployment**: Higgsfield/Cloudflare Pages

### Key Features
- Screens ~9,800 US stocks
- Focuses on: size (25M–2B), liquidity (150K+/day), profitability or inflection, no death spirals
- Scoring engine built on multi-bagger research (base rates + trait analysis)
- Real validation: 320 point-in-time observations / 88 tickers
- Measured -31.4pp crash protection vs +10.9pp explosion edge (significant)
- Two lists: Core value (12–24mo hold) + Bounce mode (35%+ down, +20% target)

### Validation Results (Aug 2026)
- **Crash Protection**: -31.4pp (95% CI -42.7 to -19.9, firm-level bootstrap)
- **Bounce Success**: 47.2% hit +20% vs 37.2% random peers
- **Annualized**: ~35% (vs ~31% for core hold 2y)
- **Methodology**: Firm-level locked holdouts with fresh hash salts per campaign

---

## العربية

**رادار الشركات الصغيرة** هو نظام فحص أسهم باللغة العربية للسوق الأمريكية يحدد فرص الانفجار في الأسهم الصغيرة.

### المحفظة التقنية
- **الواجهة**: React 19 + TanStack Start
- **الخادم**: Cloudflare Workers
- **قاعدة البيانات**: Cloudflare D1
- **النشر**: Higgsfield/Cloudflare Pages

### المعايير الأساسية
- القيمة السوقية: 25–2000 مليون دولار
- السيولة: 150K+ دولار يومياً
- ربحية أو نقطة انعطاف
- لا تحطم حتمي (لا cash burn عالي، لا leverage مفرط)

### وزن العوامل (من 100)
| العامل | الوزن |
|--------|-------|
| التقييم (Valuation) | 24 |
| الجودة (Quality) | 19 |
| انضباط السهم (Share Discipline) | 15 |
| صغر الحجم والتغطية (Small & Uncovered) | 14 |
| النمو (Growth) | 7 |
| الداخليون (Insider) | 7 |
| اتجاه الهامش (Margin Trend) | 6 |
| نقطة الدخول (Entry Point) | 5 |
| الميزانية (Balance Sheet) | 3 |

### القائمتان
1. **الارتداد** (Bounce): انخفاض >35% خلال سنة، سيولة عالية، هدف +20%
2. **القيمة الأساسية**: 12–24 شهر، ليست قائمة الارتداد

### نتائج التحقق (أغسطس 2026)
- **حماية التحطم**: -31.4 نقطة مئوية
- **نسبة الارتداد الناجح**: 47.2% (مقابل 37.2% عشوائي)
- **العائد السنوي**: ~35%
- **المنهجية**: Locked holdouts بـ firm-level

---

## Getting Started

```bash
npm install
npm run dev
```

### Project Structure

```
smallcap-radar/
├── app/
│   ├── src/
│   │   ├── components/     # React UI components
│   │   ├── layouts/        # Page layouts (AGENTS.md guidelines)
│   │   └── tools/          # Data pipeline
│   │       ├── fetch.ts    # Market data fetching
│   │       ├── pit.ts      # Point-in-time snapshots
│   │       ├── score.ts    # Scoring engine
│   │       ├── validate.ts # Validation harness
│   │       └── disasters.ts # Crash detection
│   └── public/
├── cache/                  # Query cache (gitignored)
├── results.json           # Screening results (gitignored)
├── wrangler.toml          # Cloudflare config
└── tsconfig.json
```

### Scoring Engine

The engine weights 9 factors across 3 dimensions:

1. **Valuation** (24pts): EV/Sales ≤10, FCF yield ≥8%
2. **Quality** (19pts): Operating margin, ROE, no cash burn
3. **Discipline** (15pts): Share count stable, buyback ≥ dilution
4. **Small & Uncovered** (14pts): Market cap 25–2B, analyst coverage <10
5. **Growth** (7pts): Revenue +30% YoY
6. **Insider** (7pts): Net buys, no heavy options
7. **Margins** (6pts): Expanding trend
8. **Entry Point** (5pts): Near 52-week low (49% crash rate)
9. **Balance Sheet** (3pts): Debt <50% EBITDA

---

## Deployment

Push to GitHub, Higgsfield builds and deploys automatically to Cloudflare Pages.

```bash
git add .
git commit -m "Initial commit"
git push origin main
```

---

## Notes

- **Language**: Dual Arabic/English UI
- **Validation**: Firm-level holdouts (not time-split alone)
- **Disclaimer**: Past performance ≠ future results. Use for due diligence only.
- **Data**: US stocks only; updates daily

---

**Built with ❤️ by Yousuf Hamda**

License: Private
