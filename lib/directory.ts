export type DirectoryCompany={cik:number;name:string;ticker:string;exchange:string};
type SecTicker={cik_str?:number;ticker?:string;title?:string};
const valid=/^[A-Z][A-Z0-9.^-]{0,15}$/;

export function parseOfficialDirectory(nasdaqText:string,otherText:string,secPayload:Record<string,SecTicker>):DirectoryCompany[]{
 const sec=new Map<string,{cik:number;title:string}>();
 for(const row of Object.values(secPayload||{}))if(row?.ticker){
  const value={cik:Number(row.cik_str)||0,title:String(row.title||'')},ticker=String(row.ticker).toUpperCase();
  sec.set(ticker,value);
  // Nasdaq and SEC use different punctuation for some share classes.
  sec.set(ticker.replaceAll('-','.'),value);
 }
 const result=new Map<string,DirectoryCompany>();
 const add=(ticker:string,name:string,exchange:string,test:string,etf:string)=>{
  ticker=ticker.trim().toUpperCase();name=name.trim();
  if(!valid.test(ticker)||!name||test==='Y'||etf==='Y')return;
  const filing=sec.get(ticker);result.set(ticker,{ticker,name:filing?.title||name,exchange,cik:filing?.cik||0});
 };
 for(const line of nasdaqText.split(/\r?\n/).slice(1)){const c=line.split('|');if(c.length>=8)add(c[0],c[1],'Nasdaq',c[3],c[6]);}
 const exchanges:Record<string,string>={N:'NYSE',A:'NYSE American'};
 for(const line of otherText.split(/\r?\n/).slice(1)){const c=line.split('|'),exchange=exchanges[c[2]];if(exchange&&c.length>=7)add(c[0],c[1],exchange,c[6],c[4]);}
 return [...result.values()].sort((a,b)=>a.ticker.localeCompare(b.ticker));
}
