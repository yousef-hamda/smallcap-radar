'use client';

import { useMemo, useState } from 'react';
import type { Snapshot } from '@/lib/engine';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const ranges: Record<string, number> = { '1D': 1, '1W': 7, '1M': 30, '6M': 183, '1Y': 365, '2Y': 730, '5Y': 1826 };
const compact = (value: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

export default function PriceChart({ snapshot, bounce }: { snapshot: Snapshot; bounce: boolean }) {
  const [range, setRange] = useState('1Y');
  const rows = useMemo(() => (snapshot.history || []).filter(row => Date.parse(row.date) >= Date.parse(snapshot.asOf) - ranges[range] * 86_400_000), [snapshot.history, snapshot.asOf, range]);
  if (!rows.length) return <div className="chart-empty">لا تتوفر جلسات سعرية موثقة لهذه الفترة.</div>;

  const overlays = bounce ? [
    { label: 'MA30W', value: snapshot.ma30w ?? null, color: '#7c9ac1' },
    { label: 'الهدف +20%', value: snapshot.price ? snapshot.price * 1.2 : null, color: '#65d4ad' },
    { label: 'الوقف −15%', value: snapshot.price ? snapshot.price * 0.85 : null, color: '#e77d85' },
  ] : [];
  const values = rows.map(row => row.close);
  const allValues = [...values, ...overlays.flatMap(item => item.value == null ? [] : [item.value])];
  const low = Math.min(...allValues) * 0.96;
  const high = Math.max(...allValues) * 1.04;
  const x = (index: number) => 42 + index / Math.max(1, rows.length - 1) * 508;
  const y = (value: number) => 166 - (value - low) / (high - low || 1) * 138;
  const points = rows.map((row, index) => `${x(index)},${y(row.close)}`).join(' ');
  const area = `42,166 ${points} 550,166`;
  const maxVolume = Math.max(...rows.map(row => row.volume ?? 0), 1);
  const first = rows[0].close;
  const last = rows.at(-1)!.close;
  const periodReturn = last / first - 1;

  return <section className="price-chart-panel">
    <div className="section-title">
      <div><h3>السعر التاريخي</h3><small>{rows.at(-1)!.date} · {rows.length} جلسة</small></div>
      <Tabs value={range} onValueChange={setRange}><TabsList>{Object.keys(ranges).map(key => <TabsTrigger key={key} value={key}>{key}</TabsTrigger>)}</TabsList></Tabs>
    </div>
    <div className="chart-change"><b className={periodReturn >= 0 ? 'up' : 'down'}>{periodReturn >= 0 ? '+' : ''}{(periodReturn * 100).toFixed(1)}%</b><span>خلال الفترة المختارة</span></div>
    <svg viewBox="0 0 600 225" role="img" aria-label={`رسم أسعار ${snapshot.symbol} خلال ${range}`} className="price-chart">
      <defs><linearGradient id={`area-${snapshot.symbol}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4fc49c" stopOpacity=".25"/><stop offset="100%" stopColor="#4fc49c" stopOpacity="0"/></linearGradient></defs>
      {[0, 1, 2, 3].map(index => <g key={index}><line x1="42" x2="550" y1={28 + index * 46} y2={28 + index * 46} stroke="#233440"/><text x="558" y={32 + index * 46} fontSize="10" fill="#718491">{(high - (high - low) * index / 3).toFixed(2)}</text></g>)}
      {rows.map((row, index) => index % Math.max(1, Math.floor(rows.length / 80)) === 0 ? <rect key={row.date} x={x(index) - 1} y={194 - ((row.volume ?? 0) / maxVolume) * 20} width="2" height={((row.volume ?? 0) / maxVolume) * 20} fill="#36505f" opacity=".75"/> : null)}
      {overlays.filter(item => item.value != null).map(item => <g key={item.label}><line x1="42" x2="550" y1={y(item.value!)} y2={y(item.value!)} stroke={item.color} strokeDasharray="5 5"/><text x="46" y={y(item.value!) - 5} fontSize="10" fill={item.color}>{item.label}</text></g>)}
      <polygon points={area} fill={`url(#area-${snapshot.symbol})`}/><polyline points={points} fill="none" stroke="#65d4ad" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round"/><circle cx={x(rows.length - 1)} cy={y(last)} r="3.5" fill="#65d4ad"/>
      <text x="42" y="218" fontSize="10" fill="#718491">{rows[0].date}</text><text x="550" y="218" textAnchor="end" fontSize="10" fill="#718491">{rows.at(-1)!.date}</text>
    </svg>
    <div className="chart-foot"><span>أدنى ${low.toFixed(2)}</span><span>أعلى ${high.toFixed(2)}</span><span>حجم أقصى {compact(maxVolume)}</span></div>
    {snapshot.insiderPurchases?.length ? <div className="insider-panel"><h4>مشتريات المطلعين — SEC Form 4 P</h4>{snapshot.insiderPurchases.slice(0, 6).map(purchase => <a href={purchase.source} target="_blank" rel="noreferrer" key={`${purchase.owner}-${purchase.date}-${purchase.value}`}><span><b>{purchase.owner}</b><small>{purchase.date} · {purchase.shares.toLocaleString('en-US')} سهم</small></span><strong>${compact(purchase.value)}</strong></a>)}</div> : null}
  </section>;
}
