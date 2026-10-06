import {env} from 'cloudflare:workers';
import type {DirectoryCompany} from './directory';
export type CompleteDirectory={retrievedAt:string;rows:DirectoryCompany[]};
const database=()=>(env as any).DB;
let schema:Promise<unknown>|undefined;
async function ready(){schema??=database().prepare('CREATE TABLE IF NOT EXISTS listing_directory_cache(id INTEGER PRIMARY KEY CHECK(id=1),content_hash TEXT NOT NULL,body_gzip BLOB NOT NULL)').run().catch((error:unknown)=>{schema=undefined;throw error;});await schema;}
async function digest(body:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export function completeDirectoryFiles(nasdaq:string,other:string){
 return nasdaq.startsWith('Symbol|Security Name|')&&other.startsWith('ACT Symbol|Security Name|')
  && /(?:^|\n)File Creation Time:/.test(nasdaq)&&/(?:^|\n)File Creation Time:/.test(other)
  && nasdaq.split('\n').length>2&&other.split('\n').length>2;
}
export async function saveCompleteDirectory(value:CompleteDirectory){
 if(!database())return;await ready();
 if(!value.rows.length||!Number.isFinite(Date.parse(value.retrievedAt)))throw Error('Invalid complete listing inventory');
 const body=JSON.stringify(value),bytes=new Uint8Array(await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 if(bytes.length>2_000_000)throw Error('Complete listing directory exceeds durable cache limit');
 await database().prepare('INSERT OR REPLACE INTO listing_directory_cache(id,content_hash,body_gzip) VALUES(1,?,?)').bind(await digest(body),bytes).run();
}
export async function readCompleteDirectory():Promise<CompleteDirectory|null>{
 if(!database())return null;await ready();const row=await database().prepare('SELECT content_hash,body_gzip FROM listing_directory_cache WHERE id=1').first() as any;
 if(!row)return null;
 try{
  const bytes=new Uint8Array(row.body_gzip),body=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  if(await digest(body)!==row.content_hash)throw Error('Listing inventory checksum mismatch');
  const value=JSON.parse(body);if(!Array.isArray(value.rows)||!value.rows.length||!Number.isFinite(Date.parse(value.retrievedAt)))throw Error('Invalid saved inventory');return value;
 }catch{return null;}
}
/** Retain the latest publication and latest enriched full scan's identities.
 * Missing current membership is uncertainty, never evidence of delisting. */
export async function previouslyTrackedCompanies():Promise<Array<DirectoryCompany&{directoryAvailableAt?:string}>>{
 const d=database();if(!d||!await d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='strategy_runs'").first())return [];
 const runs=(await d.prepare("SELECT id FROM strategy_runs r WHERE status IN ('complete','partial') AND stage>=13 AND source LIKE '%· full' AND EXISTS(SELECT 1 FROM fundamental_snapshots s WHERE s.run_id=r.id) ORDER BY updated_at DESC,created_at DESC").all()).results as any[];
 const selected=[runs[0],runs.find(row=>!String(row.id).includes(':ratings'))].filter(Boolean),known=new Map<string,DirectoryCompany&{directoryAvailableAt?:string}>();
 for(const run of selected){
  const rows=(await d.prepare("SELECT symbol,json_extract(payload,'$.name') AS name,json_extract(payload,'$.cik') AS cik,json_extract(payload,'$.exchange') AS exchange,json_extract(payload,'$.securityType') AS securityType,json_extract(payload,'$.provenance.securityType.url') AS directoryUrl,json_extract(payload,'$.provenance.securityType.tag') AS securityName,json_extract(payload,'$.provenance.securityType.availableAt') AS directoryAvailableAt FROM fundamental_snapshots WHERE run_id=?").bind(run.id).all()).results as any[];
  for(const row of rows)if(!known.has(row.symbol))known.set(row.symbol,{ticker:row.symbol,name:row.name||row.symbol,cik:Number(row.cik)||0,exchange:row.exchange||'Unknown',securityType:row.securityType||'unknown',securityName:row.securityName||'',directoryUrl:row.directoryUrl||'',directoryAvailableAt:row.directoryAvailableAt||undefined});
 }
 return [...known.values()];
}
