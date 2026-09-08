import {readState,db,createRun,insertSnapshot,ensureSchema} from '@/lib/storage';
import {sameOrigin,json,body} from '@/lib/http';
import {importSchema} from '@/lib/validation';
import {visitor} from '@/lib/visitor';

export async function GET(req:Request){
 try {
  const url=new URL(req.url), identity=visitor(req);
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
    const cached=row||await db().prepare('SELECT payload FROM raw_cache WHERE key=?').bind('deep:v3:'+b.symbol).first() as any;
    if(!cached)return json({error:'افتح ملف الشركة أولًا للحصول على لقطة موثقة.'},404);
    const snapshot=JSON.parse(cached.payload);delete snapshot.history;
    await db().prepare('INSERT INTO personal_watchlist(owner,symbol,created_at,payload) VALUES(?,?,?,?) ON CONFLICT(owner,symbol) DO UPDATE SET payload=excluded.payload').bind(identity.owner,b.symbol,new Date().toISOString(),JSON.stringify(snapshot)).run();
   }
   const response=json({favorites:(await readState({owner:identity.owner})).favorites});
   if(identity.cookie)response.headers.set('Set-Cookie',identity.cookie);
   return response;
  }
  if(b.action==='import'){
   const parsed=importSchema.safeParse(b.records);
   if(!parsed.success)return json({error:'ملف غير صالح: '+parsed.error.issues.slice(0,3).map(i=>i.path.join('.')+': '+i.message).join('؛ ')},400);
   const id=await createRun('import',parsed.data.length);
   try{
    for(const snapshot of parsed.data)await insertSnapshot(id,snapshot as any).run();
    await db().prepare("UPDATE strategy_runs SET status='complete',processed=total,offset=total,stage=13,updated_at=? WHERE id=?").bind(new Date().toISOString(),id).run();return json({runId:id});
   }catch(e){await db().prepare("UPDATE strategy_runs SET status='failed',error=?,updated_at=? WHERE id=?").bind(String(e).slice(0,500),new Date().toISOString(),id).run();throw Error('تعذّر حفظ الاستيراد؛ لم تتغير النتائج السابقة')}
  }
  return json({error:'عملية غير معروفة'},400);
 }catch(e:any){return json({error:e.message||'تعذّر تنفيذ الطلب'},e.status||400)}
}
