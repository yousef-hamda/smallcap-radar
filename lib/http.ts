export function sameOrigin(request:Request){const origin=request.headers.get('origin');if(!origin||origin!==new URL(request.url).origin)throw Object.assign(new Error('طلب غير موثوق'),{status:403});}
export function json(payload:unknown,status=200){return Response.json(payload,{status,headers:{'Cache-Control':'no-store'}})}
export async function body(request:Request){const length=Number(request.headers.get('content-length')||0);if(length>4_000_000)throw Error('الملف كبير جدًا');const raw=await request.text();if(raw.length>4_000_000)throw Error('الملف كبير جدًا');return JSON.parse(raw);}
