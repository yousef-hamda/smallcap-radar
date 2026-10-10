import type {Snapshot,Provenance} from './engine';
import {compatibleFinancialSources,operatingIssuerMetricsApplicable,modelEvidenceAvailable} from './financial-integrity';
export type PeerObservation={symbol:string;cik:number;sic:number;end:string;revenue:number;grossMargin:number;sources:Provenance[]};
export type OpportunityPeerContext={version:'sec-sic-size-period-v1';asOf:string;method:string;grade:number|null;peers:PeerObservation[];gaps:string[]};
export function peerObservation(snapshot:Snapshot):PeerObservation|null {
 if(!operatingIssuerMetricsApplicable(snapshot)||!snapshot.cik||snapshot.opportunityResearch?.financialStrength?.industryModel!=='industrial-operating-company'
  ||!modelEvidenceAvailable(snapshot.provenance.industryModel,snapshot.asOf)||snapshot.opportunityResearch?.earnings?.conflicts?.length)return null;
 const sic=Number(snapshot.provenance.industryModel?.tag?.match(/^SIC (\d{1,4}):/)?.[1]);if(!sic)return null;
 const rows=[...(snapshot.opportunityResearch?.earnings.annual??[])].sort((a,b)=>b.end.localeCompare(a.end));
 for(const period of rows){
  const revenue=period.metrics.revenue,gross=period.metrics.grossProfit;
  if(!revenue||!gross||!Number.isFinite(revenue.value)||revenue.value<=0||!Number.isFinite(gross.value)||gross.value>revenue.value
    ||revenue.unit!=='USD'||gross.unit!=='USD'||revenue.source.currency!=='USD'||gross.source.currency!=='USD'
    ||(revenue.source.scope??'consolidated')!=='consolidated'||revenue.source.periodStart!==period.start||revenue.source.periodEnd!==period.end
    ||!compatibleFinancialSources([revenue.source,gross.source],'flow'))continue;
  const days=(Date.parse(period.end)-Date.parse(period.start))/864e5,age=(Date.parse(snapshot.asOf)-Date.parse(period.end))/864e5;
  if(days<330||days>380||age<0||age>400||[revenue.source,gross.source].some(source=>!modelEvidenceAvailable(source,snapshot.asOf)))continue;
  return {symbol:snapshot.symbol,cik:snapshot.cik,sic,end:period.end,revenue:revenue.value,grossMargin:gross.value/revenue.value,sources:[revenue.source,gross.source,snapshot.provenance.industryModel]};
 }
 return null;
}
export function peerContext(snapshot:Snapshot,universe:PeerObservation[]):OpportunityPeerContext {
 const own=peerObservation(snapshot),gaps:string[]=[];
 const eligible=own?uniqueIssuerPeers(universe).filter(peer=>Number.isSafeInteger(peer.cik)&&peer.cik>0&&peer.cik!==own.cik&&peer.sic===own.sic
  &&Number.isFinite(peer.revenue)&&Number.isFinite(peer.grossMargin)&&peer.grossMargin<=1
  &&peer.revenue>=own.revenue/4&&peer.revenue<=own.revenue*4&&Math.abs(Date.parse(peer.end)-Date.parse(own.end))<=45*864e5
  &&peer.sources.length>=2&&peer.sources.every(source=>modelEvidenceAvailable(source,snapshot.asOf))):[];
 const peers=uniqueIssuerPeers(eligible).sort((a,b)=>Math.abs(Math.log(a.revenue/own!.revenue))-Math.abs(Math.log(b.revenue/own!.revenue))||a.cik-b.cik).slice(0,20);
 if(!own)gaps.push('Comparable sourced industrial annual revenue, gross profit and SEC SIC are unavailable.');
 if(peers.length<5)gaps.push('At least five distinct issuers with the same SEC SIC, comparable fiscal period and revenue within 0.25–4 times are required.');
 const grade=own&&peers.length>=5?Math.round(peers.reduce((sum,peer)=>sum+(own.grossMargin>peer.grossMargin?1:own.grossMargin===peer.grossMargin?.5:0),0)/peers.length*1000)/100:null;
 return {version:'sec-sic-size-period-v1',asOf:snapshot.asOf,method:'Annual gross-margin percentile against up to 20 distinct SEC-SIC issuers selected by revenue distance; industry peers are not claimed direct competitors or evidence of a moat.',grade,peers,gaps};
}
export function uniqueIssuerPeers(observations:PeerObservation[]) {
 const byCik=new Map<number,PeerObservation[]>();
 for(const item of observations){const rows=byCik.get(item.cik)??[];rows.push(item);byCik.set(item.cik,rows);}
 const canonical=(value:unknown,ancestors=new Set<object>(),depth=0):unknown=>{
  if(!value||typeof value!=='object')return value;
  if(depth>16||ancestors.has(value))return 'invalid-cyclic-source';
  const next=new Set(ancestors).add(value);
  return Array.isArray(value)?value.map(item=>canonical(item,next,depth+1))
   :Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical((value as Record<string,unknown>)[key],next,depth+1)]));
 };
 const sourceKey=(item:PeerObservation)=>JSON.stringify(canonical(item.sources));
 return [...byCik.values()].flatMap(rows=>{
  const end=rows.map(item=>item.end).sort().at(-1)!;
  const latest=rows.filter(item=>item.end===end),first=latest[0];
  // Alternate listings never get to choose favorable issuer economics.
  if(latest.some(item=>item.sic!==first.sic||item.revenue!==first.revenue||item.grossMargin!==first.grossMargin))return [];
  return [latest.sort((a,b)=>sourceKey(a)<sourceKey(b)?-1:sourceKey(a)>sourceKey(b)?1:a.symbol<b.symbol?-1:a.symbol>b.symbol?1:0)[0]];
 });
}
