import type {Provenance} from './engine';
export const REVENUE_TAGS=['RevenueFromContractWithCustomerExcludingAssessedTax','RevenueFromContractWithCustomerIncludingAssessedTax','Revenues','SalesRevenueNet','SalesRevenueGoodsNet'];
export type Fact={start?:string;end:string;val:number;filed:string;form:string;accn?:string;fy?:number;fp?:string;tag?:string};
const annualForms=['10-K','10-K/A','20-F','20-F/A','40-F','40-F/A'];
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
 const ytd=eligible.filter(r=>r.tag===annual.tag&&['10-Q','10-Q/A'].includes(r.form)&&r.start!>annual.end&&(Date.parse(r.start!)-Date.parse(annual.end))/864e5<=7&&days(r)>50&&days(r)<330).sort((a,b)=>b.end.localeCompare(a.end)||days(b)-days(a)||b.filed.localeCompare(a.filed))[0];
 if(ytd){const prior=eligible.filter(r=>r.start&&Math.abs((Date.parse(ytd.start!)-Date.parse(r.start))/864e5-365)<=3&&Math.abs(days(r)-days(ytd))<=7&&r.end<ytd.end&&r.tag===ytd.tag).sort((a,b)=>b.filed.localeCompare(a.filed))[0];if(!prior)return null;return {val:annual.val+ytd.val-prior.val,end:ytd.end,start:new Date(Date.parse(ytd.end)-365*864e5).toISOString().slice(0,10),filed:[annual,ytd,prior].map(r=>r.filed).sort().at(-1)!,tag:ytd.tag,form:ytd.form,method:'annual + current YTD − prior YTD',components:[annual,ytd,prior]};}
 if(eligible.some(r=>['10-Q','10-Q/A'].includes(r.form)&&r.end>annual.end))return null;
 return {...annual,method:'annual filing (12 months)',components:[annual]};}
export function provenance(f:Fact|any,url:string,retrievedAt:string):Provenance{return {source:'SEC EDGAR',url,periodStart:f.start,periodEnd:f.end,availableAt:f.filed+'T23:59:59Z',retrievedAt,currency:'USD',tag:f.tag,confidence:'high'}}
export function insiderPurchases(transactions:{code:string;shares:number;price:number;date:string;owner:string}[]){return transactions.filter(t=>t.code==='P'&&t.shares>0&&t.price>=0).map(t=>({...t,value:t.shares*t.price}));}
