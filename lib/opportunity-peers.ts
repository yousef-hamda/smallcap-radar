import type {Snapshot,Provenance} from './engine';
import {compatibleFinancialSources,operatingIssuerMetricsApplicable} from './financial-integrity';
import {usableEvidence} from './evidence';
export type PeerObservation={symbol:string;cik:number;sic:number;end:string;revenue:number;grossMargin:number;sources:Provenance[]};
export type OpportunityPeerContext={version:'sec-sic-size-period-v1';asOf:string;method:string;grade:number|null;peers:PeerObservation[];gaps:string[]};
export function peerObservation(snapshot:Snapshot):PeerObservation|null {
 if(!operatingIssuerMetricsApplicable(snapshot)||!snapshot.cik||snapshot.opportunityResearch?.financialStrength?.industryModel!=='industrial-operating-company')return null;
 const sic=Number(snapshot.provenance.industryModel?.tag?.match(/^SIC (\d{1,4}):/)?.[1]);if(!sic)return null;
 const rows=[...(snapshot.opportunityResearch?.earnings.annual??[])].sort((a,b)=>b.end.localeCompare(a.end));
 for(const period of rows){
  const revenue=period.metrics.revenue,gross=period.metrics.grossProfit;
  if(!revenue||!gross||revenue.value<=0||!Number.isFinite(gross.value)||revenue.unit!=='USD'||gross.unit!=='USD'||!compatibleFinancialSources([revenue.source,gross.source],'flow'))continue;
  const days=(Date.parse(period.end)-Date.parse(period.start))/864e5,age=(Date.parse(snapshot.asOf)-Date.parse(period.end))/864e5;
  if(days<330||days>380||age<0||age>400||[revenue.source,gross.source].some(source=>!usableEvidence(source,snapshot.asOf)||Date.parse(source.retrievedAt)>Date.parse(snapshot.asOf)))continue;
  return {symbol:snapshot.symbol,cik:snapshot.cik,sic,end:period.end,revenue:revenue.value,grossMargin:gross.value/revenue.value,sources:[revenue.source,gross.source,snapshot.provenance.industryModel]};
 }
 return null;
}
export function peerContext(snapshot:Snapshot,universe:PeerObservation[]):OpportunityPeerContext {
 const own=peerObservation(snapshot),gaps:string[]=[];
 const peers=own?universe.filter(peer=>peer.cik!==own.cik&&peer.sic===own.sic&&peer.revenue>=own.revenue/4&&peer.revenue<=own.revenue*4&&Math.abs(Date.parse(peer.end)-Date.parse(own.end))<=45*864e5&&peer.sources.every(source=>Date.parse(source.availableAt)<=Date.parse(snapshot.asOf)&&Date.parse(source.retrievedAt)<=Date.parse(snapshot.asOf))).sort((a,b)=>Math.abs(Math.log(a.revenue/own.revenue))-Math.abs(Math.log(b.revenue/own.revenue))||(a.symbol<b.symbol?-1:1)).slice(0,20):[];
 if(!own)gaps.push('Comparable sourced industrial annual revenue, gross profit and SEC SIC are unavailable.');
 if(peers.length<5)gaps.push('At least five distinct issuers with the same SEC SIC, comparable fiscal period and revenue within 0.25–4 times are required.');
 const grade=own&&peers.length>=5?Math.round(peers.reduce((sum,peer)=>sum+(own.grossMargin>peer.grossMargin?1:own.grossMargin===peer.grossMargin?.5:0),0)/peers.length*1000)/100:null;
 return {version:'sec-sic-size-period-v1',asOf:snapshot.asOf,method:'Annual gross-margin percentile against up to 20 distinct SEC-SIC issuers selected by revenue distance; industry peers are not claimed direct competitors or evidence of a moat.',grade,peers,gaps};
}
export function uniqueIssuerPeers(observations:PeerObservation[]) {
 const byCik=new Map<number,PeerObservation>();
 for(const item of observations){const previous=byCik.get(item.cik);if(!previous||item.end>previous.end||(item.end===previous.end&&item.symbol<previous.symbol))byCik.set(item.cik,item);}
 return [...byCik.values()];
}
