/**
 * Stock data types for Small-Cap Radar
 */

export interface Stock {
  symbol: string
  name: string
  sector: string
  marketCap: number
  revenue: number
  eps: number
  peRatio: number
  evToSales: number
  fcfYield: number
  growthRate: number
  marginTrend: number
  insiderBuys: number
  debtToEbitda: number
  score: number
  lastUpdated: string
}

export interface ScanResult {
  stocks: Stock[]
  totalScanned: number
  timestamp: string
  version: string
}

export interface ValidationMetrics {
  crashProtection: {
    mean: number
    ci95_low: number
    ci95_high: number
  }
  explosionEdge: {
    mean: number
    ci95_low: number
    ci95_high: number
  }
  sampleSize: number
  tickers: number
  methodology: string
}

export interface ScoringWeights {
  valuation: number      // 24
  quality: number        // 19
  shareDiscipline: number // 15
  smallUncovered: number  // 14
  growth: number          // 7
  insider: number         // 7
  marginTrend: number     // 6
  entryPoint: number      // 5
  balanceSheet: number    // 3
}

export interface GatingRules {
  minMarketCap: number    // 25M
  maxMarketCap: number    // 2B
  minLiquidity: number    // 150K/day
  maxEVToSales: number    // 10
  requiresProfitability: boolean
  noCashBurn: boolean
}
