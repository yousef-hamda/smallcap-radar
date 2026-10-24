/** Small process-local cache for display-only provider responses. */
export function createEphemeralCache<T>(ttlMs:number,maxEntries:number,now:()=>number=Date.now){
 const entries=new Map<string,{expiresAt:number;value:Promise<T>}>();
 return {
  has(key:string){const cached=entries.get(key);return !!cached&&cached.expiresAt>now()},
  get(key:string,load:()=>Promise<T>):Promise<T>{
   const cached=entries.get(key);
   if(cached&&cached.expiresAt>now())return cached.value;
   if(cached)entries.delete(key);
   const value=Promise.resolve().then(load);
   entries.set(key,{expiresAt:now()+ttlMs,value});
   while(entries.size>maxEntries)entries.delete(entries.keys().next().value!);
   void value.catch(()=>{if(entries.get(key)?.value===value)entries.delete(key)});
   return value;
  }
 };
}
