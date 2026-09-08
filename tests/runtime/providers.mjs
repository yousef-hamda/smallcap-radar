export let historyCalls=0;
export async function historicalMarketData(){historyCalls++;throw Error('Injected provider outage');}
export async function companySnapshot(){throw Error('No provider configured in isolated test');}
export const consumeProviderIssues=()=>[];
export const quickSymbols=[];
export const universe=async()=>[];
