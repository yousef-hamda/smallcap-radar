import type {Provenance} from './engine';

/** Strict ISO dates/timestamps, validating the written calendar date before
 * timezone conversion. Date.parse alone silently normalizes February 30. */
export function evidenceTimestamp(value:unknown):number {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value))return NaN;
 const day=Date.parse(`${value.slice(0,10)}T00:00:00Z`);
 if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==value.slice(0,10))return NaN;
 if(value.length>10&&(Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||(value[16]===':'&&Number(value.slice(17,19))>59)))return NaN;
 return Date.parse(value);
}
export function validEvidenceDate(value:unknown):boolean{return Number.isFinite(evidenceTimestamp(value));}

export function usableEvidence(p:Provenance|undefined,asOf:string){
 const cutoff=evidenceTimestamp(asOf),available=evidenceTimestamp(p?.availableAt),period=evidenceTimestamp(p?.periodEnd);
 const start=p?.periodStart===undefined?undefined:evidenceTimestamp(p.periodStart);
 return !!p&&typeof p.source==='string'&&!!p.source.trim()&&Number.isFinite(cutoff)&&Number.isFinite(available)&&Number.isFinite(period)
  &&available<=cutoff&&period<=cutoff&&period<=available&&(start===undefined||(Number.isFinite(start)&&start<=period));
}

/** Conversion chronology and actual supported reference-rate source identity
 * are shared by reviewed and model evidence. Rights remain a separate policy. */
export function validEvidenceConversion(provenance:Provenance,asOf:string):boolean {
 const conversion=provenance.conversion;if(!conversion)return true;
 const cutoff=evidenceTimestamp(asOf),available=evidenceTimestamp(provenance.availableAt),retrieved=evidenceTimestamp(provenance.retrievedAt);
 const start=evidenceTimestamp(conversion.ratePeriodStart),end=evidenceTimestamp(conversion.ratePeriodEnd);
 const inputAvailable=evidenceTimestamp(conversion.inputAvailableAt),inputRetrieved=evidenceTimestamp(conversion.inputRetrievedAt);
 if(![cutoff,available,retrieved,start,end,inputAvailable,inputRetrieved].every(Number.isFinite)
  ||!/^\d{4}-\d{2}-\d{2}$/.test(conversion.ratePeriodStart)||!/^\d{4}-\d{2}-\d{2}$/.test(conversion.ratePeriodEnd)
  ||!Number.isFinite(conversion.rate)||conversion.rate<=0||!/^[A-Z]{3}$/.test(conversion.sourceCurrency)
  ||conversion.targetCurrency!=='USD'||provenance.currency!==conversion.targetCurrency
  ||!Number.isInteger(conversion.observationCount)||conversion.observationCount<0
  ||(conversion.observationCount===0&&(conversion.sourceCurrency!=='USD'||conversion.rate!==1))
  ||start>end||end>cutoff||end>available||inputAvailable>cutoff||inputRetrieved>cutoff
  ||inputAvailable>available||inputRetrieved>retrieved
  ||!['period-average-daily-reference-cross-rate','period-end-prior-daily-reference-cross-rate'].includes(conversion.method))return false;
 try{
  const url=new URL(conversion.sourceUrl);if(url.protocol!=='https:'||url.username||url.password||url.port)return false;
  if(conversion.rateProvider==='European Central Bank (ECB) Data Portal'&&url.hostname==='data-api.ecb.europa.eu'){
   const key=decodeURIComponent(url.pathname).match(/^\/service\/data\/EXR\/D\.([A-Z]{3}(?:\+[A-Z]{3})*)\.EUR\.SP00\.A$/)?.[1];
   const quotes=key?.split('+')??[];
   return quotes.includes('USD')&&(conversion.sourceCurrency==='EUR'||quotes.includes(conversion.sourceCurrency));
  }
  return conversion.rateProvider==='European Central Bank (ECB) via Frankfurter API'&&url.hostname==='api.frankfurter.dev'
   &&url.pathname==='/v2/providers/ecb/rates'&&url.searchParams.get('base')==='EUR'
   &&(url.searchParams.get('quotes')??'').split(',').includes('USD')
   &&(conversion.sourceCurrency==='EUR'||(url.searchParams.get('quotes')??'').split(',').includes(conversion.sourceCurrency));
 }catch{return false;}
}

/** A derived number becomes available only after its latest dependency. */
export function derivedEvidence(source:string,inputs:Provenance[],asOf:string,tag:string):Provenance|undefined {
 const cutoff=evidenceTimestamp(asOf);
 if(!inputs.length||inputs.some(p=>!usableEvidence(p,asOf)||!validEvidenceDate(p.retrievedAt)||evidenceTimestamp(p.retrievedAt)>cutoff||!validEvidenceConversion(p,asOf)))return;
 const rights=inputs.map(p=>p.rightsStatus??'unknown');
 const rightsStatus=rights.includes('restricted')?'restricted':rights.includes('personal-use-only')?'personal-use-only':rights.includes('unknown')?'unknown':rights.includes('licensed')?'licensed':rights.includes('redistribution-permitted')?'redistribution-permitted':'public-domain';
 return {...inputs[0],dependencies:inputs,rightsStatus,source,tag,availableAt:inputs.map(p=>p.availableAt).sort((a,b)=>evidenceTimestamp(a)-evidenceTimestamp(b)).at(-1)!,retrievedAt:inputs.map(p=>p.retrievedAt).sort((a,b)=>evidenceTimestamp(a)-evidenceTimestamp(b)).at(-1)!,confidence:'low'};
}
