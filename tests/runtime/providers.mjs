export let historyCalls=0;
let historyResult=null;
export function setHistoryResult(value){historyResult=value;}
export async function historicalMarketData(){historyCalls++;if(historyResult)return historyResult;throw Error('Injected provider outage');}
export async function companySnapshot(){throw Error('No provider configured in isolated test');}
let opportunityResult={providerStatus:'retrieved',retryable:false};
export let opportunityCalls=0;
export const resetOpportunityCalls=()=>{opportunityCalls=0;};
export const setOpportunityResearchResult=value=>{opportunityResult=value;};
export async function enrichSnapshotsWithSecOpportunity(snapshots){opportunityCalls++;if(opportunityResult instanceof Error)return {providerStatus:'unavailable',retryable:true,requests:2,error:opportunityResult.message};for(const snapshot of snapshots)snapshot.opportunityResearch={earnings:{providerStatus:opportunityResult.providerStatus,coverage:{annualPeriodsFound:0,quarterlyPeriodsFound:0,selectedUnit:'USD'},annual:[],quarterly:[],missing:['Synthetic runtime provider fixture'],conflicts:[],limitations:[],readyForScoring:false},financialStrength:{providerStatus:opportunityResult.providerStatus,metrics:{},missing:['Synthetic runtime provider fixture'],conflicts:[],limitations:[],readyForScoring:false}};return {...opportunityResult,requests:2};}
export async function enrichSnapshotWithSecOpportunity(snapshot){return enrichSnapshotsWithSecOpportunity([snapshot]);}
export const consumeProviderIssues=()=>[];
export const quickSymbols=[];
export let universeCalls=0;
let companies=[];
export const setUniverse=value=>{companies=value;};
export const universe=async()=>{universeCalls++;return companies;};
export const yahooBulkQuotes=async rows=>rows;
let intradayResult={points:[{t:1,c:10},{t:2,c:11}],baseline:9,changePct:2/9,baselineLabel:'TEST',source:'TEST_ONLY',availableAt:'2026-09-08T00:00:00Z'};
export const setIntradayResult=value=>{intradayResult=value;};
export const companyBySymbol=symbol=>symbol==='TEST'?{ticker:'TEST',name:'Synthetic chart company',cik:99,exchange:'Nasdaq'}:null;
export const resolveCompanyBySymbol=async symbol=>companyBySymbol(symbol);
export const searchCompanies=query=>String(query).toUpperCase().includes('TEST')?[companyBySymbol('TEST')]:[];
export async function searchListedCompanies(query){return searchCompanies(query);}
export async function intradayMarketData(){if(intradayResult instanceof Error)throw intradayResult;return intradayResult;}
