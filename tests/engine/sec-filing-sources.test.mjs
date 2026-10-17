import test from 'node:test';
import assert from 'node:assert/strict';
import {env} from '../runtime/env.mjs';
import {persistSecFinancialSource,readSecFinancialSource,SEC_FINANCIAL_SOURCE_MAX_BYTES} from '../../.test-build/sec-filing-sources.mjs';
import {fetchSecFinancialFilingSources} from '../../.test-build/providers.mjs';

const cik=1234567, accession='0001234567-26-000001';
const input={cik,accession,form:'10-K',url:`https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replaceAll('-','')}/report.htm`,filed:'2026-09-01',retrievedAt:'2026-10-01T12:00:00Z',body:'<html><body>UNITED STATES SECURITIES AND EXCHANGE COMMISSION FORM 10-K. Official annual report source copy</body></html>'};

test('annual source archive validates issuer and document identity, retains hash and allows checksum-verified reading',async()=>{
 const saved=await persistSecFinancialSource(input);
 assert.equal(saved.form,'10-K');assert.equal(saved.bodyBytes,new TextEncoder().encode(input.body).byteLength);
 assert.equal((await readSecFinancialSource(accession,saved.contentHash)).body,input.body);
 assert.equal((await persistSecFinancialSource(input)).contentHash,saved.contentHash);
 const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM sec_financial_filing_sources WHERE accession=?').bind(accession).first();assert.equal(count.n,1);
 for(const bad of [{...input,cik:cik+1},{...input,url:input.url.replace('www.sec.gov','evil.example')},{...input,url:input.url.replace('report.htm','../report.htm')},{...input,filed:'2026-02-30'},{...input,form:'8-K'},{...input,body:'x'.repeat(SEC_FINANCIAL_SOURCE_MAX_BYTES+1)}])await assert.rejects(persistSecFinancialSource(bad));
 await env.DB.prepare('UPDATE sec_financial_filing_sources SET body_bytes=? WHERE accession=?').bind(0,accession).run();
 assert.equal(await readSecFinancialSource(accession,saved.contentHash),null);
});

test('Railway archive pauses on missing, stale, or low physical capacity without writing',async()=>{
 env.RAILWAY_VOLUME_MOUNT_PATH='/app/data';
 try{
  await assert.rejects(persistSecFinancialSource(input),/paused for physical volume capacity/);
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS raw_cache(key TEXT PRIMARY KEY,source TEXT,retrieved_at TEXT,payload TEXT)').run();
  await env.DB.prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind('runtime:storage-capacity','test',new Date().toISOString(),JSON.stringify({filesystemFreeBytes:300*1024*1024})).run();
  await assert.rejects(persistSecFinancialSource(input),/paused for physical volume capacity/);
  const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM sec_financial_filing_sources WHERE accession=?').bind(accession).first();assert.equal(count.n,0);
 }finally{delete env.RAILWAY_VOLUME_MOUNT_PATH;}
});

test('on-demand annual and quarterly capture is bounded, source only, and distinguishes oversized or failed reports',async()=>{
 const oldFetch=globalThis.fetch,oldAgent=process.env.SEC_USER_AGENT;
 process.env.SEC_USER_AGENT='SmallCapRadar test (contact: test@example.com)';
 const acc2='0001234567-26-000002';
 const payload={cik,filings:{recent:{form:['10-K','10-Q','8-K'],accessionNumber:[accession,acc2,'0001234567-26-000003'],primaryDocument:['report.htm','quarter.htm','current.htm'],filingDate:['2026-09-01','2026-09-15','2026-09-20']}}};
 let requests=0;
 globalThis.fetch=async url=>{requests++;assert.match(String(url),/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1234567\//);const form=String(url).endsWith('report.htm')?'10-K':'10-Q';return new Response(`<html><body>UNITED STATES SECURITIES AND EXCHANGE COMMISSION FORM ${form}. Source only; class review remains pending.</body></html>`,{status:200,headers:{'content-type':'text/html'}});};
 try{
  const result=await fetchSecFinancialFilingSources(payload,cik,new Date().toISOString());
  assert.equal(result.providerStatus,'retrieved');assert.equal(result.items.length,2);assert.equal(requests,2);
  assert.deepEqual(result.items.map(item=>item.form),['10-K','10-Q']);
  assert.match(result.limitations.join(' '),/No score or valuation credit/);
  assert.equal((await readSecFinancialSource(acc2,result.items[1].contentHash)).body.includes('Source only'),true);
  assert.equal((await fetchSecFinancialFilingSources(payload,cik+1,new Date().toISOString())).providerStatus,'unavailable');assert.equal(requests,2);
  globalThis.fetch=async()=>{requests++;return new Response('<html><title>SEC.gov | Request Rate Threshold Exceeded</title><body>UNITED STATES SECURITIES AND EXCHANGE COMMISSION FORM 10-K. Your request originates from an undeclared automated tool.</body></html>',{status:200,headers:{'content-type':'text/html'}});};
  const blocked=await fetchSecFinancialFilingSources(payload,cik,new Date().toISOString());assert.equal(blocked.providerStatus,'partial');assert.equal(blocked.failedDocuments,2);assert.equal(blocked.items.length,0);assert.match(blocked.limitations.join(' '),/can be retried/);
  globalThis.fetch=async()=>{requests++;return new Response('x'.repeat(SEC_FINANCIAL_SOURCE_MAX_BYTES+1),{status:200});};
  const oversized=await fetchSecFinancialFilingSources(payload,cik,new Date().toISOString());assert.equal(oversized.providerStatus,'partial');assert.equal(oversized.truncatedDocuments,2);assert.equal(oversized.items.length,0);
 }finally{globalThis.fetch=oldFetch;if(oldAgent===undefined)delete process.env.SEC_USER_AGENT;else process.env.SEC_USER_AGENT=oldAgent;}
});
