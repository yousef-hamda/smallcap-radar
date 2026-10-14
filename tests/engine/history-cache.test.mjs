import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeHistoryCache,decodeHistoryCache} from '../../.test-build/history-cache.mjs';

test('compressed history survives a lossless round trip and older JSON remains readable',async()=>{
 const history={source:'history',url:'https://example.invalid/history',retrievedAt:'2026-10-15T00:00:00Z',availableAt:'2026-10-14T21:00:00Z',history:Array.from({length:550},(_,index)=>({date:new Date(Date.UTC(2024,0,index+1)).toISOString().slice(0,10),close:3.41+index/100,volume:12500+index}))};
 const encoded=await encodeHistoryCache(history);
 assert.deepEqual(await decodeHistoryCache(encoded),history);
 assert.deepEqual(await decodeHistoryCache(JSON.stringify(history)),history);
 assert.ok(Buffer.byteLength(encoded)<Buffer.byteLength(JSON.stringify(history))/2);
 await assert.rejects(decodeHistoryCache(JSON.stringify({__cache:'radar-history-gzip-v1',data:'%%%'})));
});
