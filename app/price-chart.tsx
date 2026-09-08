'use client';
import {useId,useMemo,useState} from 'react';
import type {Snapshot} from '@/lib/engine';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';

export const chartRanges={'1D':{days:1,label:'يوم'},'1W':{days:7,label:'أسبوع'},'1M':{days:30,label:'شهر'},'6M':{days:183,label:'6 أشهر'},'1Y':{days:365,label:'سنة'},'2Y':{days:730,label:'سنتان'},'5Y':{days:1900,label:'5 سنوات'}};
type Range=keyof typeof chartRanges;
export default function PriceChart({snapshot,loading=false}:{snapshot:Snapshot;loading?:boolean}){
 const [range,setRange]=useState<Range>('1Y'),[point,setPoint]=useState<number|null>(null),[observedAt]=useState(()=>Date.now()),id=useId().replaceAll(':','');
 const rows=useMemo(()=>{
  const end=Math.min(Date.parse(snapshot.asOf),observedAt);
  const unique=new Map((snapshot.history||[]).filter(r=>Number.isFinite(r.close)&&r.close>0&&Number.isFinite(Date.parse(r.date))&&Date.parse(r.date)<=end).map(r=>[r.date,r]));
  const all=[...unique.values()].sort((a,b)=>a.date.localeCompare(b.date));
  return all.filter(r=>Date.parse(r.date)>=end-chartRanges[range].days*86_400_000);
 },[snapshot.history,snapshot.asOf,range,observedAt]);
 const low=rows.length?Math.min(...rows.map(r=>r.close)):0,high=rows.length?Math.max(...rows.map(r=>r.close)):0;
 const pad=(high-low||high*.02||1)*.1,y=(n:number)=>145-(n-low+pad)/(high-low+pad*2)*125,x=(i:number)=>12+i/Math.max(1,rows.length-1)*576;
 const points=rows.map((r,i)=>`${x(i)},${y(r.close)}`).join(' '),change=rows.length>1?rows.at(-1)!.close/rows[0].close-1:null;
 const color=change!=null&&change<0?'#fb7185':'#00c896';
 const chosen=point!=null?rows[Math.min(point,rows.length-1)]:null;
 return <section className="chart-section"><div className="section-line"><h3>السعر</h3><span className={change!=null&&change<0?'fail':'pass'} dir="ltr">{change==null?'—':`${change>=0?'+':''}${(change*100).toFixed(2)}%`}</span></div>
  <div className="chart-frame">{loading&&!rows.length?<p role="status">جارٍ تحميل التاريخ السعري…</p>:rows.length<2?<p className="muted">{range==='1D'?'تاريخ التداول اللحظي غير متاح؛ اختر فترة أطول.':'لا تتوفر جلستان موثقتان على الأقل لهذه الفترة.'}</p>:<>
   <output className="chart-tooltip" dir="ltr">{chosen?`${chosen.date} · $${chosen.close.toFixed(2)}`:`${rows.at(-1)!.date} · $${rows.at(-1)!.close.toFixed(2)}`}</output>
   <svg className="price-chart" viewBox="0 0 600 165" role="img" aria-label={`رسم سعر ${snapshot.symbol} — ${chartRanges[range].label}`} tabIndex={0} onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();setPoint(p=>Math.max(0,Math.min(rows.length-1,(p??rows.length-1)+(e.key==='ArrowRight'?1:-1))))}}} onPointerMove={e=>{const b=e.currentTarget.getBoundingClientRect();setPoint(Math.round(Math.max(0,Math.min(1,(e.clientX-b.left)/b.width))*(rows.length-1)))}} onPointerLeave={()=>setPoint(null)}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".25"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
    <line x1="12" x2="588" y1={y(rows[0].close)} y2={y(rows[0].close)} stroke="#71717a" strokeDasharray="5 5"/>
    <polygon points={`12,160 ${points} 588,160`} fill={`url(#${id})`}/><polyline points={points} stroke={color} strokeWidth="2.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
    {chosen&&<g><line x1={x(point!)} x2={x(point!)} y1="10" y2="160" stroke="#71717a" strokeDasharray="3 3"/><circle cx={x(point!)} cy={y(chosen.close)} r="4" fill={color}/></g>}
   </svg><div className="chart-dates" dir="ltr"><span>{rows[0].date.slice(5)}</span><span dir="rtl">أدنى {low.toFixed(2)} · أعلى {high.toFixed(2)}</span><span>{rows.at(-1)!.date.slice(5)}</span></div>
  </>}</div>
  <Tabs value={range} onValueChange={v=>{setRange(v as Range);setPoint(null)}} dir="rtl" className="chart-tabs"><TabsList aria-label="فترة الرسم السعري">{(Object.keys(chartRanges) as Range[]).map(k=><TabsTrigger key={k} value={k}>{chartRanges[k].label}</TabsTrigger>)}</TabsList></Tabs>
  <small className="muted">أسعار إغلاق يومية موثقة؛ المصدر والتوقيت ضمن سجل المصادر. حرّك المؤشر أو استخدم مفاتيح الأسهم لعرض السعر والتاريخ.</small>
 </section>;
}
