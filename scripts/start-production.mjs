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
  await delay(15_000);
  while(!stopped) {
   try {
    const response=await fetch(`http://127.0.0.1:${process.env.PORT||4173}/__radar-scheduled`,{method:'POST',headers:{'X-Radar-Background':process.env.BACKGROUND_SCAN_SECRET},signal:AbortSignal.timeout(150_000)});
    if(!response.ok)console.error(`[scheduler] tick HTTP ${response.status}`);
   }catch(error){console.error('[scheduler] tick failed',error instanceof Error?error.name:'UnknownError');}
   await delay(2000);
  }
 })();
}
