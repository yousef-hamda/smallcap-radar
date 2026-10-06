import type {Snapshot} from './engine';
import {observations,latestInstant,trailingAnnual,provenance,REVENUE_TAGS,COST_OF_REVENUE_TAGS,BACKLOG_TAGS,CONTRACT_LIABILITY_TAGS,reportedBorrowings} from './sec';
import {derivedEvidence,usableEvidence} from './evidence';

/** Independent of providers: calculations use only observations available at asOf. */
export function enrichFinancials(snapshot:Snapshot,facts:unknown,url:string):Snapshot {
 const s={...snapshot,provenance:{...snapshot.provenance},dataIssues:[...(snapshot.dataIssues??[])]},now=s.asOf;
 const instant=(tags:string[])=>latestInstant(observations(facts,tags),now);
 const cash=instant(['CashAndCashEquivalentsAtCarryingValue','CashAndCashEquivalents']);
 const borrowing=reportedBorrowings(facts,now);
 if(cash){s.cash=cash.val;s.provenance.cash=provenance(cash,url,now);}
 if(borrowing){
  s.debt=borrowing.val;s.provenance.debt={...derivedEvidence('SEC reported borrowings',borrowing.components.map(item=>provenance(item,url,now)),now,borrowing.method)!,metricScope:borrowing.scope};
 }else s.dataIssues.push('الدين الكلي غير مشتق: يلزم المكونان الجاري وغير الجاري لنفس الفترة.');
 if(s.marketCap!=null&&s.revenue!=null&&s.revenue>0&&s.cash!=null&&s.debt!=null&&s.provenance.cash?.periodEnd===s.provenance.debt?.periodEnd){
  const evidence=derivedEvidence('SEC balance sheet and quoted market cap',[s.provenance.revenue,s.provenance.marketCap,s.provenance.cash,s.provenance.debt],now,'(cap + debt − cash) / revenue');
  if(evidence){s.evSales=(s.marketCap+s.debt-s.cash)/s.revenue;s.provenance.evSales=evidence;}
 }
 const currentRevenue=trailingAnnual(observations(facts,REVENUE_TAGS),now);
 if(currentRevenue){
  const cost=trailingAnnual(observations(facts,COST_OF_REVENUE_TAGS),now);
  if(cost&&cost.end===currentRevenue.end&&cost.start===currentRevenue.start&&currentRevenue.val>0&&cost.val>=0){
   s.grossMargin=1-cost.val/currentRevenue.val;
   s.provenance.grossMargin=derivedEvidence('SEC revenue and cost of revenue',[provenance(currentRevenue,url,now),provenance(cost,url,now)],now,'1 − cost of revenue / revenue')!;
  }
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
 const backlogRows=observations(facts,BACKLOG_TAGS).filter(row=>row.end&&(!row.start||row.tag==='RemainingPerformanceObligation'||row.tag==='RevenueRemainingPerformanceObligation'));
 const backlog=latestInstant(backlogRows,now)??trailingAnnual(backlogRows,now);
 if(backlog&&backlog.val>=0){
  s.backlog={kind:'remaining-performance-obligation',amount:backlog.val,currency:'USD',asOf:backlog.end,source:url};
  s.provenance.backlog=provenance(backlog,url,now);
 }
 const contractLiability=instant(CONTRACT_LIABILITY_TAGS);
 if(contractLiability&&contractLiability.val>=0){
  s.contractLiabilities={amount:contractLiability.val,currency:'USD',asOf:contractLiability.end,source:url};
  s.provenance.contractLiabilities=provenance(contractLiability,url,now);
 }
 if(s.fcf!=null&&s.marketCap!=null&&s.marketCap>0&&usableEvidence(s.provenance.fcf,now)&&usableEvidence(s.provenance.marketCap,now)){
  s.fcfYield=s.fcf/s.marketCap;s.provenance.fcfYield=derivedEvidence('SEC FCF / market cap',[s.provenance.fcf,s.provenance.marketCap],now,'FCF / market cap')!;
 }
 return s;
}
