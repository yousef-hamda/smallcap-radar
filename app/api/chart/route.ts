import {companyBySymbol,intradayMarketData} from '@/lib/providers';
import {db,ensureSchema} from '@/lib/storage';
import {createEphemeralCache} from '@/lib/ephemeral-cache';
import {json} from '@/lib/http';

const chartCache=createEphemeralCache<Awaited<ReturnType<typeof intradayMarketData>>>(5*60_000,64);

export async function GET(request:Request){
 try{
  const symbol=new URL(request.url).searchParams.get('symbol')?.trim().toUpperCase()??'';
  if(!/^[A-Z0-9.^-]{1,16}$/.test(symbol))return json({error:'رمز السهم غير صالح'},400);
  await ensureSchema();
  if(!companyBySymbol(symbol)&&!await db().prepare('SELECT 1 AS found FROM fundamental_snapshots WHERE symbol=? LIMIT 1').bind(symbol).first())return json({error:'الشركة غير موجودة في الدليل'},404);
  const cached=chartCache.has(symbol),chart=await chartCache.get(symbol,()=>intradayMarketData(symbol));
  return json({...chart,cached});
 }catch(error){return json({error:error instanceof Error?error.message:'تعذّر جلب الرسم اللحظي'},503)}
}
