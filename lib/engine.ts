import { INVESTABLE_EXCHANGES, SPECS, specHash } from './strategy-spec';
export { SPECS, specHash } from './strategy-spec';
export type { StrategyKey } from './strategy-spec';
export type Provenance={source:string;url?:string;periodStart?:string;periodEnd:string;availableAt:string;retrievedAt:string;currency?:string;tag?:string;confidence:'high'|'medium'|'low'};
export type Snapshot={symbol:string;name:string;asOf:string;description?:string;descriptionAr?:string;sector?:string;industry?:string;employees?:number|null;securityType?:string;exchange?:string;foreignFiler?:boolean;price?:number|null;marketCap?:number|null;volume?:number|null;averageVolume10d?:number|null;medianDollarVolume20d?:number|null;revenue?:number|null;revenueGrowth?:number|null;evSales?:number|null;ps?:number|null;netIncome?:number|null;fcf?:number|null;fcfYield?:number|null;grossMargin?:number|null;operatingMarginTrend?:number|null;insiderBuyValue?:number|null;analystCount?:number|null;analystTarget?:number|null;targetMean?:number|null;targetLow?:number|null;targetHigh?:number|null;cash?:number|null;debt?:number|null;return12m?:number|null;low52w?:number|null;high52w?:number|null;ma30w?:number|null;dilution?:number|null;shareCountRatio?:number|null;splitAdjusted?:boolean;deathSpiral?:'clean'|'mild'|'elevated'|'severe'|'unknown';riskEvidence?:string;liquidityReviewed?:boolean;confidence?:'A'|'B'|'C'|'D'|'F';research?:{financials?:boolean;valuation?:boolean;analysts?:boolean;sector?:boolean};nextEarnings?:string|null;lastEarnings?:string|null;lastEarningsStatus?:'إيجابي'|'سلبي'|'مختلط'|'غير معروف';surprises?:{quarter:string;surprisePct?:number|null;actual?:number|null;estimate?:number|null}[];revenueTrend?:{quarter:string;value:number;periodEnd?:string}[];backlog?:{amount?:number|null;currency?:string;asOf?:string;stale?:boolean;source?:string}|null;news?:{title:string;link?:string;publishedAt?:string;source?:string}[];insiderPurchases?:InsiderPurchase[];sourceConflicts?:string[];dataIssues?:string[];provenance:Record<string,Provenance>;history?:{date:string;close:number;open?:number;high?:number;low?:number;volume?:number}[]};
export type InsiderPurchase={owner:string;date:string;shares:number;price:number;value:number;source?:string};
export type Status='PASS'|'FAIL'|'UNKNOWN';
export type Check={id:string;label:string;status:Status;explanation:string};
export type Factor={id:string;label:string;maxPoints:number;points:number;available:boolean;rawValue:number|null;explanation:string};
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const clamp=(n:number,min=0,max=1)=>Math.max(min,Math.min(max,n));
const scale=(value:number|null|undefined,min:number,max:number)=>finite(value)?clamp((value-min)/(max-min)):null;
function coreFactors(s:Snapshot):Factor[]{
 const valuation=(finite(s.evSales)?clamp(1-(s.evSales/SPECS.core.evSalesMax)):finite(s.ps)?clamp(1-(s.ps/SPECS.core.evSalesMax)):null);
 const quality=finite(s.netIncome)||finite(s.fcf)?((finite(s.netIncome)&&s.netIncome>0?0.5:0)+(finite(s.fcf)&&s.fcf>0?0.5:0)):null;
 const dilution=finite(s.dilution)?clamp(1-(s.dilution/SPECS.bounce.dilutionMax)):null;
 const size=finite(s.marketCap)?clamp(1-(Math.log10(Math.max(s.marketCap,SPECS.core.marketCap.min))-Math.log10(SPECS.core.marketCap.min))/(Math.log10(SPECS.core.marketCap.max)-Math.log10(SPECS.core.marketCap.min))):null;
 const growth=scale(s.revenueGrowth??null,SPECS.core.score.growthMin,SPECS.core.score.growthMax);
 const insider=finite(s.insiderBuyValue)&&finite(s.marketCap)&&s.marketCap>0?clamp(s.insiderBuyValue/s.marketCap/SPECS.core.score.insiderScale):null;
 const margin=scale(s.operatingMarginTrend??null,SPECS.core.score.marginMin,SPECS.core.score.marginMax);
 const entry=finite(s.return12m)?clamp(1-Math.abs(s.return12m-SPECS.core.score.entryAnchor)/SPECS.core.score.entryRange):null;
 const balance=finite(s.cash)&&finite(s.debt)?clamp((s.cash-s.debt)/Math.max(s.cash,s.debt,1)):null;
 const make=(id:string,label:string,maxPoints:number,n:number|null,raw:number|null|undefined,explanation:string):Factor=>({id,label,maxPoints,points:n==null?0:n*maxPoints,available:n!=null,rawValue:raw??null,explanation});
 return [
  make('valuation','التقييم',24,valuation,s.evSales??s.ps??null,finite(s.evSales)?`EV/S ${s.evSales.toFixed(2)} ضمن حد 10`:'تقييم المبيعات مستخدم لعدم توفر EV/S'),
  make('quality','الجودة والربحية',19,quality,s.netIncome??s.fcf??null,'Net Income أو FCF موجب'),
  make('shareDiscipline','انضباط الأسهم',15,dilution,s.dilution,finite(s.dilution)?`التخفيف ${(s.dilution*100).toFixed(1)}%`:'التخفيف غير متاح'),
  make('sizeCoverage','الحجم والتغطية',14,size,s.marketCap,'الحجم الأصغر يحصل على أفضلية محدودة، لا أفضلية مطلقة'),
  make('growth','النمو',7,growth,s.revenueGrowth,'نمو الإيرادات ضمن نطاق محافظ'),
  make('insider','الشراء الداخلي',7,insider,s.insiderBuyValue,'يحسب Form 4 P فقط عند توفره'),
  make('marginTrend','اتجاه الهوامش',6,margin,s.operatingMarginTrend,'تحسن هامش التشغيل'),
  make('entry','نقطة الدخول',5,entry,s.return12m,'ليس كل هبوط فرصة؛ يفضل ارتدادًا غير متطرف'),
  make('balance','الميزانية',3,balance,s.cash!=null&&s.debt!=null?s.cash-s.debt:null,'صافي النقد/الدين')
 ];
}
function legacyFactors(s:Snapshot):Factor[]{
 const valuation=finite(s.ps)?clamp(1-s.ps/SPECS.legacy.psMax):null;
 const profitability=finite(s.netIncome)||finite(s.fcf)?((finite(s.netIncome)&&s.netIncome>0?0.5:0)+(finite(s.fcf)&&s.fcf>0?0.5:0)):null;
 const momentum=finite(s.return12m)?scale(s.return12m,SPECS.legacy.momentum.min,SPECS.legacy.momentum.max):null;
 const dilution=finite(s.dilution)?clamp(1-s.dilution/SPECS.legacy.dilutionMax):null;
 const size=finite(s.marketCap)?clamp(1-(Math.log10(Math.max(s.marketCap,SPECS.legacy.marketCap.min))-Math.log10(SPECS.legacy.marketCap.min))/(Math.log10(SPECS.legacy.marketCap.max)-Math.log10(SPECS.legacy.marketCap.min))):null;
 const insider=finite(s.insiderBuyValue)&&finite(s.marketCap)&&s.marketCap>0?clamp(s.insiderBuyValue/s.marketCap/SPECS.legacy.insiderScale):null;
 const make=(id:string,label:string,maxPoints:number,n:number|null,raw:number|null|undefined,explanation:string):Factor=>({id,label,maxPoints,points:n==null?0:n*maxPoints,available:n!=null,rawValue:raw??null,explanation});
 return [
  make('valuation','التقييم',25,valuation,s.ps,'P/S ضمن الحد المرجعي 10'),
  make('profitability','الربحية / التدفق النقدي',20,profitability,s.netIncome??s.fcf,'Net Income أو FCF موجب'),
  make('momentum','الزخم',20,momentum,s.return12m,'العائد التاريخي ضمن نطاق مرجعي محافظ'),
  make('dilution','التخفيف',15,dilution,s.dilution,'التخفيف الأقل يحصل على نقاط أعلى'),
  make('size','الحجم',10,size,s.marketCap,'أفضلية الحجم الأصغر ضمن نطاق Legacy'),
  make('insider','شراء المطلعين',10,insider,s.insiderBuyValue,'Form 4 P فقط')
 ];
}
export function evaluateStrategy(strategy:keyof typeof SPECS,s:Snapshot){
 const spec=SPECS[strategy],checks:Check[]=[];
 const add=(id:string,label:string,ok:boolean|null,explanation:string)=>checks.push({id,label,status:ok==null?'UNKNOWN':ok?'PASS':'FAIL',explanation});
 const numeric=(id:string,label:string,n:unknown,test:(x:number)=>boolean,rule:string)=>add(id,label,finite(n)?test(n):null,finite(n)?`${n} · ${rule}`:'البيانات غير متاحة أو غير صالحة');
 add('security','سهم عادي مدرج في السوق الأمريكي',s.securityType&&s.exchange?s.securityType==='common'&&(INVESTABLE_EXCHANGES as readonly string[]).includes(s.exchange):null,`${s.securityType??'نوع غير معروف'} / ${s.exchange??'بورصة غير معروفة'}`);
 numeric('cap','القيمة السوقية',s.marketCap,n=>n>=spec.marketCap.min&&n<=spec.marketCap.max,`${spec.marketCap.min} ≤ cap ≤ ${spec.marketCap.max}`);
 if(strategy==='core'||strategy==='legacy'){
 const sp=SPECS[strategy];numeric('liquidity','سيولة التداول',s.medianDollarVolume20d,n=>n>=sp.liquidity,`20d median ≥ ${sp.liquidity}`);
 numeric('revenue','وجود إيرادات فعلية',s.revenue,n=>n>0,'Revenue > 0');
 if(strategy==='core')numeric('valuation','قيمة المنشأة / الإيرادات',s.evSales,n=>n<=SPECS.core.evSalesMax,'EV/S ≤ 10');else numeric('valuation','السعر / الإيرادات',s.ps,n=>n>=0&&n<=SPECS.legacy.psMax,'P/S ≤ 10');
 const positive=(finite(s.netIncome)&&s.netIncome>0)||(finite(s.fcf)&&s.fcf>0);
 add('profitability','ربحية أو تدفق نقدي موجب',positive?true:finite(s.netIncome)&&finite(s.fcf)?false:null,'NI > 0 OR FCF > 0. فرع الانعطاف غير معتمد.');
 if(strategy==='core')add('deathSpiral','مخاطر دوامة التمويل',s.deathSpiral==='severe'?false:s.deathSpiral&&s.deathSpiral!=='unknown'&&s.riskEvidence?true:null,'يتطلب مراجعة موثقة؛ حدود آلية غير معتمدة.');
 } else {
 numeric('liquidity','سيولة تداول قابلة للتنفيذ',s.medianDollarVolume20d,n=>n>=SPECS.bounce.liquidity,`20d median ≥ ${SPECS.bounce.liquidity} · حد تشغيلي قيد التحقق`);
 numeric('collapse','هبوط 12 شهرًا',s.return12m,n=>n<SPECS.bounce.returnMax,'Return < −35%');
 add('low','ابتعاد 10% عن قاع السنة',finite(s.price)&&s.price>0&&finite(s.low52w)&&s.low52w>0?s.price>=s.low52w*(1+SPECS.bounce.lowDistanceMin):null,'Price ≥ 1.10 × low52w');
 const sharesReviewed=finite(s.shareCountRatio)&&s.shareCountRatio>SPECS.bounce.shareCountRatio.minExclusive&&s.shareCountRatio<SPECS.bounce.shareCountRatio.maxExclusive;
 add('dilution','تخفيف أقل من 25% بعد مراجعة التجزئة',sharesReviewed&&finite(s.dilution)?s.dilution<SPECS.bounce.dilutionMax:null,`Dilution < ${SPECS.bounce.dilutionMax*100}%; share ratio ${SPECS.bounce.shareCountRatio.minExclusive}–${SPECS.bounce.shareCountRatio.maxExclusive} required`);
  add('reversal','انعكاس مؤكد أعلى متوسط 30 أسبوعًا',finite(s.price)&&s.price>0&&finite(s.ma30w)&&s.ma30w>0?s.price>s.ma30w*SPECS.bounce.maMultiplier:null,`Price > ${SPECS.bounce.maMultiplier} × MA30W`);
 }
 const required=strategy==='bounce'?['price','marketCap','medianDollarVolume20d','return12m','low52w','ma30w','dilution']:["price",'marketCap','medianDollarVolume20d','revenue',strategy==='core'?'evSales':'ps',...(finite(s.netIncome)&&s.netIncome>0?['netIncome']:['fcf'])];
 add('provenance','المصادر والتوقيت',required.every(k=>{const p=s.provenance[k];return p&&p.source&&p.availableAt&&p.periodEnd&&Number.isFinite(Date.parse(p.availableAt))&&Date.parse(p.availableAt)<=Date.parse(s.asOf)} )?true:null,'كل مقياس حرج يحتاج مصدرًا وتوقيت توفر لا يتجاوز وقت اللقطة.');
 const quote=s.provenance.price;add('freshness','حداثة بيانات السعر',quote&&Number.isFinite(Date.parse(quote.availableAt))?Date.parse(s.asOf)>=Date.parse(quote.availableAt)&&Date.parse(s.asOf)-Date.parse(quote.availableAt)<=SPECS.core.freshnessDays*864e5:null,`السعر الأقدم من ${SPECS.core.freshnessDays} أيام يحتاج تحديثًا؛ حد تشغيلي محافظ غير مختبر.`);
 const financial=s.provenance.revenue;if(strategy!=='bounce')add('filingFreshness','حداثة الفترة المالية',financial?Date.parse(s.asOf)-Date.parse(financial.periodEnd)<=SPECS.core.filingFreshnessDays*864e5:null,`الفترة الأقدم من ${SPECS.core.filingFreshnessDays} يومًا تحتاج مراجعة، بما فيها الإفصاحات الأجنبية.`);
 const conflictStatus=strategy==='bounce'
   ? (s.sourceConflicts?.length?false:(required.every(k=>s.provenance[k])?true:null))
   : (s.sourceConflicts?.length?false:s.confidence==='A'||s.confidence==='B'?true:s.confidence==='D'||s.confidence==='F'?false:null);
 add('conflict','تعارض المصادر',conflictStatus,s.sourceConflicts?.join('؛ ')||((strategy==='bounce'&&conflictStatus===true)?'لا يوجد تعارض في المقاييس التشغيلية الرسمية.':(s.confidence==='A'||s.confidence==='B')?'لا يوجد اختلاف جوهري بين مساري البيانات.':'التحقق من مصدرين لم يكتمل.'));
 // Keep measurable screening separate from unresolved research review. UNKNOWN
 // never becomes PASS; it remains visible as an explicit review state.
 const hardGateIds=strategy==='bounce'?['security','cap','liquidity','collapse','low','dilution','reversal']:['security','cap','liquidity','revenue','valuation','profitability','deathSpiral'];
 const measurableGateIds=hardGateIds.filter(id=>id!=='deathSpiral');
 const hardGates=checks.filter(c=>hardGateIds.includes(c.id));
 const measurableGates=checks.filter(c=>measurableGateIds.includes(c.id));
 const measurableStatus:Status=measurableGates.some(c=>c.status==='FAIL')?'FAIL':measurableGates.some(c=>c.status==='UNKNOWN')?'UNKNOWN':'PASS';
 const gateStatus:Status=hardGates.some(c=>c.status==='FAIL')?'FAIL':hardGates.some(c=>c.status==='UNKNOWN')?'UNKNOWN':'PASS';
 const screening=checks.filter(c=>c.id!=='conflict');
 const status:Status=screening.some(c=>c.status==='FAIL')?'FAIL':screening.some(c=>c.status==='UNKNOWN')?'UNKNOWN':'PASS';
 const researchComplete=['financials','valuation','analysts','sector'].every(k=>s.research?.[k as keyof NonNullable<Snapshot['research']>]===true);
 const factors=strategy==='core'?coreFactors(s):strategy==='legacy'?legacyFactors(s):[];
 // Bounce has no validated predictive ranking model in the supplied spec.
 // Expose an honest diagnostic percentage instead: equal share of the six
 // published gates, with UNKNOWN and FAIL both receiving zero. It is never
 // used to promote a stock or replace the gate result.
 const gateScore=strategy==='bounce'?Math.round(100*hardGateIds.filter(id=>checks.find(c=>c.id===id)?.status==='PASS').length/hardGateIds.length*10)/10:null;
 const score=(strategy==='core'||strategy==='legacy')&&!hardGates.some(c=>c.status==='FAIL')?Math.round(factors.reduce((total,f)=>total+f.points,0)*10)/10:null;
 const scoreCoverage=(strategy==='core'||strategy==='legacy')?Math.round(100*factors.filter(f=>f.available).reduce((t,f)=>t+f.maxPoints,0)/100):0;
 // A row is approved only when every screening check passes. Measurable-only
 // completion is retained as a diagnostic, but must never enter the approval
 // list or be presented as a recommendation.
 const screeningQualified=status==='PASS';
 return {strategy:spec.id,version:spec.version,hash:specHash(strategy),status,qualified:status==='PASS',gateStatus,screeningQualified,measurableStatus,score,gateScore,scoreCoverage,factors,scoreStatus:spec.scoreStatus,checks,researchComplete,finalRanked:false,finalReason:'الترتيب النهائي يتطلب اكتمال التحقق والزوايا الأربع'};
}
