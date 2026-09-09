'use client';
import {useEffect,useState} from 'react';
import {apiJson} from '@/lib/client-json';
import {statusText} from './radar-format';
import type {Check} from '@/lib/engine';

type Report={run:{id:string;status:string};counts:{total:number;passed:number;failed:number;unknown:number};blockers:{id:string;label:string;status:'FAIL'|'UNKNOWN';count:number}[];rows:{symbol:string;name:string;asOf:string;evaluation:{status:'PASS'|'FAIL'|'UNKNOWN';score:number|null;checks:Check[]}}[];page:{hasMore:boolean}};
export default function ScanReport({runId,strategy,onOpen}:{runId:string;strategy:'core'|'bounce';onOpen:(symbol:string)=>void}){
 const [offset,setOffset]=useState(0),[report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{
  const controller=new AbortController();
  void apiJson<Report>(`/api/scan-report?runId=${encodeURIComponent(runId)}&strategy=${strategy}&offset=${offset}`,{signal:controller.signal}).then(value=>{setReport(value);setError('');}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[runId,strategy,offset]);
 function page(next:number){setLoading(true);setOffset(next);}
 return <section aria-label="تقرير نتائج الجولة"><h3>نتائج الجولة وأسباب القرار</h3><p>هذا سجل الفحص لكل الشركات، بما فيها المستبعدة وغير المكتملة. وجود السهم هنا لا يعني تأهله. الأسباب قد تتكرر للسهم الواحد.</p>
  {error&&<p role="alert">{error}</p>}{loading&&<p role="status">جارٍ تحميل التقرير…</p>}
  {report&&!loading&&<><p>{report.counts.total} شركة محفوظة · {report.counts.passed??0} اجتازت · {report.counts.failed??0} مستبعدة · {report.counts.unknown??0} تحتاج تحققًا</p>
   <details open><summary>ما الذي منع التأهيل؟</summary><ul>{report.blockers.map(b=><li key={`${b.id}:${b.status}`}>{b.label}: {statusText[b.status]} — {b.count} شركة</li>)}</ul></details>
   {report.rows.map(row=><details key={row.symbol}><summary><b dir="ltr">{row.symbol}</b> — {statusText[row.evaluation.status]} — {row.name}</summary><p>تاريخ اللقطة: {row.asOf}</p><ul>{row.evaluation.checks.map(check=><li key={check.id}>{check.label}: {statusText[check.status]} — {check.explanation}</li>)}</ul><button onClick={()=>onOpen(row.symbol)}>فتح الملف الحالي</button></details>)}
   <div className="action-pair"><button disabled={offset===0} onClick={()=>page(Math.max(0,offset-25))}>السابق</button><span>{offset+1}–{offset+report.rows.length}</span><button disabled={!report.page.hasMore} onClick={()=>page(offset+25)}>التالي</button></div>
  </>}
 </section>;
}
