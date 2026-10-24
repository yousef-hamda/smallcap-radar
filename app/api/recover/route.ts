import {db,ensureSchema,invalidateStateCache} from '@/lib/storage';
import {httpError,json,sameOrigin,statusOf} from '@/lib/http';
import {resolveVisitor} from '@/lib/visitor';
import {restoreArchivedRow} from '@/lib/snapshot-archive';

const tokenPattern=/^[a-f0-9]{48}$/;
async function tokenHash(token:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');}
const changes=(result:any)=>Number(result?.meta?.changes||0);

async function readForm(request:Request){
 const declared=request.headers.get('content-length');
 if(declared!=null&&(!/^\d+$/.test(declared)||Number(declared)>512))throw httpError(413,'الطلب أكبر من الحد المسموح');
 const reader=request.body?.getReader();let total=0,raw='';
 if(reader)while(true){
  const {done,value}=await reader.read();if(done)break;if(!value)continue;
  total+=value.byteLength;if(total>512){await reader.cancel();throw httpError(413,'الطلب أكبر من الحد المسموح');}
  try{raw+=new TextDecoder('utf-8',{fatal:true}).decode(value,{stream:true});}catch{throw httpError(400,'ترميز الطلب غير صالح');}
 }
 const token=new URLSearchParams(raw).get('token')||'';
 if(!tokenPattern.test(token))throw httpError(400,'رابط الاستعادة غير صالح');
 return token;
}

async function claim(request:Request,token:string){
 await ensureSchema();const hash=await tokenHash(token),bundle=await db().prepare('SELECT payload FROM recovery_bundles WHERE token_hash=? AND claimed_at IS NULL').bind(hash).first() as any;
 if(!bundle)return json({error:'رابط الاستعادة مستخدم أو منتهي'},410);
 const parsed=JSON.parse(bundle.payload),symbols=Array.isArray(parsed?.favorites)?parsed.favorites.filter((value:unknown)=>typeof value==='string'&&/^[A-Z0-9.^-]{1,16}$/.test(value)).slice(0,100):[];
 const identity=await resolveVisitor(request),now=new Date().toISOString(),writes=[];
 for(const symbol of symbols){
  const row=await db().prepare('SELECT id,payload,evaluation FROM fundamental_snapshots WHERE symbol=? ORDER BY as_of DESC LIMIT 1').bind(symbol).first() as any;
  if(row?.payload){
   const restored=await restoreArchivedRow(row);
   // Keep an existing favorite because its saved snapshot may be newer than
   // the backup's symbol-only claim bundle.
   writes.push(db().prepare('INSERT INTO personal_watchlist(owner,symbol,created_at,payload) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM recovery_bundles WHERE token_hash=? AND claimed_at IS NULL) ON CONFLICT(owner,symbol) DO NOTHING').bind(identity.owner,symbol,now,restored.payload,hash));
  }
 }
 writes.push(db().prepare('UPDATE recovery_bundles SET claimed_at=?,claimed_by=? WHERE token_hash=? AND claimed_at IS NULL').bind(now,identity.owner,hash));
 const results=await db().batch(writes),claimed=changes(results.at(-1));
 if(!claimed)return json({error:'تم استخدام رابط الاستعادة'},410);
 invalidateStateCache();
 const response=new Response(null,{status:302,headers:{Location:new URL('/',request.url).toString(),'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});if(identity.cookie)response.headers.set('Set-Cookie',identity.cookie);return response;
}

export async function GET(request:Request){
 try{
  const token=new URL(request.url).searchParams.get('token')||'';
  if(!tokenPattern.test(token))return json({error:'رابط الاستعادة غير صالح'},400);
  await ensureSchema();const bundle=await db().prepare('SELECT id FROM recovery_bundles WHERE token_hash=? AND claimed_at IS NULL').bind(await tokenHash(token)).first();
  if(!bundle)return json({error:'رابط الاستعادة مستخدم أو منتهي'},410);
  // Redemption is deliberately a user-confirmed POST. Mail scanners and link
  // previewers commonly fetch GET links automatically and must not consume it.
  const html='<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>استعادة المفضلة</title><body style="font:16px system-ui;max-width:36rem;margin:12vh auto;padding:1.5rem;color:#18212b"><h1>استعادة المفضلة</h1><p>اضغط الزر لإضافة المفضلة المحفوظة إلى هذا الجهاز.</p><form method="post" action="/api/recover"><input type="hidden" name="token" value="'+token+'"><button style="padding:.75rem 1rem;font:inherit">استعادة المفضلة</button></form></body></html>';
  return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
 }catch(error){return json({error:error instanceof Error?error.message:'تعذّر استعادة المفضلة'},statusOf(error,500));}
}

export async function POST(request:Request){
 try{sameOrigin(request);return await claim(request,await readForm(request));}
 catch(error){return json({error:error instanceof Error?error.message:'تعذّرت استعادة المفضلة'},statusOf(error,500));}
}
