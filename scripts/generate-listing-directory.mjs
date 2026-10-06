import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {stripTypeScriptTypes} from 'node:module';
const parser=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(fs.readFileSync(new URL('../lib/directory.ts',import.meta.url),'utf8'))).toString('base64'));
const urls=['https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt','https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'];
const files=await Promise.all(urls.map(async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Official directory download failed');return response.text();}));
if(!parser.completeDirectoryFiles(...files))throw Error('Official directory download is incomplete');
let sec={},secSource=null;
try{const response=await fetch('https://www.sec.gov/files/company_tickers.json',{headers:{...(process.env.SEC_USER_AGENT?{'User-Agent':process.env.SEC_USER_AGENT}:{}),Accept:'application/json'},signal:AbortSignal.timeout(15000)});if(response.ok){sec=await response.json();secSource={url:'https://www.sec.gov/files/company_tickers.json',contentHash:createHash('sha256').update(JSON.stringify(sec)).digest('hex')};}}catch{/* Missing CIK mappings remain zero. */}
const rows=parser.parseOfficialDirectory(...files,sec),retrievedAt=new Date().toISOString(),value={retrievedAt,rows,rowsHash:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),sources:urls.map((url,index)=>({url,contentHash:createHash('sha256').update(files[index]).digest('hex'),creationTime:files[index].split(/\r?\n/).find(line=>line.startsWith('File Creation Time:'))})),secSource};
if(!rows.length)throw Error('Official inventory is empty');
fs.writeFileSync(new URL('../lib/listing-directory.generated.json',import.meta.url),JSON.stringify(value));
fs.writeFileSync(new URL('../lib/listing-directory-sources.generated.json',import.meta.url),JSON.stringify({retrievedAt,sources:value.sources,files:files.map(body=>gzipSync(Buffer.from(body)).toString('base64'))}));
fs.mkdirSync('.verification',{recursive:true});files.forEach((body,index)=>fs.writeFileSync('.verification/official-directory-'+index+'.txt',body));
console.log(JSON.stringify({total:rows.length,cikMapped:rows.filter(row=>row.cik>0).length,retrievedAt,rowsHash:value.rowsHash,sourceHashes:value.sources.map(source=>source.contentHash)}));
