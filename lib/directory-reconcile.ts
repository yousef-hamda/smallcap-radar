import {db,log,insertSnapshot} from './storage';
import {preliminarySnapshot} from './bulk';
import {universe} from './providers';

/** Append repaired membership without changing existing acquisition indices. */
export async function reconcileAcquisitionDirectory(run:any){
 if(run.directory_version===1||run.universe!=='paged-v2'||run.stage<1||run.stage>10||!String(run.source).includes('Opportunity SEC v13'))return false;
 const current=await universe({skipYahoo:true}),bySymbol=new Map(current.map(company=>[company.ticker,company])),records:any[]=[];
 for(let page=0;page<Math.ceil(Number(run.total)/100);page++){
  const row=await db().prepare('SELECT payload FROM raw_cache WHERE key=?').bind(`universe:${run.id}:quotes:${page}`).first() as any;
  if(!row)throw Error('Cannot repair an incomplete saved acquisition inventory');
  records.push(...JSON.parse(row.payload));
 }
 if(records.length!==Number(run.total))throw Error('Acquisition inventory count mismatch');
 const merged=records.map(previous=>{
  const listed=bySymbol.get(previous.ticker);bySymbol.delete(previous.ticker);
  // Retain all original quote dates/values and provider work. Identity alone
  // is updated by a complete current directory observation.
  return listed?{...previous,name:listed.name,cik:listed.cik||previous.cik,exchange:listed.exchange,securityType:listed.securityType,securityName:listed.securityName,directoryUrl:listed.directoryUrl,directoryAvailableAt:listed.directoryAvailableAt,listingStatus:listed.listingStatus}:{...previous,listingStatus:'not-confirmed-current'};
 });
 merged.push(...[...bySymbol.values()].sort((a,b)=>a.ticker.localeCompare(b.ticker)));
 const now=new Date().toISOString(),writes=[];
 for(const kind of ['quotes',...(run.stage>=4?['candidates']:[]),...(run.stage===10?['history']:[])])for(let offset=0;offset<merged.length;offset+=100)writes.push(db().prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(`universe:${run.id}:${kind}:${offset/100}`,'complete directory membership repair',now,JSON.stringify(merged.slice(offset,offset+100))));
 writes.push(db().prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(`universe:${run.id}:ciks`,'complete candidate CIK checkpoint',now,JSON.stringify([...new Set(merged.map(company=>Number(company.cik)).filter(cik=>Number.isSafeInteger(cik)&&cik>0))])));
 if(run.stage===10){
  for(let offset=0;offset<merged.length;offset+=20){
   const entries=merged.slice(offset,offset+20),symbols=entries.map(company=>company.ticker);
   const existing=(await db().prepare(`SELECT symbol,payload FROM fundamental_snapshots WHERE run_id=? AND symbol IN (${symbols.map(()=>'?').join(',')})`).bind(run.id,...symbols).all()).results as any[],saved=new Map(existing.map(row=>[row.symbol,JSON.parse(row.payload)]));
   const updates=entries.map(company=>{const old=saved.get(company.ticker),current=preliminarySnapshot(company,undefined,now);
    return insertSnapshot(run.id,old?{...old,name:company.name,cik:company.cik,exchange:company.exchange,securityType:company.securityType,listingStatus:company.listingStatus,asOf:now,provenance:{...old.provenance,...Object.fromEntries(Object.entries(current.provenance).filter(([key])=>['exchange','securityType'].includes(key)))},dataIssues:[...(old.dataIssues??[]),...(current.listingStatus==='not-confirmed-current'?current.dataIssues??[]:[])]}:current);
   });
   updates.push(db().prepare('UPDATE strategy_runs SET lease_until=? WHERE id=?').bind(Date.now()+90_000,run.id));await db().batch(updates);
  }
 }

 // A scoring-only cursor can restart; provider-stage offsets and retry queues
 // stay intact. New listings are appended after all existing indices.
 writes.push(db().prepare('UPDATE strategy_runs SET directory_version=1,total=?,universe_total=?,screened_out=0,offset=?,lease_until=0,updated_at=? WHERE id=?').bind(merged.length,merged.length,run.stage===9?0:run.offset,now,run.id));
 await db().batch(writes);await log(run.id,'universe',`Complete official membership repaired: ${records.length} -> ${merged.length}; original provider indices and retry queue preserved.`);return true;
}
