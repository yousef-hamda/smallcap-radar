import type {Snapshot} from './engine';
import {observations,latestInstant,trailingAnnual,provenance,REVENUE_TAGS} from './sec';
import {derivedEvidence,usableEvidence} from './evidence';

/** Independent of providers: calculations use only observations available at asOf. */
export function enrichFinancials(snapshot:Snapshot,facts:unknown,url:string):Snapshot {
 const s={...snapshot,provenance:{...snapshot.provenance},dataIssues:[...(snapshot.dataIssues??[])]},now=s.asOf;
 const instant=(tags:string[])=>latestInstant(observations(facts,tags),now);
 const cash=instant(['CashAndCashEquivalentsAtCarryingValue','CashAndCashEquivalents']);
 const current=instant(['LongTermDebtCurrent','BorrowingsCurrent']);
 const noncurrent=instant(['LongTermDebtNoncurrent','BorrowingsNoncurrent']);
 if(cash){s.cash=cash.val;s.provenance.cash=provenance(cash,url,now);}
 if(current&&noncurrent&&current.end===noncurrent.end){
  s.debt=current.val+noncurrent.val;s.provenance.debt=derivedEvidence('SEC debt components',[provenance(current,url,now),provenance(noncurrent,url,now)],now,'current + noncurrent')!;
 }else s.dataIssues.push('الدين الكلي غير مشتق: يلزم المكونان الجاري وغير الجاري لنفس الفترة.');
 if(s.marketCap!=null&&s.revenue!=null&&s.revenue>0&&s.cash!=null&&s.debt!=null&&s.provenance.cash?.periodEnd===s.provenance.debt?.periodEnd){
  const evidence=derivedEvidence('SEC balance sheet and quoted market cap',[s.provenance.revenue,s.provenance.marketCap,s.provenance.cash,s.provenance.debt],now,'(cap + debt − cash) / revenue');
  if(evidence){s.evSales=(s.marketCap+s.debt-s.cash)/s.revenue;s.provenance.evSales=evidence;}
 }
 const currentRevenue=trailingAnnual(observations(facts,REVENUE_TAGS),now);
 if(currentRevenue){
  const yearAgo=new Date(now);yearAgo.setUTCFullYear(yearAgo.getUTCFullYear()-1);
  const priorRevenue=trailingAnnual(observations(facts,REVENUE_TAGS),yearAgo.toISOString());
  if(priorRevenue&&priorRevenue.val>0&&Math.abs((Date.parse(currentRevenue.end)-Date.parse(priorRevenue.end))/864e5-365)<=8){
   s.revenueGrowth=currentRevenue.val/priorRevenue.val-1;s.provenance.revenueGrowth=derivedEvidence('SEC trailing revenue comparison',[provenance(currentRevenue,url,now),provenance(priorRevenue,url,now)],now,'current TTM / prior TTM − 1')!;
   const operatingTags=['OperatingIncomeLoss','ProfitLossFromOperatingActivities'];
   const op=trailingAnnual(observations(facts,operatingTags),now),priorOp=trailingAnnual(observations(facts,operatingTags),yearAgo.toISOString());
   if(op&&priorOp&&op.end===currentRevenue.end&&priorOp.end===priorRevenue.end&&currentRevenue.val>0){
    s.operatingMarginTrend=op.val/currentRevenue.val-priorOp.val/priorRevenue.val;
    s.provenance.operatingMarginTrend=derivedEvidence('SEC operating margin comparison',[provenance(op,url,now),provenance(priorOp,url,now),s.provenance.revenueGrowth],now,'current margin − prior margin')!;
   }
  }
 }
 if(s.fcf!=null&&s.marketCap!=null&&s.marketCap>0&&usableEvidence(s.provenance.fcf,now)&&usableEvidence(s.provenance.marketCap,now)){
  s.fcfYield=s.fcf/s.marketCap;s.provenance.fcfYield=derivedEvidence('SEC FCF / market cap',[s.provenance.fcf,s.provenance.marketCap],now,'FCF / market cap')!;
 }
 return s;
}
