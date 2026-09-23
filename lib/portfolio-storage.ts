import { db, ensureSchema } from './storage';
import { companyBySymbol, yahooBulkQuotes, type Company } from './providers';
import { evaluateStrategy, type Snapshot } from './engine';
import { calculatePortfolio, type PortfolioQuote, type PortfolioTransaction } from './portfolio';

const parseMetadata = (value: unknown) => {
  try { return value ? JSON.parse(String(value)) : {}; } catch { return {}; }
};

export function transactionFromRow(row: any): PortfolioTransaction {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    companyName: String(row.company_name),
    side: row.side === 'sell' ? 'sell' : 'buy',
    quantity: Number(row.quantity),
    price: Number(row.price),
    fees: Number(row.fees || 0),
    tradeDate: String(row.trade_date),
    note: String(row.note || ''),
    metadata: parseMetadata(row.metadata),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function readPortfolioTransactions(owner: string) {
  await ensureSchema();
  const rows = (await db().prepare('SELECT * FROM portfolio_transactions WHERE owner=? ORDER BY trade_date ASC, CASE side WHEN \'buy\' THEN 0 ELSE 1 END ASC, created_at ASC, id ASC').bind(owner).all()).results as any[];
  return rows.map(transactionFromRow);
}

function placeholders(count: number) { return Array.from({ length: count }, () => '?').join(','); }

async function snapshotMap(symbols: string[]) {
  const snapshots = new Map<string, Snapshot>();
  if (!symbols.length) return snapshots;
  const latestRows = (await db().prepare(`SELECT symbol,payload FROM (
    SELECT symbol,payload,ROW_NUMBER() OVER(PARTITION BY symbol ORDER BY as_of DESC,id DESC) AS row_number
    FROM fundamental_snapshots WHERE symbol IN (${placeholders(symbols.length)})
  ) WHERE row_number=1`).bind(...symbols).all()).results as any[];
  for (const row of latestRows) {
    try { snapshots.set(String(row.symbol), JSON.parse(String(row.payload))); } catch { /* corrupted cache is ignored */ }
  }
  const keys = symbols.flatMap(symbol => [`deep:v7:${symbol}`, `deep:v6:${symbol}`, `deep:v5:${symbol}`, `deep:v4:${symbol}`]);
  const deepRows = (await db().prepare(`SELECT key,payload,retrieved_at FROM raw_cache WHERE key IN (${placeholders(keys.length)}) ORDER BY retrieved_at ASC`).bind(...keys).all()).results as any[];
  for (const row of deepRows) {
    try {
      const snapshot = JSON.parse(String(row.payload)) as Snapshot;
      if (snapshot?.symbol && symbols.includes(snapshot.symbol)) snapshots.set(snapshot.symbol, snapshot);
    } catch { /* corrupted cache is ignored */ }
  }
  return snapshots;
}

export async function readPortfolioQuotes(symbols: string[], options: { forceRefresh?: boolean } = {}) {
  await ensureSchema();
  const unique = [...new Set(symbols.map(symbol => symbol.toUpperCase()))].slice(0, 80);
  const snapshots = await snapshotMap(unique), now = Date.now();
  const liveQuotes = new Map<string, Company>();
  if (unique.length) {
    const keys = unique.map(symbol => `portfolio-quote:v1:${symbol}`);
    const cachedRows = (await db().prepare(`SELECT key,retrieved_at,payload FROM raw_cache WHERE key IN (${placeholders(keys.length)})`).bind(...keys).all()).results as any[];
    for (const row of cachedRows) {
      if (options.forceRefresh || now - Date.parse(String(row.retrieved_at)) > 5 * 60_000) continue;
      try {
        const quote = JSON.parse(String(row.payload)) as Company;
        if (quote?.ticker && quote.quoteSource === 'Yahoo bulk quote live' && Number.isFinite(quote.price) && quote.price! > 0) liveQuotes.set(quote.ticker, quote);
      } catch { /* corrupted cache is ignored */ }
    }
    const missing = unique.filter(symbol => !liveQuotes.has(symbol)).map(companyBySymbol).filter((company): company is Company => !!company);
    if (missing.length) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const refreshed = await Promise.race([
        yahooBulkQuotes(missing),
        new Promise<Company[]>(resolve => { timeout = setTimeout(() => resolve(missing), 4_000); }),
      ]).finally(() => { if (timeout) clearTimeout(timeout); });
      const retrievedAt = new Date().toISOString();
      const writes = [];
      for (const quote of refreshed) {
        if (quote.quoteSource !== 'Yahoo bulk quote live' || !Number.isFinite(quote.price) || quote.price! <= 0) continue;
        liveQuotes.set(quote.ticker, quote);
        writes.push(db().prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(`portfolio-quote:v1:${quote.ticker}`, quote.quoteSource, retrievedAt, JSON.stringify(quote)));
      }
      if (writes.length) await db().batch(writes);
    }
  }
  const quotes: Record<string, PortfolioQuote> = {};
  for (const symbol of unique) {
    const company = companyBySymbol(symbol);
    const live = liveQuotes.get(symbol);
    const snapshot = snapshots.get(symbol);
    const core = snapshot ? evaluateStrategy('core', snapshot) : null;
    const bounce = snapshot ? evaluateStrategy('bounce', snapshot) : null;
    const price = live?.price != null && Number.isFinite(live.price) && live.price > 0
      ? live.price
      : snapshot?.price != null && Number.isFinite(snapshot.price) && snapshot.price > 0
      ? snapshot.price
      : company?.price != null && Number.isFinite(company.price) && company.price > 0 ? company.price : null;
    quotes[symbol] = {
      symbol,
      name: snapshot?.name || company?.name || symbol,
      nameAr: snapshot?.nameAr,
      price,
      dailyChange: live?.dailyChange ?? snapshot?.dailyChange ?? company?.dailyChange ?? null,
      asOf: live?.quoteAvailableAt || snapshot?.provenance?.price?.availableAt || snapshot?.asOf || company?.quoteAvailableAt || null,
      source: live?.quoteSource || snapshot?.provenance?.price?.source || company?.quoteSource,
      sector: live?.sector || snapshot?.sector || company?.sector,
      industry: live?.industry || snapshot?.industry || company?.industry,
      exchange: snapshot?.exchange || company?.exchange,
      coreScore: core?.score ?? null,
      coreCoverage: core?.scoreCoverage ?? null,
      bounceScore: bounce?.score ?? null,
      bounceCoverage: bounce?.scoreCoverage ?? null,
      snapshot,
    };
  }
  return quotes;
}

export async function canonicalPortfolioAsset(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  const company = companyBySymbol(normalized);
  const snapshot = (await snapshotMap([normalized])).get(normalized);
  if (!company && !snapshot) return null;
  return {
    symbol: normalized,
    name: snapshot?.name || company!.name,
    metadata: {
      exchange: snapshot?.exchange || company?.exchange,
      sector: snapshot?.sector || company?.sector,
      industry: snapshot?.industry || company?.industry,
      website: snapshot?.website,
    },
  };
}

export async function readPortfolio(owner: string, options: { forceRefresh?: boolean } = {}) {
  const transactions = await readPortfolioTransactions(owner);
  const quotes = await readPortfolioQuotes(transactions.map(transaction => transaction.symbol), options);
  const calculated = calculatePortfolio(transactions, quotes);
  const compactQuotes = Object.fromEntries(Object.entries(quotes).map(([symbol, quote]) => {
    const compact = { ...quote };
    delete compact.snapshot;
    return [symbol, compact];
  }));
  return { transactions: [...transactions].reverse(), quotes: compactQuotes, ...calculated, asOf: new Date().toISOString() };
}
