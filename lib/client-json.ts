export async function apiJson<T>(url:string,options?:RequestInit):Promise<T>{
 const response=await fetch(url,{cache:'no-store',...options});
 const raw=await response.text();
 let payload:any=null;
 const contentType=response.headers.get('content-type')||'';
 try{payload=raw?JSON.parse(raw):null}catch{
  const html=contentType.includes('text/html')||/^\s*<!doctype html/i.test(raw);
  throw Error(html
   ? `مسار الخادم أعاد صفحة HTML بدل JSON (${response.status}). أعد نشر النسخة أو أعد المحاولة بعد تحديث الصفحة.`
   : `الخادم أعاد استجابة غير صالحة (${response.status}). أعد المحاولة؛ وإذا تكرر الخطأ فالمسار غير منشور بصورة صحيحة.`);
 }
 if(!response.ok)throw Error(payload?.error||`تعذّر الاتصال بالخادم (${response.status})`);
 if(payload==null||typeof payload!=='object')throw Error('استجابة الخادم فارغة أو غير صالحة.');
 return payload as T;
}
