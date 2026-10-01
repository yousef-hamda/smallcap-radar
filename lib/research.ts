import type {Snapshot,Provenance} from './engine';
import {derivedEvidence,usableEvidence} from './evidence';

/** Only a complete, valid split-event response can verify reported shares. */
export function reviewShareSplits(snapshot:Snapshot,events:{date:string;factor:number}[]|null|undefined,coverageStart:string,coverageEnd:string,evidence:Provenance):Snapshot {
 if(snapshot.splitAdjusted===true)return snapshot;
 const shares=snapshot.provenance.shareCountRatio;
 if(!Array.isArray(events)||!shares?.periodStart||!shares.periodEnd||!usableEvidence(shares,snapshot.asOf)||!usableEvidence(evidence,snapshot.asOf))return snapshot;
 const start=Date.parse(shares.periodStart),end=Date.parse(shares.periodEnd);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||!(Date.parse(coverageStart)<=start)||!(Date.parse(coverageEnd)>=end))return snapshot;
 if(!Number.isFinite(snapshot.shareCountRatio)||snapshot.shareCountRatio!<=0)return snapshot;
 const unique=new Map<string,number>();
 for(const event of events){
  const date=Date.parse(event.date);
  if(!Number.isFinite(date)||!Number.isFinite(event.factor)||event.factor<=0||date>Date.parse(snapshot.asOf))return snapshot;
  if(unique.has(event.date)&&unique.get(event.date)!==event.factor)return snapshot;
  unique.set(event.date,event.factor);
 }
 let factor=1;
 for(const [date,value] of unique)if(Date.parse(date)>start&&Date.parse(date)<=end)factor*=value;
 const ratio=snapshot.shareCountRatio!/factor;
 if(!Number.isFinite(ratio)||ratio<=0)return snapshot;
 const p=derivedEvidence('SEC share counts + Yahoo split events',[shares,evidence],snapshot.asOf,`reported share ratio / split factor ${factor}`);
 if(!p)return snapshot;
 const adjusted={...p,url:evidence.url,tag:`${p.tag}; SEC shares: ${shares.url??shares.source}`,periodStart:shares.periodStart,periodEnd:shares.periodEnd};
 return {...snapshot,shareCountRatio:ratio,dilution:ratio-1,splitAdjusted:true,provenance:{...snapshot.provenance,dilution:adjusted,shareCountRatio:adjusted},dataIssues:snapshot.dataIssues?.filter(issue=>!issue.includes('corporate actions'))};
}
export type OutcomeBar={date:string;close:number};
export type CompletedSessionQuote={price:number;dailyChange:number;periodEnd:string};
/**
 * Return the last fully observed close and its close-to-close change.
 * Radar cards call this value "last session", so it must never be derived
 * from a live/intraday quote. Providers may return bars in either order.
 */
export function completedSessionQuote(rows:{date:string;close:number}[]):CompletedSessionQuote|null{
 const valid=rows.filter(row=>typeof row.date==='string'&&Number.isFinite(Date.parse(row.date))&&Number.isFinite(row.close)&&row.close>0).sort((a,b)=>a.date.localeCompare(b.date));
 const current=valid.at(-1),previous=valid.at(-2);
 if(!current||!previous||!(previous.close>0))return null;
 return {price:current.close,dailyChange:current.close/previous.close-1,periodEnd:current.date};
}
export type OpportunityHorizonMonths=1|3|6|12;
export function horizonDate(entryDate:string,months:OpportunityHorizonMonths){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)||!Number.isInteger(months)||![1,3,6,12].includes(months))throw Error('Invalid entry date or opportunity horizon');
 const date=new Date(`${entryDate}T00:00:00Z`);if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==entryDate)throw Error('Invalid entry date');
 const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months);const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,last));return date.toISOString().slice(0,10);
}
/**
 * Measure a point-in-time price-only forward return at a requested Opportunity
 * horizon. It has no target/stop rule and never invents a quote after missing
 * history. Dividends and corporate-action total return are deliberately not
 * implied by this price-only outcome.
 */
export function simulateForwardReturn(entry:number,entryDate:string,bars:OutcomeBar[],months:OpportunityHorizonMonths,cost={slippageBps:0,commission:0,shares:1}){
 if(!(entry>0)||!Number.isFinite(entry)||!Number.isFinite(cost.slippageBps)||cost.slippageBps<0||cost.slippageBps>=10000||!Number.isFinite(cost.commission)||cost.commission<0||!Number.isFinite(cost.shares)||!(cost.shares>0))throw Error('Invalid entry or costs');
 const targetDate=horizonDate(entryDate,months);
 const valid=bars.filter(bar=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(bar.date)||!Number.isFinite(bar.close)||bar.close<=0)return false;const stamp=Date.parse(`${bar.date}T00:00:00Z`);return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===bar.date}).sort((a,b)=>a.date.localeCompare(b.date));
 const horizonRows=valid.filter(bar=>bar.date>=targetDate&&bar.date>=entryDate);
 const exitDate=horizonRows[0]?.date;
 const exitCandidates=exitDate?horizonRows.filter(bar=>bar.date===exitDate):[];
 if(new Set(exitCandidates.map(bar=>bar.close)).size>1)return {status:'CENSORED' as const,reason:'conflicting_daily_closes',targetDate,months,priceReturnOnly:true,netReturn:null,exitDate};
 const exit=exitCandidates[0];
 if(!exit)return {status:'CENSORED' as const,reason:'history_ends_before_horizon',targetDate,months,priceReturnOnly:true,netReturn:null,exitDate:null};
 const lagDays=(Date.parse(`${exit.date}T00:00:00Z`)-Date.parse(`${targetDate}T00:00:00Z`))/86_400_000;
 if(lagDays<0||lagDays>7)return {status:'CENSORED' as const,reason:'no_close_near_horizon',targetDate,months,priceReturnOnly:true,netReturn:null,exitDate:null};
 const slip=cost.slippageBps/1e4,paid=entry*(1+slip)*cost.shares+cost.commission,received=exit.close*(1-slip)*cost.shares-cost.commission;
 return {status:'OBSERVED' as const,reason:'horizon_close',targetDate,months,entryDate,exitDate:exit.date,entry,exit:exit.close,lagDays,priceReturnOnly:true,netReturn:received/paid-1,convention:'first observed completed close on or after horizon; price return only; no target or stop'};
}
export function pointInTime<T extends {availableAt?:string;periodEnd:string}>(rows:T[],at:string){const cutoff=Date.parse(at);if(!Number.isFinite(cutoff))throw Error('Invalid cutoff');return rows.filter(r=>{const t=r.availableAt?Date.parse(r.availableAt):Date.parse(r.periodEnd)+60*864e5;return Number.isFinite(t)&&t<=cutoff}).map(r=>({...r,availabilityEstimated:!r.availableAt}));}
export function firmHoldout(firmId:string,salt:string){if(!salt)throw Error('Permanent salt required');let n=2166136261;for(const c of `${salt}:${firmId}`){n^=c.charCodeAt(0);n=Math.imul(n,16777619)}const bucket=(n>>>0)%100;return bucket<60?'train':bucket<80?'validation':bucket<90?'locked':'final';}
export function bonferroni(p:number,experiments:number){if(p<0||p>1||!Number.isInteger(experiments)||experiments<1)throw Error('Invalid experiment');return Math.min(1,p*experiments)}
export function firmBootstrap(rows:{firm:string;value:number}[],iterations=1000,seed=42){if(!rows.length||iterations<1)throw Error('No observations');const firms=[...new Set(rows.map(r=>r.firm))].sort(),groups=firms.map(f=>rows.filter(r=>r.firm===f).map(r=>r.value));const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};const estimates=[];for(let i=0;i<iterations;i++){const sample=[];for(let j=0;j<firms.length;j++)sample.push(...groups[Math.floor(rand()*firms.length)]);estimates.push(sample.reduce((a,b)=>a+b,0)/sample.length)}estimates.sort((a,b)=>a-b);return {unit:'firm',firms:firms.length,low:estimates[Math.floor(iterations*.025)],high:estimates[Math.min(iterations-1,Math.floor(iterations*.975))]};}
export function splitAdjustedDilution(current:number,previous:number,splitFactor:number){return current>0&&previous>0&&splitFactor>0?current/(previous*splitFactor)-1:null;}
export function ma30Weeks(rows:{date:string;close:number}[],asOf:string){const cutoff=new Date(asOf);const day=cutoff.getUTCDay();const monday=new Date(cutoff);monday.setUTCDate(cutoff.getUTCDate()-((day+6)%7));monday.setUTCHours(0,0,0,0);const weeks=new Map<string,{date:string;close:number}>();for(const r of rows){const d=new Date(r.date+'T00:00:00Z');if(d>=monday||!(r.close>0))continue;d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));const key=d.toISOString().slice(0,10);if(!weeks.has(key)||weeks.get(key)!.date<r.date)weeks.set(key,r)}const last=[...weeks.entries()].sort((a,b)=>a[0].localeCompare(b[0])).slice(-30);if(last.length<30)return null;for(let i=1;i<last.length;i++)if(Date.parse(last[i][0])-Date.parse(last[i-1][0])!==7*864e5)return null;return last.reduce((n,[,r])=>n+r.close,0)/30;}
export function opportunityHistoryMetrics(rows:{date:string;close:number;low?:number|null}[],asOf:string){
 const valid=rows.filter((r)=>r.date&&Number.isFinite(r.close)&&r.close>0).sort((a,b)=>a.date.localeCompare(b.date));
 const last=valid.at(-1); if(!last)return {return12m:null,low52w:null,ma30w:null};
 const cutoff=Date.parse(last.date)-365*86_400_000;
 const year=valid.filter((r)=>Date.parse(r.date)>=cutoff);
 const prior=valid.filter((r)=>Date.parse(r.date)<=cutoff).at(-1);
 const return12m=prior&&Date.parse(prior.date)>=cutoff-7*86_400_000?last.close/prior.close-1:null;
 const low52w=year.length>=240?Math.min(...year.map((r)=>r.low!=null&&Number.isFinite(r.low)&&r.low>0?r.low:r.close)):null;
 const ma30w=ma30Weeks(valid.map((r)=>({date:r.date,close:r.close})),asOf);
 return {return12m,low52w,ma30w};
}
