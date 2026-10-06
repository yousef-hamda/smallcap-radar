import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {gunzipSync} from 'node:zlib';
import {refreshListingDirectory} from '../scripts/sync-listing-directory.mjs';
test('native directory transport persists complete official membership and retains it after malformed downloads',async()=>{
 const mountPath=fs.mkdtempSync(path.join(os.tmpdir(),'radar-directory-')),folder=path.join(mountPath,'state/v3/d1/miniflare-D1DatabaseObject');fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,'test.sqlite');new DatabaseSync(file).close();
 const nasdaq='Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares\nAAA|Synthetic Common Stock|Q|N|N|100|N|N\nFile Creation Time: 1006202623:00|';
 const other='ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol\nBBB$A|Synthetic Series A Preferred Stock|F|BBBpA|N|100|N|BBB-A\nFile Creation Time: 1006202623:00|';
 const fakeFetch=async(url,options)=>{if(String(url).endsWith('/nasdaqlisted.txt')){assert.equal(options.headers.Accept,'text/plain');assert.equal(options.headers.Referer,undefined);return new Response(nasdaq);}if(String(url).endsWith('/otherlisted.txt'))return new Response(other);return Response.json({'0':{ticker:'AAA',cik_str:1,title:'Synthetic only'}});};
 try{
  assert.deepEqual(await refreshListingDirectory({mountPath,fetchImpl:fakeFetch}),{cached:false,total:2});
  const database=new DatabaseSync(file),before=database.prepare('SELECT * FROM listing_directory_cache').get(),value=JSON.parse(gunzipSync(before.body_gzip));assert.deepEqual(value.rows.map(row=>row.ticker),['AAA','BBB-A']);assert.equal(value.rows[1].exchange,'Texas Stock Exchange');assert.equal(value.rows[1].securityType,'preferred');
  assert.deepEqual(await refreshListingDirectory({mountPath,fetchImpl:()=>{throw Error('cache should suppress requests');}}),{cached:true,total:2});
  await assert.rejects(refreshListingDirectory({mountPath,fetchImpl:async()=>new Response('<html>Source challenge</html>'),force:true,allowBundledFallback:false}),/incomplete/);
  assert.deepEqual(database.prepare('SELECT * FROM listing_directory_cache').get(),before);database.close();
 }finally{fs.rmSync(mountPath,{recursive:true,force:true});}
});

test('a blocked production transport seeds the exact dated official artifact without inventing a retrieval',async()=>{
 const mountPath=fs.mkdtempSync(path.join(os.tmpdir(),'radar-directory-fallback-')),folder=path.join(mountPath,'state/v3/d1/miniflare-D1DatabaseObject');fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,'test.sqlite');new DatabaseSync(file).close();
 try{const bundled=JSON.parse(fs.readFileSync(new URL('../lib/listing-directory.generated.json',import.meta.url),'utf8'));const result=await refreshListingDirectory({mountPath,fetchImpl:async()=>new Response('<html>Source unavailable</html>')});assert.equal(result.bundled,true);assert.equal(result.total,bundled.rows.length);assert.equal(result.retrievedAt,bundled.retrievedAt);const database=new DatabaseSync(file),saved=JSON.parse(gunzipSync(database.prepare('SELECT body_gzip FROM listing_directory_cache').get().body_gzip));assert.deepEqual(saved,bundled);database.close();}
 finally{fs.rmSync(mountPath,{recursive:true,force:true});}
});
