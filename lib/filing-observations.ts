import {env} from 'cloudflare:workers';
export const FILING_PARSER_VERSION='filing-observations-v1';
export type FilingObservation={id:string;kind:'commercial'|'financing'|'governance'|'scheduled-event';text:string;eventDate?:string;reviewStatus:'unreviewed';scoreCredit:0};
const monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
export function parseFilingObservations(html:string,asOf:string):FilingObservation[] {
 const text=html.replace(/<(script|style|ix:header)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
 const fragments=text.split(/(?<=[.!?;])\s+/).filter(item=>item.length>=30&&item.length<=1600);
 const observations:FilingObservation[]=[];
 for(const sentence of fragments) {
  const dates=[...sentence.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})\b/g)].map(match=>`${match[3]}-${String(monthNames.indexOf(match[1])+1).padStart(2,'0')}-${match[2].padStart(2,'0')}`);
  const eventDate=dates.find(date=>new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date&&Date.parse(`${date}T23:59:59Z`)>Date.parse(asOf)&&Date.parse(`${date}T23:59:59Z`)-Date.parse(asOf)<=183*864e5);
  const kind:FilingObservation['kind']|null=/\b(?:going concern|convertible|at.the.market|credit agreement|loan|maturit|financing|liquidity)\b/i.test(sentence)?'financing':/\b(?:director|executive|compensation|related.party|audit committee|material weakness)\b/i.test(sentence)?'governance':/\b(?:backlog|performance obligations|purchase order|contract|agreement)\b/i.test(sentence)?'commercial':eventDate&&/\b(?:expects?|scheduled|plans?|launch|completion|approval|opening|begin)\b/i.test(sentence)?'scheduled-event':null;
  if(!kind)continue;
  // An excerpt establishes what the filing says. It does not establish funding,
  // binding terms, incremental economics, approval odds or unpriced upside.
  observations.push({id:`excerpt-${observations.length+1}`,kind,text:sentence.slice(0,1000),...(eventDate?{eventDate}:{}),reviewStatus:'unreviewed',scoreCredit:0});
  if(observations.length>=40)break;
 }
 return observations;
}
let schema:Promise<unknown>|undefined;
export async function persistFilingDocument(input:{cik:number;accession:string;url:string;filed:string;retrievedAt:string;body:string;asOf:string}) {
 const db=(env as any).DB;if(!db)throw Error('Filing archive database unavailable');
 schema??=db.batch([
  db.prepare('CREATE TABLE IF NOT EXISTS filing_documents (cik INTEGER NOT NULL,accession TEXT NOT NULL,content_hash TEXT NOT NULL,url TEXT NOT NULL,filed TEXT NOT NULL,retrieved_at TEXT NOT NULL,encoding TEXT NOT NULL,body BLOB NOT NULL,PRIMARY KEY(accession,content_hash))'),
  db.prepare('CREATE TABLE IF NOT EXISTS filing_observations (accession TEXT NOT NULL,content_hash TEXT NOT NULL,parser_version TEXT NOT NULL,parsed_at TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(accession,content_hash,parser_version))'),
 ]).catch((error:unknown)=>{schema=undefined;throw error;});await schema;
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input.body));
 const contentHash=[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
 const observations=parseFilingObservations(input.body,input.asOf);
 const compressed=new Uint8Array(await new Response(new Blob([input.body]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 await db.batch([
  db.prepare('INSERT OR IGNORE INTO filing_documents(cik,accession,content_hash,url,filed,retrieved_at,encoding,body) VALUES(?,?,?,?,?,?,?,?)').bind(input.cik,input.accession,contentHash,input.url,input.filed,input.retrievedAt,'gzip',compressed),
  db.prepare('INSERT OR IGNORE INTO filing_observations(accession,content_hash,parser_version,parsed_at,payload) VALUES(?,?,?,?,?)').bind(input.accession,contentHash,FILING_PARSER_VERSION,input.retrievedAt,JSON.stringify(observations)),
 ]);
 return {contentHash,parserVersion:FILING_PARSER_VERSION,observations};
}
