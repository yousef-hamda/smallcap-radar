# Project Structure | هيكل المشروع

## الدليل الكامل

```
smallcap-radar/
├── app/                          # Application code
│   ├── index.html               # HTML entry point
│   ├── src/
│   │   ├── index.tsx            # React root
│   │   ├── App.tsx              # Main component
│   │   ├── index.css            # Global styles
│   │   ├── types.ts             # TypeScript interfaces
│   │   ├── components/
│   │   │   ├── Screener.tsx     # Main screener UI
│   │   │   ├── StockTable.tsx   # Results table
│   │   │   ├── Header.tsx       # App header
│   │   │   └── Navigation.tsx   # Navigation menu
│   │   ├── layouts/
│   │   │   ├── MainLayout.tsx   # Primary layout
│   │   │   └── AGENTS.md        # Agent guidelines (TanStack)
│   │   └── tools/
│   │       ├── fetch.ts         # Market data API fetching
│   │       ├── pit.ts           # Point-in-time snapshots
│   │       ├── score.ts         # Scoring engine (9 factors)
│   │       ├── validate.ts      # Validation harness
│   │       └── disasters.ts     # Crash detection
│   └── public/
│       ├── favicon.ico
│       └── manifest.json        # PWA manifest
│
├── docs/                         # Documentation
│   ├── SCORING.md               # Scoring formula
│   ├── VALIDATION.md            # Validation methodology
│   ├── DATA_PIPELINE.md         # Data flow
│   └── DEPLOYMENT.md            # Deployment guide
│
├── cache/                        # Local cache (gitignored)
│   ├── queries/
│   └── results/
│
├── .git/                         # Git repository
├── .gitignore                    # Git ignore rules
├── wrangler.toml                 # Cloudflare Workers config
├── tsconfig.json                 # TypeScript config
├── tsconfig.app.json             # App-specific TS config
├── vite.config.ts                # Vite bundler config
├── tailwind.config.js            # Tailwind CSS config
├── manifest.json                 # NPM package manifest
├── README.md                      # Project overview
├── PROJECT_STRUCTURE.md           # This file
└── LICENSE                        # MIT License
```

---

## Key Directories

### `/app/src/`
Core application code (React + TypeScript).

**Components** (`/components/`)
- `Screener.tsx` — Main UI for stock screening
- `StockTable.tsx` — Sortable results table with Arabic labels
- `Header.tsx` — App header with language toggle
- `Navigation.tsx` — Navigation and filters

**Tools** (`/tools/`)
- `fetch.ts` — Retrieves market data from providers (Yahoo Finance, SEC)
- `pit.ts` — Creates point-in-time snapshots for validation
- `score.ts` — Scoring engine: weights 9 factors (valuation, quality, etc.)
- `validate.ts` — Validation harness: firm-level locked holdouts, CI calculation
- `disasters.ts` — Identifies crash risks (death spiral detection)

**Layouts** (`/layouts/`)
- `MainLayout.tsx` — Primary page wrapper
- `AGENTS.md` — TanStack Start agent definitions (server actions)

### `/docs/`
Comprehensive guides.

- `SCORING.md` — How the 9-factor scoring model works
- `VALIDATION.md` — Methodology: 320 observations / 88 tickers, crash protection -31.4pp
- `DATA_PIPELINE.md` — Daily update flow
- `DEPLOYMENT.md` — Pushing to Higgsfield → Cloudflare build

### `/cache/`
Temporary data (`.gitignore`d):
- Query results from market data APIs
- Intermediate scoring calculations
- Results snapshots

---

## File Purposes

| File | Purpose |
|------|---------|
| `index.html` | HTML shell for React SPA |
| `App.tsx` | Root React component, locale toggle, scan flow |
| `types.ts` | TypeScript interfaces for stocks, validation, scoring |
| `index.css` | Tailwind imports + custom RTL/animations |
| `wrangler.toml` | Cloudflare config (D1 database, KV, routes) |
| `tsconfig.json` | TypeScript strict mode, path aliases |
| `vite.config.ts` | Vite build configuration |
| `manifest.json` | NPM project metadata |
| `README.md` | Dual-language overview (English + Arabic) |

---

## Data Flow

```
Market Data APIs
    ↓
fetch.ts (fetch & parse)
    ↓
score.ts (9-factor scoring)
    ↓
pit.ts (snapshot for validation)
    ↓
Cloudflare D1 (store results)
    ↓
React UI (display)
```

---

## Scoring Engine (9 Factors)

```
Total: 100 points

Valuation (24):
  - EV/Sales ≤ 10
  - FCF Yield ≥ 8%

Quality (19):
  - Operating margin
  - ROE
  - No cash burn

Share Discipline (15):
  - Stable share count
  - Buyback ≥ dilution

Small & Uncovered (14):
  - Market cap 25–2B
  - Analyst coverage < 10

Growth (7):
  - Revenue +30% YoY

Insider (7):
  - Net buys in last 6mo
  - No heavy options

Margin Trend (6):
  - Expanding trend

Entry Point (5):
  - Near 52-week low (49% crash rate)

Balance Sheet (3):
  - Debt < 50% EBITDA
```

---

## Validation Results (Aug 2026)

| Metric | Value |
|--------|-------|
| Crash Protection | -31.4pp (95% CI: -42.7 to -19.9) |
| Explosion Edge | +10.9pp (not significant) |
| Bounce Success Rate | 47.2% hit +20% target |
| Annualized Return (Bounce) | ~35% |
| Sample Size | 320 observations / 88 tickers |
| Methodology | Firm-level locked holdouts |

---

## Git Workflow

```bash
# Clone
git clone https://github.com/[user]/smallcap-radar.git
cd smallcap-radar

# Install & run locally
npm install
npm run dev

# Build
npm run build

# Validate
npm run check:stocks

# Push to GitHub → Higgsfield auto-deploys to Cloudflare Pages
git add .
git commit -m "Update screening results"
git push origin main
```

---

## Environment Variables

Add to `.env.local`:

```env
VITE_API_BASE_URL=https://smallcap-radar.higgsfield.app/api
VITE_MOCK_DATA=false
```

For Cloudflare Workers (via `wrangler.toml` secrets):

```toml
[[env.production.vars]]
FETCH_PROVIDER="yahoo"
UPDATE_SCHEDULE="daily"
```

---

## Deployment

1. **Code**: Push to GitHub
2. **Build**: Higgsfield triggers Vite build
3. **Database**: D1 stores screening results
4. **CDN**: Cloudflare Pages serves the app
5. **Live**: Available at `https://smallcap-radar.higgsfield.app`

---

## Notes

- **Language**: All UI is Arabic-first; English toggle available
- **Real Data**: Uses live market data (Yahoo Finance, SEC Edgar)
- **Validation**: Measured on 320 historical snapshots with proper holdouts
- **No Backtesting Bias**: Firm-level locked holdouts prevent overfitting
- **Transparent**: All methodology documented in `/docs/`

---

**Last Updated**: August 2026  
**Version**: 1.0.0
