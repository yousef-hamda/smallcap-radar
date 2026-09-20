const SECURITY_HEADERS:Record<string,string>={
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'strict-origin-when-cross-origin',
 'X-Frame-Options':'DENY',
 'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
};

export function httpError(status:number,message:string){return Object.assign(new Error(message),{status});}
export function statusOf(error:unknown,fallback=500){const status=Number((error as {status?:unknown}|null)?.status);return Number.isInteger(status)&&status>=400&&status<=599?status:fallback;}
export function sameOrigin(request:Request){
 const origin=request.headers.get('origin');
 if(!origin||origin!==new URL(request.url).origin)throw httpError(403,'طلب غير موثوق');
}
export function secureResponse(response:Response){
 const headers=new Headers(response.headers);
 for(const [name,value] of Object.entries(SECURITY_HEADERS))if(!headers.has(name))headers.set(name,value);
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
export function json(payload:unknown,status=200){
 const headers=new Headers({'Cache-Control':'no-store'});
 for(const [name,value] of Object.entries(SECURITY_HEADERS))headers.set(name,value);
 return Response.json(payload,{status,headers});
}
export async function body(request:Request,maxBytes=4_000_000){
 const declared=request.headers.get('content-length');
 if(declared!=null&&!/^\d+$/.test(declared))throw httpError(400,'حجم الطلب غير صالح');
 if(declared!=null&&Number(declared)>maxBytes)throw httpError(413,'الطلب أكبر من الحد المسموح');
 const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let total=0;
 if(reader){
  while(true){const {done,value}=await reader.read();if(done)break;if(!value)continue;total+=value.byteLength;if(total>maxBytes){await reader.cancel();throw httpError(413,'الطلب أكبر من الحد المسموح');}chunks.push(value);}
 }
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let raw:string;
 try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw httpError(400,'ترميز الطلب غير صالح');}
 if(!raw.trim())throw httpError(400,'جسم الطلب فارغ');
 try{return JSON.parse(raw);}catch{throw httpError(400,'بيانات JSON غير صالحة');}
}
