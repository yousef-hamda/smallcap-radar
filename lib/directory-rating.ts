import {db,insertSnapshot,ensureRunEvaluations,invalidateStateCache} from './storage';
import {restoreArchivedRow} from './snapshot-archive';
import {preliminarySnapshot} from './bulk';
import type {Snapshot} from './engine';

/** Publish a complete immutable rating release independently of slow acquisition.
 * Carry forward issuer-matching observations with their original source dates;
 * a missing observation remains missing, rather than a favorable default. */
export async function publishDirectoryRatings(run:any,pageSize=1000,limit=80){
 const d=db(),id=`${run.id}:ratings-v2`,key=`directory-rating:v2:${run.id}`;
 let checkpoint=await d.prepare('SELECT payload FROM raw_cache WHERE key=?').bind(key).first() as any;
 if(!checkpoint){
  const prior=await d.prepare("SELECT id FROM strategy_runs r WHERE id<>? AND status IN ('complete','partial') AND stage>=13 AND source LIKE '%· full' AND EXISTS(SELECT 1 FROM fundamental_snapshots s WHERE s.run_id=r.id) ORDER BY updated_at DESC,created_at DESC LIMIT 1").bind(id).first() as any;
  const state={id,offset:0,total:Number(run.universe_total||run.total),asOf:new Date().toISOString(),priorRunId:prior?.id??null,done:false};
  await d.batch([
   d.prepare("INSERT OR IGNORE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,'directory rating checkpoint',?,?)").bind(key,state.asOf,JSON.stringify(state)),
   d.prepare("INSERT OR IGNORE INTO strategy_runs(id,created_at,updated_at,status,source,total,universe_total,strategy_hash) VALUES(?,?,?,'running','Directory ratings · full',?,?,?)").bind(id,state.asOf,state.asOf,state.total,state.total,run.strategy_hash),
  ]);
  checkpoint=await d.prepare('SELECT payload FROM raw_cache WHERE key=?').bind(key).first();
 }
 const state=JSON.parse(checkpoint.payload);if(state.done)return state;
 const entries:any[]=[];
 for(let page=Math.floor(state.offset/pageSize);page<=Math.floor(Math.min(state.total-1,state.offset+limit-1)/pageSize);page++){
  const row=await d.prepare('SELECT payload FROM raw_cache WHERE key=?').bind(`universe:${run.id}:quotes:${page}`).first() as any;
  if(!row)throw Error('Complete directory rating checkpoint is missing');
  const records=JSON.parse(row.payload);
  for(let index=Math.max(0,state.offset-page*pageSize);index<records.length&&entries.length<limit&&page*pageSize+index<state.total;index++)entries.push(records[index]);
 }
 if(!entries.length&&state.offset<state.total)throw Error('Complete directory rating cursor has no listing');
 const symbols=entries.map(row=>row.ticker),priorRows=state.priorRunId?(await d.prepare(`SELECT id,symbol,payload,evaluation FROM fundamental_snapshots WHERE run_id=? AND symbol IN (${symbols.map(()=>'?').join(',')})`).bind(state.priorRunId,...symbols).all()).results as any[]:[];
 const previous=new Map<string,Snapshot>();
 for(const row of priorRows)previous.set(row.symbol,JSON.parse((await restoreArchivedRow(row)).payload));
 const writes=[];
 for(const company of entries){
  const current=preliminarySnapshot(company,undefined,state.asOf),prior=previous.get(company.ticker);
  let snapshot=current;
  if(prior&&Number.isSafeInteger(current.cik)&&Number(current.cik)>0&&prior.cik===current.cik&&prior.securityType===current.securityType){
   snapshot={...prior,name:current.name,exchange:current.exchange,asOf:state.asOf,provenance:{...prior.provenance}};
   for(const field of ['price','marketCap','volume','averageVolume10d','return12m','low52w','high52w'] as const){
    const evidence=current.provenance[field],old=prior.provenance[field];
    if(typeof current[field]==='number'&&evidence&&Date.parse(evidence.availableAt??evidence.periodEnd)>(Number.isFinite(Date.parse(old?.availableAt??old?.periodEnd??''))?Date.parse(old?.availableAt??old?.periodEnd??''):-Infinity)){
     (snapshot as any)[field]=current[field];snapshot.provenance[field]=evidence;
     if(field==='price'){snapshot.dailyChange=null;delete snapshot.provenance.dailyChange;}
    }
   }
   for(const field of ['exchange','securityType'])if(current.provenance[field])snapshot.provenance[field]=current.provenance[field];
  }
  writes.push(insertSnapshot(id,snapshot));
 }
 state.offset+=entries.length;
 writes.push(d.prepare('UPDATE raw_cache SET payload=? WHERE key=?').bind(JSON.stringify(state),key));
 await d.batch(writes);
 if(state.offset===state.total){
  const count=await d.prepare('SELECT COUNT(*) AS n FROM fundamental_snapshots WHERE run_id=?').bind(id).first() as any;
  if(Number(count.n)!==state.total)throw Error('Complete directory rating listing count does not match');
  await ensureRunEvaluations(id);
  state.done=true;
  await d.batch([
   d.prepare("UPDATE strategy_runs SET status='partial',stage=13,offset=total,processed=total,updated_at=? WHERE id=?").bind(new Date().toISOString(),id),
   d.prepare('UPDATE raw_cache SET payload=? WHERE key=?').bind(JSON.stringify(state),key),
  ]);
  invalidateStateCache();
 }
 return state;
}
