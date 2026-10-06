import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {readStorageCapacity} from '../scripts/storage-capacity.mjs';
test('native storage capacity includes reusable SQLite pages without modifying application rows',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'radar-capacity-'));
 try{
  const directory=path.join(root,'state/v3/d1/miniflare-D1DatabaseObject');fs.mkdirSync(directory,{recursive:true});
  const d=new DatabaseSync(path.join(directory,'application.sqlite'));d.exec('CREATE TABLE source(payload TEXT);CREATE TABLE favorites(symbol TEXT);INSERT INTO favorites VALUES(\'SYNTH\')');
  const insert=d.prepare('INSERT INTO source VALUES(?)');for(let i=0;i<100;i++)insert.run('synthetic'.repeat(1000));d.exec('DELETE FROM source');d.close();
  const capacity=readStorageCapacity(root);assert(capacity.reusableBytes>0);assert(capacity.filesystemFreeBytes>0);
  const restored=new DatabaseSync(path.join(directory,'application.sqlite'),{readOnly:true});assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM favorites').get().n,1);restored.close();
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('new volumes report filesystem capacity before SQLite creation',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'radar-capacity-new-'));try{const result=readStorageCapacity(root);assert.equal(result.reusableBytes,0);assert(result.filesystemFreeBytes>0);}finally{fs.rmSync(root,{recursive:true,force:true});}});
test('unconfigured local runtime has no implied production volume',()=>{assert.equal(readStorageCapacity(undefined),null);});
