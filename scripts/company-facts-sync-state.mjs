import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export async function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value)}\n`);
  await fs.rename(temporaryPath, filePath);
}

/** Persist merged facts before advancing the resumable cursor. If interrupted
 * between the two atomic renames, the prior cursor repeats work instead of
 * skipping facts that were only held in memory. */
export async function persistCompanyFactsCheckpoint(outputPath, checkpointPath, output, checkpoint) {
  await atomicWriteJson(outputPath, output);
  await atomicWriteJson(checkpointPath, checkpoint);
}
