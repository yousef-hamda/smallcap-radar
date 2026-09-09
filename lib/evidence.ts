import type {Provenance} from './engine';

export function usableEvidence(p:Provenance|undefined,asOf:string){
 const cutoff=Date.parse(asOf);
 return !!p&&!!p.source?.trim()&&Number.isFinite(cutoff)&&Number.isFinite(Date.parse(p.availableAt))&&Number.isFinite(Date.parse(p.periodEnd))&&Date.parse(p.availableAt)<=cutoff&&Date.parse(p.periodEnd)<=cutoff;
}

/** A derived number becomes available only after its latest dependency. */
export function derivedEvidence(source:string,inputs:Provenance[],asOf:string,tag:string):Provenance|undefined {
 if(!inputs.length||inputs.some(p=>!usableEvidence(p,asOf)))return;
 return {...inputs[0],source,tag,availableAt:inputs.map(p=>p.availableAt).sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1)!,retrievedAt:inputs.map(p=>p.retrievedAt).sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1)!,confidence:'low'};
}
