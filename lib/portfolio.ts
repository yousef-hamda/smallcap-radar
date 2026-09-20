import type { Snapshot } from './engine';

export type PortfolioSide = 'buy' | 'sell';

export type PortfolioTransaction = {
  id: string;
  symbol: string;
  companyName: string;
  side: PortfolioSide;
  quantity: number;
  price: number;
  fees: number;
  tradeDate: string;
  createdAt: string;
  updatedAt: string;
  note?: string;
  metadata?: {
    exchange?: string;
    sector?: string;
    industry?: string;
    website?: string;
  };
};

export type PortfolioQuote = {
  symbol: string;
  name: string;
  price: number | null;
  dailyChange: number | null;
  asOf: string | null;
  source?: string;
  sector?: string;
  industry?: string;
  exchange?: string;
  coreScore?: number | null;
  coreCoverage?: number | null;
  bounceScore?: number | null;
  bounceCoverage?: number | null;
  snapshot?: Snapshot;
};

export type PortfolioPosition = {
  symbol: string;
  name: string;
  quantity: number;
  averageCost: number;
  costBasis: number;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPct: number | null;
  realizedPnl: number;
  dailyPnl: number | null;
  weight: number | null;
  quoteAsOf: string | null;
  sector?: string;
  industry?: string;
  exchange?: string;
  coreScore?: number | null;
  coreCoverage?: number | null;
  bounceScore?: number | null;
  bounceCoverage?: number | null;
};

export type PortfolioHistory = Record<string, Array<{ date: string; close: number }>>;
export type PortfolioPoint = {
  date: string;
  marketValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  returnPct: number | null;
  grossPurchases: number;
};

const EPSILON = 1e-8;

export function sortTransactions<T extends PortfolioTransaction>(transactions: T[]): T[] {
  return [...transactions].sort((a, b) =>
    a.tradeDate.localeCompare(b.tradeDate)
    || (a.side === b.side ? 0 : a.side === 'buy' ? -1 : 1)
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id));
}

export function validateLedger(transactions: PortfolioTransaction[]) {
  const shares = new Map<string, number>();
  for (const transaction of sortTransactions(transactions)) {
    if (!Number.isFinite(transaction.quantity) || transaction.quantity <= 0) throw Error('عدد الأسهم يجب أن يكون أكبر من صفر.');
    if (!Number.isFinite(transaction.price) || transaction.price <= 0) throw Error('سعر العملية يجب أن يكون أكبر من صفر.');
    if (!Number.isFinite(transaction.fees) || transaction.fees < 0) throw Error('العمولة لا يمكن أن تكون سالبة.');
    const before = shares.get(transaction.symbol) ?? 0;
    const after = before + (transaction.side === 'buy' ? transaction.quantity : -transaction.quantity);
    if (after < -EPSILON) throw Error(`لا يمكن بيع ${transaction.quantity} سهم من ${transaction.symbol}؛ الرصيد المتاح في ذلك التاريخ ${before.toFixed(6)}.`);
    shares.set(transaction.symbol, Math.abs(after) < EPSILON ? 0 : after);
  }
  return shares;
}

type RunningPosition = {
  symbol: string;
  name: string;
  quantity: number;
  costBasis: number;
  realizedPnl: number;
  metadata?: PortfolioTransaction['metadata'];
};

function applyTransaction(position: RunningPosition, transaction: PortfolioTransaction) {
  if (transaction.side === 'buy') {
    position.quantity += transaction.quantity;
    position.costBasis += transaction.quantity * transaction.price + transaction.fees;
  } else {
    if (transaction.quantity > position.quantity + EPSILON) throw Error(`عملية بيع ${transaction.symbol} تتجاوز الرصيد المتاح.`);
    const averageCost = position.quantity > EPSILON ? position.costBasis / position.quantity : 0;
    const removedCost = averageCost * transaction.quantity;
    position.realizedPnl += transaction.quantity * transaction.price - transaction.fees - removedCost;
    position.quantity -= transaction.quantity;
    position.costBasis -= removedCost;
    if (position.quantity < EPSILON) {
      position.quantity = 0;
      position.costBasis = 0;
    }
  }
  position.name = transaction.companyName || position.name;
  position.metadata = transaction.metadata || position.metadata;
}

export function calculatePortfolio(transactions: PortfolioTransaction[], quotes: Record<string, PortfolioQuote>) {
  validateLedger(transactions);
  const state = new Map<string, RunningPosition>();
  let grossPurchases = 0;
  let saleProceeds = 0;
  let fees = 0;
  for (const transaction of sortTransactions(transactions)) {
    const position = state.get(transaction.symbol) ?? { symbol: transaction.symbol, name: transaction.companyName, quantity: 0, costBasis: 0, realizedPnl: 0, metadata: transaction.metadata };
    applyTransaction(position, transaction);
    state.set(transaction.symbol, position);
    fees += transaction.fees;
    if (transaction.side === 'buy') grossPurchases += transaction.quantity * transaction.price + transaction.fees;
    else saleProceeds += transaction.quantity * transaction.price - transaction.fees;
  }

  let marketValue = 0, knownCostBasis = 0, unrealizedPnl = 0, realizedPnl = 0, dailyPnl = 0;
  let missingQuoteCount = 0;
  const positions: PortfolioPosition[] = [];
  for (const position of state.values()) {
    realizedPnl += position.realizedPnl;
    if (position.quantity <= EPSILON) continue;
    const quote = quotes[position.symbol];
    const currentPrice = quote?.price != null && Number.isFinite(quote.price) && quote.price > 0 ? quote.price : null;
    const value = currentPrice == null ? null : position.quantity * currentPrice;
    const unrealized = value == null ? null : value - position.costBasis;
    const daily = value == null || quote?.dailyChange == null || !Number.isFinite(quote.dailyChange) || quote.dailyChange <= -1
      ? null
      : value - value / (1 + quote.dailyChange);
    if (value == null) missingQuoteCount++;
    else {
      marketValue += value;
      knownCostBasis += position.costBasis;
      unrealizedPnl += unrealized!;
      if (daily != null) dailyPnl += daily;
    }
    positions.push({
      symbol: position.symbol,
      name: quote?.name || position.name,
      quantity: position.quantity,
      averageCost: position.costBasis / position.quantity,
      costBasis: position.costBasis,
      currentPrice,
      marketValue: value,
      unrealizedPnl: unrealized,
      unrealizedPct: unrealized == null || position.costBasis <= 0 ? null : unrealized / position.costBasis,
      realizedPnl: position.realizedPnl,
      dailyPnl: daily,
      weight: null,
      quoteAsOf: quote?.asOf ?? null,
      sector: quote?.sector || position.metadata?.sector,
      industry: quote?.industry || position.metadata?.industry,
      exchange: quote?.exchange || position.metadata?.exchange,
      coreScore: quote?.coreScore,
      coreCoverage: quote?.coreCoverage,
      bounceScore: quote?.bounceScore,
      bounceCoverage: quote?.bounceCoverage,
    });
  }
  for (const position of positions) position.weight = position.marketValue == null || marketValue <= 0 ? null : position.marketValue / marketValue;
  positions.sort((a, b) => (b.marketValue ?? -1) - (a.marketValue ?? -1) || a.symbol.localeCompare(b.symbol));

  const weights = positions.map(position => position.weight).filter((weight): weight is number => weight != null);
  const hhi = weights.reduce((total, weight) => total + weight ** 2, 0);
  const effectiveHoldings = hhi > 0 ? 1 / hhi : 0;
  const diversificationScore = positions.length <= 1 ? 0 : Math.min(100, Math.max(0, (effectiveHoldings - 1) / (Math.min(10, positions.length) - 1) * 100));
  const sectorValues = new Map<string, number>();
  for (const position of positions) if (position.marketValue != null) sectorValues.set(position.sector || 'غير مصنف', (sectorValues.get(position.sector || 'غير مصنف') ?? 0) + position.marketValue);
  const sectors = [...sectorValues.entries()].map(([name, value]) => ({ name, value, weight: marketValue > 0 ? value / marketValue : 0 })).sort((a, b) => b.value - a.value);
  const weighted = (key: 'coreScore' | 'bounceScore') => {
    const eligible = positions.filter(position => position.marketValue != null && position[key] != null);
    const value = eligible.reduce((total, position) => total + position.marketValue! * position[key]!, 0);
    const covered = eligible.reduce((total, position) => total + position.marketValue!, 0);
    return covered > 0 ? { score: value / covered, coverage: marketValue > 0 ? covered / marketValue : 0 } : { score: null, coverage: 0 };
  };
  const totalPnl = realizedPnl + unrealizedPnl;
  const alerts: string[] = [];
  if ((positions[0]?.weight ?? 0) >= 0.35) alerts.push(`${positions[0].symbol} يمثل ${((positions[0].weight ?? 0) * 100).toFixed(1)}% من المحفظة؛ تركّز مرتفع في سهم واحد.`);
  if ((sectors[0]?.weight ?? 0) >= 0.55) alerts.push(`${sectors[0].name} يمثل ${(sectors[0].weight * 100).toFixed(1)}% من المحفظة؛ راقب مخاطر القطاع.`);
  if (missingQuoteCount) alerts.push(`${missingQuoteCount} مركز بلا سعر حديث؛ الإجماليات تستبعد قيمته ولا تحوله إلى صفر.`);
  if (!alerts.length && positions.length > 1) alerts.push('لا يظهر تنبيه تركّز حاد وفق الحدود الحالية، مع بقاء مخاطر السوق قائمة.');

  return {
    positions,
    sectors,
    alerts,
    summary: {
      marketValue,
      knownCostBasis,
      grossPurchases,
      saleProceeds,
      fees,
      realizedPnl,
      unrealizedPnl,
      totalPnl,
      totalReturnPct: grossPurchases > 0 ? totalPnl / grossPurchases : null,
      dailyPnl,
      winners: positions.filter(position => (position.unrealizedPnl ?? 0) > 0).length,
      losers: positions.filter(position => (position.unrealizedPnl ?? 0) < 0).length,
      openPositions: positions.length,
      missingQuoteCount,
      diversificationScore,
      effectiveHoldings,
      topWeight: positions[0]?.weight ?? null,
      weightedCore: weighted('coreScore'),
      weightedBounce: weighted('bounceScore'),
    },
  };
}

export function buildPerformanceSeries(transactions: PortfolioTransaction[], histories: PortfolioHistory, asOf = new Date().toISOString().slice(0, 10)) {
  if (!transactions.length) return { points: [] as PortfolioPoint[], incompleteSymbols: [] as string[] };
  validateLedger(transactions);
  const sorted = sortTransactions(transactions);
  const firstDate = sorted[0].tradeDate;
  const symbols = [...new Set(sorted.map(transaction => transaction.symbol))];
  const rowsByDate = new Map<string, Array<{ symbol: string; close: number }>>();
  const incompleteSymbols: string[] = [];
  for (const symbol of symbols) {
    const rows = (histories[symbol] ?? []).filter(row => row.date >= firstDate && row.date <= asOf && Number.isFinite(row.close) && row.close > 0).sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) incompleteSymbols.push(symbol);
    for (const row of rows) rowsByDate.set(row.date, [...(rowsByDate.get(row.date) ?? []), { symbol, close: row.close }]);
  }
  const dates = [...new Set([...rowsByDate.keys(), ...sorted.map(transaction => transaction.tradeDate).filter(date => date <= asOf), asOf])].sort();
  const positions = new Map<string, RunningPosition>();
  const prices = new Map<string, { value: number; date: string }>();
  let transactionIndex = 0, grossPurchases = 0;
  const points: PortfolioPoint[] = [];
  for (const date of dates) {
    for (const row of rowsByDate.get(date) ?? []) prices.set(row.symbol, { value: row.close, date });
    while (transactionIndex < sorted.length && sorted[transactionIndex].tradeDate <= date) {
      const transaction = sorted[transactionIndex++];
      const position = positions.get(transaction.symbol) ?? { symbol: transaction.symbol, name: transaction.companyName, quantity: 0, costBasis: 0, realizedPnl: 0, metadata: transaction.metadata };
      applyTransaction(position, transaction);
      positions.set(transaction.symbol, position);
      if (transaction.side === 'buy') grossPurchases += transaction.quantity * transaction.price + transaction.fees;
      if (!prices.has(transaction.symbol)) prices.set(transaction.symbol, { value: transaction.price, date: transaction.tradeDate });
    }
    let marketValue = 0, costBasis = 0, realizedPnl = 0, complete = true, open = 0;
    for (const position of positions.values()) {
      realizedPnl += position.realizedPnl;
      if (position.quantity <= EPSILON) continue;
      open++;
      const quote = prices.get(position.symbol);
      if (!quote || (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${quote.date}T00:00:00Z`)) / 86_400_000 > 7) { complete = false; continue; }
      marketValue += position.quantity * quote.value;
      costBasis += position.costBasis;
    }
    if (!open || !complete) continue;
    const unrealizedPnl = marketValue - costBasis;
    const totalPnl = realizedPnl + unrealizedPnl;
    points.push({ date, marketValue, realizedPnl, unrealizedPnl, totalPnl, returnPct: grossPurchases > 0 ? totalPnl / grossPurchases : null, grossPurchases });
  }
  if (points.length <= 500) return { points, incompleteSymbols };
  const step = (points.length - 1) / 499;
  const sampled = Array.from({ length: 499 }, (_, index) => points[Math.round(index * step)]);
  sampled.push(points.at(-1)!);
  return { points: [...new Map(sampled.map(point => [point.date, point])).values()], incompleteSymbols };
}
