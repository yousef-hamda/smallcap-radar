import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
// Use the same checked-in parser in Node and the Worker; this module has no
// runtime imports or executable input from providers.
const parser=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(fs.readFileSync(new URL('../lib/directory.ts',import.meta.url),'utf8'))).toString('base64'));
export async function refreshListingDirectory({mountPath=process.env.RAILWAY_VOLUME_MOUNT_PATH,fetchImpl=fetch,force=false,allowBundledFallback=true}={}){
 if(!mountPath)return {skipped:true};
 const directory=path.join(mountPath,'state/v3/d1/miniflare-D1DatabaseObject');if(!fs.existsSync(directory))return {skipped:true};
 const files=fs.readdirSync(directory).filter(name=>name.endsWith('.sqlite')&&name!=='metadata.sqlite').sort((a,b)=>fs.statSync(path.join(directory,b)).size-fs.statSync(path.join(directory,a)).size);if(!files.length)return {skipped:true};
 const database=new DatabaseSync(path.join(directory,files[0]));
 try{
  database.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS listing_directory_cache(id INTEGER PRIMARY KEY CHECK(id=1),content_hash TEXT NOT NULL,body_gzip BLOB NOT NULL)');
  const cached=database.prepare('SELECT content_hash,body_gzip FROM listing_directory_cache WHERE id=1').get();
  if(cached&&!force){try{const body=gunzipSync(cached.body_gzip),value=JSON.parse(body);if(createHash('sha256').update(body).digest('hex')===cached.content_hash&&Date.now()-Date.parse(value.retrievedAt)<3600_000)return {cached:true,total:value.rows.length};}catch{/* Fetch a verified replacement. */}}
  const urls=['https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt','https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'];
  let files;
  try{
   files=await Promise.all(urls.map(async url=>{const response=await fetchImpl(url,{headers:{Accept:'text/plain'},signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Official listing download failed');return response.text();}));
   if(!parser.completeDirectoryFiles(...files))throw Error('Official listing files are incomplete');
  }catch(error){
   if(!allowBundledFallback)throw error;
   if(cached){try{const body=gunzipSync(cached.body_gzip),value=JSON.parse(body);if(createHash('sha256').update(body).digest('hex')===cached.content_hash&&value.rows?.length)return {cached:true,total:value.rows.length,refreshFailed:true};}catch{/* Recover from the checked-in official artifact. */}}
   const value=JSON.parse(fs.readFileSync(new URL('../lib/listing-directory.generated.json',import.meta.url),'utf8')),
    raw=JSON.parse(fs.readFileSync(new URL('../lib/listing-directory-sources.generated.json',import.meta.url),'utf8')),
    files=raw.files.map(body=>gunzipSync(Buffer.from(body,'base64')).toString());
   if(!parser.completeDirectoryFiles(...files)||raw.retrievedAt!==value.retrievedAt||!Number.isFinite(Date.parse(value.retrievedAt))||Date.parse(value.retrievedAt)>Date.now()||createHash('sha256').update(JSON.stringify(value.rows)).digest('hex')!==value.rowsHash)throw Error('Bundled complete directory is invalid');
   files.forEach((body,index)=>{if(createHash('sha256').update(body).digest('hex')!==raw.sources[index].contentHash)throw Error('Official source checksum mismatch');});
   const parsed=parser.parseOfficialDirectory(...files,{}),bySymbol=new Map(value.rows.map(row=>[row.ticker,row]));
   if(parsed.length!==value.rows.length||parsed.some(row=>!bySymbol.has(row.ticker)||bySymbol.get(row.ticker).exchange!==row.exchange||bySymbol.get(row.ticker).securityType!==row.securityType))throw Error('Bundled inventory differs from official source files');
   const body=Buffer.from(JSON.stringify(value)),bytes=gzipSync(body);if(bytes.length>2_000_000)throw Error('Bundled inventory exceeds cache limit');
   database.prepare('INSERT OR REPLACE INTO listing_directory_cache(id,content_hash,body_gzip) VALUES(1,?,?)').run(createHash('sha256').update(body).digest('hex'),bytes);
   return {cached:false,total:value.rows.length,bundled:true,retrievedAt:value.retrievedAt};
  }
  let sec={};if(process.env.SEC_USER_AGENT)try{const response=await fetchImpl('https://www.sec.gov/files/company_tickers.json',{headers:{'User-Agent':process.env.SEC_USER_AGENT,Accept:'application/json'},signal:AbortSignal.timeout(8000)});if(response.ok)sec=await response.json();}catch{/* Optional CIK mapping never removes listings. */}
  const rows=parser.parseOfficialDirectory(...files,sec);if(!rows.length)throw Error('Official inventory has no stock listings');
  const value={retrievedAt:new Date().toISOString(),rows},body=Buffer.from(JSON.stringify(value)),bytes=gzipSync(body);if(bytes.length>2_000_000)throw Error('Official inventory exceeds cache limit');
  database.prepare('INSERT OR REPLACE INTO listing_directory_cache(id,content_hash,body_gzip) VALUES(1,?,?)').run(createHash('sha256').update(body).digest('hex'),bytes);
  return {cached:false,total:rows.length};
 }finally{database.close();}
}
