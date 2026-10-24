import {env} from 'cloudflare:workers';

/** Source copies are an analyst aid, never an equity-class review or score. */
export const SEC_FINANCIAL_SOURCE_MAX_BYTES=1_500_000;
const ARCHIVE_MAX_BYTES=32*1024*1024;
export type SecFinancialSourceForm='10-K'|'10-K/A'|'10-Q'|'10-Q/A'|'20-F'|'20-F/A'|'40-F'|'40-F/A';
export type SecFinancialSourceRecord={cik:number;accession:string;form:SecFinancialSourceForm;url:string;filed:string;retrievedAt:string;contentHash:string;bodyBytes:number};
const validDay=(value:string)=>{const millis=Date.parse(`${value}T00:00:00Z`);return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(millis)&&new Date(millis).toISOString().slice(0,10)===value;};
const sourceUrl=(cik:number,accession:string,url:string)=>{
 if(!Number.isSafeInteger(cik)||cik<=0||!/^\d{10}-\d{2}-\d{6}$/.test(accession))return false;
 const prefix=`https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replaceAll('-','')}/`;
 if(!url.startsWith(prefix))return false;
 const document=url.slice(prefix.length);
 return /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:htm|html|txt)$/i.test(document)&&!document.includes('..');
};
function recognizablePrimaryFiling(body:string,form:SecFinancialSourceForm){
 if(!/<(?:html|document|ix:[a-z])/i.test(body))return false;
 const head=body.slice(0,100_000).replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/\s*(?:script|style)\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/\s+/g,' ');
 const title=body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g,' ').trim()??'';
 if(/\b(?:request rate threshold exceeded|access denied|403 forbidden|404 not found|service unavailable|automated access|undeclared automated tool|temporarily unavailable)\b/i.test(title)||/\b(?:your request originates from an undeclared automated tool|request rate threshold exceeded|sec\.gov is currently unavailable)\b/i.test(head.slice(0,5_000)))return false;
 const baseForm=form.replace('/A','');
 const typeTag=body.slice(0,100_000).match(/<ix:nonNumeric\b[^>]*\bname\s*=\s*["']dei:DocumentType["'][^>]*>([\s\S]{0,100}?)<\/ix:nonNumeric>/i)?.[1]?.replace(/<[^>]*>/g,' ').trim();
 if(typeTag?.toUpperCase()===baseForm)return true;
 const formLabel=new RegExp(`\\bform\\s*${baseForm.replace('-','[\\s-]?')}\\b`,'i');
 return formLabel.test(head)&&/\b(?:securities and exchange commission|annual report|quarterly report|registration statement)\b/i.test(head);
}
let schema:Promise<unknown>|undefined;
const db=()=>(env as any).DB;
export async function secFinancialSourceCapacityAvailable(now=Date.now()){
 if(!(env as any).RAILWAY_VOLUME_MOUNT_PATH)return true;
 try{
  const row=await db().prepare('SELECT retrieved_at,payload FROM raw_cache WHERE key=?').bind('runtime:storage-capacity').first() as any;
  const measured=Date.parse(row?.retrieved_at),capacity=JSON.parse(row?.payload??'null');
  return Number.isFinite(measured)&&now>=measured&&now-measured<=5*60_000&&Number.isSafeInteger(capacity?.filesystemFreeBytes)&&capacity.filesystemFreeBytes>=512*1024*1024;
 }catch{return false;}
}
async function ready(){
 if(!db())throw Error('SEC filing source archive database unavailable');
 schema??=db().prepare('CREATE TABLE IF NOT EXISTS sec_financial_filing_sources (cik INTEGER NOT NULL,accession TEXT NOT NULL,form TEXT NOT NULL,url TEXT NOT NULL,filed TEXT NOT NULL,retrieved_at TEXT NOT NULL,content_hash TEXT NOT NULL,body_bytes INTEGER NOT NULL,body_gzip BLOB NOT NULL,PRIMARY KEY(accession,content_hash))').run().catch((error:unknown)=>{schema=undefined;throw error;});
 await schema;
}
export async function persistSecFinancialSource(input:{cik:number;accession:string;form:SecFinancialSourceForm;url:string;filed:string;retrievedAt:string;body:string}):Promise<SecFinancialSourceRecord>{
 if(!sourceUrl(input.cik,input.accession,input.url)||!['10-K','10-K/A','10-Q','10-Q/A','20-F','20-F/A','40-F','40-F/A'].includes(input.form)||!validDay(input.filed)||!Number.isFinite(Date.parse(input.retrievedAt))||Date.parse(`${input.filed}T00:00:00Z`)>Date.parse(input.retrievedAt))throw Error('SEC filing source identity or chronology mismatch');
 const encoded=new TextEncoder().encode(input.body);
 if(!encoded.byteLength||encoded.byteLength>SEC_FINANCIAL_SOURCE_MAX_BYTES)throw Error('SEC filing source exceeds bounded archive size');
 if(!recognizablePrimaryFiling(input.body,input.form))throw Error('SEC filing source is not a recognizable primary filing document');
 const hashBytes=new Uint8Array(await crypto.subtle.digest('SHA-256',encoded));
 const contentHash=[...hashBytes].map(value=>value.toString(16).padStart(2,'0')).join('');
 const compressed=new Uint8Array(await new Response(new Blob([encoded]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 if(compressed.byteLength>SEC_FINANCIAL_SOURCE_MAX_BYTES)throw Error('SEC filing source exceeds bounded archive size');
 if(!await secFinancialSourceCapacityAvailable())throw Error('SEC filing source archive paused for physical volume capacity');
 await ready();
 const record={cik:input.cik,accession:input.accession,form:input.form,url:input.url,filed:input.filed,retrievedAt:input.retrievedAt,contentHash,bodyBytes:encoded.byteLength};
 await db().prepare('INSERT OR IGNORE INTO sec_financial_filing_sources(cik,accession,form,url,filed,retrieved_at,content_hash,body_bytes,body_gzip) VALUES(?,?,?,?,?,?,?,?,?)').bind(input.cik,input.accession,input.form,input.url,input.filed,input.retrievedAt,contentHash,encoded.byteLength,compressed).run();
 // This archive is intentionally small even when many profiles are opened.
 await db().prepare('DELETE FROM sec_financial_filing_sources WHERE rowid IN (SELECT rowid FROM (SELECT rowid,SUM(length(body_gzip)) OVER(ORDER BY retrieved_at DESC,rowid DESC) AS used FROM sec_financial_filing_sources) WHERE used>?)').bind(ARCHIVE_MAX_BYTES).run();
 return record;
}
export async function readSecFinancialSource(accession:string,contentHash:string):Promise<{record:SecFinancialSourceRecord;body:string}|null>{
 if(!/^\d{10}-\d{2}-\d{6}$/.test(accession)||! /^[a-f0-9]{64}$/.test(contentHash))return null;
 await ready();
 const row=await db().prepare('SELECT cik,accession,form,url,filed,retrieved_at,content_hash,body_bytes,body_gzip FROM sec_financial_filing_sources WHERE accession=? AND content_hash=?').bind(accession,contentHash).first() as any;
 if(!row)return null;
 try{
  const bytes=row.body_gzip instanceof Uint8Array?row.body_gzip:new Uint8Array(row.body_gzip);
  const body=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const encoded=new TextEncoder().encode(body);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',encoded));
  const hash=[...digest].map(value=>value.toString(16).padStart(2,'0')).join('');
  if(hash!==contentHash||encoded.byteLength!==row.body_bytes||!sourceUrl(row.cik,row.accession,row.url))throw Error('SEC filing source checksum or identity mismatch');
  return {record:{cik:row.cik,accession:row.accession,form:row.form,url:row.url,filed:row.filed,retrievedAt:row.retrieved_at,contentHash:row.content_hash,bodyBytes:row.body_bytes},body};
 }catch{await db().prepare('DELETE FROM sec_financial_filing_sources WHERE accession=? AND content_hash=?').bind(accession,contentHash).run();return null;}
}
