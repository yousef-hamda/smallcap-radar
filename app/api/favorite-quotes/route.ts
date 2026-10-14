import { completedSessionQuote } from '@/lib/research';
import { historicalMarketData } from '@/lib/providers';
import { createEphemeralCache } from '@/lib/ephemeral-cache';
import { json } from '@/lib/http';

const SYMBOL=/^[A-Z][A-Z0-9.^-]{0,15}$/;
const CACHE_TTL=5*60_000;

function evidence(result:Awaited<ReturnType<typeof historicalMarketData>>,periodEnd:string){
 const availableAt=`${periodEnd}T21:00:00.000Z`;
 return {source:result.source,url:result.url,periodEnd,availableAt:availableAt>new Date().toISOString()?new Date().toISOString():availableAt,retrievedAt:result.retrievedAt,currency:'USD',confidence:result.source.includes('fallback')?'low':'medium' as const};
}

async function loadQuote(symbol:string){
 const result=await historicalMarketData(symbol,new Date().toISOString(),60),session=completedSessionQuote(result.history);
 if(!session)throw Error('لا تتوفر جلستان مكتملتان');
 const source=evidence(result,session.periodEnd);
 return {symbol,price:session.price,dailyChange:session.dailyChange,periodEnd:session.periodEnd,provenance:{price:{...source,tag:'last completed session close'},dailyChange:{...source,tag:'last completed close / previous completed close - 1'}}};
}
const quoteCache=createEphemeralCache<Awaited<ReturnType<typeof loadQuote>>>(CACHE_TTL,256);

export async function GET(request:Request){
 try{
  const raw=new URL(request.url).searchParams.get('symbols')||'';
  const symbols=[...new Set(raw.split(',').map(symbol=>symbol.trim().toUpperCase()).filter(symbol=>SYMBOL.test(symbol)))].slice(0,80);
  if(!symbols.length)return json({quotes:{},errors:[]});
  const quotes:Record<string,Awaited<ReturnType<typeof loadQuote>>>={},errors:string[]=[];
  for(let start=0;start<symbols.length;start+=6){
   const batch=await Promise.all(symbols.slice(start,start+6).map(async symbol=>{
    try{return {quote:await quoteCache.get(symbol,()=>loadQuote(symbol))};}
    catch(error){return {error:`${symbol}: ${error instanceof Error?error.message:'تعذّر تحديث السعر'}`};}
   }));
   for(const item of batch){if('quote'in item&&item.quote)quotes[item.quote.symbol]=item.quote;else if('error'in item&&item.error)errors.push(item.error)}
  }
  return json({quotes,errors});
 }catch(error){return json({error:error instanceof Error?error.message:'تعذّر تحديث أسعار المفضلة'},503)}
}
