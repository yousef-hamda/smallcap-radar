import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runLab} from '../research/weight-lab.mjs';

test('weight lab blocks insufficient data instead of publishing invented weights',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-lab-')),input=path.join(dir,'bounce.jsonl');
 await fs.writeFile(input,JSON.stringify({symbol:'A',asOf:'2024-01-01',features:{collapse:1,reversal:1,liquidity:1,dilution:1,offLow:1,size:1},availableAt:{collapse:'2024-01-01'},safety:{tradable:'PASS',conflict:'PASS',criticalData:'PASS'},outcome:{label:1,observedAt:'2024-05-01'}})+'\n');
 const result=await runLab({strategy:'bounce',input});assert.equal(result.status,'BLOCKED');assert(result.blockers.some(x=>x.includes('rows')));assert.equal(result.weights.reduce((sum,row)=>sum+row.weight,0),100);
});

test('weight lab rejects future evidence and duplicate observations',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-lab-')),input=path.join(dir,'core.jsonl');
 const row={symbol:'A',asOf:'2024-01-01',features:{valuation:.5,quality:.5,shareDiscipline:.5,sizeCoverage:.5,growth:.5,insider:.5,marginTrend:.5,entry:.5,balance:.5},availableAt:{valuation:'2025-01-01'},safety:{tradable:'PASS',conflict:'PASS',criticalData:'PASS'},outcome:{label:0,observedAt:'2025-01-01'}};
 await fs.writeFile(input,[row,row].map(JSON.stringify).join('\n'));
 const result=await runLab({strategy:'core',input});assert(result.blockers.some(x=>x.includes('duplicate')));assert(result.blockers.some(x=>x.includes('future evidence')));
});

test('weight lab keeps exact 100-point normalization and deterministic learned output',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-lab-')),input=path.join(dir,'bounce.jsonl');
 const rows=[];
 for(let month=0;month<12;month++) for(let company=0;company<8;company++){
  const asOf=new Date(Date.UTC(2023,month,1)).toISOString().slice(0,10);
  const collapse=company%4/3, reversal=(month%3)/2, label=collapse>.5?1:0;
  rows.push({symbol:'S'+company,asOf,features:{collapse,reversal,liquidity:.8,dilution:.7,offLow:.6,size:.5},availableAt:{collapse:asOf,reversal:asOf,liquidity:asOf,dilution:asOf,offLow:asOf,size:asOf},safety:{tradable:'PASS',conflict:'PASS',criticalData:'PASS'},outcome:{label,netUtility:label ? .2 : -.15,observedAt:new Date(Date.UTC(2023,month,25)).toISOString().slice(0,10)}});
 }
 await fs.writeFile(input,rows.map(JSON.stringify).join('\n'));
 const first=await runLab({strategy:'bounce',input}),second=await runLab({strategy:'bounce',input});
 assert.equal(first.datasetHash,second.datasetHash);assert.deepEqual(first.weights,second.weights);assert.equal(first.weightBasisPointsTotal,10000);assert.equal(first.weights.reduce((sum,row)=>sum+row.weight,0),100);
 assert.equal(first.metrics.test.auc,1);
});

test('unknown and failed safety states never enter the learning sample',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-lab-')),input=path.join(dir,'bounce.jsonl');
 const base={symbol:'A',asOf:'2024-01-01',features:{collapse:.5,reversal:.5,liquidity:.5,dilution:.5,offLow:.5,size:.5},availableAt:{collapse:'2024-01-01'},outcome:{label:1,observedAt:'2024-02-01'}};
 await fs.writeFile(input,[{...base,safety:{tradable:'PASS',conflict:'PASS',criticalData:'PASS'}},{...base,symbol:'B',safety:{tradable:'PASS',conflict:'PASS',criticalData:'UNKNOWN'}},{...base,symbol:'C',safety:{tradable:'FAIL',conflict:'PASS',criticalData:'PASS'}}].map(JSON.stringify).join('\n'));
 const result=await runLab({strategy:'bounce',input});assert.equal(result.counts.validRows,1);assert.equal(result.counts.excludedRows,2);assert(result.blockers.some(x=>x.includes('valid rows 1')));
});

test('firm holdout identity is stable across ticker aliases',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-lab-')),input=path.join(dir,'bounce.jsonl');
 const row=(symbol,asOf,label)=>({symbol,firmId:'CIK-42',asOf,features:{collapse:.5,reversal:.5,liquidity:.5,dilution:.5,offLow:.5,size:.5},availableAt:{collapse:asOf,reversal:asOf,liquidity:asOf,dilution:asOf,offLow:asOf,size:asOf},safety:{tradable:'PASS',conflict:'PASS',criticalData:'PASS'},outcome:{label,observedAt:'2025-01-01'}});
 await fs.writeFile(input,[row('OLD','2023-01-01',1),row('NEW','2023-02-01',0)].map(JSON.stringify).join('\n'));
 const result=await runLab({strategy:'bounce',input});
 assert(result.blockers.some(x=>x.includes('firm holdout AUC')||x.includes('one or more chronological')));
 assert.equal(result.counts.firms,1);assert.equal(result.protocol.holdout.includes('firm identity'),true);
});
