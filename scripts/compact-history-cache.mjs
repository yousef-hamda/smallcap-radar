/** Build and verify a lossless compact SQLite copy outside the production
 * volume. This script never edits its source or installs the result. */
import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';

const [sourcePath,workingPath,finalPath]=process.argv.slice(2);
if(!sourcePath||!workingPath||!finalPath||new Set([sourcePath,workingPath,finalPath]).size!==3||[workingPath,finalPath].some(existsSync)||workingPath.startsWith('/app/data/')||finalPath.startsWith('/app/data/')){
 throw Error('Usage: compact-history-cache.mjs SOURCE.sqlite NEW-WORKING.sqlite NEW-FINAL.sqlite (outputs outside /app/data)');
}
const marker='radar-history-gzip-v1';
const original=new DatabaseSync(sourcePath,{readOnly:true});
assert.equal(original.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
await backup(original,workingPath,{rate:1000});
const working=new DatabaseSync(workingPath);
working.exec('PRAGMA journal_mode=DELETE');
const update=working.prepare('UPDATE raw_cache SET payload=? WHERE key=?');
let converted=0,oldBytes=0,newBytes=0;
for(const row of original.prepare("SELECT key,payload FROM raw_cache WHERE key LIKE 'scan-history:v3:%' ORDER BY key").iterate()){
 let parsed;try{parsed=JSON.parse(row.payload);}catch{/* preserve malformed legacy rows exactly through compression */}
 if(parsed?.__cache===marker)continue;
 const encoded=JSON.stringify({__cache:marker,data:gzipSync(Buffer.from(row.payload),{level:1}).toString('base64')});
 if(converted%100===0)working.exec('BEGIN IMMEDIATE');
 update.run(encoded,row.key);
 if(converted%100===99)working.exec('COMMIT');
 converted++;oldBytes+=Buffer.byteLength(row.payload);newBytes+=Buffer.byteLength(encoded);
}
if(converted%100)working.exec('COMMIT');
working.prepare('VACUUM INTO ?').run(finalPath);
working.close();
const compact=new DatabaseSync(finalPath,{readOnly:true});
assert.equal(compact.prepare('PRAGMA integrity_check').get().integrity_check,'ok');

function tableDigest(database,table){
 const rowDigests=[];
 for(const row of database.prepare(`SELECT * FROM "${table.replaceAll('"','""')}"`).iterate()){
  const digest=createHash('sha256');
  for(const [key,value] of Object.entries(row)){
   const bytes=value===null?Buffer.alloc(0):Buffer.isBuffer(value)||value instanceof Uint8Array?Buffer.from(value):Buffer.from(String(value));
   digest.update(key);digest.update(':');digest.update(value===null?'null':typeof value);digest.update(':');digest.update(String(bytes.length));digest.update(':');digest.update(bytes);
  }
  rowDigests.push(digest.digest('hex'));
 }
 rowDigests.sort();
 const digest=createHash('sha256');for(const rowDigest of rowDigests)digest.update(rowDigest);
 return {count:rowDigests.length,sha256:digest.digest('hex')};
}
const tables=original.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'raw_cache' ORDER BY name").all().map(row=>row.name);
const protectedTables={};
for(const table of tables){
 const before=tableDigest(original,table),after=tableDigest(compact,table);
 assert.deepEqual(after,before,`Protected table changed: ${table}`);
 protectedTables[table]=before.count;
}
const sourceRows=original.prepare('SELECT key,source,retrieved_at,payload FROM raw_cache ORDER BY key').iterate();
const finalRows=compact.prepare('SELECT key,source,retrieved_at,payload FROM raw_cache ORDER BY key').iterate();
function logicalPayload(payload){
 let parsed;try{parsed=JSON.parse(payload);}catch{return payload;}
 return parsed?.__cache===marker?gunzipSync(Buffer.from(parsed.data,'base64')).toString():payload;
}
let cacheRows=0;
for(;;){
 const before=sourceRows.next(),after=finalRows.next();
 assert.equal(before.done,after.done,'raw_cache row count changed');
 if(before.done)break;
 const expected=before.value,actual=after.value;
 assert.equal(actual.key,expected.key);
 assert.equal(actual.source,expected.source);
 assert.equal(actual.retrieved_at,expected.retrieved_at);
 assert.equal(logicalPayload(actual.payload),logicalPayload(expected.payload),`Cache changed: ${expected.key}`);
 cacheRows++;
}
const size=compact.prepare('PRAGMA page_count').get().page_count*compact.prepare('PRAGMA page_size').get().page_size;
const manifest={converted,oldBytes,newBytes,savedPayloadBytes:oldBytes-newBytes,finalBytes:size,cacheRows,protectedTables,integrity:'ok',parity:'exact'};
compact.close();original.close();
console.log(JSON.stringify(manifest));
