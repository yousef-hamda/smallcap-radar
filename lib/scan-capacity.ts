import {env} from 'cloudflare:workers';
import {db} from './storage';
export const MIN_SCAN_FILESYSTEM_BYTES=256*1024*1024;
const key='runtime:storage-capacity';
/** Only the secret-protected native scheduler supplies actual filesystem capacity.
 * Reusable SQLite pages do not provide space for its WAL or shared-memory file. */
export async function recordScanCapacity(capacity:{reusableBytes:number;filesystemFreeBytes:number},now=Date.now()) {
 await db().prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(key,'native storage capacity',new Date(now).toISOString(),JSON.stringify(capacity)).run();
}
export async function scanCapacityPaused(now=Date.now()) {
 if(!(env as any).RAILWAY_VOLUME_MOUNT_PATH)return false;
 const row=await db().prepare('SELECT retrieved_at,payload FROM raw_cache WHERE key=?').bind(key).first() as any;
 if(!row)return true;
 const age=now-Date.parse(row.retrieved_at);
 try{const capacity=JSON.parse(row.payload);return !Number.isFinite(age)||age<0||age>5*60_000||!Number.isSafeInteger(capacity.filesystemFreeBytes)||capacity.filesystemFreeBytes<MIN_SCAN_FILESYSTEM_BYTES;}
 catch{return true;}
}
