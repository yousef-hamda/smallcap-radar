import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { persistCompanyFactsCheckpoint } from '../scripts/company-facts-sync-state.mjs';

test('sync facts are durably written before a checkpoint can advance the resume cursor', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-facts-checkpoint-'));
  const outputPath = path.join(directory, 'facts.json');
  const checkpointPath = path.join(directory, 'checkpoint.json');
  await fs.mkdir(checkpointPath);
  try {
    const output = { fundamentals: { 123: { revenue: { val: 10 } } } };
    const checkpoint = { state: { index: 40 } };
    await assert.rejects(persistCompanyFactsCheckpoint(outputPath, checkpointPath, output, checkpoint));
    const persistedOutput = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    assert.equal(persistedOutput.fundamentals[123].revenue.val, 10);
    await assert.rejects(fs.readFile(path.join(checkpointPath, 'index')), { code: 'ENOENT' });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
