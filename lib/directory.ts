export type ListedSecurityType='common'|'adr'|'preferred'|'warrant'|'unit'|'right'|'fund'|'debt'|'other'|'unknown';
export type DirectoryCompany={cik:number;name:string;ticker:string;exchange:string;securityType:ListedSecurityType;securityName:string;directoryUrl:string};
type SecTicker={cik_str?:number;ticker?:string;title?:string};
const valid=/^[A-Z][A-Z0-9.^-]{0,15}$/;
const NASDAQ_DIRECTORY_URL='https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
const OTHER_DIRECTORY_URL='https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';

/** Classify only security types explicitly stated by the exchange's issue name.
 * A bare issuer/company name does not establish that a ticker is common stock. */
export function classifyListedSecurity(securityName:string,etf='N'):ListedSecurityType{
 if(etf==='Y')return 'fund';
 const name=securityName.trim();
 if(!name)return 'unknown';
 if(/\b(warrant|warrants)\b/i.test(name))return 'warrant';
 if(/\b(right|rights)\b/i.test(name))return 'right';
 if(/\b(unit|units)\b/i.test(name))return 'unit';
 if(/\b(preferred|preference)\b/i.test(name))return 'preferred';
 if(/\b(debenture|note|bond)\b/i.test(name))return 'debt';
 if(/\bfund common shares of beneficial interest\b/i.test(name))return 'fund';
 if(/\b(american depositar(?:y|ies)|american depositor(?:y|ies)|depositary shares|depository shares|depositary receipts|depository receipts|ads|adrs)\b/i.test(name))return 'adr';
 if(/\b(common stock|common shares?|ordinary shares?)\b/i.test(name))return 'common';
 return 'unknown';
}

export function parseOfficialDirectory(nasdaqText:string,otherText:string,secPayload:Record<string,SecTicker>):DirectoryCompany[]{
 const sec=new Map<string,{cik:number;title:string}>();
 for(const row of Object.values(secPayload||{}))if(row?.ticker){
  const value={cik:Number(row.cik_str)||0,title:String(row.title||'')},ticker=String(row.ticker).toUpperCase();
  sec.set(ticker,value);
  // Nasdaq and SEC use different punctuation for some share classes.
  sec.set(ticker.replaceAll('-','.'),value);
 }
 const result=new Map<string,DirectoryCompany>();
 const add=(ticker:string,name:string,securityName:string,exchange:string,test:string,etf:string,directoryUrl:string)=>{
  ticker=ticker.trim().toUpperCase();name=name.trim();
  if(!valid.test(ticker)||!name||test==='Y'||etf==='Y')return;
  const filing=sec.get(ticker);result.set(ticker,{ticker,name:filing?.title||name,exchange,cik:filing?.cik||0,securityType:classifyListedSecurity(securityName,etf),securityName:securityName.trim(),directoryUrl});
 };
 for(const line of nasdaqText.split(/\r?\n/).slice(1)){const c=line.split('|');if(c.length>=8)add(c[0],c[1],c[1],'Nasdaq',c[3],c[6],NASDAQ_DIRECTORY_URL);}
 const exchanges:Record<string,string>={N:'NYSE',A:'NYSE American'};
 for(const line of otherText.split(/\r?\n/).slice(1)){const c=line.split('|'),exchange=exchanges[c[2]];if(exchange&&c.length>=7)add(c[0],c[1],c[1],exchange,c[6],c[4],OTHER_DIRECTORY_URL);}
 return [...result.values()].sort((a,b)=>a.ticker.localeCompare(b.ticker));
}
