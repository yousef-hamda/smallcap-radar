/** Run inside the service, then download the backup to private/off-volume storage.
 * Never copy the live WAL database with a plain filesystem copy. */
import {DatabaseSync,backup} from 'node:sqlite';
import {createReadStream,existsSync,writeFileSync,statSync,chmodSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [sourcePath,destination]=process.argv.slice(2);
if(!sourcePath||!destination||sourcePath===destination||existsSync(destination))throw Error('Usage: backup-production.mjs source.sqlite NEW-backup.sqlite');
const source=new DatabaseSync(sourcePath,{readOnly:true});
const tables=['strategy_runs','fundamental_snapshots','opportunity_rankings','personal_watchlist','portfolio_transactions','radar_accounts','radar_sessions','recovery_bundles'];
source.exec('BEGIN');
const expected={};for(const table of tables)if(source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))expected[table]=source.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
await backup(source,destination,{rate:1000});chmodSync(destination,0o600);
const restored=new DatabaseSync(destination,{readOnly:true});
assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
const counts={};
for(const table of tables){if(!restored.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;counts[table]=restored.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;assert.equal(counts[table],expected[table],table);}
const digest=createHash('sha256');for await(const chunk of createReadStream(destination))digest.update(chunk);
const manifest={createdAt:new Date().toISOString(),bytes:statSync(destination).size,sha256:digest.digest('hex'),integrity:'ok',counts};
writeFileSync(`${destination}.manifest.json`,JSON.stringify(manifest,null,2),{mode:0o600});
source.close();restored.close();console.log(JSON.stringify(manifest));
