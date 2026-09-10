import React, { useState } from 'react'
import type { Stock } from './types'

/**
 * Small-Cap Radar | رادار الشركات الصغيرة
 * 
 * Arabic stock screener for US market.
 * Identifies small-cap "explosion" candidates.
 */

export default function App() {
  const [locale, setLocale] = useState<'ar' | 'en'>('ar')
  const [stocks, setStocks] = useState<Stock[]>([])
  const [loading, setLoading] = useState(false)

  const t = {
    ar: {
      title: 'رادار الشركات الصغيرة',
      subtitle: 'فحص الأسهم الصغيرة في السوق الأمريكي',
      scan: 'فحص السوق',
      results: 'النتائج',
      noResults: 'لم تُعثر على نتائج',
      loading: 'جاري الفحص...',
    },
    en: {
      title: 'Small-Cap Radar',
      subtitle: 'US stock screener for small-cap opportunities',
      scan: 'Scan Market',
      results: 'Results',
      noResults: 'No results found',
      loading: 'Scanning...',
    }
  }

  const strings = t[locale]

  const handleScan = async () => {
    setLoading(true)
    try {
      // Fetch from scoring engine
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await response.json()
      setStocks(data.stocks || [])
    } catch (err) {
      console.error('Scan failed:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`min-h-screen ${locale === 'ar' ? 'rtl' : 'ltr'}`}>
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
                  <th className="px-4 py-3 text-left font-semibold">Symbol</th>
                  <th className="px-4 py-3 text-right font-semibold">Score</th>
                  <th className="px-4 py-3 text-right font-semibold">Market Cap</th>
                  <th className="px-4 py-3 text-right font-semibold">Revenue</th>
                  <th className="px-4 py-3 text-right font-semibold">Growth</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((stock) => (
                  <tr key={stock.symbol} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold">{stock.symbol}</td>
                    <td className="px-4 py-3 text-right">{stock.score.toFixed(1)}</td>
                    <td className="px-4 py-3 text-right">${(stock.marketCap / 1e9).toFixed(2)}B</td>
                    <td className="px-4 py-3 text-right">${(stock.revenue / 1e9).toFixed(2)}B</td>
                    <td className="px-4 py-3 text-right text-green-600">{(stock.growthRate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && stocks.length === 0 && (
          <div className="text-center text-slate-500 py-12">
            <p>{strings.noResults}</p>
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
