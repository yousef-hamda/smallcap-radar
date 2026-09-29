import { completedSessionQuote } from '@/lib/research';
import { historicalMarketData } from '@/lib/providers';
import { db, ensureSchema } from '@/lib/storage';
import { json } from '@/lib/http';

const SYMBOL=/^[A-Z][A-Z0-9.^-]{0,15}$/;
const CACHE_TTL=5*60_000;
const placeholders=(count:number)=>Array.from({length:count},()=>'?').join(',');

function evidence(result:Awaited<ReturnType<typeof historicalMarketData>>,periodEnd:string){
 const availableAt=`${periodEnd}T21:00:00.000Z`;
 return {source:result.source,url:result.url,periodEnd,availableAt:availableAt>new Date().toISOString()?new Date().toISOString():availableAt,retrievedAt:result.retrievedAt,currency:'USD',confidence:result.source.includes('fallback')?'low':'medium' as const};
}

export async function GET(request:Request){
 try{
  await ensureSchema();
  const raw=new URL(request.url).searchParams.get('symbols')||'';
  const symbols=[...new Set(raw.split(',').map(symbol=>symbol.trim().toUpperCase()).filter(symbol=>SYMBOL.test(symbol)))].slice(0,80);
  if(!symbols.length)return json({quotes:{},errors:[]});
  const now=Date.now(),quotes=new Map<string,any>(),keys=symbols.map(symbol=>`favorite-quote:v1:${symbol}`);
  const cached=(await db().prepare(`SELECT key,retrieved_at,payload FROM raw_cache WHERE key IN (${placeholders(keys.length)})`).bind(...keys).all()).results as any[];
  for(const row of cached){if(now-Date.parse(String(row.retrieved_at))>CACHE_TTL)continue;try{const quote=JSON.parse(String(row.payload));if(quote?.symbol&&Number.isFinite(quote.price)&&Number.isFinite(quote.dailyChange))quotes.set(String(quote.symbol),quote)}catch{/* ignore malformed cache */}}
  const missing=symbols.filter(symbol=>!quotes.has(symbol)),errors:string[]=[];
  for(let start=0;start<missing.length;start+=6){
   const batch=await Promise.all(missing.slice(start,start+6).map(async symbol=>{
    try{
     const result=await historicalMarketData(symbol,new Date().toISOString(),60),session=completedSessionQuote(result.history);
     if(!session)throw Error('لا تتوفر جلستان مكتملتان');
     const source=evidence(result,session.periodEnd),quote={symbol,price:session.price,dailyChange:session.dailyChange,periodEnd:session.periodEnd,provenance:{price:{...source,tag:'last completed session close'},dailyChange:{...source,tag:'last completed close / previous completed close - 1'}}};
     return {quote,write:db().prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(`favorite-quote:v1:${symbol}`,result.source,new Date().toISOString(),JSON.stringify(quote))};
    }catch(error){return {error:`${symbol}: ${error instanceof Error?error.message:'تعذّر تحديث السعر'}`};}
   }));
   const writes=batch.filter((item):item is {quote:any;write:any}=>'quote'in item);
   for(const item of writes)quotes.set(item.quote.symbol,item.quote);
   if(writes.length)await db().batch(writes.map(item=>item.write));
   errors.push(...batch.filter((item):item is {error:string}=>'error'in item).map(item=>item.error));
  }
  return json({quotes:Object.fromEntries(quotes),errors});
 }catch(error){return json({error:error instanceof Error?error.message:'تعذّر تحديث أسعار المفضلة'},503)}
}
