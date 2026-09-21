import {readState,db,createRun,insertSnapshot,ensureSchema,currentHash} from '@/lib/storage';
import {sameOrigin,sameSecret,json,body,statusOf} from '@/lib/http';
import {importSchema} from '@/lib/validation';
import {visitor} from '@/lib/visitor';
import {env} from 'cloudflare:workers';

const tokenPattern=/^[a-f0-9]{48}$/;
async function tokenHash(token:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');}

export async function GET(req:Request){
 try {
  const url=new URL(req.url), identity=visitor(req);
  if(url.searchParams.get('status')==='1'){
   await ensureSchema();
   const row=await db().prepare('SELECT id,status,source,stage,offset,processed,total,failed,created_at,updated_at,error,lease_until,universe_total,quote_coverage,fundamental_coverage,sec_failed,sec_success,sec_requests,json_array_length(retry_queue) AS retryPending FROM strategy_runs WHERE strategy_hash=? ORDER BY created_at DESC LIMIT 1').bind(currentHash()).first();
   return json({run:row});
  }
  const strategy=url.searchParams.get('strategy'),limit=Number(url.searchParams.get('limit')||40),offset=Number(url.searchParams.get('offset')||0);
  const response=json(await readState({strategy:strategy==='core'||strategy==='favorites'?strategy:'bounce',owner:identity.owner,query:url.searchParams.get('q')||'',limit:Number.isFinite(limit)?limit:40,offset:Number.isFinite(offset)?offset:0}));
  if(identity.cookie)response.headers.set('Set-Cookie',identity.cookie);
  return response;
 }catch{return json({error:'تعذّر قراءة قاعدة البيانات'},503)}
}
export async function POST(req:Request){
 try {
  sameOrigin(req);await ensureSchema();const b=await body(req);
  if(b.action==='favorite'){
   if(typeof b.symbol!=='string'||!/^[A-Z0-9.^-]{1,16}$/.test(b.symbol)||typeof b.saved!=='boolean')return json({error:'رمز أو حالة حفظ غير صالحة'},400);
   const identity=visitor(req);
   if(!b.saved)await db().prepare('DELETE FROM personal_watchlist WHERE owner=? AND symbol=?').bind(identity.owner,b.symbol).run();
   else {
    const row=await db().prepare('SELECT payload FROM fundamental_snapshots WHERE symbol=? ORDER BY as_of DESC LIMIT 1').bind(b.symbol).first() as any;
    const cached=row
      ||await db().prepare('SELECT payload FROM raw_cache WHERE key=?').bind('deep:v5:'+b.symbol).first() as any
      ||await db().prepare('SELECT payload FROM raw_cache WHERE key=?').bind('deep:v4:'+b.symbol).first() as any;
    if(!cached)return json({error:'افتح ملف الشركة أولًا للحصول على لقطة موثقة.'},404);
    const snapshot=JSON.parse(cached.payload);delete snapshot.history;
    await db().prepare('INSERT INTO personal_watchlist(owner,symbol,created_at,payload) VALUES(?,?,?,?) ON CONFLICT(owner,symbol) DO UPDATE SET payload=excluded.payload').bind(identity.owner,b.symbol,new Date().toISOString(),JSON.stringify(snapshot)).run();
   }
   const response=json({favorites:(await db().prepare('SELECT symbol FROM personal_watchlist WHERE owner=? ORDER BY created_at DESC').bind(identity.owner).all()).results.map((row:any)=>row.symbol)});
   if(identity.cookie)response.headers.set('Set-Cookie',identity.cookie);
   return response;
  }
  if(b.action==='import'){
   const parsed=importSchema.safeParse(b.records);
   if(!parsed.success)return json({error:'ملف غير صالح: '+parsed.error.issues.slice(0,3).map(i=>i.path.join('.')+': '+i.message).join('؛ ')},400);
   const id=await createRun('import',parsed.data.length);
   try{
    for(let offset=0;offset<parsed.data.length;offset+=50)await db().batch(parsed.data.slice(offset,offset+50).map(snapshot=>insertSnapshot(id,snapshot as any)));
    await db().prepare("UPDATE strategy_runs SET status='complete',processed=total,offset=total,stage=13,updated_at=? WHERE id=?").bind(new Date().toISOString(),id).run();return json({runId:id});
   }catch(e){await db().prepare("UPDATE strategy_runs SET status='failed',error=?,updated_at=? WHERE id=?").bind(String(e).slice(0,500),new Date().toISOString(),id).run();throw Error('تعذّر حفظ الاستيراد؛ لم تتغير النتائج السابقة')}
  }
  if(b.action==='restore'){
   const secret=String((env as any).RECOVERY_SECRET||'');
   if(!secret||!sameSecret(req.headers.get('x-radar-recovery'),secret))return json({error:'غير مصرح'},401);
   const parsed=importSchema.safeParse(b.records);
   if(!parsed.success)return json({error:'دفعة الاستعادة غير صالحة: '+parsed.error.issues.slice(0,3).map(i=>i.path.join('.')+': '+i.message).join('؛ ')},400);
   let id=typeof b.runId==='string'&&/^[0-9a-f-]{36}$/i.test(b.runId)?b.runId:'';
   if(id){const run=await db().prepare("SELECT id FROM strategy_runs WHERE id=? AND source='recovered backup' AND (status='running' OR (status='complete' AND ?=1))").bind(id,b.final===true?1:0).first();if(!run)return json({error:'جلسة الاستعادة غير صالحة'},409);}
   else id=await createRun('recovered backup',0,[],'running');
   for(let offset=0;offset<parsed.data.length;offset+=50)await db().batch(parsed.data.slice(offset,offset+50).map(snapshot=>insertSnapshot(id,snapshot as any)));
   const count=Number((await db().prepare('SELECT COUNT(*) AS count FROM fundamental_snapshots WHERE run_id=?').bind(id).first() as any)?.count||0),final=b.final===true;
   if(final){
    const symbols=Array.isArray(b.favoriteSymbols)?[...new Set(b.favoriteSymbols.filter((value:unknown)=>typeof value==='string'&&/^[A-Z0-9.^-]{1,16}$/.test(value)))].slice(0,100):[];
    if(typeof b.claimToken==='string'&&tokenPattern.test(b.claimToken)&&symbols.length)await db().prepare('INSERT OR REPLACE INTO recovery_bundles(id,token_hash,payload,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),await tokenHash(b.claimToken),JSON.stringify({favorites:symbols}),new Date().toISOString()).run();
   }
   await db().prepare('UPDATE strategy_runs SET total=?,processed=?,offset=?,stage=?,status=?,updated_at=? WHERE id=?').bind(count,count,count,final?13:0,final?'complete':'running',new Date().toISOString(),id).run();
   return json({runId:id,recovered:count,complete:final});
  }
  return json({error:'عملية غير معروفة'},400);
 }catch(e:any){return json({error:e.message||'تعذّر تنفيذ الطلب'},statusOf(e,500))}
}
