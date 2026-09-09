export async function apiJson<T>(url:string,options?:RequestInit):Promise<T>{
 const response=await fetch(url,options);
 const raw=await response.text();
 let payload:any=null;
 try{payload=raw?JSON.parse(raw):null}catch{
  throw Error(`الخادم أعاد استجابة غير صالحة (${response.status}). أعد المحاولة؛ وإذا تكرر الخطأ فالمسار غير منشور بصورة صحيحة.`);
 }
 if(!response.ok)throw Error(payload?.error||`تعذّر الاتصال بالخادم (${response.status})`);
 if(payload==null||typeof payload!=='object')throw Error('استجابة الخادم فارغة أو غير صالحة.');
 return payload as T;
}
