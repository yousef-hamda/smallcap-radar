'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BriefcaseBusiness, Download, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiJson } from '@/lib/client-json';
import type { Snapshot } from '@/lib/engine';
import type { PortfolioPoint, PortfolioPosition, PortfolioQuote, PortfolioTransaction } from '@/lib/portfolio';

type PortfolioData = {
  transactions: PortfolioTransaction[];
  positions: PortfolioPosition[];
  quotes: Record<string, PortfolioQuote>;
  sectors: Array<{ name: string; value: number; weight: number }>;
  alerts: string[];
  summary: {
    marketValue: number;
    knownCostBasis: number;
    grossPurchases: number;
    saleProceeds: number;
    fees: number;
    realizedPnl: number;
    unrealizedPnl: number;
    totalPnl: number;
    totalReturnPct: number | null;
    dailyPnl: number;
    winners: number;
    losers: number;
    openPositions: number;
    missingQuoteCount: number;
    diversificationScore: number;
    effectiveHoldings: number;
    topWeight: number | null;
    weightedCore: { score: number | null; coverage: number };
    weightedBounce: { score: number | null; coverage: number };
  };
  asOf: string;
};

type SearchResult = { symbol: string; name: string; nameAr?: string; exchange?: string; price?: number | null; sector?: string; industry?: string };
type HistoryData = { points: PortfolioPoint[]; unavailable: string[]; incompleteSymbols: string[]; sources: Array<{ symbol: string; source: string; availableAt: string }>; asOf: string; method?: string };
type FormState = { id?: string; symbol: string; side: 'buy' | 'sell'; quantity: string; price: string; fees: string; tradeDate: string; note: string };

const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = (): FormState => ({ symbol: '', side: 'buy', quantity: '', price: '', fees: '0', tradeDate: today(), note: '' });
const usd = (value: number | null | undefined, signed = false) => value == null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: signed ? 'exceptZero' : 'auto' }).format(value);
const pct = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
const weightPct = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(2)}%`;
const number = (value: number, digits = 4) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
const post = (method: 'POST' | 'PUT' | 'DELETE', body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const performanceRanges = { '1M': 31, '3M': 93, '6M': 186, '1Y': 366, MAX: Infinity } as const;

function CompanyLogo({ symbol, size = 44 }: { symbol: string; size?: number }) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  // Bump this when the resolver changes so a browser cannot keep an old
  // initials placeholder cached for a full day after a deployment.
  const logoVersion = '5';
  const src = `/api/portfolio-logo?symbol=${encodeURIComponent(symbol)}&v=${logoVersion}`;
  const retrySrc = `/api/portfolio-logo?symbol=${encodeURIComponent(symbol)}&v=${logoVersion}&retry=1`;
  return <Image unoptimized className="company-logo" src={failedFor === symbol ? retrySrc : src} width={size} height={size} alt={`شعار ${symbol}`} loading="lazy" onError={() => setFailedFor(symbol)} />;
}

export function PerformanceChart({ history }: { history: HistoryData | null }) {
  const [range, setRange] = useState<'1M' | '3M' | '6M' | '1Y' | 'MAX'>('1Y');
  const [hovered, setHovered] = useState<number | null>(null);
  const rows = useMemo(() => {
    const all = history?.points ?? [];
    if (!all.length || range === 'MAX') return all;
    const cutoff = Date.parse(`${all.at(-1)!.date}T00:00:00Z`) - performanceRanges[range] * 86_400_000;
    return all.filter(point => Date.parse(`${point.date}T00:00:00Z`) >= cutoff);
  }, [history, range]);
  const validRows = rows.filter((point): point is PortfolioPoint & { returnPct: number } => point.returnPct != null && Number.isFinite(point.returnPct));
  const values = validRows.map(point => point.returnPct);
  const low = values.length ? Math.min(...values, 0) : 0, high = values.length ? Math.max(...values, 0) : 0;
  const padding = Math.max((high - low) * .12, .01);
  const x = (index: number) => 18 + index / Math.max(1, validRows.length - 1) * 684;
  const y = (value: number) => 210 - (value - low + padding) / Math.max(.0001, high - low + padding * 2) * 180;
  const path = validRows.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(2)},${y(point.returnPct).toFixed(2)}`).join(' ');
  const last = validRows.at(-1), selected = hovered == null ? last : validRows[hovered];
  const color = (last?.returnPct ?? 0) < 0 ? '#fb7185' : '#14d9a4';
  const gradientId = useId().replaceAll(':', '');
  return <section className="portfolio-panel performance-panel">
    <div className="section-line"><div><h3>أداء المحفظة عبر الزمن</h3><p>الربح المحقق وغير المحقق مقارنة بإجمالي تكلفة المشتريات.</p></div><strong className={(last?.returnPct ?? 0) >= 0 ? 'pass' : 'fail'} dir="ltr">{pct(last?.returnPct)}</strong></div>
    <Tabs value={range} onValueChange={value => { setRange(value as typeof range); setHovered(null); }} dir="rtl" className="portfolio-range"><TabsList aria-label="فترة أداء المحفظة">{(['1M', '3M', '6M', '1Y', 'MAX'] as const).map(value => <TabsTrigger key={value} value={value}>{value === 'MAX' ? 'الكل' : value}</TabsTrigger>)}</TabsList></Tabs>
    <div className="portfolio-chart-frame">
      {validRows.length < 2 ? <div className="portfolio-chart-empty">أضف عملية مع تاريخ وسعر صحيحين ليظهر الأداء الزمني. لا نرسم خطًا من بيانات ناقصة.</div> : <>
        <div className="portfolio-chart-tooltip"><b dir="ltr">{pct(selected?.returnPct)}</b><span dir="ltr">{selected?.date} · {usd(selected?.marketValue)}</span></div>
        <svg viewBox="0 0 720 230" role="img" aria-label={`أداء المحفظة من ${validRows[0].date} إلى ${last!.date}؛ العائد ${pct(last?.returnPct)}`} tabIndex={0} onPointerMove={event => { const box = event.currentTarget.getBoundingClientRect(); setHovered(Math.round(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * (validRows.length - 1))); }} onPointerLeave={() => setHovered(null)} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setHovered(index => Math.max(0, Math.min(validRows.length - 1, (index ?? validRows.length - 1) + (event.key === 'ArrowRight' ? 1 : -1)))); } }}>
          <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".28"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
          <line x1="18" x2="702" y1={y(0)} y2={y(0)} stroke="#6b7280" strokeDasharray="5 5"/>
          <path d={`${path} L702,220 L18,220 Z`} fill={`url(#${gradientId})`}/><path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
          <line x1={x(hovered ?? validRows.length - 1)} x2={x(hovered ?? validRows.length - 1)} y1="15" y2="220" stroke="#818cf8" strokeDasharray="3 4"/><circle cx={x(hovered ?? validRows.length - 1)} cy={y(selected!.returnPct)} r="5" fill={color}/>
        </svg>
        <div className="chart-dates" dir="ltr"><span>{validRows[0].date}</span><span dir="rtl">أدنى {pct(low)} · أعلى {pct(high)}</span><span>{last!.date}</span></div>
      </>}
    </div>
    {!!history?.unavailable.length && <p className="portfolio-warning"><AlertTriangle size={16}/> التاريخ غير متاح حاليًا لـ {history.unavailable.join('، ')}؛ لم تُحوّل البيانات الناقصة إلى صفر.</p>}
  </section>;
}

type TreemapNode = PortfolioPosition & { x: number; y: number; width: number; height: number; color: string };
type TreemapDatum = { position: PortfolioPosition; index: number };
type TreemapRoot = { children: TreemapDatum[] };
type TreemapData = TreemapRoot | TreemapDatum;

// D3's standard squarified treemap keeps areas proportional while choosing
// readable rectangles, adding consistent inner/outer gaps, and recalculating
// the complete layout whenever the portfolio values change.
export function squarifiedTreemap(positions: PortfolioPosition[]): TreemapNode[] {
  const palette = ['#5eead4', '#60a5fa', '#c084fc', '#fb7185', '#fbbf24', '#34d399', '#818cf8', '#f472b6'];
  const values = positions.filter(position => Number.isFinite(position.marketValue) && position.marketValue! > 0)
    .sort((a, b) => (b.marketValue! - a.marketValue!) || a.symbol.localeCompare(b.symbol));
  if (!values.length) return [];
  const root = hierarchy<TreemapData>({ children: values.map((position, index) => ({ position, index })) }, datum => 'children' in datum ? datum.children : undefined)
    .sum(datum => 'position' in datum ? datum.position.marketValue! : 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || ('position' in a.data && 'position' in b.data ? a.data.position.symbol.localeCompare(b.data.position.symbol) : 0));
  const layoutRoot = treemap<TreemapData>()
    .size([100, 100])
    .round(false)
    .paddingOuter(0.8)
    .paddingInner(1.1)
    .tile(treemapSquarify.ratio((1 + Math.sqrt(5)) / 2))(root);
  return layoutRoot.leaves().flatMap(node => {
    if (!('position' in node.data)) return [];
    return [{ ...node.data.position, x: node.x0, y: node.y0, width: Math.max(0, node.x1 - node.x0), height: Math.max(0, node.y1 - node.y0), color: palette[node.data.index % palette.length] }];
  });
}

export function AllocationTreemap({ positions, onOpen }: { positions: PortfolioPosition[]; onOpen: (position: PortfolioPosition) => void }) {
  const nodes = useMemo(() => squarifiedTreemap(positions), [positions]);
  return <section className="portfolio-panel allocation-panel"><div className="section-line"><div><h3>توزيع المحفظة</h3><p>مساحة كل مستطيل تساوي وزن الشركة من القيمة الحالية.</p></div><span>{positions.length} مراكز</span></div>
    {nodes.length ? <><div className="portfolio-treemap" role="group" aria-label="خريطة توزيع مراكز المحفظة">{nodes.map(node => <button className="treemap-node" key={node.symbol} style={{ insetInlineStart: `${node.x}%`, top: `${node.y}%`, width: `${node.width}%`, height: `${node.height}%`, '--node-color': node.color } as React.CSSProperties} onClick={() => onOpen(node)} aria-label={`${node.nameAr || node.name}، ${node.symbol}، وزن ${weightPct(node.weight)}`} title={`${node.symbol} · ${weightPct(node.weight)} · ${usd(node.marketValue)}`}>
      <span className="treemap-node-logo"><CompanyLogo symbol={node.symbol} size={44}/></span><span className="treemap-node-copy"><b dir="ltr">{node.symbol}</b><span dir="ltr">{weightPct(node.weight)}</span><small>{usd(node.marketValue)}</small><em className="treemap-node-company" dir="auto">{node.nameAr || node.name}</em></span>
    </button>)}</div><div className="allocation-legend" role="list" aria-label="نسب شركات المحفظة">{nodes.map(node => <button role="listitem" key={node.symbol} onClick={() => onOpen(node)} aria-label={`فتح ${node.nameAr || node.name}، وزن ${weightPct(node.weight)}`}><CompanyLogo symbol={node.symbol} size={36}/><span><b dir="ltr">{node.symbol}</b><small dir="auto">{node.nameAr || node.name}</small></span><strong dir="ltr">{weightPct(node.weight)}</strong></button>)}</div></> : <div className="portfolio-chart-empty">لا يمكن رسم التوزيع حتى يتوفر سعر موثوق لمركز واحد على الأقل.</div>}
  </section>;
}

export default function PortfolioView({ onOpenCompany, onCountChange }: { onOpenCompany: (snapshot: Snapshot) => void; onCountChange?: (count: number) => void }) {
  const [data, setData] = useState<PortfolioData | null>(null), [history, setHistory] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true), [historyLoading, setHistoryLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [query, setQuery] = useState(''), [results, setResults] = useState<SearchResult[]>([]), [searching, setSearching] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false), [detailLoading, setDetailLoading] = useState(false), [selected, setSelected] = useState<SearchResult | null>(null), [form, setForm] = useState<FormState>(emptyForm);
  const [deleteTransaction, setDeleteTransaction] = useState<PortfolioTransaction | null>(null);
  const companyRequest = useRef<AbortController | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try { setHistory(await apiJson<HistoryData>('/api/portfolio-history')); }
    catch (error) { setError(error instanceof Error ? error.message : 'تعذّر تحميل تاريخ المحفظة.'); }
    finally { setHistoryLoading(false); }
  }, []);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { const value = await apiJson<PortfolioData>('/api/portfolio'); setData(value); onCountChange?.(value.positions.length); setError(''); void loadHistory(); }
    catch (error) { setError(error instanceof Error ? error.message : 'تعذّر تحميل المحفظة.'); }
    finally { setLoading(false); }
  }, [loadHistory, onCountChange]);
  useEffect(() => { queueMicrotask(() => void refresh()); return () => companyRequest.current?.abort(); }, [refresh]);
  useEffect(() => {
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible' && !busy) void refresh(); };
    const timer = window.setInterval(refreshWhenVisible, 5 * 60_000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refreshWhenVisible); document.removeEventListener('visibilitychange', refreshWhenVisible); };
  }, [busy, refresh]);
  useEffect(() => {
    if (query.trim().length < 1) return;
    const controller = new AbortController(), timer = window.setTimeout(() => {
      setSearching(true);
      void apiJson<{ results: SearchResult[] }>(`/api/portfolio?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal }).then(value => setResults(value.results)).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'تعذّر البحث.'); }).finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  async function chooseCompany(company: SearchResult) {
    companyRequest.current?.abort();
    const controller = new AbortController();
    companyRequest.current = controller;
    setSelected(company); setForm({ ...emptyForm(), symbol: company.symbol, price: company.price ? String(company.price) : '' }); setDialogOpen(true); setDetailLoading(true); setQuery(''); setResults([]);
    try {
      const value = await apiJson<{ snapshot: Snapshot }>(`/api/company?symbol=${encodeURIComponent(company.symbol)}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setSelected({ ...company, name: value.snapshot.name, nameAr: value.snapshot.nameAr, exchange: value.snapshot.exchange, sector: value.snapshot.sector, industry: value.snapshot.industry, price: value.snapshot.price });
      setForm(current => ({ ...current, price: current.price || (value.snapshot.price ? String(value.snapshot.price) : '') }));
    } catch { if (!controller.signal.aborted) setNotice('سيُحفظ السهم من دليل السوق؛ تعذّر تحديث ملفه العميق الآن.'); }
    finally { if (!controller.signal.aborted) setDetailLoading(false); }
  }
  function editTransaction(transaction: PortfolioTransaction) {
    setSelected({ symbol: transaction.symbol, name: transaction.companyName, exchange: transaction.metadata?.exchange, sector: transaction.metadata?.sector, industry: transaction.metadata?.industry });
    setForm({ id: transaction.id, symbol: transaction.symbol, side: transaction.side, quantity: String(transaction.quantity), price: String(transaction.price), fees: String(transaction.fees), tradeDate: transaction.tradeDate, note: transaction.note || '' });
    setDialogOpen(true);
  }
  function openNewTransaction() {
    setSelected(null); setForm(emptyForm()); setQuery(''); setResults([]); setSearching(false); setDialogOpen(true);
  }
  async function saveTransaction(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const payload = { ...form, quantity: Number(form.quantity), price: Number(form.price), fees: Number(form.fees || 0) };
      const value = await apiJson<PortfolioData>('/api/portfolio', post(form.id ? 'PUT' : 'POST', payload));
      setData(value); onCountChange?.(value.positions.length); setDialogOpen(false); setForm(emptyForm()); setSelected(null); setNotice(form.id ? 'تم تعديل العملية وإعادة حساب المحفظة.' : 'تم حفظ العملية وإعادة حساب المحفظة.'); void loadHistory();
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر حفظ العملية.'); }
    finally { setBusy(false); }
  }
  async function removeTransaction() {
    if (!deleteTransaction) return;
    setBusy(true); setError('');
    try { const value = await apiJson<PortfolioData>('/api/portfolio', post('DELETE', { id: deleteTransaction.id })); setData(value); onCountChange?.(value.positions.length); setDeleteTransaction(null); setNotice('حُذفت العملية وأُعيد حساب السجل كاملًا.'); void loadHistory(); }
    catch (error) { setError(error instanceof Error ? error.message : 'تعذّر حذف العملية.'); }
    finally { setBusy(false); }
  }
  function openPosition(position: PortfolioPosition) {
    const quote = data?.quotes[position.symbol];
    onOpenCompany(quote?.snapshot || { symbol: position.symbol, name: position.name, nameAr: position.nameAr, asOf: quote?.asOf || new Date().toISOString(), price: position.currentPrice, exchange: position.exchange, sector: position.sector, industry: position.industry, provenance: {} });
  }
  function exportCsv() {
    if (!data) return;
    const rows = [['symbol', 'company', 'side', 'quantity', 'price', 'fees', 'trade_date', 'note'], ...[...data.transactions].reverse().map(transaction => [transaction.symbol, transaction.companyName, transaction.side, transaction.quantity, transaction.price, transaction.fees, transaction.tradeDate, transaction.note || ''])];
    const csv = '\ufeff' + rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), anchor = document.createElement('a'); anchor.href = url; anchor.download = `portfolio-${today()}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }
  const editedTransaction = form.id ? data?.transactions.find(transaction => transaction.id === form.id) : null;
  const availableToSell = selected
    ? (data?.positions.find(position => position.symbol === selected.symbol)?.quantity ?? 0)
      + (editedTransaction?.side === 'sell' && editedTransaction.symbol === selected.symbol ? editedTransaction.quantity : 0)
    : 0;
  const staleQuoteCount = data?.positions.filter(position => {
    const date = position.quoteAsOf?.slice(0, 10);
    if (!date) return true;
    const age = (Date.parse(`${data.asOf.slice(0, 10)}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
    return !Number.isFinite(age) || age > 7;
  }).length ?? 0;

  if (loading && !data) return <div className="portfolio-loading" role="status"><BriefcaseBusiness/> جارٍ تحميل محفظتك المحفوظة…</div>;
  return <section className="portfolio-view" aria-label="محفظتي الاستثمارية">
    {(error || notice) && <div className={`message ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><span>{error || notice}</span><button aria-label="إغلاق الرسالة" onClick={() => { setError(''); setNotice(''); }}><X size={16}/></button></div>}
    <div className="portfolio-hero"><div><span className="portfolio-kicker"><BriefcaseBusiness size={17}/> محفظتي</span><h2>متابعة قراراتك، لا أسعارك فقط</h2><p>سجّل الشراء والبيع، ثم راقب العائد والتوزيع والتركيز من بياناتك الحقيقية.</p></div><div className="portfolio-hero-actions"><button className="portfolio-export" onClick={exportCsv} disabled={!data?.transactions.length}><Download size={17}/> تصدير CSV</button><button className="scan-button" onClick={openNewTransaction}><Plus size={17}/> إضافة عملية</button></div></div>

    <div className="portfolio-search"><Search size={19}/><input value={query} onChange={event => { const value = event.target.value; setQuery(value); if (!value.trim()) { setResults([]); setSearching(false); } }} placeholder="ابحث عن الشركة أو رمز السهم لإضافة عملية" aria-label="ابحث عن سهم لإضافته إلى المحفظة"/><span>{searching ? 'جارٍ البحث…' : query && !results.length ? 'لا نتائج' : ''}</span>{!!results.length && <div className="portfolio-search-results">{results.map(company => <button key={company.symbol} onClick={() => void chooseCompany(company)}><CompanyLogo symbol={company.symbol}/><span><b dir="ltr">{company.symbol}</b><small dir="auto">{company.name}</small></span><em>{company.exchange || 'سوق أمريكي'}</em></button>)}</div>}</div>

    {!data?.transactions.length ? <div className="portfolio-empty"><div className="empty-portfolio-icon"><BriefcaseBusiness/></div><h3>محفظتك فارغة</h3><p>ابحث عن أول شركة، أدخل عدد الأسهم وسعر الشراء والتاريخ، وسنبدأ حساب الأداء والتوزيع دون أرقام افتراضية.</p><button className="scan-button" onClick={openNewTransaction}><Plus size={17}/> إضافة أول عملية</button></div> : <>
      <div className="portfolio-metrics"><article><span>القيمة الحالية</span><strong dir="ltr">{usd(data.summary.marketValue)}</strong><small>{data.summary.missingQuoteCount ? `${data.summary.missingQuoteCount} مركز غير محسوب` : staleQuoteCount ? `${staleQuoteCount} سعر مؤرخ؛ راجع تاريخ السعر` : 'كل الأسعار حديثة'}</small></article><article className={data.summary.totalPnl >= 0 ? 'positive' : 'negative'}><span>الربح/الخسارة الكلية</span><strong dir="ltr">{usd(data.summary.totalPnl, true)}</strong><small dir="ltr">{pct(data.summary.totalReturnPct)}</small></article><article><span>غير المحقق</span><strong dir="ltr">{usd(data.summary.unrealizedPnl, true)}</strong><small>{data.summary.winners} رابحة · {data.summary.losers} خاسرة</small></article><article><span>المحقق من البيع</span><strong dir="ltr">{usd(data.summary.realizedPnl, true)}</strong><small>بعد العمولات المسجلة</small></article><article><span>تغير آخر جلسة</span><strong dir="ltr">{usd(data.summary.dailyPnl, true)}</strong><small>من المراكز ذات التغير المتاح</small></article></div>
      <PerformanceChart history={history}/>{historyLoading && <p className="muted">جارٍ تحديث التاريخ السعري للمحفظة…</p>}
      <div className="portfolio-visual-grid"><AllocationTreemap positions={data.positions} onOpen={openPosition}/><section className="portfolio-panel portfolio-insights"><div className="section-line"><div><h3>صحة المحفظة</h3><p>مؤشرات تركّز وجودة مبنية على أوزان المراكز الحالية.</p></div><strong>{data.summary.diversificationScore.toFixed(0)}<small>/100</small></strong></div><div className="insight-scores"><div><span>عدد المراكز الفعّال</span><b dir="ltr">{data.summary.effectiveHoldings.toFixed(1)}</b></div><div><span>أكبر مركز</span><b dir="ltr">{pct(data.summary.topWeight)}</b></div><div><span>Core موزون</span><b dir="ltr">{data.summary.weightedCore.score?.toFixed(1) ?? '—'}</b><small>تغطية {pct(data.summary.weightedCore.coverage)}</small></div><div><span>Bounce موزون</span><b dir="ltr">{data.summary.weightedBounce.score?.toFixed(1) ?? '—'}</b><small>تغطية {pct(data.summary.weightedBounce.coverage)}</small></div></div><div className="portfolio-alerts">{data.alerts.map(alert => <p key={alert}><AlertTriangle size={16}/>{alert}</p>)}</div><div className="sector-bars">{data.sectors.slice(0, 5).map(sector => <div key={sector.name}><span>{sector.name}</span><div><i style={{ width: `${sector.weight * 100}%` }}/></div><b dir="ltr">{pct(sector.weight)}</b></div>)}</div></section></div>

      <section className="portfolio-panel positions-panel"><div className="section-line"><div><h3>المراكز المفتوحة</h3><p>مرتبة حسب القيمة الحالية؛ اضغط على الشركة لفتح ملفها الكامل.</p></div><span>{data.positions.length} مراكز</span></div><div className="positions-list">{data.positions.map(position => <button key={position.symbol} onClick={() => openPosition(position)}><CompanyLogo symbol={position.symbol}/><span className="position-name"><b dir="ltr">{position.symbol}</b><small dir="auto">{position.nameAr || position.name}</small></span><span><small>عدد الأسهم</small><b dir="ltr">{number(position.quantity)}</b></span><span><small>متوسط التكلفة</small><b dir="ltr">{usd(position.averageCost)}</b></span><span><small>القيمة</small><b dir="ltr">{usd(position.marketValue)}</b></span><span className={(position.unrealizedPnl ?? 0) >= 0 ? 'pass' : 'fail'}><small>العائد</small><b dir="ltr">{pct(position.unrealizedPct)}</b></span><span className="position-arrow">{(position.unrealizedPnl ?? 0) >= 0 ? <ArrowUpRight/> : <ArrowDownRight/>}</span></button>)}</div></section>

      <section className="portfolio-panel transactions-panel"><div className="section-line"><div><h3>سجل العمليات</h3><p>كل تعديل يعيد بناء متوسط التكلفة والربح من أول عملية.</p></div><button className="text-button" onClick={openNewTransaction}><Plus size={16}/> عملية جديدة</button></div><div className="transactions-list">{data.transactions.map(transaction => <article key={transaction.id}><CompanyLogo symbol={transaction.symbol} size={38}/><div><b dir="ltr">{transaction.symbol}</b><small>{transaction.tradeDate}</small></div><span className={transaction.side === 'buy' ? 'buy-tag' : 'sell-tag'}>{transaction.side === 'buy' ? 'شراء' : 'بيع'}</span><div dir="ltr">{number(transaction.quantity)} × {usd(transaction.price)}</div><strong dir="ltr">{usd(transaction.quantity * transaction.price + (transaction.side === 'buy' ? transaction.fees : -transaction.fees))}</strong><div className="transaction-actions"><button onClick={() => editTransaction(transaction)} aria-label={`تعديل عملية ${transaction.symbol}`}><Pencil size={16}/></button><button onClick={() => setDeleteTransaction(transaction)} aria-label={`حذف عملية ${transaction.symbol}`}><Trash2 size={16}/></button></div></article>)}</div></section>
    </>}

    <Dialog open={dialogOpen} onOpenChange={open => { setDialogOpen(open); if (!open) { companyRequest.current?.abort(); setDetailLoading(false); setSelected(null); setForm(emptyForm()); setQuery(''); setResults([]); setSearching(false); } }}><DialogContent className={`portfolio-dialog ${form.symbol ? 'has-form' : 'picker-dialog'}`} dir="rtl" showCloseButton={false}><DialogClose className="absolute top-4 left-4" aria-label="إغلاق نافذة العملية"><X size={20}/></DialogClose><DialogTitle>{form.id ? 'تعديل العملية' : form.symbol ? `إضافة ${form.side === 'buy' ? 'شراء' : 'بيع'}` : 'اختر الشركة'}</DialogTitle><DialogDescription>{form.symbol ? 'أدخل بيانات العملية كما تظهر في كشف الوسيط. الأرقام بالدولار الأمريكي.' : 'ابحث برمز السهم أو اسم الشركة، ثم اخترها من النتائج.'}</DialogDescription>
      {!form.symbol ? <div className="dialog-search"><Search size={18}/><input autoFocus aria-label="ابحث عن شركة للعملية" value={query} onChange={event => { const value = event.target.value; setQuery(value); if (!value.trim()) { setResults([]); setSearching(false); } }} placeholder="مثال: SOFI أو Adobe"/>{!!results.length && <div className="portfolio-search-results in-dialog">{results.map(company => <button key={company.symbol} onClick={() => void chooseCompany(company)}><CompanyLogo symbol={company.symbol}/><span><b dir="ltr">{company.symbol}</b><small>{company.nameAr || company.name}</small></span></button>)}</div>}</div> : <form className="transaction-form" onSubmit={saveTransaction}><div className="transaction-company"><CompanyLogo symbol={form.symbol} size={52}/><div><b dir="ltr">{form.symbol}</b><p dir="auto">{selected?.nameAr || selected?.name || data?.quotes[form.symbol]?.nameAr || data?.quotes[form.symbol]?.name || form.symbol}</p><small>{detailLoading ? 'جارٍ تحديث بيانات الشركة…' : [selected?.exchange, selected?.sector].filter(Boolean).join(' · ')}</small></div></div><div className="side-toggle" role="group" aria-label="نوع العملية"><button type="button" aria-pressed={form.side === 'buy'} className={form.side === 'buy' ? 'active buy' : ''} onClick={() => setForm(value => ({ ...value, side: 'buy' }))}>شراء</button><button type="button" aria-pressed={form.side === 'sell'} className={form.side === 'sell' ? 'active sell' : ''} onClick={() => setForm(value => ({ ...value, side: 'sell' }))}>بيع</button></div>{form.side === 'sell' && <p className="available-shares">المتاح للبيع حاليًا: <b dir="ltr">{number(availableToSell)}</b> سهم</p>}<div className="form-grid"><label>عدد الأسهم<input required min="0.000001" step="any" inputMode="decimal" type="number" value={form.quantity} onChange={event => setForm(value => ({ ...value, quantity: event.target.value }))}/></label><label>السعر لكل سهم<input required min="0.000001" step="any" inputMode="decimal" type="number" value={form.price} onChange={event => setForm(value => ({ ...value, price: event.target.value }))}/></label><label>العمولة والرسوم<input min="0" step="any" inputMode="decimal" type="number" value={form.fees} onChange={event => setForm(value => ({ ...value, fees: event.target.value }))}/></label><label>تاريخ العملية<input required max={today()} type="date" value={form.tradeDate} onChange={event => setForm(value => ({ ...value, tradeDate: event.target.value }))}/></label></div><label>ملاحظة اختيارية<textarea maxLength={500} value={form.note} onChange={event => setForm(value => ({ ...value, note: event.target.value }))} placeholder="سبب الدخول، رقم الأمر، أو ملاحظة للمراجعة"/></label><div className="transaction-preview"><span>{form.side === 'buy' ? 'تكلفة العملية' : 'صافي البيع قبل حساب تكلفة المركز'}</span><b dir="ltr">{usd((Number(form.quantity) || 0) * (Number(form.price) || 0) + (form.side === 'buy' ? 1 : -1) * (Number(form.fees) || 0))}</b></div><button className="scan-button save-transaction" disabled={busy || !form.quantity || !form.price}>{busy ? 'جارٍ الحفظ…' : 'حفظ وإعادة الحساب'}</button></form>}
    </DialogContent></Dialog>

    <AlertDialog open={!!deleteTransaction} onOpenChange={open => { if (!open) setDeleteTransaction(null); }}><AlertDialogContent dir="rtl"><AlertDialogHeader><AlertDialogTitle>حذف عملية {deleteTransaction?.symbol}؟</AlertDialogTitle><AlertDialogDescription>سيُعاد حساب كل المراكز والأرباح من السجل المتبقي. لن يتم الحذف إذا أدى إلى بيع أسهم أكثر من الرصيد.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>إلغاء</AlertDialogCancel><AlertDialogAction onClick={() => void removeTransaction()} disabled={busy}>حذف العملية</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
