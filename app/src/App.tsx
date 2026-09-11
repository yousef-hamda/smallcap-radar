import React, { useState } from 'react'
import './App.css'

/**
 * Small-Cap Radar | رادار الشركات الصغيرة
 * Arabic stock screener for US market
 */

interface Stock {
  symbol: string
  name: string
  score: number
  marketCap: number
  revenue: number
  growthRate: number
}

export default function App() {
  const [locale, setLocale] = useState<'ar' | 'en'>('ar')
  const [stocks, setStocks] = useState<Stock[]>([])
  const [loading, setLoading] = useState(false)

  // Sample data for demonstration
  const SAMPLE_STOCKS: Stock[] = [
    {
      symbol: 'NVDA',
      name: 'NVIDIA Corporation',
      score: 87,
      marketCap: 1200000000000,
      revenue: 60000000000,
      growthRate: 0.245
    },
    {
      symbol: 'MSFT',
      name: 'Microsoft Corporation',
      score: 82,
      marketCap: 2800000000000,
      revenue: 198000000000,
      growthRate: 0.16
    },
    {
      symbol: 'GOOGL',
      name: 'Alphabet Inc.',
      score: 78,
      marketCap: 1700000000000,
      revenue: 307000000000,
      growthRate: 0.13
    },
    {
      symbol: 'AMZN',
      name: 'Amazon.com Inc.',
      score: 75,
      marketCap: 1900000000000,
      revenue: 575000000000,
      growthRate: 0.11
    },
    {
      symbol: 'META',
      name: 'Meta Platforms Inc.',
      score: 71,
      marketCap: 950000000000,
      revenue: 135000000000,
      growthRate: 0.19
    }
  ]

  const t = {
    ar: {
      title: 'رادار الشركات الصغيرة',
      subtitle: 'فحص الأسهم الصغيرة في السوق الأمريكي',
      scan: 'فحص السوق',
      results: 'النتائج',
      noResults: 'لم تُعثر على نتائج',
      loading: 'جاري الفحص...',
      symbol: 'الرمز',
      name: 'اسم الشركة',
      score: 'النقاط',
      marketCap: 'القيمة السوقية',
      revenue: 'الإيرادات',
      growth: 'النمو',
    },
    en: {
      title: 'Small-Cap Radar',
      subtitle: 'US stock screener for small-cap opportunities',
      scan: 'Scan Market',
      results: 'Results',
      noResults: 'No results found',
      loading: 'Scanning...',
      symbol: 'Symbol',
      name: 'Company',
      score: 'Score',
      marketCap: 'Market Cap',
      revenue: 'Revenue',
      growth: 'Growth',
    }
  }

  const strings = t[locale]

  const handleScan = async () => {
    setLoading(true)
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500))
    setStocks(SAMPLE_STOCKS)
    setLoading(false)
  }

  const formatCurrency = (value: number) => {
    if (value >= 1e12) return '$' + (value / 1e12).toFixed(2) + 'T'
    if (value >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B'
    if (value >= 1e6) return '$' + (value / 1e6).toFixed(2) + 'M'
    return '$' + value.toFixed(2)
  }

  return (
    <div className={`min-h-screen ${locale === 'ar' ? 'rtl' : 'ltr'}`} style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
      {/* Header */}
      <header className="bg-gradient-to-r from-slate-900 to-slate-800 text-white p-6">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold">{strings.title}</h1>
            <p className="text-slate-400 mt-2">{strings.subtitle}</p>
          </div>
          <button
            onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition"
          >
            {locale === 'ar' ? 'English' : 'العربية'}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-6">
        {/* Scan Button */}
        <div className="mb-8">
          <button
            onClick={handleScan}
            disabled={loading}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-semibold transition"
          >
            {loading ? strings.loading : strings.scan}
          </button>
        </div>

        {/* Results Table */}
        {stocks.length > 0 && (
          <div className="bg-white rounded-lg shadow-lg overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-100 border-b">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">{strings.symbol}</th>
                  <th className="px-4 py-3 text-left font-semibold">{strings.name}</th>
                  <th className="px-4 py-3 text-right font-semibold">{strings.score}</th>
                  <th className="px-4 py-3 text-right font-semibold">{strings.marketCap}</th>
                  <th className="px-4 py-3 text-right font-semibold">{strings.revenue}</th>
                  <th className="px-4 py-3 text-right font-semibold">{strings.growth}</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((stock) => (
                  <tr key={stock.symbol} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-blue-600">{stock.symbol}</td>
                    <td className="px-4 py-3">{stock.name}</td>
                    <td className="px-4 py-3 text-right font-semibold text-green-600">{stock.score}</td>
                    <td className="px-4 py-3 text-right text-sm">{formatCurrency(stock.marketCap)}</td>
                    <td className="px-4 py-3 text-right text-sm">{formatCurrency(stock.revenue)}</td>
                    <td className="px-4 py-3 text-right text-green-600">{(stock.growthRate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && stocks.length === 0 && (
          <div className="text-center text-slate-500 py-12">
            <p className="text-lg">{strings.noResults}</p>
            <p className="text-sm mt-2">{locale === 'ar' ? 'اضغط الزر أعلاه لبدء الفحص' : 'Click the button above to start scanning'}</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 text-center py-6 mt-12">
        <p>© 2026 Small-Cap Radar | رادار الشركات الصغيرة</p>
      </footer>
    </div>
  )
}
