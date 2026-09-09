export type ChartPoint={t:number;c:number};
export type ChartPayload={points:ChartPoint[];baseline:number|null;changePct:number|null;baselineLabel:string;source:string;availableAt:string};

export function parseYahooIntraday(payload:any,asOf:string):ChartPayload{
 const result=payload?.chart?.result?.[0];
 const timestamps=Array.isArray(result?.timestamp)?result.timestamp:[];
 const closes=Array.isArray(result?.indicators?.quote?.[0]?.close)?result.indicators.quote[0].close:[];
 const cutoff=Math.floor(Date.parse(asOf)/1000);
 const points:ChartPoint[]=[];
 for(let i=0;i<Math.min(timestamps.length,closes.length);i++){
  const t=Number(timestamps[i]),c=Number(closes[i]);
  if(Number.isFinite(t)&&Number.isFinite(c)&&c>0&&t<=cutoff&&(points.at(-1)?.t??-1)<t)points.push({t,c});
 }
 const previous=Number(result?.meta?.chartPreviousClose??result?.meta?.previousClose);
 const baseline=Number.isFinite(previous)&&previous>0?previous:points[0]?.c??null;
 return {points,baseline,changePct:baseline&&points.length?points.at(-1)!.c/baseline-1:null,baselineLabel:'من إغلاق الجلسة السابقة',source:'Yahoo Finance intraday chart',availableAt:asOf};
}
