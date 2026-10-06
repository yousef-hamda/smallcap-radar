import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const WEIGHTS=Object.freeze({valuation:25,catalysts:20,financialStrength:15,earningsQuality:12,competitivePosition:10,downsideRisk:10,management:5,technicalTiming:3});
export const PROTOCOL=Object.freeze({version:'opportunity-pit-six-month-v1',horizonDays:183,majorUpside:.50,trainFraction:.6,validationFraction:.2,issuerHoldoutPct:20,minimumRows:10000,minimumIssuers:1000,minimumMonths:60});
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
const average=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const issuerBucket=id=>parseInt(hash(String(id)).slice(0,8),16)%100;
export function validateObservation(row,cutoff=Date.now()) {
 const errors=[],asOf=Date.parse(row?.asOf),end=asOf+PROTOCOL.horizonDays*864e5;
 if(!row?.symbol||!row?.issuerId||!Number.isFinite(asOf))errors.push('Missing security/issuer/as-of identity');
 for(const id of Object.keys(WEIGHTS)){
  const factor=row?.factors?.[id];
  if(!factor||!finite(factor.score)||factor.score<0||factor.score>10||!Array.isArray(factor.sources)||!factor.sources.length)errors.push('Missing bounded grade or point-in-time lineage: '+id);
  else for(const source of factor.sources)if(!source.id||!Number.isFinite(Date.parse(source.availableAt))||Date.parse(source.availableAt)>asOf||!Number.isFinite(Date.parse(source.periodEnd))||Date.parse(source.periodEnd)>asOf)errors.push('Future or invalid point-in-time source: '+id);
 }
 const coverage=row?.coverage;
 if(coverage?.membershipAsOf!==row?.asOf||coverage?.delistedIncluded!==true||coverage?.corporateActionsComplete!==true||coverage?.outcomesComplete!==true)errors.push('Membership, delisted outcomes or corporate actions are not complete');
 if(row?.prices?.adjustment!=='split-adjusted-with-cash-dividends')errors.push('Explicit split-adjusted prices and cash dividends are required');
 const entry=row?.prices?.entry;
 if(!entry||!finite(entry.price)||entry.price<=0||Date.parse(entry.at)<=asOf||Date.parse(entry.at)>end||Date.parse(entry.at)>cutoff)errors.push('Entry must be an executable session after the signal');
 const bars=row?.prices?.bars;
 if(!Array.isArray(bars)||!bars.length||bars.some((bar,index)=>!finite(bar.close)||bar.close<=0||!finite(bar.dividend)||bar.dividend<0||!Number.isFinite(Date.parse(bar.at))||Date.parse(bar.at)>cutoff||(index>0&&Date.parse(bar.at)<=Date.parse(bars[index-1].at))))errors.push('Invalid chronological price/dividend observations');
 if(!finite(row?.costs?.roundTripBps)||row.costs.roundTripBps<0)errors.push('Explicit execution costs are required');
 if(!row?.benchmark?.source||!finite(row.benchmark.totalReturn))errors.push('Independent benchmark total-return observation is required');
 const delisting=row?.prices?.delisting;
 if(delisting&&(!finite(delisting.proceedsPerShare)||delisting.proceedsPerShare<0||!Number.isFinite(Date.parse(delisting.at))||Date.parse(delisting.at)>cutoff||Date.parse(delisting.at)<Date.parse(entry?.at)))errors.push('Delisting payoff and timestamp are required');
 const observedUntil=Date.parse(row?.prices?.observedUntil);
 if(Number.isFinite(observedUntil)&&observedUntil>cutoff)errors.push('Observed-through date exceeds the verification cutoff');
 const endpoint=delisting&&Date.parse(delisting.at)<=end?Date.parse(delisting.at):end;
 const included=Array.isArray(bars)?bars.filter(bar=>Date.parse(bar.at)>=Date.parse(entry?.at)&&Date.parse(bar.at)<=endpoint):[];
 const coverageGap=!included.length||Date.parse(included[0]?.at)-Date.parse(entry?.at)>4*864e5||endpoint-Date.parse(included.at(-1)?.at)>4*864e5||included.some((bar,index)=>index>0&&Date.parse(bar.at)-Date.parse(included[index-1].at)>7*864e5);
 const censored=coverageGap||end>cutoff||!Number.isFinite(observedUntil)||(observedUntil<end&&!delisting);
 if(errors.length)return {valid:false,errors,censored};
 const relevant=bars.filter(bar=>Date.parse(bar.at)>=Date.parse(entry.at)&&Date.parse(bar.at)<=end);
 let dividends=0,peak=entry.price,maxDrawdown=0,maxReturn=0,lastValue=entry.price;
 for(const bar of relevant){dividends+=bar.dividend;lastValue=bar.close+dividends;peak=Math.max(peak,lastValue);maxDrawdown=Math.min(maxDrawdown,lastValue/peak-1);maxReturn=Math.max(maxReturn,lastValue/entry.price-1);}
 if(delisting&&Date.parse(delisting.at)<=end){lastValue=delisting.proceedsPerShare+dividends;maxDrawdown=Math.min(maxDrawdown,lastValue/peak-1);}
 const cost=row.costs.roundTripBps/10000;
 const score=Math.round(Object.entries(WEIGHTS).reduce((sum,[id,weight])=>sum+Math.round(row.factors[id].score*100)*weight,0)/10)/100;
 return {valid:true,errors:[],censored,issuerId:String(row.issuerId),symbol:row.symbol,asOf,end,observedUntil,score,totalReturn:lastValue/entry.price-1-cost,maxReturn:maxReturn-cost,maxDrawdown,majorUpside:maxReturn-cost>=PROTOCOL.majorUpside,benchmarkReturn:row.benchmark.totalReturn};
}
function cohort(rows){const ordered=[...rows].sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol));const top=ordered.slice(0,Math.ceil(ordered.length*.1));return {rows:rows.length,issuers:new Set(rows.map(row=>row.issuerId)).size,majorUpsideRate:average(rows.map(row=>Number(row.majorUpside))),meanReturn:average(rows.map(row=>row.totalReturn)),meanDrawdown:average(rows.map(row=>row.maxDrawdown)),benchmarkMeanReturn:average(rows.map(row=>row.benchmarkReturn)),topDecile:{rows:top.length,majorUpsideRate:average(top.map(row=>Number(row.majorUpside))),meanReturn:average(top.map(row=>row.totalReturn)),meanDrawdown:average(top.map(row=>row.maxDrawdown))}};}
export function validateOpportunityDataset(rows,{cutoff=Date.now()}={}) {
 const blockers=[],keys=new Set(),accepted=[],rejected=[];let censored=0;
 for(const row of rows){const key=String(row.symbol)+':'+String(row.asOf);if(keys.has(key)){rejected.push({key,errors:['Duplicate security/as-of observation']});continue;}keys.add(key);const result=validateObservation(row,cutoff);if(!result.valid)rejected.push({key,errors:result.errors});else if(result.censored)censored++;else accepted.push(result);}
 const sorted=accepted.sort((a,b)=>a.asOf-b.asOf||a.symbol.localeCompare(b.symbol)),dates=[...new Set(sorted.map(row=>row.asOf))];
 const validationStart=dates[Math.floor(dates.length*PROTOCOL.trainFraction)],testStart=dates[Math.floor(dates.length*(PROTOCOL.trainFraction+PROTOCOL.validationFraction))];
 const holdout=sorted.filter(row=>issuerBucket(row.issuerId)<PROTOCOL.issuerHoldoutPct),development=sorted.filter(row=>issuerBucket(row.issuerId)>=PROTOCOL.issuerHoldoutPct);
 const train=development.filter(row=>row.asOf<validationStart&&row.end<validationStart),validation=development.filter(row=>row.asOf>=validationStart&&row.asOf<testStart&&row.end<testStart),test=development.filter(row=>row.asOf>=testStart);
 const months=dates.length?(dates.at(-1)-dates[0])/864e5/30.4375:0,issuers=new Set(sorted.map(row=>row.issuerId)).size;
 if(sorted.length<PROTOCOL.minimumRows)blockers.push('Insufficient uncensored point-in-time rows: '+sorted.length);
 if(issuers<PROTOCOL.minimumIssuers)blockers.push('Insufficient independent issuers: '+issuers);
 if(months<PROTOCOL.minimumMonths)blockers.push('Insufficient historical coverage in months: '+months.toFixed(1));
 if(rejected.length)blockers.push('Invalid or duplicate observations: '+rejected.length);
 if([train,validation,test,holdout].some(part=>!part.length))blockers.push('Purged chronological or issuer holdout partition is empty');
 // This study assesses the fixed ranking. Probability publication requires an
 // additional preregistered calibration experiment; none is guessed here.
 return {status:blockers.length?'BLOCKED':'DIAGNOSTIC-READY',datasetHash:hash(JSON.stringify(rows)),protocol:PROTOCOL,weights:WEIGHTS,probability:null,calibrationStatus:'unvalidated',counts:{total:rows.length,accepted:sorted.length,rejected:rejected.length,censored,issuers,purged:development.length-train.length-validation.length-test.length},blockers,metrics:{all:cohort(sorted),train:cohort(train),validation:cohort(validation),test:cohort(test),issuerHoldout:cohort(holdout)},rejected:rejected.slice(0,100)};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const input=process.argv[2];const rows=input&&fs.existsSync(input)?fs.readFileSync(input,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
 console.log(JSON.stringify(validateOpportunityDataset(rows),null,2));
}
