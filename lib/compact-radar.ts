import type {Snapshot} from './engine';
import type {OpportunityEvaluation} from './opportunity-engine';
import {operatingCandidateSignals} from './opportunity-candidates';

/** Keep the canonical grade, hash, factors, ranks and source flags. Full research
 * stays in the pinned profile/export; cards do not need repeated filing histories. */
export function compactRadarSnapshot(snapshot:Snapshot) {
 const result={...snapshot,operatingSignals:operatingCandidateSignals(snapshot)};
 delete result.peerContext;delete result.opportunityResearch;delete result.history;delete result.news;delete result.insiderPurchases;
 result.provenance=Object.fromEntries(Object.entries(snapshot.provenance).filter(([key])=>['price','dailyChange','securityType','exchange','revenue','netIncome','fcf','cash','debt','dilution'].includes(key)).map(([key,value])=>[key,{...value,dependencies:undefined}]));
 return result;
}
export function compactRadarEvaluation(evaluation:OpportunityEvaluation):OpportunityEvaluation {
 return {...evaluation,factors:evaluation.factors.map(factor=>({...factor,sources:[],calculation:factor.calculation?{...factor.calculation,inputs:[{name:'canonical calculation',value:evaluation.evaluationHash}]}:undefined})),thesis:{...evaluation.thesis,valuation:{...evaluation.thesis.valuation,sources:[]},catalysts:[]}};
}
