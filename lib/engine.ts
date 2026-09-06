export type Provenance={source:string;url?:string;periodStart?:string;periodEnd:string;availableAt:string;retrievedAt:string;currency?:string;tag?:string;confidence:'high'|'medium'|'low'};
export type Snapshot={symbol:string;name:string;asOf:string;securityType?:string;exchange?:string;foreignFiler?:boolean;price?:number|null;marketCap?:number|null;medianDollarVolume20d?:number|null;revenue?:number|null;evSales?:number|null;ps?:number|null;netIncome?:number|null;fcf?:number|null;return12m?:number|null;low52w?:number|null;ma30w?:number|null;dilution?:number|null;splitAdjusted?:boolean;deathSpiral?:'clean'|'mild'|'elevated'|'severe'|'unknown';riskEvidence?:string;liquidityReviewed?:boolean;confidence?:'A'|'B'|'C'|'D'|'F';research?:{financials?:boolean;valuation?:boolean;analysts?:boolean;sector?:boolean};sourceConflicts?:string[];dataIssues?:string[];provenance:Record<string,Provenance>;history?:{date:string;close:number;open?:number;high?:number;low?:number;volume?:number}[]};
export const SPECS={core:{id:'CORE_VALUE_V2',version:'2.0.0-draft.2',marketCap:{min:25e6,max:2e9},liquidity:150e3,liquidityMetric:'medianDollarVolume20d',evSalesMax:10,weights:{Valuation:24,Quality:19,'Share Discipline':15,'Small Size + Low Coverage':14,Growth:7,'Insider Buying':7,'Margin Trend':6,'Entry Point':5,'Balance Sheet':3},scoreStatus:'unvalidated',policy:'Liquidity median20d is an implementation convention, not validated original logic'},bounce:{id:'BOUNCE_V2',version:'2.0.0-draft.2',marketCap:{min:25e6,max:600e6},liquidity:150e3,liquidityMetric:'medianDollarVolume20d',returnMax:-.35,lowDistanceMin:.1,dilutionMax:.25,maMultiplier:1.05,exit:{target:.2,stop:-.15,months:3},weights:{},scoreStatus:'gates-only',policy:'150k median dollar volume is an explicit operating convention pending validation'},legacy:{id:'LEGACY_BENCHMARK',version:'1.0.0-reference',marketCap:{min:50e6,max:5e9},liquidity:300e3,psMax:10,weights:{Valuation:25,'Profitability/FCF':20,Momentum:20,Dilution:15,Size:10,Insider:10},scoreStatus:'normalization-unavailable'}} as const;
export type Status='PASS'|'FAIL'|'UNKNOWN';
export type Check={id:string;label:string;status:Status;explanation:string};
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
export function specHash(strategy:keyof typeof SPECS){let h=2166136261;for(const c of JSON.stringify(SPECS[strategy])){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0).toString(16)}
export function evaluateStrategy(strategy:keyof typeof SPECS,s:Snapshot){
 const spec=SPECS[strategy],checks:Check[]=[];
 const add=(id:string,label:string,ok:boolean|null,explanation:string)=>checks.push({id,label,status:ok==null?'UNKNOWN':ok?'PASS':'FAIL',explanation});
 const numeric=(id:string,label:string,n:unknown,test:(x:number)=>boolean,rule:string)=>add(id,label,finite(n)?test(n):null,finite(n)?`${n} · ${rule}`:'البيانات غير متاحة أو غير صالحة');
 add('security','سهم عادي مدرج في السوق الأمريكي',s.securityType&&s.exchange?s.securityType==='common'&&['Nasdaq','NYSE','NYSE American','NASDAQ','NMS','NGM','NCM','NYQ','ASE'].includes(s.exchange):null,`${s.securityType??'نوع غير معروف'} / ${s.exchange??'بورصة غير معروفة'}`);
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
 add('dilution','تخفيف أقل من 25% بعد تصحيح التجزئة',s.splitAdjusted===true&&finite(s.dilution)?s.dilution<SPECS.bounce.dilutionMax:null,'Dilution < 25%; split-adjusted required');
 add('reversal','انعكاس مؤكد أعلى متوسط 30 أسبوعًا',finite(s.price)&&s.price>0&&finite(s.ma30w)&&s.ma30w>0?s.price>s.ma30w*SPECS.bounce.maMultiplier:null,'Price > 1.05 × MA30W');
 }
 const required=strategy==='bounce'?['price','marketCap','medianDollarVolume20d','return12m','low52w','ma30w','dilution']:["price",'marketCap','medianDollarVolume20d','revenue',strategy==='core'?'evSales':'ps',...(finite(s.netIncome)&&s.netIncome>0?['netIncome']:['fcf'])];
 add('provenance','المصادر والتوقيت',required.every(k=>{const p=s.provenance[k];return p&&p.source&&p.availableAt&&p.periodEnd&&Number.isFinite(Date.parse(p.availableAt))&&Date.parse(p.availableAt)<=Date.parse(s.asOf)} )?true:null,'كل مقياس حرج يحتاج مصدرًا وتوقيت توفر لا يتجاوز وقت اللقطة.');
 const quote=s.provenance.price;add('freshness','حداثة بيانات السعر',quote&&Number.isFinite(Date.parse(quote.availableAt))?Date.parse(s.asOf)>=Date.parse(quote.availableAt)&&Date.parse(s.asOf)-Date.parse(quote.availableAt)<=3*864e5:null,'السعر الأقدم من 3 أيام يحتاج تحديثًا؛ حد تشغيلي محافظ غير مختبر.');
 const financial=s.provenance.revenue;if(strategy!=='bounce')add('filingFreshness','حداثة الفترة المالية',financial?Date.parse(s.asOf)-Date.parse(financial.periodEnd)<=200*864e5:null,'الفترة الأقدم من 200 يوم تحتاج مراجعة، بما فيها الإفصاحات الأجنبية.');
 add('conflict','تعارض المصادر',s.sourceConflicts?.length?false:s.confidence==='D'||s.confidence==='F'?false:null,s.sourceConflicts?.join('؛ ')||'التحقق من مصدرين لم يكتمل.');
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
 return {strategy:spec.id,version:spec.version,hash:specHash(strategy),status,qualified:status==='PASS',gateStatus,screeningQualified:measurableStatus==='PASS',measurableStatus,score:null as number|null,scoreStatus:spec.scoreStatus,checks,researchComplete,finalRanked:false,finalReason:'يلزم اعتماد المعادلات والتحقق من المصادر والزوايا الأربع'};
}
