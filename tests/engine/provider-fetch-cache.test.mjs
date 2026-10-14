import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalMarketData,HistoricalSessionsUnavailableError} from '../../.test-build/providers.mjs';

test('out-of-range bundled history with three no-data providers is terminal',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response('',{status:404});
 try{
  await assert.rejects(historicalMarketData('MRVI','2035-01-02T00:00:00Z',3),error=>error instanceof HistoricalSessionsUnavailableError&&error.retryable===false);
 }finally{globalThis.fetch=original;}
});

test('mixed timeout and no-data responses stay retryable',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>String(url).includes('query1.finance.yahoo.com')
  ?Promise.reject(new Error('upstream timeout'))
  :String(url).includes('query2.finance.yahoo.com')||String(url).includes('cdn.cboe.com')
   ?new Response('',{status:404})
   :new Response(JSON.stringify({data:{tradesTable:{rows:[]}}}),{status:200,headers:{'content-type':'application/json'}});
 try{
  await assert.rejects(historicalMarketData('NOT-A-QUICK-SYMBOL','2035-01-02T00:00:00Z',3),error=>!(error instanceof HistoricalSessionsUnavailableError));
 }finally{globalThis.fetch=original;}
});
