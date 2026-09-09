import type {Snapshot} from './engine';

// Reconciliation policy, separate from strategy thresholds and original scores.
export const SOURCE_DIFFERENCE_MAX=0.2;
export function reconcile(current:Snapshot,previous:Snapshot|null):Snapshot {
 const next:Snapshot={...current,provenance:{...current.provenance},dataIssues:[...(current.dataIssues??[])],sourceConflicts:[...(current.sourceConflicts??[])]};
 let compared=0;
 for(const key of ['marketCap','revenue','netIncome','fcf','evSales'] as const){
  const a=current[key],b=previous?.[key],pa=current.provenance[key],pb=previous?.provenance[key];
  if(!Number.isFinite(a)||!Number.isFinite(b)||!pa||!pb)continue;
  if(!pa.periodEnd||pa.periodEnd!==pb.periodEnd||pa.periodStart!==pb.periodStart){next.dataIssues!.push(`${key}: تاريخا القياس مختلفان؛ لم تُعتبر المقارنة تعارض مصادر.`);continue;}
  if(Date.parse(pa.availableAt)>Date.parse(current.asOf)||Date.parse(pb.availableAt)>Date.parse(current.asOf))continue;
  compared++;
  const denominator=Math.max(Math.abs(a!),Math.abs(b!));
  const difference=denominator?Math.abs(a!-b!)/denominator:0;
  if(difference>SOURCE_DIFFERENCE_MAX)next.sourceConflicts!.push(`${key}: اختلاف ${(difference*100).toFixed(1)}% لنفس الفترة بين اللقطتين`);
 }
 for(const key of ['revenue','netIncome','fcf','cash','debt','evSales','ps','dilution','shareCountRatio','marketCap','revenueGrowth','operatingMarginTrend'] as const){
  const p=previous?.provenance[key];
  if(next[key]==null&&Number.isFinite(previous?.[key])&&p&&Number.isFinite(Date.parse(p.availableAt))&&Date.parse(p.availableAt)<=Date.parse(current.asOf)){
   next[key]=previous![key];next.provenance[key]=p;
   next.dataIssues!.push(`${key}: احتُفظ بقيمة الفحص السابقة المؤرخة لعدم توفر تحديث.`);
  }
 }
 if(next.sourceConflicts!.length)next.confidence='D';
 next.dataIssues=[...new Set([...next.dataIssues!,`مقارنات لنفس الفترة: ${compared}. لا تعني استقلال المصدرين.`])];
 next.sourceConflicts=[...new Set(next.sourceConflicts)];
 return next;
}
