"use client";

import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {
 Activity,AlertTriangle,ArrowUpLeft,BarChart3,Check,ChevronLeft,Clock3,
 Database,Download,FileUp,FlaskConical,Info,Layers,Menu,Radar,RefreshCw,
 Search,Server,ShieldCheck,Star,Wifi,X
} from "lucide-react";
import {Tabs,TabsList,TabsTrigger} from "@/components/ui/tabs";
import {Dialog,DialogContent,DialogDescription,DialogTitle} from "@/components/ui/dialog";
import {Progress} from "@/components/ui/progress";
import {evaluateStrategy,SPECS,type Snapshot} from "@/lib/engine";
import {fixtures} from "@/lib/fixtures";
import {simulateExit} from "@/lib/research";
import {saveOffline} from "@/lib/offline";
import PriceChart from "./price-chart";

const money=(n:number|null|undefined)=>n==null?'—':new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(n);
const pct=(n:number|null|undefined)=>n==null?'—':`${(n*100).toFixed(1)}%`;
const labels:Record<string,string>={PASS:'اجتاز الفحص',FAIL:'مستبعد',UNKNOWN:'يحتاج تحقق'};
const tabTitles:Record<string,string>={home:'لوحة الفرص',core:'القيمة الأساسية',bounce:'فرص الارتداد',favorites:'قائمة المتابعة',lab:'مختبر الاستراتيجية',data:'مركز البيانات'};
const navItems=[['home','لوحة الفرص',BarChart3],['core','القيمة الأساسية',ShieldCheck],['bounce','فرص الارتداد',Activity],['favorites','قائمة المتابعة',Star],['lab','مختبر الاستراتيجية',FlaskConical],['data','مركز البيانات',Database]] as const;

export default function RadarApp(){
 const [tab,setTab]=useState('home');
 const [strategy,setStrategy]=useState<'core'|'bounce'>('core');
 const [filter,setFilter]=useState('all');
 const [query,setQuery]=useState('');
 const [data,setData]=useState<Snapshot[]>([]);
 const [demo,setDemo]=useState(false);
 const [run,setRun]=useState<any>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [selected,setSelected]=useState<Snapshot|null>(null);
 const [favorites,setFavorites]=useState<string[]>([]);
 const [install,setInstall]=useState<any>(null);
 const [installHelp,setInstallHelp]=useState(false);
 const [scanMenu,setScanMenu]=useState(false);
 const [mobileNav,setMobileNav]=useState(false);
 const [lab,setLab]=useState<any>(null);
 const [storedEvaluations,setStoredEvaluations]=useState<any[]>([]);

 const refresh=async()=>{const response=await fetch('/api/radar');const payload=await response.json();if(!response.ok)throw Error(payload.error||'تعذّر تحميل آخر فحص.');setData(payload.snapshots||[]);setStoredEvaluations(payload.storedEvaluations||[]);setRun(payload.run);setFavorites(payload.favorites||[]);setDemo(false);if(payload.dataRunId&&payload.run?.id!==payload.dataRunId)setNotice('نعرض آخر لقطة تحتوي بيانات؛ الجولة الأحدث لم تنتج نتائج بعد.');await saveOffline({savedAt:new Date().toISOString(),run:payload.dataRun,snapshots:(payload.snapshots||[]).map((s:any)=>({...s,history:undefined}))}).catch(()=>{});};

 useEffect(()=>{queueMicrotask(()=>refresh().catch(e=>setNotice(e.message||'لا توجد لقطة محفوظة بعد.')));const handler=(event:any)=>{event.preventDefault();setInstall(event)};window.addEventListener('beforeinstallprompt',handler);if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});return()=>window.removeEventListener('beforeinstallprompt',handler)},[]);

 async function scan(mode:'quick'|'full'){
  setBusy(true);setError('');setNotice('');setDemo(false);setScanMenu(false);
  try{
   let response=await fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'start',mode})});
   let payload=await response.json();if(!response.ok)throw Error(payload.error||'تعذّر بدء الفحص.');setRun(payload.run);
   const maxSteps=mode==='quick'?20:40;let steps=0;
   while(payload.run&&['running','partial'].includes(payload.run.status)&&(payload.run.offset<payload.run.total||payload.run.retryPending)&&steps<maxSteps){
    response=await fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'step',runId:payload.run.id})});
    payload=await response.json();if(!response.ok)throw Error(payload.error||'تعذّر إكمال الدفعة.');setRun(payload.run);steps++;
    if(payload.run.offset<payload.run.total||payload.run.retryPending)await new Promise(resolve=>setTimeout(resolve,140));
   }
   await refresh();
   if(payload.run&&(payload.run.offset<payload.run.total||payload.run.retryPending))setNotice('حُفظ التقدم. اضغط «متابعة الفحص» لإكمال الجولة التالية دون فقد النتائج.');
  }catch(e:any){setError(e.message||'تعذّر إكمال الفحص.')}finally{setBusy(false)}
 }

 async function favorite(symbol:string){if(demo){setNotice('الحفظ متاح للبيانات الفعلية فقط.');return}try{const response=await fetch('/api/radar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'favorite',symbol})});const payload=await response.json();if(!response.ok)throw Error(payload.error||'تعذّر حفظ الشركة.');setFavorites(payload.favorites)}catch(e:any){setError(e.message)}}
 async function importFile(file?:File){if(!file)return;setBusy(true);setError('');try{if(file.size>4_000_000)throw Error('الحد الأقصى للملف 4 MB.');const records=JSON.parse(await file.text());const response=await fetch('/api/radar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'import',records})});const payload=await response.json();if(!response.ok)throw Error(payload.error);await refresh();setNotice('تم استيراد اللقطة وتقييمها بالقواعد الحالية.')}catch(e:any){setError(e.message)}finally{setBusy(false)}}

 const evaluated=useMemo(()=>data.map(snapshot=>({s:snapshot,e:evaluateStrategy(strategy,snapshot)})),[data,strategy]);
 const rows=useMemo(()=>evaluated.filter(({s,e})=>(!query||`${s.symbol} ${s.name}`.toLowerCase().includes(query.toLowerCase()))&&(tab!=='favorites'||favorites.includes(s.symbol))&&(filter==='all'||e.status===filter)).sort((a,b)=>{const rank={PASS:3,UNKNOWN:2,FAIL:1};return rank[b.e.status as keyof typeof rank]-rank[a.e.status as keyof typeof rank]||a.s.symbol.localeCompare(b.s.symbol)}),[evaluated,query,tab,favorites,filter]);
 const qualified=evaluated.filter(x=>x.e.status==='PASS').length;
 const incomplete=evaluated.filter(x=>x.e.status==='UNKNOWN').length;
 const excluded=evaluated.filter(x=>x.e.status==='FAIL').length;
 const progress=run?.total?Math.min(100,100*(run.processed||0)/run.total):0;
 const resumable=run&&['running','partial'].includes(run.status)&&(run.offset<run.total||run.retryPending);

 function switchTab(id:string){setTab(id);setMobileNav(false);if(id==='core'||id==='bounce'){setStrategy(id);setFilter('all')}}
 function exportData(){const blob=new Blob([JSON.stringify({run,mode:demo?'synthetic':'observed',strategy:SPECS[strategy],results:evaluated,evaluationMode:'current-spec reevaluation',persistedEvaluations:demo?[]:storedEvaluations},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download='small-cap-radar-audit.json';anchor.click();URL.revokeObjectURL(url)}

 return <div className="terminal-shell" dir="rtl">
  <aside className={`sidebar ${mobileNav?'open':''}`}>
   <div className="sidebar-head"><Link className="wordmark" href="/"><span className="mark"><Radar size={21}/></span><span><b>رادار</b><small>SMALL CAP INTELLIGENCE</small></span></Link><button className="mobile-close" onClick={()=>setMobileNav(false)} aria-label="إغلاق القائمة"><X size={20}/></button></div>
   <div className="nav-caption">مساحة العمل</div>
   <nav>{navItems.map(([id,name,Icon])=><button key={id} className={tab===id?'side-link active':'side-link'} onClick={()=>switchTab(id)}><Icon size={18}/><span>{name}</span>{tab===id&&<ChevronLeft size={15}/>}</button>)}</nav>
   <div className="sidebar-status"><div className="status-line"><span className="live-dot"/><b>النظام جاهز</b></div><p>محرك القواعد موحّد، والنتائج مرتبطة بالمصدر وتاريخ الإفصاح.</p><button className="install-link" onClick={()=>install?install.prompt():setInstallHelp(true)}><Download size={16}/> تثبيت التطبيق</button></div>
   <div className="build-label">V2 · RESEARCH TERMINAL</div>
  </aside>
  {mobileNav&&<button className="nav-scrim" onClick={()=>setMobileNav(false)} aria-label="إغلاق القائمة"/>}

  <main className="app-main">
   <header className="appbar"><button className="menu-button" onClick={()=>setMobileNav(true)} aria-label="فتح القائمة"><Menu size={21}/></button><div className="breadcrumb"><span>رادار</span><ChevronLeft size={14}/><b>{tabTitles[tab]}</b></div><div className="appbar-meta"><span className="market-state"><span className="live-dot"/> مصادر مباشرة</span><span className="avatar">YH</span></div></header>
   <div className="content">
    <section className="command-header"><div><span className="kicker">INVESTMENT RESEARCH WORKSPACE</span><h1>{tabTitles[tab]}</h1><p>{tab==='home'?'فلترة السوق الأمريكي إلى قائمة قصيرة قابلة للتحقق.':tab==='lab'?'اختبر القواعد والتكاليف قبل اعتماد أي نتيجة.':tab==='data'?'راقب مصادر كل رقم وجودته وتاريخ توفره.':'نتائج واضحة، أسباب معلنة، وفجوات لا تُخفى.'}</p></div><div className="scan-actions"><button className="scan-primary" onClick={()=>resumable?scan(run.source?.includes('quick')?'quick':'full'):setScanMenu(v=>!v)} disabled={busy}><RefreshCw size={17} className={busy?'spin':''}/>{busy?'جارٍ الفحص':resumable?'متابعة الفحص':'بدء فحص جديد'}</button>{scanMenu&&<div className="scan-popover"><button onClick={()=>scan('quick')}><b>فحص سريع</b><span>64 سهمًا موزعة على السوق · لاختبار المصادر والواجهة</span></button><button onClick={()=>scan('full')}><b>فحص السوق الكامل</b><span>كل الأسهم المدرجة · يُحفظ التقدم على دفعات</span></button></div>}</div></section>

    {(error||notice||demo)&&<div className={`system-message ${error?'danger':demo?'synthetic':''}`}>{error?<AlertTriangle size={17}/>:demo?<FlaskConical size={17}/>:<Info size={17}/>}<span>{error||notice||(demo?'وضع العرض التجريبي: البيانات اصطناعية ولا تمثل شركات حقيقية.':'')}</span>{demo&&<button onClick={()=>refresh().catch(e=>setError(e.message))}>العودة للبيانات</button>}<button className="message-close" onClick={()=>{setError('');setNotice('')}} aria-label="إغلاق"><X size={15}/></button></div>}

    {run&&<section className="scan-strip"><div className="scan-strip-head"><div><span className={`run-state ${run.status}`}>{run.status==='complete'?'مكتمل':run.status==='failed'?'فشل':resumable?'قيد التنفيذ':'جزئي'}</span><b>{run.source?.includes('quick')?'فحص سريع':'فحص السوق'}</b><small dir="ltr">{new Date(run.created_at).toLocaleString('en-GB')}</small></div><div className="scan-numbers"><span><b>{(run.processed||0).toLocaleString('en-US')}</b> تمت معالجتها</span><span><b>{(run.total||0).toLocaleString('en-US')}</b> الإجمالي</span><span className={run.failed?'negative':''}><b>{run.failed||0}</b> فشل</span></div></div><Progress value={progress}/><div className="progress-caption"><span>{progress.toFixed(1)}%</span><span>{resumable?'يمكن إغلاق التطبيق؛ التقدم محفوظ.':'آخر لقطة متاحة للعرض.'}</span></div></section>}

    <section className="metric-row">
     <Metric icon={Database} label="الأسهم المفحوصة" value={data.length} meta="UNIVERSE" tone="neutral"/>
     <Metric icon={ShieldCheck} label="اجتازت البوابات" value={qualified} meta="PASSED" tone="positive"/>
     <Metric icon={Clock3} label="بانتظار التحقق" value={incomplete} meta="REVIEW" tone="warning"/>
     <Metric icon={Layers} label="مستبعدة" value={excluded} meta="EXCLUDED" tone="negative"/>
    </section>

    {tab==='lab'?<LabPanel lab={lab} setLab={setLab}/>:tab==='data'?<DataPanel run={run} exportData={exportData} importFile={importFile}/>:<>
     <section className="strategy-switch" aria-label="اختيار الاستراتيجية"><button className={strategy==='core'?'active':''} onClick={()=>{setStrategy('core');setFilter('all')}}><span><ShieldCheck size={18}/><b>Core Value</b></span><small>12–24 شهرًا · $25M–$2B</small></button><button className={strategy==='bounce'?'active':''} onClick={()=>{setStrategy('bounce');setFilter('all')}}><span><Activity size={18}/><b>Bounce</b></span><small>حتى 3 أشهر · +20% / −15%</small></button><div className="strategy-note"><Info size={16}/><span>{strategy==='core'?'محرك Core يعرض اجتياز البوابات فقط حتى اعتماد معادلات الدرجات الفرعية.':'السيولة 150 ألف دولار حد تشغيلي معلن وقيد التحقق البحثي.'}</span></div></section>

     <section className="research-panel"><div className="panel-heading"><div><span className="section-eyebrow">CANDIDATE PIPELINE</span><h2>{tab==='favorites'?'قائمة المتابعة':'نتائج الفحص'} <em>{rows.length}</em></h2></div><button className="ghost-button" onClick={exportData}><Download size={16}/> تصدير التدقيق</button></div><div className="control-row"><Tabs value={filter} onValueChange={setFilter} dir="rtl"><TabsList><TabsTrigger value="all">الكل</TabsTrigger><TabsTrigger value="PASS">اجتازت</TabsTrigger><TabsTrigger value="UNKNOWN">تحتاج تحقق</TabsTrigger><TabsTrigger value="FAIL">مستبعدة</TabsTrigger></TabsList></Tabs><label className="search-field"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="اسم الشركة أو الرمز" aria-label="بحث الشركات"/></label></div>
      {rows.length?<StockTable rows={rows} strategy={strategy} favorites={favorites} onSelect={setSelected} onFavorite={favorite}/>:<EmptyState hasData={!!data.length} onQuick={()=>scan('quick')} onDemo={()=>{setData(fixtures);setDemo(true);setRun(null);setError('');setNotice('')}}/>}
     </section>
    </>}
    <footer className="app-footer"><span>Small-Cap Radar V2</span><span>POINT-IN-TIME · SOURCE-AWARE · NO PADDING</span></footer>
   </div>
  </main>

  <CompanyDialog selected={selected} strategy={strategy} onClose={()=>setSelected(null)}/>
  <Dialog open={installHelp} onOpenChange={setInstallHelp}><DialogContent dir="rtl" className="install-dialog"><DialogTitle>تثبيت رادار على الهاتف</DialogTitle><DialogDescription>افتح التطبيق من هاتفك وأنت مسجل بالحساب نفسه.</DialogDescription><div className="install-step"><b>iPhone / Safari</b><span>مشاركة ← إضافة إلى الشاشة الرئيسية</span></div><div className="install-step"><b>Android / Chrome</b><span>القائمة ⋮ ← تثبيت التطبيق</span></div></DialogContent></Dialog>
 </div>
}

function Metric({icon:Icon,label,value,meta,tone}:{icon:any,label:string,value:number,meta:string,tone:string}){return <div className={`metric ${tone}`}><span className="metric-icon"><Icon size={18}/></span><div><small>{label}</small><b>{value.toLocaleString('en-US')}</b><span>{meta}</span></div></div>}

function StockTable({rows,strategy,favorites,onSelect,onFavorite}:{rows:any[];strategy:'core'|'bounce';favorites:string[];onSelect:(s:Snapshot)=>void;onFavorite:(symbol:string)=>void}){return <div className="table-wrap"><div className="table-head"><span>الشركة</span><span>السعر</span><span>القيمة السوقية</span><span>12 شهرًا</span><span>الحالة</span><span>جودة البيانات</span><span/></div>{rows.map(({s,e})=><div className="table-row" key={s.symbol}><button className="issuer" onClick={()=>onSelect(s)}><span className="ticker">{s.symbol.slice(0,2)}</span><span><b dir="ltr">{s.symbol}</b><small>{s.name}</small></span></button><button className="cell-number" onClick={()=>onSelect(s)}><b>${money(s.price)}</b></button><button className="cell-number" onClick={()=>onSelect(s)}><b>${money(s.marketCap)}</b></button><button className={`cell-number ${s.return12m!=null&&(s.return12m<0?'down':'up')}`} onClick={()=>onSelect(s)}><b>{pct(s.return12m)}</b></button><button className="status-cell" onClick={()=>onSelect(s)}><span className={`result-badge ${e.status.toLowerCase()}`}>{labels[e.status]}</span><small>{e.status==='PASS'?'البوابات مكتملة؛ التحقق النهائي معلّق':e.checks.find((c:any)=>c.status===e.status)?.label||'راجع تفاصيل الفحص'}</small></button><button className="quality-cell" onClick={()=>onSelect(s)}><b>{s.confidence||'F'}</b><small>{strategy==='core'?'درجة نهائية معلّقة':'بوابات فقط'}</small></button><button className={`watch ${favorites.includes(s.symbol)?'saved':''}`} aria-label="حفظ في قائمة المتابعة" onClick={()=>onFavorite(s.symbol)}><Star size={17}/></button></div>)}</div>}

function EmptyState({hasData,onQuick,onDemo}:{hasData:boolean;onQuick:()=>void;onDemo:()=>void}){return <div className="empty-state"><div className="empty-rule"/><span className="section-eyebrow">NO MATCHING RECORDS</span><h3>{hasData?'لا توجد نتائج ضمن هذا الفلتر':'لم تُنشأ لقطة سوق بعد'}</h3><p>{hasData?'عدّل البحث أو حالة النتائج.':'ابدأ بفحص سريع للتأكد من اتصال البيانات، ثم شغّل الفحص الكامل.'}</p>{!hasData&&<div><button className="scan-primary" onClick={onQuick}>تشغيل فحص سريع</button><button className="text-button" onClick={onDemo}>عرض بيانات اختبار</button></div>}</div>}

function LabPanel({lab,setLab}:{lab:any;setLab:(v:any)=>void}){return <section className="research-panel content-panel"><div className="panel-heading"><div><span className="section-eyebrow">VALIDATION HARNESS</span><h2>مختبر الاستراتيجية</h2></div><span className="result-badge unknown">بحث قابل لإعادة الإنتاج</span></div><div className="analysis-grid"><article><div className="article-icon"><FlaskConical size={19}/></div><h3>محاكاة خروج محافظة</h3><p>إذا لامس السعر الهدف ووقف الخسارة في الجلسة نفسها، يفترض المحرك تنفيذ الوقف أولًا. يشمل المثال انزلاقًا سعريًا قدره 50 نقطة أساس.</p><button className="ghost-button" onClick={()=>setLab(simulateExit(100,'2026-01-01',[{date:'2026-01-02',open:100,high:122,low:83,close:110}],{slippageBps:50,commission:0,shares:1}))}>تشغيل المحاكاة</button>{lab&&<div className="analysis-result"><span>النتيجة</span><b>{lab.reason==='stop'?'وقف الخسارة':'خروج'} · {pct(lab.netReturn)}</b></div>}</article><article><div className="article-icon"><ShieldCheck size={19}/></div><h3>بوابات الاعتماد</h3>{['استخدام تاريخ توفر الإفصاح الفعلي','عزل الشركات في عينات الاختبار','تصحيح تعدد التجارب','إضافة تكاليف التداول والانزلاق','إظهار تحيز الشركات المشطوبة'].map(item=><div className="validation-line" key={item}><Check size={15}/><span>{item}</span></div>)}<a href="/api/export?kind=spec" className="inline-link">تنزيل مواصفات المحرك <ArrowUpLeft size={14}/></a></article></div><div className="method-note"><Info size={17}/><div><b>حدود الاعتماد</b><p>تعريف الانعطاف إلى الربحية ودرجات العوامل الفرعية لم يَرِد بمعادلات قابلة لإعادة الإنتاج. لذلك تُعرض البوابات وحالة البيانات دون صناعة درجة استثمارية وهمية.</p></div></div></section>}

function DataPanel({run,exportData,importFile}:{run:any;exportData:()=>void;importFile:(f?:File)=>void}){return <section className="research-panel content-panel"><div className="panel-heading"><div><span className="section-eyebrow">DATA OPERATIONS</span><h2>مركز البيانات</h2></div><button className="ghost-button" onClick={exportData}><Download size={16}/> سجل التدقيق</button></div><div className="source-grid"><article><div className="source-head"><span><Server size={18}/></span><div><b>SEC EDGAR</b><small>Company Facts · Exchange Universe</small></div><span className="source-state"><span className="live-dot"/> مباشر</span></div><p>إيرادات، أرباح، تدفقات نقدية، وعدد الأسهم مع تاريخ الإفصاح ووسم XBRL.</p></article><article><div className="source-head"><span><Wifi size={18}/></span><div><b>Yahoo Finance</b><small>Price History · Volume · Splits</small></div><span className="source-state review">تجريبي</span></div><p>الأسعار وحجم التداول وتاريخ التجزئات. أي فشل يُسجّل ولا يمحو بيانات SEC المتاحة.</p></article></div><div className="data-actions"><div><h3>استيراد لقطة موثقة</h3><p>JSON من نوع Snapshot[] مع المصدر وتاريخ التوفر لكل مقياس.</p></div><label className="ghost-button upload"><FileUp size={16}/> اختيار ملف<input type="file" accept="application/json,.json" onChange={event=>importFile(event.target.files?.[0])}/></label><a className="inline-link" href="/api/export?kind=schema">قاموس البيانات</a></div>{run?.error&&<div className="system-message danger"><AlertTriangle size={17}/>{run.error}</div>}</section>}

function CompanyDialog({selected,strategy,onClose}:{selected:Snapshot|null;strategy:'core'|'bounce';onClose:()=>void}){const evaluation=selected?evaluateStrategy(strategy,selected):null;return <Dialog open={!!selected} onOpenChange={open=>!open&&onClose()}><DialogContent className="company-dialog" dir="rtl"><DialogTitle>{selected?.symbol} · {selected?.name}</DialogTitle><DialogDescription>تفاصيل الفحص والأدلة — {strategy==='core'?'Core Value':'Bounce'}</DialogDescription>{selected&&evaluation&&<><div className="dialog-summary"><div><small>السعر</small><b>${money(selected.price)}</b></div><div><small>القيمة السوقية</small><b>${money(selected.marketCap)}</b></div><div><small>عائد 12 شهرًا</small><b className={selected.return12m!=null&&selected.return12m<0?'down':'up'}>{pct(selected.return12m)}</b></div><div><small>جودة البيانات</small><b>{selected.confidence||'F'}</b></div></div><PriceChart snapshot={selected} bounce={strategy==='bounce'}/>{selected.dataIssues?.map(issue=><div className="system-message danger" key={issue}><AlertTriangle size={16}/>{issue}</div>)}<h3 className="dialog-section-title">بوابات الاستراتيجية</h3><div className="gate-list">{evaluation.checks.map((check:any)=><div className="gate-row" key={check.id}><span className={`gate-dot ${check.status.toLowerCase()}`}/><div><b>{check.label}</b><small>{check.explanation}</small></div><span className={`result-badge ${check.status.toLowerCase()}`}>{check.status==='PASS'?'اجتاز':check.status==='FAIL'?'فشل':'ناقص'}</span></div>)}</div>{strategy==='bounce'&&selected.price&&<div className="trade-plan"><span>خطة الخروج الموثقة</span><b>هدف ${money(selected.price*1.2)}</b><b>وقف ${money(selected.price*.85)}</b><b>3 أشهر كحد أقصى</b></div>}<h3 className="dialog-section-title">مصادر الأرقام</h3><div className="evidence-list">{Object.entries(selected.provenance||{}).map(([key,p]:any)=><div className="evidence-row" key={key}><div><b>{key}</b><small>{p.source}</small></div><span>{p.periodEnd}</span>{p.url?<a href={p.url} target="_blank" rel="noreferrer">فتح المصدر ↗</a>:<span>—</span>}</div>)}</div><div className="research-completeness"><span>اكتمال زوايا البحث</span><b>{Object.values(selected.research||{}).filter(Boolean).length}/4</b><small>لا يدخل السهم ترتيبًا نهائيًا قبل اكتمال المالية، التقييم، المحللين والقطاع.</small></div></>}</DialogContent></Dialog>}
