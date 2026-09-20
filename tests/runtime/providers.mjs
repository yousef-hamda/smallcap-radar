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
export const yahooBulkQuotes=async rows=>rows;
let intradayResult={points:[{t:1,c:10},{t:2,c:11}],baseline:9,changePct:2/9,baselineLabel:'TEST',source:'TEST_ONLY',availableAt:'2026-09-08T00:00:00Z'};
export const setIntradayResult=value=>{intradayResult=value;};
export const companyBySymbol=symbol=>symbol==='TEST'?{ticker:'TEST',name:'Synthetic chart company',cik:99,exchange:'Nasdaq'}:null;
export const searchCompanies=query=>String(query).toUpperCase().includes('TEST')?[companyBySymbol('TEST')]:[];
export async function intradayMarketData(){if(intradayResult instanceof Error)throw intradayResult;return intradayResult;}
