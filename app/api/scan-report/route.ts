import {db,ensureSchema} from '@/lib/storage';
import {json} from '@/lib/http';
import {evaluateOpportunity} from '@/lib/opportunity-engine';
import {OPPORTUNITY_SPEC,opportunitySpecHash} from '@/lib/opportunity-spec';

export async function GET(req:Request){
 try{
  const params=new URL(req.url).searchParams;
  const runId=params.get('runId'),requestedStrategy=params.get('strategy');
  const offset=Number(params.get('offset')??0),limit=25;
  if(!runId||runId.length>100||(requestedStrategy!=null&&requestedStrategy!=='opportunity')||!Number.isSafeInteger(offset)||offset<0)return json({error:'معرّف الجولة أو الفئة أو الصفحة غير صالح'},400);
  const strategy='opportunity';
  await ensureSchema();const database=db();
  const run=await database.prepare('SELECT id,status,stage,created_at,updated_at,failed,error FROM strategy_runs WHERE id=?').bind(runId).first();
  if(!run)return json({error:'الجولة غير موجودة'},404);
  {
   const counts=await database.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN json_extract(evaluation,'$.opportunity.state')='ranked' AND json_extract(evaluation,'$.opportunity.hash')=? THEN 1 ELSE 0 END) AS passed,
    SUM(CASE WHEN json_extract(evaluation,'$.opportunity.state')='excluded' AND json_extract(evaluation,'$.opportunity.hash')=? THEN 1 ELSE 0 END) AS failed
    FROM fundamental_snapshots WHERE run_id=?`).bind(opportunitySpecHash(),opportunitySpecHash(),runId).first() as any;
   const total=Number(counts?.total||0),passed=Number(counts?.passed||0),failed=Number(counts?.failed||0);
   const missingRows=(await database.prepare(`SELECT json_extract(f.value,'$.id') AS id,
    SUM(CASE WHEN json_extract(f.value,'$.evidenced')=1 THEN 0 ELSE 1 END) AS count
    FROM fundamental_snapshots s,json_each(s.evaluation,'$.opportunity.factors') f WHERE s.run_id=?
    GROUP BY json_extract(f.value,'$.id')`).bind(runId).all()).results as any[];
   const missingById=new Map(missingRows.map(row=>[String(row.id),Number(row.count||0)]));
   const blockers=OPPORTUNITY_SPEC.factors.map(factor=>({id:factor.id,label:factor.label,status:'UNKNOWN' as const,count:Math.max(0,missingById.get(factor.id)??total)})).filter(blocker=>blocker.count>0);
   const rows=(await database.prepare('SELECT symbol,payload,evaluation FROM fundamental_snapshots WHERE run_id=? ORDER BY symbol LIMIT ? OFFSET ?').bind(runId,limit+1,offset).all()).results as any[];
   return json({run,strategy,counts:{total,passed,failed,unknown:Math.max(0,total-passed-failed)},blockers,rows:rows.slice(0,limit).map(row=>{const snapshot=JSON.parse(row.payload),saved=JSON.parse(row.evaluation).opportunity;const evaluation=saved?.hash===opportunitySpecHash()?saved:evaluateOpportunity(snapshot,{});return {symbol:row.symbol,name:snapshot.name,asOf:snapshot.asOf,evaluation};}),page:{offset,limit,hasMore:rows.length>limit}});
  }
 }catch{return json({error:'تعذّر تحميل تقرير الجولة المحفوظة؛ حاول مجددًا'},503);}
}
