import {db,ensureSchema} from '@/lib/storage';
import {json} from '@/lib/http';

export async function GET(req:Request){
 try{
  const params=new URL(req.url).searchParams;
  const runId=params.get('runId'),strategy=params.get('strategy')??'bounce';
  const offset=Number(params.get('offset')??0),limit=25;
  if(!runId||runId.length>100||!['core','bounce'].includes(strategy)||!Number.isSafeInteger(offset)||offset<0)return json({error:'معرّف الجولة أو الاستراتيجية أو الصفحة غير صالح'},400);
  await ensureSchema();const database=db();
  const run=await database.prepare('SELECT id,status,stage,created_at,updated_at,failed,error FROM strategy_runs WHERE id=?').bind(runId).first();
  if(!run)return json({error:'الجولة غير موجودة'},404);
  const counts=await database.prepare(`SELECT COUNT(*) AS total,
   SUM(CASE WHEN json_extract(evaluation, '$.${strategy}.status')='PASS' THEN 1 ELSE 0 END) AS passed,
   SUM(CASE WHEN json_extract(evaluation, '$.${strategy}.status')='FAIL' THEN 1 ELSE 0 END) AS failed,
   SUM(CASE WHEN json_extract(evaluation, '$.${strategy}.status')='UNKNOWN' THEN 1 ELSE 0 END) AS unknown
   FROM fundamental_snapshots WHERE run_id=?`).bind(runId).first();
  const blockers=(await database.prepare(`SELECT json_extract(c.value,'$.id') AS id,json_extract(c.value,'$.label') AS label,json_extract(c.value,'$.status') AS status,COUNT(*) AS count
   FROM fundamental_snapshots s,json_each(s.evaluation,'$.${strategy}.checks') c
   WHERE s.run_id=? AND json_extract(c.value,'$.status') IN ('FAIL','UNKNOWN')
   GROUP BY json_extract(c.value,'$.id'),json_extract(c.value,'$.label'),json_extract(c.value,'$.status')
   ORDER BY count DESC,json_extract(c.value,'$.id'),json_extract(c.value,'$.status')`).bind(runId).all()).results;
  const rows=(await database.prepare('SELECT symbol,payload,evaluation FROM fundamental_snapshots WHERE run_id=? ORDER BY symbol LIMIT ? OFFSET ?').bind(runId,limit+1,offset).all()).results as any[];
  return json({run,strategy,counts,blockers,rows:rows.slice(0,limit).map(row=>{const snapshot=JSON.parse(row.payload);return {symbol:row.symbol,name:snapshot.name,asOf:snapshot.asOf,evaluation:JSON.parse(row.evaluation)[strategy]};}),page:{offset,limit,hasMore:rows.length>limit}});
 }catch{return json({error:'تعذّر تحميل تقرير الجولة المحفوظة؛ حاول مجددًا'},503);}
}
