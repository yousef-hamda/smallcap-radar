import {companyBySymbol,intradayMarketData} from '@/lib/providers';
import {db,ensureSchema} from '@/lib/storage';
import {json} from '@/lib/http';

export async function GET(request:Request){
 try{
  const symbol=new URL(request.url).searchParams.get('symbol')?.trim().toUpperCase()??'';
  if(!/^[A-Z0-9.^-]{1,16}$/.test(symbol))return json({error:'رمز السهم غير صالح'},400);
  await ensureSchema();
  if(!companyBySymbol(symbol)&&!await db().prepare('SELECT 1 AS found FROM fundamental_snapshots WHERE symbol=? LIMIT 1').bind(symbol).first())return json({error:'الشركة غير موجودة في الدليل'},404);
  const key=`chart:v1:${symbol}:1D`,cached=await db().prepare('SELECT retrieved_at,payload FROM raw_cache WHERE key=?').bind(key).first() as any;
  if(cached&&Date.now()-Date.parse(cached.retrieved_at)<5*60_000)return json({...JSON.parse(cached.payload),cached:true});
  const chart=await intradayMarketData(symbol);
  await db().prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(key,chart.source,new Date().toISOString(),JSON.stringify(chart)).run();
  return json({...chart,cached:false});
 }catch(error){return json({error:error instanceof Error?error.message:'تعذّر جلب الرسم اللحظي'},503)}
}
