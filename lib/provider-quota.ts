import {env} from 'cloudflare:workers';
const db=()=>{const value=(env as any).DB;if(!value)throw Error('Provider quota database unavailable');return value;};
let ready:Promise<unknown>|undefined;
/** A database reservation coordinates all isolates/processes using this deployment. */
export async function reserveProviderRequest(provider:string,intervalMs:number,now=Date.now()) {
 ready??=db().prepare('CREATE TABLE IF NOT EXISTS provider_request_slots (provider TEXT PRIMARY KEY,next_at INTEGER NOT NULL)').run().catch((error:unknown)=>{ready=undefined;throw error;});
 await ready;
 const row=await db().prepare('INSERT INTO provider_request_slots(provider,next_at) VALUES(?,?) ON CONFLICT(provider) DO UPDATE SET next_at=MAX(provider_request_slots.next_at,?)+? RETURNING next_at').bind(provider,now+intervalMs,now,intervalMs).first() as any;
 return Math.max(0,Number(row.next_at)-intervalMs-now);
}
