import type {Status} from '@/lib/engine';
export const money=(n:number|null|undefined)=>n==null||!Number.isFinite(n)?'غير متاح':new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(n);
export const price=(n:number|null|undefined)=>n==null||!Number.isFinite(n)?'—':`$${n.toFixed(2)}`;
export const percent=(n:number|null|undefined)=>n==null||!Number.isFinite(n)?'غير متاح':`${n>=0?'+':''}${(n*100).toFixed(2)}%`;
export const day=(n?:string|null)=>n?n.slice(0,10):'غير متاح';
export const statusText:Record<Status,string>={PASS:'اجتاز',FAIL:'لم يجتز',UNKNOWN:'غير مثبت'};
export const mark:Record<Status,string>={PASS:'✓',FAIL:'✕',UNKNOWN:'~'};
export const checkLabel:Record<string,string>={security:'الإدراج',cap:'الحجم',liquidity:'السيولة',collapse:'عمق الهبوط',low:'خرج من القاع',dilution:'لا تخفيف حاد',reversal:'انعكاس مؤكد',revenue:'قاعدة الإيراد',valuation:'التقييم',profitability:'الربحية أو التدفق الحر',deathSpiral:'لا دوامة تمويل',provenance:'المصادر والتوقيت',freshness:'حداثة السعر',filingFreshness:'حداثة الفترة المالية',conflict:'توافق المصادر'};
