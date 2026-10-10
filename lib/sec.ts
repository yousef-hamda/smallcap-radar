import type {Provenance} from './engine';
// US-GAAP and IFRS standard concepts both appear in SEC Company Facts. Keep
// aliases explicit: accepting an IFRS namespace without searching its actual
// standard concepts silently creates zero-coverage foreign issuers.
export const US_GAAP_REVENUE_TAGS=['RevenueFromContractWithCustomerExcludingAssessedTax','RevenueFromContractWithCustomerIncludingAssessedTax','Revenues','SalesRevenueNet','SalesRevenueGoodsNet'];
// IFRS filers frequently report operating revenue under this standard
// concept. Prefer it to the broad plural "RevenueFromContractsWithCustomers"
// fallback, which can describe a narrow contract-revenue line (and is not a
// valid revenue denominator for banks or other issuers with multiple income
// streams).
export const REVENUE_TAGS=[...US_GAAP_REVENUE_TAGS,'RevenueAndOperatingIncome','Revenue','RevenueFromContractsWithCustomers'];
export const COST_OF_REVENUE_TAGS=['CostOfRevenue','CostOfGoodsAndServicesSold','CostOfGoodsAndServicesSoldDirect','CostOfGoodsAndServicesSoldIncludingDAndA'];
export const BACKLOG_TAGS=['RemainingPerformanceObligation','RevenueRemainingPerformanceObligation'];
export const CONTRACT_LIABILITY_TAGS=['ContractWithCustomerLiability','ContractWithCustomerLiabilityCurrent','ContractWithCustomerLiabilityNoncurrent'];
export const CURRENT_BORROWING_TAGS=['BorrowingsCurrent','CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings','LongTermDebtCurrent','CurrentPortionOfLongtermBorrowings'];
export const NONCURRENT_BORROWING_TAGS=['BorrowingsNoncurrent','LongtermBorrowings','LongTermDebtNoncurrent'];
export const AGGREGATE_BORROWING_TAGS=['DebtAndCapitalLeaseObligations','Borrowings','LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities'];
export type Fact={start?:string;end:string;val:number;filed:string;form:string;accn?:string;fy?:number;fp?:string;tag?:string};
const annualForms=['10-K','10-K/A','20-F','20-F/A','40-F','40-F/A'];
const interimForms=['10-Q','10-Q/A','6-K','6-K/A'];
export function observations(facts:any,tags:string[],unit='USD'):Fact[]{return tags.flatMap(tag=>{
 const namespaces=['us-gaap','ifrs-full','dei'];
 return namespaces.flatMap(namespace=>{
  const rows=facts?.[namespace]?.[tag]?.units?.[unit];
  return Array.isArray(rows)?rows.map((f:any)=>({...f,tag})):[];
 });
});}
export function latestInstant(rows:Fact[],asOf:string){return rows.filter(r=>Date.parse(r.filed+'T23:59:59Z')<=Date.parse(asOf)&&Number.isFinite(Date.parse(r.end))&&Date.parse(r.end)<=Date.parse(asOf)&&!r.start&&Number.isFinite(r.val)).sort((a,b)=>b.end.localeCompare(a.end)||b.filed.localeCompare(a.filed))[0]||null;}
export function trailingAnnual(rows:Fact[],asOf:string){const eligible=rows.filter(r=>r.start&&Date.parse(r.filed+'T23:59:59Z')<=Date.parse(asOf)&&Number.isFinite(Date.parse(r.end))&&Date.parse(r.end)<=Date.parse(asOf)&&Number.isFinite(r.val));const days=(r:Fact)=>(Date.parse(r.end)-Date.parse(r.start!))/864e5;const annual=eligible.filter(r=>annualForms.includes(r.form)&&days(r)>=330&&days(r)<=380).sort((a,b)=>b.end.localeCompare(a.end)||b.filed.localeCompare(a.filed))[0];if(!annual)return null;
 // A filer can transition between standard revenue tags. Only combine YTD
 // facts from the same concept as the selected annual fact; an unrelated,
 // newer-tagged quarter must not suppress a valid same-tag TTM bridge.
 const ytd=eligible.filter(r=>r.tag===annual.tag&&interimForms.includes(r.form)&&r.start!>annual.end&&(Date.parse(r.start!)-Date.parse(annual.end))/864e5<=7&&days(r)>50&&days(r)<330).sort((a,b)=>b.end.localeCompare(a.end)||days(b)-days(a)||b.filed.localeCompare(a.filed))[0];
 if(ytd){const prior=eligible.filter(r=>r.start&&interimForms.includes(r.form)&&Math.abs((Date.parse(ytd.start!)-Date.parse(r.start))/864e5-365)<=3&&Math.abs(days(r)-days(ytd))<=7&&r.end<ytd.end&&r.tag===ytd.tag).sort((a,b)=>b.filed.localeCompare(a.filed))[0];if(!prior)return null;return {val:annual.val+ytd.val-prior.val,end:ytd.end,start:new Date(Date.parse(ytd.end)-365*864e5).toISOString().slice(0,10),filed:[annual,ytd,prior].map(r=>r.filed).sort().at(-1)!,tag:ytd.tag,form:ytd.form,method:'annual + current YTD − prior YTD',components:[annual,ytd,prior]};}
 if(eligible.some(r=>interimForms.includes(r.form)&&r.end>annual.end))return null;
 return {...annual,method:'annual filing (12 months)',components:[annual]};}
export function provenance(f:Fact|any,url:string,retrievedAt:string):Provenance{return {source:'SEC EDGAR',url,periodStart:f.start,periodEnd:f.end,availableAt:f.filed+'T23:59:59Z',retrievedAt,currency:'USD',tag:f.tag,confidence:'high'}}
export function insiderPurchases(transactions:{code:string;shares:number;price:number;date:string;owner:string}[]){return transactions.filter(t=>t.code==='P'&&t.shares>0&&t.price>=0).map(t=>({...t,value:t.shares*t.price}));}

/** A reported aggregate is an alternative to its components, never additive.
 * US long-term debt may omit short-term borrowing/leases; the scope is retained.
 * Missing debt parts are never synthesized as zero. */
export function reportedBorrowings(facts: unknown, asOf: string, unit = 'USD') {
  const record = facts as any;
  const pick = (tags: string[]) => latestInstant(observations(record, tags, unit), asOf);
  const aggregate = pick(AGGREGATE_BORROWING_TAGS), current = pick(CURRENT_BORROWING_TAGS), noncurrent = pick(NONCURRENT_BORROWING_TAGS);
  const shortTerm = pick(['ShortTermBorrowings']);
  const dates = [aggregate,current,noncurrent,shortTerm].filter(Boolean).map(item => item!.end);
  const latest = dates.sort().at(-1);
  if (aggregate && aggregate.end === latest && aggregate.val >= 0) {
    // A reported total smaller than one of its contemporaneous components
    // needs filing reconciliation; it cannot prove debt-free status.
    const comparableParts=[current,noncurrent].filter(item=>item&&item.end===aggregate.end) as Fact[];
    if (comparableParts.some(item=>item.val<0 || item.val>aggregate.val+Math.max(0.01,Math.abs(aggregate.val)*0.01))) return null;
    if(comparableParts.length===2&&['Borrowings','DebtAndCapitalLeaseObligations'].includes(aggregate.tag??'')
      &&comparableParts.reduce((sum,item)=>sum+item.val,0)>aggregate.val+Math.max(.01,Math.abs(aggregate.val)*.01))return null;
    const components = [aggregate];
    // The lease-inclusive long-term aggregate excludes separately disclosed
    // short-term borrowing; IFRS Borrowings already includes it.
    if (aggregate.tag === 'LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities' && shortTerm) {
      if (shortTerm.end !== aggregate.end || shortTerm.val < 0) return null;
      components.push(shortTerm);
    }
    return { ...aggregate, val: components.reduce((sum,item) => sum + item.val, 0), components,
      filed: components.map(item=>item.filed).sort().at(-1)!,
      scope: aggregate.tag === 'Borrowings' || aggregate.tag === 'DebtAndCapitalLeaseObligations' ? 'reported-total-borrowings' : 'reported-long-term-debt-and-leases',
      method: components.map(item => item.tag).join(' + ') };
  }
  if (!current || !noncurrent || current.end !== noncurrent.end || current.end !== latest || current.val < 0 || noncurrent.val < 0) return null;
  const components = [current,noncurrent];
  if (current.tag === 'LongTermDebtCurrent' && shortTerm) {
    if (shortTerm.end !== current.end || shortTerm.val < 0) return null;
    components.push(shortTerm);
  }
  return { ...current, val: components.reduce((sum,item) => sum + item.val, 0), components,
    filed: components.map(item => item.filed).sort().at(-1)!,
    scope: 'reported-borrowing-components', method: components.map(item => item.tag).join(' + ') };
}
