import {db,ensureSchema} from '@/lib/storage';
import {json} from '@/lib/http';
import {visitor} from '@/lib/visitor';

const tokenPattern=/^[a-f0-9]{48}$/;
async function tokenHash(token:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');}
const changes=(result:any)=>Number(result?.meta?.changes||0);

export async function GET(request:Request){
 try{
  const url=new URL(request.url),token=url.searchParams.get('token')||'';
  if(!tokenPattern.test(token))return json({error:'رابط الاستعادة غير صالح'},400);
  await ensureSchema();const hash=await tokenHash(token),bundle=await db().prepare('SELECT payload FROM recovery_bundles WHERE token_hash=? AND claimed_at IS NULL').bind(hash).first() as any;
  if(!bundle)return json({error:'رابط الاستعادة مستخدم أو منتهي'},410);
  const parsed=JSON.parse(bundle.payload),symbols=Array.isArray(parsed?.favorites)?parsed.favorites.filter((value:unknown)=>typeof value==='string'&&/^[A-Z0-9.^-]{1,16}$/.test(value)).slice(0,100):[];
  const identity=visitor(request),now=new Date().toISOString(),writes=[];
  for(const symbol of symbols){
   const row=await db().prepare('SELECT payload FROM fundamental_snapshots WHERE symbol=? ORDER BY as_of DESC LIMIT 1').bind(symbol).first() as any;
   if(row?.payload)writes.push(db().prepare('INSERT INTO personal_watchlist(owner,symbol,created_at,payload) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM recovery_bundles WHERE token_hash=? AND claimed_at IS NULL) ON CONFLICT(owner,symbol) DO UPDATE SET payload=excluded.payload').bind(identity.owner,symbol,now,row.payload,hash));
  }
  writes.push(db().prepare('UPDATE recovery_bundles SET claimed_at=?,claimed_by=? WHERE token_hash=? AND claimed_at IS NULL').bind(now,identity.owner,hash));
  const results=await db().batch(writes),claimed=changes(results.at(-1));
  if(!claimed)return json({error:'تم استخدام رابط الاستعادة'},410);
  const response=new Response(null,{status:302,headers:{Location:new URL('/',request.url).toString()}});if(identity.cookie)response.headers.set('Set-Cookie',identity.cookie);return response;
 }catch{return json({error:'تعذّرت استعادة المفضلة'},500);}
}
