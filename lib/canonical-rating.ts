import type {Snapshot} from './engine';
import type {OpportunityEvaluation} from './opportunity-engine';
const ids=['valuation','catalysts','financialStrength','earningsQuality','competitivePosition','downsideRisk','management','technicalTiming'];
const weights=[25,20,15,12,10,10,5,3];
/** Browser rendering trusts the published fixed-weight contract, not the bundle's
 * local rubric version. It never recalculates compact cards with missing facts. */
export function canonicalRating(snapshot:Snapshot,value:unknown):OpportunityEvaluation {
 const evaluation=value as OpportunityEvaluation|undefined;
 if(!evaluation||evaluation.asOf!==snapshot.asOf||evaluation.state!=='ranked'||evaluation.rankingEligible!==true||!evaluation.hash||!evaluation.evaluationHash?.startsWith(evaluation.hash+':')||!evaluation.snapshotHash||!Array.isArray(evaluation.factors)||evaluation.factors.length!==8)throw Error('التقييم النهائي المحفوظ غير متاح أو غير متطابق؛ حدّث النتائج.');
 let numerator=0;
 for(const [index,factor]of evaluation.factors.entries()){
  if(factor.id!==ids[index]||factor.weight!==weights[index]||!Number.isFinite(factor.points)||!Number.isFinite(factor.score)||factor.score<0||factor.score>10||Math.abs(factor.points-factor.score*factor.weight/10)>1e-8)throw Error('قيم عوامل التقييم غير متطابقة؛ حدّث النتائج.');
  numerator+=Math.round(factor.score*100)*factor.weight;
 }
 if(!Number.isFinite(evaluation.score)||evaluation.score!==Math.round(numerator/10)/100)throw Error('الدرجة النهائية لا تطابق عواملها؛ حدّث النتائج.');
 return evaluation;
}
