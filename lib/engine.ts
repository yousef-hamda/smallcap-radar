import { INVESTABLE_EXCHANGES, SPECS, specHash } from './strategy-spec';
import {usableEvidence} from './evidence';
export { SPECS, specHash } from './strategy-spec';
export type { StrategyKey } from './strategy-spec';
export type Provenance={source:string;url?:string;periodStart?:string;periodEnd:string;availableAt:string;retrievedAt:string;currency?:string;tag?:string;confidence:'high'|'medium'|'low'};
export type Snapshot={symbol:string;name:string;asOf:string;cik?:number;description?:string;descriptionAr?:string;website?:string;sector?:string;industry?:string;employees?:number|null;securityType?:string;exchange?:string;foreignFiler?:boolean;price?:number|null;dailyChange?:number|null;marketCap?:number|null;volume?:number|null;averageVolume10d?:number|null;medianDollarVolume20d?:number|null;revenue?:number|null;revenueGrowth?:number|null;evSales?:number|null;ps?:number|null;netIncome?:number|null;fcf?:number|null;fcfYield?:number|null;grossMargin?:number|null;operatingMarginTrend?:number|null;insiderBuyValue?:number|null;analystCount?:number|null;analystTarget?:number|null;targetMean?:number|null;targetLow?:number|null;targetHigh?:number|null;cash?:number|null;debt?:number|null;return12m?:number|null;low52w?:number|null;high52w?:number|null;ma30w?:number|null;dilution?:number|null;shareCountRatio?:number|null;splitAdjusted?:boolean;deathSpiral?:'clean'|'mild'|'elevated'|'severe'|'unknown';riskEvidence?:string;liquidityReviewed?:boolean;confidence?:'A'|'B'|'C'|'D'|'F';research?:{financials?:boolean;valuation?:boolean;analysts?:boolean;sector?:boolean};nextEarnings?:string|null;lastEarnings?:string|null;lastEarningsStatus?:'إيجابي'|'سلبي'|'مختلط'|'غير معروف';surprises?:{quarter:string;surprisePct?:number|null;actual?:number|null;estimate?:number|null}[];revenueTrend?:{quarter:string;value:number;periodEnd?:string}[];backlog?:{amount?:number|null;currency?:string;asOf?:string;stale?:boolean;source?:string}|null;news?:{title:string;link?:string;publishedAt?:string;source?:string}[];insiderPurchases?:InsiderPurchase[];sourceConflicts?:string[];dataIssues?:string[];provenance:Record<string,Provenance>;history?:{date:string;close:number;open?:number;high?:number;low?:number;volume?:number}[]};
export type InsiderPurchase={owner:string;date:string;shares:number;price:number;value:number;source?:string};
export type Status='PASS'|'FAIL'|'UNKNOWN';
export type CheckRole='eligibility'|'factor'|'evidence';
export type Check={id:string;label:string;status:Status;role:CheckRole;explanation:string};
export type Factor={id:string;label:string;maxPoints:number;points:number;available:boolean;availableWeight?:number;rawValue:number|null;explanation:string};
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const clamp=(n:number,min=0,max=1)=>Math.max(min,Math.min(max,n));
const scale=(value:number|null|undefined,min:number,max:number)=>finite(value)?clamp((value-min)/(max-min)):null;
function coreFactors(s:Snapshot):Factor[]{
 const revenueValid=finite(s.revenue)&&s.revenue>0;
 const valuation=revenueValid?(finite(s.evSales)?clamp(1-(s.evSales/SPECS.core.evSalesMax)):finite(s.ps)?clamp(1-(s.ps/SPECS.core.evSalesMax)):null):null;
 const qualityBase=finite(s.netIncome)||finite(s.fcf)?((finite(s.netIncome)&&s.netIncome>0?0.5:0)+(finite(s.fcf)&&s.fcf>0?0.5:0)):null;
 const riskMultiplier=s.deathSpiral==='clean'?1:s.deathSpiral==='mild'?0.75:s.deathSpiral==='elevated'?0.4:s.deathSpiral==='severe'?0:null;
 const quality=qualityBase!=null&&riskMultiplier!=null?qualityBase*riskMultiplier:null;
 const dilution=finite(s.dilution)?clamp(1-(s.dilution/SPECS.bounce.dilutionMax)):null;
 const size=finite(s.marketCap)?clamp(1-(Math.log10(Math.max(s.marketCap,SPECS.core.marketCap.min))-Math.log10(SPECS.core.marketCap.min))/(Math.log10(SPECS.core.marketCap.max)-Math.log10(SPECS.core.marketCap.min))):null;
 const liquidity=finite(s.medianDollarVolume20d)&&s.medianDollarVolume20d>0?clamp(Math.log(s.medianDollarVolume20d/SPECS.core.liquidity)/Math.log(SPECS.core.score.liquidityCeiling/SPECS.core.liquidity)):null;
 const sizeCoverage=size!=null&&liquidity!=null?size*0.7+liquidity*0.3:null;
 const growth=scale(s.revenueGrowth??null,SPECS.core.score.growthMin,SPECS.core.score.growthMax);
 const insider=finite(s.insiderBuyValue)&&finite(s.marketCap)&&s.marketCap>0?clamp(s.insiderBuyValue/s.marketCap/SPECS.core.score.insiderScale):null;
 const margin=scale(s.operatingMarginTrend??null,SPECS.core.score.marginMin,SPECS.core.score.marginMax);
 const entry=finite(s.return12m)?clamp(1-Math.abs(s.return12m-SPECS.core.score.entryAnchor)/SPECS.core.score.entryRange):null;
 const balance=finite(s.cash)&&finite(s.debt)?clamp((s.cash-s.debt)/Math.max(s.cash,s.debt,1)):null;
 const make=(id:string,label:string,maxPoints:number,n:number|null,raw:number|null|undefined,explanation:string):Factor=>({id,label,maxPoints,points:n==null?0:n*maxPoints,available:n!=null,rawValue:raw??null,explanation});
 return [
  make('valuation','التقييم',SPECS.core.weights['Valuation'],valuation,s.evSales??s.ps??null,revenueValid?(finite(s.evSales)?`EV/S ${s.evSales.toFixed(2)} ضمن حد 10`:'تقييم المبيعات مستخدم لعدم توفر EV/S'):'الإيرادات الفعلية غير متاحة؛ لا تُمنح نقاط التقييم'),
  make('quality','الجودة والربحية',SPECS.core.weights['Quality'],quality,s.netIncome??s.fcf??null,'Net Income أو FCF موجب بعد خصم مخاطر دوامة التمويل الموثقة'),
  make('shareDiscipline','انضباط الأسهم',SPECS.core.weights['Share Discipline'],dilution,s.dilution,finite(s.dilution)?`التخفيف ${(s.dilution*100).toFixed(1)}%`:'التخفيف غير متاح'),
  make('sizeCoverage','الحجم والسيولة والتغطية',SPECS.core.weights['Small Size + Low Coverage'],sizeCoverage,s.marketCap,`الحجم والسيولة يساهمان معًا؛ الوسيط الأعلى من ${SPECS.core.score.liquidityCeiling} لا يمنح نقاطًا إضافية`),
  make('growth','النمو',SPECS.core.weights['Growth'],growth,s.revenueGrowth,'نمو الإيرادات ضمن نطاق محافظ'),
  make('insider','الشراء الداخلي',SPECS.core.weights['Insider Buying'],insider,s.insiderBuyValue,'يحسب Form 4 P فقط عند توفره'),
  make('marginTrend','اتجاه الهوامش',SPECS.core.weights['Margin Trend'],margin,s.operatingMarginTrend,'تحسن هامش التشغيل'),
  make('entry','نقطة الدخول',SPECS.core.weights['Entry Point'],entry,s.return12m,'ليس كل هبوط فرصة؛ يفضل ارتدادًا غير متطرف'),
  make('balance','الميزانية',SPECS.core.weights['Balance Sheet'],balance,s.cash!=null&&s.debt!=null?s.cash-s.debt:null,'صافي النقد/الدين')
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
  make('valuation','التقييم',SPECS.legacy.weights['Valuation'],valuation,s.ps,'P/S ضمن الحد المرجعي 10'),
  make('profitability','الربحية / التدفق النقدي',SPECS.legacy.weights['Profitability/FCF'],profitability,s.netIncome??s.fcf,'Net Income أو FCF موجب'),
  make('momentum','الزخم',SPECS.legacy.weights['Momentum'],momentum,s.return12m,'العائد التاريخي ضمن نطاق مرجعي محافظ'),
  make('dilution','التخفيف',SPECS.legacy.weights['Dilution'],dilution,s.dilution,'التخفيف الأقل يحصل على نقاط أعلى'),
  make('size','الحجم',SPECS.legacy.weights['Size'],size,s.marketCap,'أفضلية الحجم الأصغر ضمن نطاق Legacy'),
  make('insider','شراء المطلعين',SPECS.legacy.weights['Insider'],insider,s.insiderBuyValue,'Form 4 P فقط')
 ];
}
function bounceFactors(s:Snapshot):Factor[]{
 const r=SPECS.bounce.ranking;
 const collapse=finite(s.return12m)?clamp((SPECS.bounce.returnMax-s.return12m)/(SPECS.bounce.returnMax-r.collapseFloor)):null;
 const reversal=finite(s.price)&&s.price>0&&finite(s.ma30w)&&s.ma30w>0?clamp((s.price/s.ma30w-SPECS.bounce.maMultiplier)/(r.reversalCeiling-(SPECS.bounce.maMultiplier-1))):null;
 const liquidity=finite(s.medianDollarVolume20d)&&s.medianDollarVolume20d>0?clamp(Math.log(s.medianDollarVolume20d/SPECS.bounce.liquidity)/Math.log(r.liquidityCeiling/SPECS.bounce.liquidity)):null;
 const dilution=finite(s.dilution)?clamp(1-Math.max(0,s.dilution)/SPECS.bounce.dilutionMax):null;
 const offLow=finite(s.price)&&s.price>0&&finite(s.low52w)&&s.low52w>0?clamp(1-Math.abs((s.price/s.low52w-1)-r.offLowAnchor)/r.offLowRange):null;
 const size=finite(s.marketCap)?clamp(1-(s.marketCap-SPECS.bounce.marketCap.min)/(SPECS.bounce.marketCap.max-SPECS.bounce.marketCap.min)):null;
 const make=(id:string,label:string,maxPoints:number,n:number|null,raw:number|null,explanation:string):Factor=>({id,label,maxPoints,points:n==null?0:n*maxPoints,available:n!=null,rawValue:raw,explanation});
 return [
  make('collapse','عمق الهبوط',r.weights.collapse,collapse,s.return12m??null,'شدة الهبوط التاريخي كعامل موزون؛ لا يحذف السهم منفردًا.'),
  make('reversal','قوة الانعكاس',r.weights.reversal,reversal,finite(s.price)&&finite(s.ma30w)&&s.ma30w>0?s.price/s.ma30w-1:null,'المسافة الموثقة عن MA30W كعامل موزون.'),
  make('liquidity','جودة السيولة',r.weights.liquidity,liquidity,s.medianDollarVolume20d??null,'وسيط قيمة التداول لعشرين جلسة، بمقياس لوغاريتمي محدود.'),
  make('dilution','انضباط الأسهم',r.weights.dilution,dilution,s.dilution??null,'التخفيف الأقل بعد إثبات مراجعة التجزئة.'),
  make('offLow','موضع الارتداد',r.weights.offLow,offLow,finite(s.price)&&finite(s.low52w)&&s.low52w>0?s.price/s.low52w-1:null,'يفضل خروجًا واضحًا من القاع دون تمدد مفرط.'),
  make('size','الحجم',r.weights.size,size,s.marketCap??null,'مكوّن صغير داخل نطاق Bounce فقط.'),
 ];
}
export function evaluateStrategy(strategy:keyof typeof SPECS,s:Snapshot){
 const spec=SPECS[strategy],checks:Check[]=[];
 const eligibilityIds=new Set<string>('eligibilityGateIds' in spec?spec.eligibilityGateIds:[]);
 const factorIds=new Set<string>('factorCheckIds' in spec?spec.factorCheckIds:[]);
 const roleFor=(id:string):CheckRole=>eligibilityIds.has(id)?'eligibility':factorIds.has(id)?'factor':'evidence';
 const add=(id:string,label:string,ok:boolean|null,explanation:string,role=roleFor(id))=>checks.push({id,label,status:ok==null?'UNKNOWN':ok?'PASS':'FAIL',role,explanation});
 const numeric=(id:string,label:string,n:unknown,test:(x:number)=>boolean,rule:string)=>add(id,label,finite(n)?test(n):null,finite(n)?`${n} · ${rule}`:'البيانات غير متاحة أو غير صالحة');
 add('security','سهم عادي مدرج في السوق الأمريكي',s.securityType&&s.exchange?s.securityType==='common'&&(INVESTABLE_EXCHANGES as readonly string[]).includes(s.exchange):null,`${s.securityType??'نوع غير معروف'} / ${s.exchange??'بورصة غير معروفة'}`);
 numeric('cap','القيمة السوقية',s.marketCap,n=>n>=spec.marketCap.min&&n<=spec.marketCap.max,`${spec.marketCap.min} ≤ cap ≤ ${spec.marketCap.max}`);
 if(strategy==='core'||strategy==='legacy'){
 const sp=SPECS[strategy];numeric('liquidity','سيولة التداول',s.medianDollarVolume20d,n=>n>=sp.liquidity,`20d median ≥ ${sp.liquidity}`);
 numeric('revenue','وجود إيرادات فعلية',s.revenue,n=>n>0,'Revenue > 0 · عامل ترتيب وليس بوابة أهلية');
 if(strategy==='core')numeric('valuation','قيمة المنشأة / الإيرادات',s.evSales,n=>n<=SPECS.core.evSalesMax,'EV/S ≤ 10');else numeric('valuation','السعر / الإيرادات',s.ps,n=>n>=0&&n<=SPECS.legacy.psMax,'P/S ≤ 10');
 const positive=(finite(s.netIncome)&&s.netIncome>0)||(finite(s.fcf)&&s.fcf>0);
 add('profitability','ربحية أو تدفق نقدي موجب',positive?true:finite(s.netIncome)&&finite(s.fcf)?false:null,'NI > 0 OR FCF > 0 · عامل ترتيب وليس بوابة أهلية.');
 if(strategy==='core')add('deathSpiral','مخاطر دوامة التمويل',s.deathSpiral==='severe'?false:s.deathSpiral&&s.deathSpiral!=='unknown'&&s.riskEvidence?true:null,'يتطلب مراجعة موثقة؛ حدود آلية غير معتمدة.');
 } else {
 numeric('liquidity','سيولة تداول قابلة للتنفيذ',s.medianDollarVolume20d,n=>n>=SPECS.bounce.liquidity,`20d median ≥ ${SPECS.bounce.liquidity} · حد تشغيلي قيد التحقق`);
 numeric('collapse','هبوط 12 شهرًا',s.return12m,n=>n<SPECS.bounce.returnMax,'Return < −35% · عامل موزون');
 add('low','ابتعاد 10% عن قاع السنة',finite(s.price)&&s.price>0&&finite(s.low52w)&&s.low52w>0?s.price>=s.low52w*(1+SPECS.bounce.lowDistanceMin):null,'Price ≥ 1.10 × low52w · عامل موزون');
 const sharesReviewed=s.splitAdjusted===true&&finite(s.shareCountRatio)&&s.shareCountRatio>SPECS.bounce.shareCountRatio.minExclusive&&s.shareCountRatio<SPECS.bounce.shareCountRatio.maxExclusive;
 add('dilution','تخفيف أقل من 25% بعد مراجعة التجزئة',sharesReviewed&&finite(s.dilution)?s.dilution<SPECS.bounce.dilutionMax:null,`Dilution < ${SPECS.bounce.dilutionMax*100}%; share ratio ${SPECS.bounce.shareCountRatio.minExclusive}–${SPECS.bounce.shareCountRatio.maxExclusive} · عامل موزون`);
  add('reversal','انعكاس مؤكد أعلى متوسط 30 أسبوعًا',finite(s.price)&&s.price>0&&finite(s.ma30w)&&s.ma30w>0?s.price>s.ma30w*SPECS.bounce.maMultiplier:null,`Price > ${SPECS.bounce.maMultiplier} × MA30W · عامل موزون`);
 }
 const required=strategy==='bounce'?['price','marketCap','medianDollarVolume20d','return12m','low52w','ma30w','dilution']:["price",'marketCap','medianDollarVolume20d','revenue',strategy==='core'?'evSales':'ps',...(finite(s.netIncome)&&s.netIncome>0?['netIncome']:['fcf'])];
 add('provenance','المصادر والتوقيت',required.every(k=>usableEvidence(s.provenance[k],s.asOf))?true:null,'كل مقياس حرج يحتاج مصدرًا وفترة وتوقيت توفر لا يتجاوز وقت اللقطة.');
 const critical=['price','marketCap','medianDollarVolume20d'];
 const criticalValues:Record<string,unknown>={price:s.price,marketCap:s.marketCap,medianDollarVolume20d:s.medianDollarVolume20d};
 const criticalReady=critical.every(k=>finite(criticalValues[k])&&Number(criticalValues[k])>0&&usableEvidence(s.provenance[k],s.asOf));
 add('criticalData','أدلة الأهلية الحرجة',criticalReady?true:null,'السعر والقيمة السوقية والسيولة تحتاج قيمًا موجبة ومصادر مؤرخة صالحة قبل إدخال السهم في الكون القابل للتصنيف.');
 const quote=s.provenance.price;add('freshness','حداثة بيانات السعر',usableEvidence(quote,s.asOf)&&Date.parse(s.asOf)-Date.parse(quote.availableAt)<=SPECS.core.freshnessDays*864e5?true:null,`السعر الأقدم من ${SPECS.core.freshnessDays} أيام يحتاج تحديثًا؛ حد تشغيلي محافظ غير مختبر.`);
 const financial=s.provenance.revenue;if(strategy!=='bounce')add('filingFreshness','حداثة الفترة المالية',usableEvidence(financial,s.asOf)&&Date.parse(s.asOf)-Date.parse(financial.periodEnd)<=SPECS.core.filingFreshnessDays*864e5?true:null,`الفترة الأقدم من ${SPECS.core.filingFreshnessDays} يومًا تحتاج مراجعة، بما فيها الإفصاحات الأجنبية.`);
 const conflictStatus=strategy==='bounce'
   ? (s.sourceConflicts?.length?null:(required.every(k=>s.provenance[k])?true:null))
   : (s.sourceConflicts?.length?null:s.confidence==='A'||s.confidence==='B'?true:s.confidence==='D'||s.confidence==='F'?null:null);
 add('conflict','تعارض المصادر',conflictStatus,s.sourceConflicts?.join('؛ ')||((strategy==='bounce'&&conflictStatus===true)?'لا يوجد تعارض في المقاييس التشغيلية الرسمية.':(s.confidence==='A'||s.confidence==='B')?'لا يوجد اختلاف جوهري بين مساري البيانات.':'التحقق من مصدرين لم يكتمل.'));
 const evidenceRequirements:Record<string,string[]>={cap:['marketCap'],liquidity:['medianDollarVolume20d'],revenue:['revenue'],valuation:[strategy==='legacy'?'ps':'evSales'],collapse:['return12m'],low:['price','low52w'],dilution:['dilution','shareCountRatio'],reversal:['price','ma30w']};
 const profitKeys=finite(s.netIncome)&&s.netIncome>0?['netIncome']:finite(s.fcf)&&s.fcf>0?['fcf']:['netIncome','fcf'];
 evidenceRequirements.profitability=profitKeys;
 for(const check of checks){
  const keys=evidenceRequirements[check.id];
  if(keys&&check.status!=='UNKNOWN'&&!keys.every(key=>usableEvidence(s.provenance[key],s.asOf))){check.status='UNKNOWN';check.explanation+=` · الدليل الزمني غير مكتمل: ${keys.filter(key=>!usableEvidence(s.provenance[key],s.asOf)).join(', ')}`;}
 }
 // Only data-integrity and marketability safety are hard gates. Strategy
 // conditions are weighted factors and may lower a row without deleting it.
 // UNKNOWN never becomes PASS; it lowers factor coverage and confidence.
 const hardGateIds='eligibilityGateIds' in spec?[...spec.eligibilityGateIds]:['security','cap','liquidity'];
 const hardGates=checks.filter(c=>hardGateIds.includes(c.id));
 const gateStatus:Status=hardGates.some(c=>c.status==='FAIL')?'FAIL':hardGates.some(c=>c.status==='UNKNOWN')?'UNKNOWN':'PASS';
 const status:Status=hardGates.some(c=>c.status==='FAIL')?'FAIL':hardGates.some(c=>c.status==='UNKNOWN')?'UNKNOWN':'PASS';
 const factorChecks=checks.filter(c=>c.role==='factor');
 const factorStatus:Status=factorChecks.some(c=>c.status==='FAIL')?'FAIL':factorChecks.some(c=>c.status==='UNKNOWN')?'UNKNOWN':'PASS';
 const measurableStatus:Status=factorStatus;
 const researchComplete=['financials','valuation','analysts','sector'].every(k=>s.research?.[k as keyof NonNullable<Snapshot['research']>]===true);
 const scoreInput={...s};
 for(const key of ['evSales','ps','netIncome','fcf','dilution','marketCap','medianDollarVolume20d','revenueGrowth','insiderBuyValue','operatingMarginTrend','return12m','low52w','ma30w','cash','debt'] as const)if(!usableEvidence(s.provenance[key],s.asOf))scoreInput[key]=null;
 const factors=strategy==='core'?coreFactors(scoreInput):strategy==='legacy'?legacyFactors(scoreInput):bounceFactors(scoreInput);
 const qualityFactor=factors.find(f=>f.id==='quality'||f.id==='profitability');
 if(qualityFactor)qualityFactor.availableWeight=qualityFactor.maxPoints*([scoreInput.netIncome,scoreInput.fcf].filter(finite).length/2);
 // Bounce has no validated predictive probability in the supplied spec.
 // Keep the legacy field name for API compatibility, but make its meaning
 // explicit: it is the percentage of evidenced Bounce factors that pass,
 // never an eligibility gate and never a probability.
 const bounceGateChecks=strategy==='bounce'?checks.filter(c=>c.role==='factor'):[];
 const gateScore=strategy==='bounce'?Math.round(100*bounceGateChecks.filter(c=>c.status==='PASS').length/Math.max(1,bounceGateChecks.length)*10)/10:null;
 const rawScore=Math.round(factors.reduce((total,f)=>total+f.points,0)*10)/10;
 const scoreCoverage=Math.round(factors.filter(f=>f.available).reduce((t,f)=>t+(f.availableWeight??f.maxPoints),0)*10)/10;
 const totalFactorPoints=factors.reduce((t,f)=>t+f.maxPoints,0);
 // The strict 0-100 rank combines the points earned by evidenced factors with
 // evidence completeness. Missing inputs are not asserted to be bad values;
 // they simply cannot contribute points, so an UNKNOWN row cannot reach 100
 // from one unusually strong metric. scoreCoverage remains visible separately;
 // qualification is governed only by the hard safety gates while factorStatus
 // remains visible to the user.
 const evidenceScore=scoreCoverage>0?Math.round(rawScore/scoreCoverage*1000)/10:null;
 const score=scoreCoverage>0&&totalFactorPoints>0?Math.round(rawScore/totalFactorPoints*1000)/10:null;
 // A row enters the category ranking when safety gates are valid. A failed or
 // unknown strategy factor changes the score/coverage but never becomes PASS.
 const screeningQualified=status==='PASS';
 const ratingConfidence=scoreCoverage>=85&&status==='PASS'?'high':scoreCoverage>=60&&status!=='FAIL'?'medium':'low';
 const model='model' in spec?spec.model:null;
 const modelValidation:string|undefined=model?.validation;
 return {strategy:spec.id,version:spec.version,hash:specHash(strategy),status,qualified:status==='PASS',gateStatus,screeningQualified,measurableStatus,factorStatus,score,rawScore,evidenceScore,gateScore,scoreCoverage,ratingConfidence,outcomeProbability:null,model,factors,scoreStatus:spec.scoreStatus,checks,researchComplete,finalRanked:false,finalReason:modelValidation==='approved'?'النموذج معتمد وفق سجل النسخة':'الدرجة تشخيصية؛ الاعتماد التنبؤي محجوب حتى اكتمال الدراسة التاريخية'};
}
