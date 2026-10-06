import {refreshListingDirectory} from './sync-listing-directory.mjs';
import {readStorageCapacity} from './storage-capacity.mjs';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview'],{stdio:'inherit',env:{...process.env,CLOUDFLARE_INCLUDE_PROCESS_ENV:'true',WRANGLER_LOG_PATH:'.wrangler/wrangler.log'}});
let stopped=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopped=true;child.kill(signal);});
child.on('exit',(code)=>{stopped=true;process.exit(code??1);});
// Local development has no scheduler unless explicitly enabled. Production runs
// unattended; its secret never appears in URLs, process arguments or logs.
if(process.env.RAILWAY_VOLUME_MOUNT_PATH||process.env.RADAR_SCHEDULER_ENABLED==='1') {
 if(!process.env.BACKGROUND_SCAN_SECRET)console.error('[scheduler] disabled: BACKGROUND_SCAN_SECRET is missing');
 else void (async()=>{
  await delay(15_000);let lastLoggedAt=0,lastPhase='',directoryCheckedAt=0;
  while(!stopped) {
   try {
    if(Date.now()-directoryCheckedAt>60_000){try{const inventory=await refreshListingDirectory();console.log('[directory]',JSON.stringify(inventory));directoryCheckedAt=Date.now()+(inventory.skipped?0:3540_000);}catch(error){console.error('[directory] refresh failed',error instanceof Error?error.name:'UnknownError');directoryCheckedAt=Date.now();}}
    let capacity=null;try{capacity=readStorageCapacity(process.env.RAILWAY_VOLUME_MOUNT_PATH);}catch(error){console.error('[scheduler] capacity inspection failed',error instanceof Error?error.name:'UnknownError');}
    const capacityHeaders=capacity?{'X-Radar-Reusable-Bytes':String(capacity.reusableBytes),'X-Radar-Filesystem-Free-Bytes':String(capacity.filesystemFreeBytes)}:{};
    const response=await fetch(`http://127.0.0.1:${process.env.PORT||4173}/__radar-scheduled`,{method:'POST',headers:{...capacityHeaders,'X-Radar-Background':process.env.BACKGROUND_SCAN_SECRET},signal:AbortSignal.timeout(150_000)});
    const result=await response.json();
    if(!response.ok)console.error(`[scheduler] tick HTTP ${response.status}`,String(result.error??'').replace(/https?:\/\/\S+/g,'[source URL]').slice(0,300));
    else {const phase=String(result.run?.id??'')+':'+String(result.run?.stage??'')+':'+String(result.pausedForCapacity??result.idle??'maintenance');if(phase!==lastPhase||Date.now()-lastLoggedAt>30000){console.log('[scheduler] progress',JSON.stringify({runId:result.run?.id,stage:result.run?.stage,processed:result.run?.processed,total:result.run?.total,ratingPublication:result.ratingPublication?{total:result.ratingPublication.total,offset:result.ratingPublication.offset,done:result.ratingPublication.done}:undefined,archived:result.maintenance?.archived,pausedForCapacity:result.pausedForCapacity,idle:result.idle}));lastLoggedAt=Date.now();lastPhase=phase;}}
   }catch(error){console.error('[scheduler] tick failed',error instanceof Error?error.name:'UnknownError');}
   await delay(2000);
  }
 })();
}
