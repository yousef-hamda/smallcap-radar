export let historyCalls=0;
let historyResult=null;
export function setHistoryResult(value){historyResult=value;}
export async function historicalMarketData(){historyCalls++;if(historyResult)return historyResult;throw Error('Injected provider outage');}
export async function companySnapshot(){throw Error('No provider configured in isolated test');}
export const consumeProviderIssues=()=>[];
export const quickSymbols=[];
export let universeCalls=0;
let companies=[];
export const setUniverse=value=>{companies=value;};
export const universe=async()=>{universeCalls++;return companies;};
