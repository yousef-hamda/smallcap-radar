import type {Snapshot,Provenance} from './engine';
import {SPECS} from './engine';
import {ma30Weeks} from './research';
import {observations,latestInstant,trailingAnnual,provenance,REVENUE_TAGS} from './sec';
const userAgent='SmallCapRadar/2.0 (research; github.com/yousef-hamda)';
export async function fetchJson(url:string){const r=await fetch(url,{headers:{'User-Agent':userAgent,Accept:'application/json'},signal:AbortSignal.timeout(18000)});if(!r.ok)throw Error(`${new URL(url).hostname}: HTTP ${r.status}`);return r.json();}
export async function universe(){const j:any=await fetchJson('https://www.sec.gov/files/company_tickers_exchange.json');const fields=j.fields;return j.data.map((r:any[])=>Object.fromEntries(fields.map((f:string,i:number)=>[f,r[i]]))).filter((r:any)=>['Nasdaq','NYSE','NYSE American'].includes(r.exchange)&&/^[A-Z0-9.-]{1,12}$/.test(r.ticker));}
export async function companySnapshot(company:any):Promise<Snapshot>{
 const now=new Date().toISOString(),symbol=company.ticker,cik=String(company.cik).padStart(10,'0'),url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d&events=splits`;
 const j:any=await fetchJson(url),result=j.chart?.result?.[0];if(!result)throw Error(`${symbol}: quote unavailable`);const meta=result.meta,q=result.indicators?.quote?.[0],timestamps=result.timestamp||[];
 const history=timestamps.map((t:number,i:number)=>({date:new Date(t*1000).toISOString().slice(0,10),close:q?.close?.[i],open:q?.open?.[i],high:q?.high?.[i],low:q?.low?.[i],volume:q?.volume?.[i]})).filter((r:any)=>r.close>0&&r.low>0);
 const quoteTime=new Date(meta.regularMarketTime*1000).toISOString();const quoteEvidence:Provenance={source:'Yahoo chart (experimental)',url,periodEnd:quoteTime.slice(0,10),availableAt:quoteTime,retrievedAt:now,currency:meta.currency,confidence:'medium'};
 const s:Snapshot={symbol,name:company.name,asOf:now,exchange:company.exchange,securityType:meta.instrumentType==='EQUITY'&&!/preferred|warrant|depositary.*share|fund|trust|\betf\b/i.test(company.name)?'common':'unknown',price:meta.currency==='USD'?meta.regularMarketPrice:null,confidence:'F',deathSpiral:'unknown',provenance:{price:quoteEvidence},history};
 if(meta.currency!=='USD')return s;
 const dv=history.slice(-20).map((r:any)=>r.close*r.volume).filter(Number.isFinite).sort((a:number,b:number)=>a-b);if(dv.length===20){s.medianDollarVolume20d=(dv[9]+dv[10])/2;s.provenance.medianDollarVolume20d=quoteEvidence;}
 const yearStart=Date.parse(quoteTime)-365*864e5,year=history.filter((r:any)=>Date.parse(r.date)>=yearStart),prior=history.filter((r:any)=>Date.parse(r.date)<=yearStart).at(-1);
 if(prior&&Date.parse(prior.date)>=yearStart-7*864e5&&s.price){s.return12m=s.price/prior.close-1;s.provenance.return12m=quoteEvidence;}
 if(year.length>=240){s.low52w=Math.min(...year.map((r:any)=>r.low));s.provenance.low52w=quoteEvidence;}
 s.ma30w=ma30Weeks(history,now);if(s.ma30w)s.provenance.ma30w=quoteEvidence;
 const factsUrl=`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;const facts:any=await fetchJson(factsUrl);const f=facts.facts;
 const shares=latestInstant(observations(f,['EntityCommonStockSharesOutstanding','CommonStockSharesOutstanding'],'shares'),now);
 // A filing share count is historical; mark cap estimate and do not silently treat as current verified market cap.
 if(shares&&s.price&&Date.parse(now)-Date.parse(shares.end)<120*864e5&&!Object.values(result.events?.splits||{}).some((split:any)=>split.date*1000>Date.parse(shares.end))){s.marketCap=shares.val*s.price;s.provenance.marketCap={...provenance(shares,factsUrl,now),source:'Derived: SEC reported shares × Yahoo price',availableAt:[provenance(shares,factsUrl,now).availableAt,quoteEvidence.availableAt].sort().at(-1)!,confidence:'low'};}
 if(s.marketCap!=null&&(s.marketCap<SPECS.core.marketCap.min||s.marketCap>SPECS.core.marketCap.max))return s;
 for(const [key,tags] of Object.entries({revenue:REVENUE_TAGS,netIncome:['NetIncomeLoss','ProfitLoss'],ocf:['NetCashProvidedByUsedInOperatingActivities'],capex:['PaymentsToAcquirePropertyPlantAndEquipment']})){
 const annual=trailingAnnual(observations(f,tags),now);if(annual){(s as any)[key]=annual.val;s.provenance[key]=provenance(annual,factsUrl,now);if(['20-F','40-F'].includes(annual.form))s.foreignFiler=true;}
 }
 const ocf=(s as any).ocf,capex=(s as any).capex;if(ocf!=null&&capex!=null&&s.provenance.ocf.periodEnd===s.provenance.capex.periodEnd){s.fcf=ocf-capex;s.provenance.fcf={...s.provenance.ocf,tag:'OperatingCashFlow − PaymentsToAcquirePropertyPlantAndEquipment',availableAt:[s.provenance.ocf.availableAt,s.provenance.capex.availableAt].sort().at(-1)!};}
 // EV and split-corrected dilution stay missing until a reliable debt/current-share feed is configured.
 if(s.marketCap&&s.revenue&&s.revenue>0){s.ps=s.marketCap/s.revenue;s.provenance.ps={...s.provenance.revenue,source:'Derived: estimated market cap / SEC revenue',availableAt:[s.provenance.marketCap.availableAt,s.provenance.revenue.availableAt].sort().at(-1)!,confidence:'low'}}
 s.confidence='C';s.research={financials:!!s.revenue,valuation:false,analysts:false,sector:false};delete (s as any).ocf;delete (s as any).capex;return s;
}
