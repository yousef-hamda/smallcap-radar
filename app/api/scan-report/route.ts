import { requestedRankRelease } from '@/lib/rank-release';
import {db,ensureSchema,readState,ensureRunEvaluations,readResearchConflictCount} from '@/lib/storage';
import {json,statusOf} from '@/lib/http';
import {currentOpportunityEvaluation} from '@/lib/opportunity-dossier';
import {OPPORTUNITY_SPEC} from '@/lib/opportunity-spec';

export async function GET(req:Request){
 try{
  const params=new URL(req.url).searchParams;requestedRankRelease(params);
  const runId=params.get('runId'),requestedStrategy=params.get('strategy');
  const offset=Number(params.get('offset')??0),limit=25;
  if(!runId||runId.length>100||(requestedStrategy!=null&&requestedStrategy!=='opportunity')||!Number.isSafeInteger(offset)||offset<0)return json({error:'معرّف الجولة أو الفئة أو الصفحة غير صالح'},400);
  const strategy='opportunity';
  await ensureSchema();const database=db();
  const run=await database.prepare('SELECT id,status,stage,source,created_at,updated_at,failed,error FROM strategy_runs WHERE id=?').bind(runId).first();
  if(!run)return json({error:'الجولة غير موجودة'},404);
  await ensureRunEvaluations(runId);
  const researchConflictCount=await readResearchConflictCount(runId);
  const published=['complete','partial'].includes(String(run.status))&&(Number(run.stage)>=13||run.source==='import');
  const current=await readState({strategy:'opportunity',opportunityState:'all',limit,offset,...(published?{runId,releaseToken:params.get('release')||undefined}:{})});
  if(current.dataRunId===runId){
   const total=current.summary.total,passed=current.summary.opportunityRanked,failed=current.summary.opportunityExcluded;
   const incompleteById=current.summary.opportunityFactorIncomplete??{};
   const blockers:Array<{id:string;label:string;status:'FAIL'|'UNKNOWN';count:number}>=OPPORTUNITY_SPEC.factors.map(factor=>({id:factor.id,label:factor.label,status:'UNKNOWN' as const,count:Math.max(0,Number(incompleteById[factor.id]??total))})).filter(blocker=>blocker.count>0);
   const checkLabels:Record<string,string>={security:'نوع الورقة والبورصة', 'market-cap':'القيمة السوقية',liquidity:'سيولة التداول',price:'حداثة السعر','source-conflict':'تعارض المصادر','dossier-as-of':'تطابق توقيت البحث','financial-integrity':'اتساق الفترات والعملات المالية'};
   for(const[key,value]of Object.entries(current.summary.opportunityEligibilityBlockers??{}) as Array<[string,{status:'FAIL'|'UNKNOWN';role?:string;count:number}]>){
    const separator=key.lastIndexOf(':');if(separator<0)continue;const id=key.slice(0,separator),status=key.slice(separator+1);
    if(status!=='FAIL'&&status!=='UNKNOWN')continue;
    blockers.push({id:`${value.role==='evidence'?'evidence':'eligibility'}-${id}-${status.toLowerCase()}`,label:`${value.role==='evidence'?'فجوة الأدلة':'بوابة الأهلية'} · ${checkLabels[id]??id}`,status,count:Number(value.count)||0});
   }
   if(researchConflictCount)blockers.push({id:'sec-concept-conflict',label:'تعارض مفاهيم مالية من SEC يحتاج مراجعة',status:'UNKNOWN',count:researchConflictCount});
   const rows=current.snapshots.map((snapshot:any,index:number)=>({symbol:snapshot.symbol,name:snapshot.name,asOf:snapshot.asOf,rank:current.rankPositions?.[index],evaluation:currentOpportunityEvaluation(snapshot,current.storedEvaluations?.[index]?.opportunity)}));
   return json({run,release:current.release,strategy,counts:{total,passed,failed,unknown:Math.max(0,total-passed-failed),withEvidence:current.summary.opportunityWithEvidence,stale:current.summary.stale},blockers,rows,page:{offset,limit,hasMore:current.page.hasMore}});
  }
  {
   const counts=await database.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN json_extract(evaluation,'$.opportunity.state')='ranked' THEN 1 ELSE 0 END) AS passed,
    SUM(CASE WHEN json_extract(evaluation,'$.opportunity.state')='excluded' THEN 1 ELSE 0 END) AS failed,
    SUM(CASE WHEN EXISTS(SELECT 1 FROM json_each(evaluation,'$.opportunity.factors') f WHERE json_extract(f.value,'$.evidenced')=1) THEN 1 ELSE 0 END) AS withEvidence
    FROM fundamental_snapshots WHERE run_id=?`).bind(runId).first() as any;
   const total=Number(counts?.total||0),passed=Number(counts?.passed||0),failed=Number(counts?.failed||0);
   const missingRows=(await database.prepare(`SELECT json_extract(f.value,'$.id') AS id,
    SUM(CASE WHEN json_extract(f.value,'$.complete')=1 THEN 0 ELSE 1 END) AS count
    FROM fundamental_snapshots s,json_each(s.evaluation,'$.opportunity.factors') f WHERE s.run_id=?
    GROUP BY json_extract(f.value,'$.id')`).bind(runId).all()).results as any[];
   const missingById=new Map(missingRows.map(row=>[String(row.id),Number(row.count||0)]));
   const blockers:Array<{id:string;label:string;status:'FAIL'|'UNKNOWN';count:number}>=OPPORTUNITY_SPEC.factors.map(factor=>({id:factor.id,label:factor.label,status:'UNKNOWN' as const,count:Math.max(0,missingById.get(factor.id)??total)})).filter(blocker=>blocker.count>0);
   const eligibilityRows=(await database.prepare(`SELECT json_extract(c.value,'$.id') AS id,json_extract(c.value,'$.status') AS status,json_extract(c.value,'$.role') AS role,COUNT(*) AS count FROM fundamental_snapshots s,json_each(s.evaluation,'$.opportunity.checks') c WHERE s.run_id=? AND json_extract(c.value,'$.status') IN ('FAIL','UNKNOWN') GROUP BY json_extract(c.value,'$.id'),json_extract(c.value,'$.status'),json_extract(c.value,'$.role')`).bind(runId).all()).results as any[];
   const checkLabels:Record<string,string>={security:'نوع الورقة والبورصة', 'market-cap':'القيمة السوقية',liquidity:'سيولة التداول',price:'حداثة السعر','source-conflict':'تعارض المصادر','dossier-as-of':'تطابق توقيت البحث','financial-integrity':'اتساق الفترات والعملات المالية'};
   blockers.push(...eligibilityRows.map(row=>({id:`${row.role==='evidence'?'evidence':'eligibility'}-${row.id}-${String(row.status).toLowerCase()}`,label:`${row.role==='evidence'?'فجوة الأدلة':'بوابة الأهلية'} · ${checkLabels[row.id]??row.id}`,status:row.status as 'FAIL'|'UNKNOWN',count:Number(row.count)||0})));
   if(researchConflictCount)blockers.push({id:'sec-concept-conflict',label:'تعارض مفاهيم مالية من SEC يحتاج مراجعة',status:'UNKNOWN',count:researchConflictCount});
   const rows=(await database.prepare("SELECT symbol,payload,evaluation,ROW_NUMBER() OVER (ORDER BY json_extract(evaluation,'$.opportunity.score') DESC,symbol COLLATE BINARY ASC) AS rank_position FROM fundamental_snapshots WHERE run_id=? ORDER BY json_extract(evaluation,'$.opportunity.score') DESC,symbol COLLATE BINARY ASC LIMIT ? OFFSET ?").bind(runId,limit+1,offset).all()).results as any[];
   return json({run,strategy,counts:{total,passed,failed,unknown:Math.max(0,total-passed-failed),withEvidence:Number(counts?.withEvidence||0)},blockers,rows:rows.slice(0,limit).map(row=>{const snapshot=JSON.parse(row.payload),evaluation=JSON.parse(row.evaluation).opportunity??currentOpportunityEvaluation(snapshot,undefined);return {symbol:row.symbol,name:snapshot.name,asOf:snapshot.asOf,rank:Number(row.rank_position),evaluation};}),page:{offset,limit,hasMore:rows.length>limit}});
  }
 }catch(error){return json({error:statusOf(error,503)===409&&error instanceof Error?error.message:'تعذّر تحميل تقرير الجولة المحفوظة؛ حاول مجددًا'},statusOf(error,503));}
}
