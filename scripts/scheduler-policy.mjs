const MIN_IDLE_DELAY_MS=60_000;
const MAX_IDLE_DELAY_MS=5*60_000;
const BUSY_DELAY_MS=30_000;
const ACTIVE_DELAY_MS=2_000;

/** Keep maintenance and scan leases from being polled faster than useful. */
export function schedulerDelay(result,now=Date.now()){
 if(result?.pausedForCapacity||result?.busy||result?.projectionPublication?.busy)return BUSY_DELAY_MS;
 if(result?.maintenance?.more)return ACTIVE_DELAY_MS;
 if(result?.idle){
  const remaining=Date.parse(result.nextDueAt)-now;
  return Number.isFinite(remaining)?Math.max(MIN_IDLE_DELAY_MS,Math.min(MAX_IDLE_DELAY_MS,remaining)):MAX_IDLE_DELAY_MS;
 }
 return ACTIVE_DELAY_MS;
}
