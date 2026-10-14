/** Lossless, versioned storage for durable chart history. Plain JSON rows from
 * earlier releases stay readable while new scan rows use much less disk. */
const marker='radar-history-gzip-v1';

function toBase64(bytes:Uint8Array){
 let binary='';
 for(let offset=0;offset<bytes.length;offset+=32_768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32_768));
 return btoa(binary);
}

function fromBase64(encoded:string){
 const binary=atob(encoded),bytes=new Uint8Array(binary.length);
 for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
 return bytes;
}

export async function encodeHistoryCache(value:unknown):Promise<string>{
 const text=JSON.stringify(value);
 const buffer=await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
 return JSON.stringify({__cache:marker,data:toBase64(new Uint8Array(buffer))});
}

export async function decodeHistoryCache(payload:string):Promise<unknown>{
 const value=JSON.parse(payload);
 if(value?.__cache!==marker)return value;
 if(typeof value.data!=='string')throw Error('Compressed history cache is malformed');
 const bytes=fromBase64(value.data);
 const text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
 return JSON.parse(text);
}
