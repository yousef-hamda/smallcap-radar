import { db, ensureSchema } from '@/lib/storage';
import { json } from '@/lib/http';
import { resolveVisitor } from '@/lib/visitor';
import { buildPerformanceSeries, type PortfolioHistory } from '@/lib/portfolio';
import { readPortfolioQuotes, readPortfolioTransactions } from '@/lib/portfolio-storage';
import { historicalMarketData } from '@/lib/providers';

const CACHE_HOURS = 6;
const MAX_SYMBOLS = 64;

async function mapLimited<T, R>(values: T[], limit: number, work: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await work(values[index]);
    }
  }));
  return results;
}

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const identity = await resolveVisitor(request), transactions = await readPortfolioTransactions(identity.owner);
    if (!transactions.length) {
      const response = json({ points: [], unavailable: [], incompleteSymbols: [], sources: [], asOf: new Date().toISOString() });
      if (identity.cookie) response.headers.set('Set-Cookie', identity.cookie);
      return response;
    }
    const allSymbols = [...new Set(transactions.map(transaction => transaction.symbol))];
    if (allSymbols.length > MAX_SYMBOLS) return json({ error: `يدعم الرسم حتى ${MAX_SYMBOLS} سهمًا مختلفًا في المحفظة.` }, 422);
    const now = new Date(), asOf = now.toISOString(), today = asOf.slice(0, 10);
    const firstDate = transactions.reduce((minimum, transaction) => transaction.tradeDate < minimum ? transaction.tradeDate : minimum, transactions[0].tradeDate);
    const requestedDays = Math.min(7_300, Math.max(45, Math.ceil((Date.now() - Date.parse(`${firstDate}T00:00:00Z`)) / 86_400_000) + 30));
    const cacheKeys = allSymbols.map(symbol => `portfolio-history:v1:${symbol}`);
    const placeholders = cacheKeys.map(() => '?').join(',');
    const cachedRows = (await db().prepare(`SELECT key,retrieved_at,payload FROM raw_cache WHERE key IN (${placeholders})`).bind(...cacheKeys).all()).results as any[];
    const cached = new Map(cachedRows.map(row => [String(row.key).split(':').at(-1)!, row]));
    const unavailable: string[] = [], sources: Array<{ symbol: string; source: string; availableAt: string }> = [];
    const histories: PortfolioHistory = {};
    const freshWrites: Array<{ key: string; source: string; payload: string }> = [];
    await mapLimited(allSymbols, 4, async symbol => {
      const row = cached.get(symbol);
      if (row && Date.now() - Date.parse(String(row.retrieved_at)) < CACHE_HOURS * 3_600_000) {
        try {
          const payload = JSON.parse(String(row.payload));
          if (payload.from <= firstDate && Array.isArray(payload.history)) {
            histories[symbol] = payload.history;
            sources.push({ symbol, source: payload.source || 'ذاكرة تاريخ المحفظة', availableAt: payload.availableAt || row.retrieved_at });
            return;
          }
        } catch { /* refresh a corrupted or insufficient cache */ }
      }
      try {
        const result = await historicalMarketData(symbol, asOf, requestedDays);
        const history = result.history.filter(bar => bar.date <= today && Number.isFinite(bar.close) && bar.close! > 0).map(bar => ({ date: bar.date, close: Number(bar.close) }));
        if (!history.length) throw Error('لا توجد جلسات موثقة');
        histories[symbol] = history;
        const payload = { from: history[0].date, history, source: result.source, availableAt: result.availableAt };
        freshWrites.push({ key: `portfolio-history:v1:${symbol}`, source: result.source, payload: JSON.stringify(payload) });
        sources.push({ symbol, source: result.source, availableAt: result.availableAt });
      } catch { unavailable.push(symbol); }
    });
    if (freshWrites.length) await db().batch(freshWrites.map(row => db().prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(row.key, row.source, asOf, row.payload)));
    const quotes = await readPortfolioQuotes(allSymbols);
    for (const symbol of allSymbols) {
      const quote = quotes[symbol];
      if (quote?.price != null && quote.price > 0) {
        const history = histories[symbol] ?? [];
        const date = quote.asOf?.slice(0, 10) || today;
        const ageDays = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
        // A dated scan snapshot may still be useful in the company file, but it
        // must not be presented as today's portfolio price or extend the chart
        // across a stale gap.  Only append a quote that is no more than seven
        // calendar days old (weekends/holidays included).
        if (date <= today && ageDays >= 0 && ageDays <= 7) histories[symbol] = [...history.filter(row => row.date !== date), { date, close: quote.price }].sort((a, b) => a.date.localeCompare(b.date));
      }
    }
    const series = buildPerformanceSeries(transactions, histories, today);
    const response = json({ ...series, unavailable, sources, asOf, method: 'الربح المحقق + غير المحقق ÷ إجمالي تكلفة المشتريات حتى كل تاريخ' });
    if (identity.cookie) response.headers.set('Set-Cookie', identity.cookie);
    return response;
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'تعذّر بناء تاريخ المحفظة.' }, 503); }
}
