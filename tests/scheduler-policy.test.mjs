import test from 'node:test';
import assert from 'node:assert/strict';
import {schedulerDelay} from '../scripts/scheduler-policy.mjs';

test('idle scheduler sleeps up to five minutes until the next full scan is due',()=>{
 const now=Date.parse('2026-10-23T00:00:00Z');
 assert.equal(schedulerDelay({idle:true,nextDueAt:new Date(now+2*60_000).toISOString()},now),2*60_000);
 assert.equal(schedulerDelay({idle:true,nextDueAt:new Date(now+24*60*60_000).toISOString()},now),5*60_000);
 assert.equal(schedulerDelay({idle:true,nextDueAt:new Date(now-1).toISOString()},now),60_000);
 assert.equal(schedulerDelay({idle:true},now),5*60_000);
});

test('busy and capacity-paused scheduler work backs off, while active scans retain a short cadence',()=>{
 assert.equal(schedulerDelay({busy:true}),30_000);
 assert.equal(schedulerDelay({pausedForCapacity:true}),30_000);
 assert.equal(schedulerDelay({projectionPublication:{busy:true}}),30_000);
 assert.equal(schedulerDelay({run:{status:'running'}}),2_000);
});

test('idle archive maintenance continues at the bounded active cadence until its durable cursor is exhausted',()=>{
 assert.equal(schedulerDelay({idle:true,nextDueAt:'2026-10-24T00:00:00.000Z',maintenance:{more:true}},Date.parse('2026-10-23T00:00:00.000Z')),2_000);
 assert.equal(schedulerDelay({idle:true,nextDueAt:'2026-10-24T00:00:00.000Z',maintenance:{more:false}},Date.parse('2026-10-23T00:00:00.000Z')),5*60_000);
});
