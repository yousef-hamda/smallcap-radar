import {env} from 'cloudflare:workers';
let schema:Promise<unknown>|undefined;
const db=()=>(env as any).DB;
async function ready(){if(!db())return;schema??=db().batch([
 db().prepare('CREATE TABLE IF NOT EXISTS sec_artifact_cache(url TEXT PRIMARY KEY,cik INTEGER NOT NULL,content_hash TEXT NOT NULL,fetched_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,body_gzip BLOB NOT NULL)'),
 db().prepare('CREATE TABLE IF NOT EXISTS provider_acquisition_status(url TEXT PRIMARY KEY,last_attempt_at INTEGER NOT NULL,last_success_at INTEGER,last_error TEXT)'),
]).catch((e:unknown)=>{schema=undefined;throw e;});await schema;}
export function secArtifactCik(url:string){return url.match(/^https:\/\/data\.sec\.gov\/(?:api\/xbrl\/companyfacts\/|submissions\/)CIK(\d{10})\.json$/)?.[1];}
export async function readSecArtifact(url:string,now=Date.now()){
 if(!secArtifactCik(url)||!db())return null;await ready();
 const row=await db().prepare('SELECT body_gzip,content_hash FROM sec_artifact_cache WHERE url=? AND expires_at>?').bind(url,now).first() as any;
 if(!row)return null;
 try{
  const bytes=row.body_gzip instanceof Uint8Array?row.body_gzip:new Uint8Array(row.body_gzip);
  const body=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
  const hash=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
  const value=JSON.parse(body);if(hash!==row.content_hash||Number(value.cik)!==Number(secArtifactCik(url)))throw Error('SEC cache checksum or issuer mismatch');
  return value;
 }catch{await db().prepare('DELETE FROM sec_artifact_cache WHERE url=?').bind(url).run();return null;}
}
export async function recordSecArtifact(url:string,value:unknown,error?:string,now=Date.now()){
 const cik=Number(secArtifactCik(url));if(!cik||!db())return;await ready();
 if(error){await db().prepare('INSERT INTO provider_acquisition_status(url,last_attempt_at,last_error) VALUES(?,?,?) ON CONFLICT(url) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,last_error=excluded.last_error').bind(url,now,error.slice(0,1000)).run();return;}
 if(!value||typeof value!=='object'||Number((value as any).cik)!==cik)throw Error('SEC artifact issuer mismatch');
 const body=JSON.stringify(value),compressed=new Uint8Array(await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));const hash=[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
 const writes=[db().prepare('INSERT INTO provider_acquisition_status(url,last_attempt_at,last_success_at,last_error) VALUES(?,?,?,NULL) ON CONFLICT(url) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at,last_error=NULL').bind(url,now,now)];
 if(compressed.length<=2_000_000)writes.push(db().prepare('INSERT OR REPLACE INTO sec_artifact_cache(url,cik,content_hash,fetched_at,expires_at,body_gzip) VALUES(?,?,?,?,?,?)').bind(url,cik,hash,now,now+6*60*60_000,compressed));
 await db().batch(writes);
 // Bounded acquisition cache; saved snapshots/filings retain the scoring evidence.
 await db().prepare('DELETE FROM sec_artifact_cache WHERE url IN (SELECT url FROM (SELECT url,SUM(length(body_gzip)) OVER(ORDER BY fetched_at DESC,url) AS used FROM sec_artifact_cache) WHERE used>268435456)').run();
}
