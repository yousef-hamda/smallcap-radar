'use client';
import {useEffect,useState} from 'react';
import {apiJson} from '@/lib/client-json';
import {statusText} from './radar-format';
import type {OpportunityEvaluation,OpportunityState} from '@/lib/opportunity-engine';

type Report={run:{id:string;status:string;stage:number};strategy:'opportunity';counts:{total:number;passed:number;failed:number;unknown:number;withEvidence?:number;stale?:boolean};blockers:{id:string;label:string;status:'FAIL'|'UNKNOWN';count:number}[];rows:{symbol:string;name:string;asOf:string;rank?:number;evaluation:Pick<OpportunityEvaluation,'state'|'score'|'coveragePct'|'algorithmicCoveragePct'|'factors'|'checks'>}[];page:{hasMore:boolean}};
const opportunityStateText:Record<OpportunityState,string>={ranked:'تقييم نهائي', 'needs-research':'يحتاج بحثًا',excluded:'مستبعد'};
export default function ScanReport({runId,releaseToken,onOpen}:{runId:string;releaseToken?:string;onOpen:(symbol:string)=>void}){
 const [offset,setOffset]=useState(0),[report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{
  const controller=new AbortController();
  void apiJson<Report>(`/api/scan-report?runId=${encodeURIComponent(runId)}&strategy=opportunity&offset=${offset}${releaseToken?`&release=${encodeURIComponent(releaseToken)}`:''}`,{signal:controller.signal}).then(value=>{setReport(value);setError('');}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[runId,offset,releaseToken]);
 function page(next:number){setLoading(true);setOffset(next);}
 return <section aria-label="تقرير نتائج الجولة"><h3>الدرجات النهائية وملاحظات البحث</h3><p>هذا سجل الدرجات النهائية لكل الشركات. ملاحظات المصادر والسلامة مستقلة عن ترتيب الدرجات، وقد تتكرر للسهم الواحد.</p>
  {error&&<p role="alert">{error}</p>}{loading&&<p role="status">جارٍ تحميل التقرير…</p>}
  {report&&!loading&&<>{(report.run.status==='running'||(report.run.status==='partial'&&report.run.stage<13))&&<p role="status">هذه الجولة لا تزال قيد التنفيذ؛ الأعداد والصفوف مؤقتة حتى تنتهي.</p>}<p>{report.counts.total} شركة محفوظة · {report.counts.withEvidence??0} لها أدلة مصدرية · {report.counts.passed??0} تقييم نهائي محسوب · {report.counts.failed??0} مستبعدة · {report.counts.unknown??0} تحتاج بحثًا{report.counts.stale?' · أُعيد تقييم اللقطة المحفوظة بالنموذج الحالي':''}</p>
   <details open><summary>ملاحظات المصادر والسلامة</summary><ul>{report.blockers.map(b=><li key={`${b.id}:${b.status}`}>{b.label}: {statusText[b.status]} — {b.count} شركة</li>)}</ul></details>
   {report.rows.map(row=>{const evaluation=row.evaluation;return <details key={row.symbol}><summary><b dir="ltr">#{row.rank} · {row.symbol}</b> — {opportunityStateText[evaluation.state]} — {row.name}</summary><p>تاريخ اللقطة: {row.asOf} · الدرجة النهائية: {evaluation.score.toFixed(2)} / 100 · تغطية الخوارزمية: {evaluation.algorithmicCoveragePct.toFixed(1)}% · الأدلة المصدرية: {evaluation.coveragePct.toFixed(1)}%</p><ul>{evaluation.factors.map(factor=><li key={factor.id}>{factor.label} ({factor.weight}%): {factor.score!=null?`${factor.points.toFixed(2)} نقطة · ${factor.proxy&&!factor.evidenced?'درجة خوارزمية · تغطية '+factor.algorithmicCoveragePct.toFixed(0)+'%':'تغطية مصدرية '+factor.coveragePct.toFixed(1)+'%'} · نتيجة ${factor.score.toFixed(2)}/10 · ${factor.sources.length} مصدر`:'لا يوجد جزء مثبت'} — {factor.rationale}</li>)}</ul><button onClick={()=>onOpen(row.symbol)}>فتح الملف الحالي</button></details>})}
   <div className="action-pair"><button disabled={offset===0} onClick={()=>page(Math.max(0,offset-25))}>السابق</button><span>{offset+1}–{offset+report.rows.length}</span><button disabled={!report.page.hasMore} onClick={()=>page(offset+25)}>التالي</button></div>
  </>}
 </section>;
}
