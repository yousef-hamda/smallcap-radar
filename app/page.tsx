'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Star,RefreshCw,Download,Bell,Database,Search,X,ChevronDown,BriefcaseBusiness,LogIn,LogOut,UserRound} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Progress} from '@/components/ui/progress';
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogClose} from '@/components/ui/dialog';
import {evaluateStrategy,SPECS,type Snapshot} from '@/lib/engine';
import {scanProgress,type ScanRun} from '@/lib/scan-progress';
import {saveOffline} from '@/lib/offline';
import {money,price,percent,day,mark,checkLabel} from './radar-format';
import CompanySheet from './company-sheet';
import ScanReport from './scan-report';
import {apiJson} from '@/lib/client-json';
import {VALIDATION_REPORT} from '@/lib/validation-report';
import PortfolioView from './portfolio-view';

type View='core'|'bounce'|'favorites'|'portfolio';
type AccountSession={username:string};
type RadarData={run:ScanRun|null;dataRun:ScanRun|null;dataRunId?:string;snapshots:Snapshot[];favorites:string[];portfolioCount?:number;coverage?:{runId:string;total:number;fields:Record<string,number>}|null;summary:{total:number;coreQualified:number;bounceQualified:number;coreRanked?:number;bounceRanked?:number;coreUnknown:number;bounceUnknown:number;coreFailed?:number;bounceFailed?:number;stale?:boolean};page:{hasMore:boolean;offset?:number}};
const names:Record<View,string>={bounce:'فرص الارتداد',core:'القيمة الأساسية',favorites:'المفضلة',portfolio:'محفظتي'};
const request=apiJson;
const post=(data:unknown)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});

export default function RadarApp(){
 const [view,setView]=useState<View>('bounce'),[query,setQuery]=useState(''),[search,setSearch]=useState('');
 const [data,setData]=useState<RadarData|null>(null),[rows,setRows]=useState<Snapshot[]>([]),[favorites,setFavorites]=useState<string[]>([]);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [selected,setSelected]=useState<Snapshot|null>(null),[selectedEvaluation,setSelectedEvaluation]=useState<ReturnType<typeof evaluateStrategy>|null>(null),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState('');
 const [reportOpen,setReportOpen]=useState(false);
 const [portfolioCount,setPortfolioCount]=useState(0);
 const [account,setAccount]=useState<AccountSession|null>(null),[accountOpen,setAccountOpen]=useState(false),[accountMode,setAccountMode]=useState<'login'|'signup'>('login'),[accountUsername,setAccountUsername]=useState(''),[accountPassword,setAccountPassword]=useState(''),[accountBusy,setAccountBusy]=useState(false),[accountRevision,setAccountRevision]=useState(0);
 const [settings,setSettings]=useState(false),[notificationBusy,setNotificationBusy]=useState(false),[saving,setSaving]=useState<string|null>(null);
 const [hasMore,setHasMore]=useState(false),[copied,setCopied]=useState('');
 const selection=useRef<AbortController|null>(null),lastView=useRef({view,search}),listRequest=useRef<AbortController|null>(null);
 const cursor=useRef(0),loadingRequest=useRef(false),favoriteVersion=useRef(0),favoritePending=useRef(false),lastResume=useRef(0);
 const progress=scanProgress(data?.run),strategy=view==='core'?'core':'bounce';
 const refresh=useCallback(async(append=false)=>{
  listRequest.current?.abort();const controller=new AbortController();listRequest.current=controller;loadingRequest.current=true;
  const {view,search}=lastView.current,offset=append?cursor.current:0,version=favoriteVersion.current;
  try{
   const payload=await request<RadarData>(`/api/radar?strategy=${view}&q=${encodeURIComponent(search)}&limit=40&offset=${offset}`,{signal:controller.signal});
   if(controller.signal.aborted)return;
   setData(payload);if(version===favoriteVersion.current&&!favoritePending.current)setFavorites(payload.favorites);setPortfolioCount(payload.portfolioCount??0);setHasMore(payload.page.hasMore);cursor.current=offset+payload.snapshots.length;setError('');
   setRows(old=>append?[...old,...payload.snapshots.filter(s=>!old.some(p=>p.symbol===s.symbol))]:payload.snapshots);
   void saveOffline({savedAt:new Date().toISOString(),run:payload.dataRun,snapshots:payload.snapshots}).catch(()=>{});
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'تعذّر تحميل البيانات');}
  finally{if(!controller.signal.aborted){setLoading(false);loadingRequest.current=false;}}
 },[]);
 useEffect(()=>{lastView.current={view,search};cursor.current=0;queueMicrotask(()=>{setLoading(true);setRows([]);void refresh()});return()=>listRequest.current?.abort()},[view,search,refresh]);
 useEffect(()=>{
  if(!progress.active)return;
  let pending=false;const controller=new AbortController();
  const timer=window.setInterval(async()=>{
   if(pending||document.hidden)return;pending=true;
   try{
    const payload=await request<{run:ScanRun|null}>('/api/radar?status=1',{signal:controller.signal});
    if(controller.signal.aborted)return;
    setData(old=>old?{...old,run:payload.run}:old);
    if(payload.run&&scanProgress(payload.run).active&&Date.now()-Date.parse(payload.run.updated_at)>15_000&&Date.now()>Number(payload.run.lease_until||0)&&Date.now()-lastResume.current>15_000){
     lastResume.current=Date.now();void request('/api/background-scan/resume',post({runId:payload.run.id})).catch(()=>{});
    }
    const next=scanProgress(payload.run);
    if(!next.active){setNotice(next.phase);await refresh();}
   }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'تعذّر تحديث حالة الفحص');}
   finally{pending=false;}
  },2500);
  return()=>{window.clearInterval(timer);controller.abort();};
 },[progress.active,refresh]);
 useEffect(()=>{if('serviceWorker'in navigator)void navigator.serviceWorker.register('/sw.js').catch(()=>{});return()=>selection.current?.abort()},[]);
 useEffect(()=>{void request<{account:AccountSession|null}>('/api/account').then(value=>setAccount(value.account)).catch(()=>undefined)},[]);
 useEffect(()=>{
  if(view==='portfolio')return;
  const hiddenAt={value:null as number|null};
  const refreshWhenVisible=()=>{
   if(document.visibilityState!=='visible'||loadingRequest.current)return;
   if(hiddenAt.value!=null&&Date.now()-hiddenAt.value<60_000)return;
   hiddenAt.value=null;void refresh();
  };
  const onVisibility=()=>{if(document.visibilityState==='hidden')hiddenAt.value=Date.now();else refreshWhenVisible()};
  const timer=window.setInterval(refreshWhenVisible,10*60_000);
  document.addEventListener('visibilitychange',onVisibility);
  return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',onVisibility)};
 },[refresh,view]);

 async function scan(mode:'quick'|'full'='full'){
  setBusy(true);setError('');
  try{const p=await request<{run:ScanRun}>('/api/background-scan/start',post({mode}));setData(old=>old?{...old,run:p.run}:{run:p.run,dataRun:null,snapshots:[],favorites:[],summary:{total:0,coreQualified:0,bounceQualified:0,coreUnknown:0,bounceUnknown:0},page:{hasMore:false}});setNotice('بدأ الفحص على الخادم. يمكنك إغلاق التطبيق والعودة لنفس الجولة.');await refresh()}
  catch(e){setError(e instanceof Error?e.message:'تعذّر بدء الفحص')}finally{setBusy(false)}
 }
 async function favorite(s:Snapshot){
  if(favoritePending.current)return;favoritePending.current=true;favoriteVersion.current++;setSaving(s.symbol);setError('');
  try{const saved=!favorites.includes(s.symbol);const p=await request<{favorites:string[]}>('/api/radar',post({action:'favorite',symbol:s.symbol,saved,...(saved?{snapshot:s}:{})}));setFavorites(p.favorites);if(view==='favorites')await refresh()}
  catch(e){setError(e instanceof Error?e.message:'تعذّر حفظ المفضلة')}finally{favoritePending.current=false;favoriteVersion.current++;setSaving(null)}
 }
 async function accountAction(event:React.FormEvent){
  event.preventDefault();setAccountBusy(true);setError('');
  try{
   const value=await request<{account:AccountSession|null}>('/api/account',post({action:accountMode,username:accountUsername,password:accountPassword}));
   setAccount(value.account);setAccountPassword('');setAccountOpen(false);setAccountRevision(version=>version+1);await refresh();setNotice(accountMode==='signup'?'تم إنشاء الحساب ومزامنة بيانات هذا الجهاز.':'تم تسجيل الدخول ومزامنة بياناتك.');
  }catch(error){setError(error instanceof Error?error.message:'تعذّر تسجيل الحساب.')}finally{setAccountBusy(false)}
 }
 async function logout(){
  setAccountBusy(true);setError('');
  try{await request('/api/account',post({action:'logout'}));setAccount(null);setAccountRevision(version=>version+1);await refresh();setNotice('تم تسجيل الخروج.')}catch(error){setError(error instanceof Error?error.message:'تعذّر تسجيل الخروج.')}finally{setAccountBusy(false)}
 }
 async function openCompany(s:Snapshot,baseline:ReturnType<typeof evaluateStrategy>|null=evaluateStrategy(strategy,s)){
  selection.current?.abort();const controller=new AbortController();selection.current=controller;
  setSelected(s);setSelectedEvaluation(baseline);setDetailLoading(true);setDetailError('');
  try{const p=await request<{snapshot:Snapshot}>(`/api/company?symbol=${encodeURIComponent(s.symbol)}`,{signal:controller.signal});if(!controller.signal.aborted)setSelected(p.snapshot)}
  catch(e){if(!controller.signal.aborted)setDetailError(e instanceof Error?e.message:'تعذّر تحديث الملف')}
  finally{if(!controller.signal.aborted)setDetailLoading(false)}
 }
 function closeCompany(){selection.current?.abort();setSelected(null);setSelectedEvaluation(null);setDetailLoading(false)}
 async function copy(symbol:string){try{await navigator.clipboard.writeText(symbol);setCopied(symbol);window.setTimeout(()=>setCopied(''),1500)}catch{setNotice('تعذّر النسخ؛ يمكنك تحديد الرمز ونسخه يدويًا.')}}
 async function lookup(){
  setSearch(query.trim());
  if(!/^[A-Za-z][A-Za-z0-9.^-]{0,15}$/.test(query.trim()))return;
  const found=rows.find(s=>s.symbol===query.trim().toUpperCase());if(found){await openCompany(found);return;}
  selection.current?.abort();const controller=new AbortController();selection.current=controller;
  setBusy(true);setError('');
  try{const p=await request<{snapshot:Snapshot}>(`/api/company?symbol=${encodeURIComponent(query.trim().toUpperCase())}`,{signal:controller.signal});if(!controller.signal.aborted){setSelected(p.snapshot);setDetailError('');setDetailLoading(false);}}
  catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'لا توجد بيانات لهذا الرمز')}finally{setBusy(false)}
 }
 async function notifications(testOnly=false){
  setNotificationBusy(true);setError('');
  try{
   if(!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window))throw Error('على iPhone افتح الموقع في Safari، أضفه للشاشة الرئيسية، ثم افتحه من الأيقونة لتفعيل الإشعارات.');
   if(!testOnly&&await Notification.requestPermission()!=='granted')throw Error('لم يُمنح إذن الإشعارات؛ راجع إعدادات المتصفح.');
   const registration=await Promise.race([navigator.serviceWorker.ready,new Promise<never>((_,reject)=>window.setTimeout(()=>reject(Error('تعذّر تجهيز الإشعارات؛ أعد فتح التطبيق ثم حاول مجددًا.')),10000))]);let subscription=await registration.pushManager.getSubscription();
   if(testOnly&&!subscription)throw Error('فعّل الإشعارات أولًا، ثم اختبر وصولها.');
   if(!testOnly){
    const key=await request<{publicKey:string}>('/api/push/key');
    if(!key.publicKey)throw Error('مفتاح الإشعارات غير مضبوط على الخادم.');
    const normalized=key.publicKey.replace(/-/g,'+').replace(/_/g,'/');
    const bytes=Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,'=')),c=>c.charCodeAt(0));
    subscription=subscription||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
    await request('/api/push/subscribe',post(subscription));setNotice('حُفظ الاشتراك. اضغط اختبار الإشعار للتحقق من وصوله إلى جهازك.');
   }else {await request('/api/push/test',post({endpoint:subscription!.endpoint}));setNotice('قبل مزود الإشعارات رسالة الاختبار؛ تأكد من وصولها على جهازك.');}
  }catch(e){setError(e instanceof Error?e.message:'تعذّر إرسال الإشعار')}finally{setNotificationBusy(false)}
 }
 function exportData(){const blob=new Blob([JSON.stringify({run:data?.dataRun,activeRun:data?.run,strategy:SPECS[strategy],results:rows.map(s=>({snapshot:s,evaluation:evaluateStrategy(strategy,s)}))},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='radar-visible-results.json';a.click();URL.revokeObjectURL(url)}
 async function importFile(file?:File){if(!file)return;setBusy(true);try{if(file.size>4_000_000)throw Error('الحد الأقصى 4 MB');const value=JSON.parse(await file.text());const records=Array.isArray(value)?value:Array.isArray(value.results)?value.results.map((row:{snapshot:Snapshot})=>row.snapshot):value.snapshots;await request('/api/radar',post({action:'import',records}));await refresh();setNotice('حُفظت اللقطة وأُعيد تقييمها.')}catch(e){setError(String(e))}finally{setBusy(false)}}
 const evaluated=useMemo(()=>rows.map(s=>({s,e:evaluateStrategy(strategy,s)})),[rows,strategy]);
 const count=view==='favorites'?favorites.length:view==='core'?data?.summary.coreRanked:data?.summary.bounceRanked;
 return <div className="radar-app" dir="rtl">
  <header className="radar-header"><div className="header-inner">
   <div className="header-line"><div className="brand"><h1>رادار الشركات الصغيرة</h1><p>{(data?.summary.total??0).toLocaleString('en-US')} شركة مفحوصة · {day(data?.dataRun?.updated_at)}</p></div>
    <div className="header-actions"><button className={`favorite-pill ${view==='favorites'?'chosen':''}`} onClick={()=>setView('favorites')} aria-label={`المفضلة: ${favorites.length}`}><Star size={18} fill={view==='favorites'?'currentColor':'none'}/><span>{favorites.length}</span></button><button className={`account-pill ${account?'signed-in':''}`} onClick={()=>setAccountOpen(true)} aria-label={account?`الحساب ${account.username}`:'فتح مزامنة الحساب'}><UserRound size={17}/><span>{account?.username||'مزامنة'}</span></button><button className="scan-button" onClick={()=>scan()} disabled={busy||progress.active}><RefreshCw size={16} className={busy||progress.active?'spin':''}/>{busy?'جارٍ البدء':progress.active?'جارٍ الفحص':'فحص السوق'}</button></div></div>
   <form className="search-box" onSubmit={e=>{e.preventDefault();void lookup()}}><Search size={18}/><input aria-label="ابحث برمز السهم أو اسم الشركة" placeholder="ابحث برمز السهم أو اسم الشركة" value={query} onChange={e=>{setQuery(e.target.value);if(!e.target.value)setSearch('')}}/><button disabled={!query.trim()||busy}>بحث</button></form>
  </div></header>
  <main className="radar-main">
   {(error||notice)&&<div className={`message ${error?'error':''}`} role={error?'alert':'status'}><span>{error||notice}</span><button aria-label="إغلاق الرسالة" onClick={()=>{setError('');setNotice('')}}><X size={16}/></button></div>}
   {data?.summary.stale&&<div className="message" role="status"><span>أُعيد تقييم آخر لقطة محفوظة بالمحرك الحالي حتى لا تختفي النتائج. ابدأ فحصًا جديدًا لتحديث البيانات وربطها بهذه النسخة.</span><button onClick={()=>scan()} disabled={busy||progress.active}>تحديث الآن</button></div>}
   {(data?.run||busy)&&<section className="scan-panel" aria-label="تقدم فحص السوق"><div className="scan-heading"><b>{busy&&!data?.run?'تجهيز الفحص':progress.phase}</b><strong dir="ltr">{progress.percent.toFixed(2)}<small> / 100.00%</small></strong></div><Progress value={progress.percent} aria-label="تقدم فحص السوق" aria-valuetext={`${progress.percent.toFixed(2)} بالمئة، ${progress.phase}`}/><div className="scan-meta"><span>{(([4,5,10].includes(data?.run?.stage??-1)?data?.run?.offset:data?.run?.processed)??0).toLocaleString('en-US')} / {(data?.run?.total??0).toLocaleString('en-US')} في المرحلة</span><span>{progress.active?'الفحص مستمر على الخادم':data?.run?.failed?`${data.run.failed} شركة تعذّر جلب تاريخها`:'النتائج محفوظة'}</span></div>{data?.run?.error&&<p className="muted">{data.run.error}</p>}<details><summary>تفاصيل التقدم</summary><p>النسبة تمثل مراحل العمل المنجزة، وليست نسبة الوقت المتبقي. تتحرك فقط مع تقدم محفوظ من الخادم؛ مرحلة الاستعادة تعرض عدد الشركات التي تمت معالجتها.</p><p dir="ltr">{data?.run?.id}</p><p>آخر تحديث: {data?.run?.updated_at||'بانتظار الخادم'}</p></details></section>}
   {(data?.run||data?.dataRun)&&<p><button className="text-button" onClick={()=>{setReportOpen(true);setSettings(true)}}>عرض نتائج الجولة وأسباب عدم التأهيل</button>{data?.run&&data?.dataRun&&data.run.id!==data.dataRun.id&&<span> · القوائم تعرض آخر نتيجة محفوظة؛ تقرير الجولة يعرض الفحص الأحدث.</span>}</p>}
   <Tabs value={view} onValueChange={v=>{setView(v as View);setQuery('');setSearch('')}} dir="rtl" className="main-tabs"><TabsList aria-label="القوائم الرئيسية">{(['bounce','core','favorites','portfolio'] as View[]).map(v=><TabsTrigger key={v} value={v} className={v}>{v==='portfolio'&&<BriefcaseBusiness size={16}/>} {names[v]} <span>({v==='portfolio'?portfolioCount:v==='favorites'?favorites.length:v==='core'?data?.summary.coreRanked??0:data?.summary.bounceRanked??0})</span></TabsTrigger>)}</TabsList></Tabs>
   {view==='portfolio'?<PortfolioView key={accountRevision} onOpenCompany={snapshot=>void openCompany(snapshot,null)} onCountChange={setPortfolioCount}/>:<>
   <section className={`strategy-brief ${view}`}>
    {view==='favorites'?<><div className="section-line"><h2>المفضلة ({favorites.length})</h2><button className="text-button" onClick={()=>setView('bounce')}>عودة للكل</button></div><p>قائمتك الخاصة. الحفظ لا يجعل السهم مؤهلًا للاستراتيجية.</p></>:<>
     <p>{view==='bounce'?<>قائمة ارتداد قصيرة الأجل. لا يدخلها إلا سهم يجتاز الهبوط، الابتعاد عن القاع، التخفيف المراجَع، والانعكاس فوق MA30W؛ ثم ترتبه الدرجة.</>:<>قائمة قيمة طويلة الأجل. لا يدخلها إلا سهم يجتاز الإيرادات، EV/S، الربحية، السيولة، الحجم، ومراجعة مخاطر التمويل؛ ثم ترتبه الدرجة.</>}</p>
     <div className="model-state"><b>حالة النموذج: تشخيصي — التحقق التاريخي محجوب</b><span>الدرجة ترتب الأسهم من 100، لكنها ليست احتمال ربح. لن يظهر احتمال مستقل قبل نجاح المعايرة والاختبار النهائي.</span></div>
     <div className="brief-stats"><div><b>{count??0}</b><span>شركة مؤهلة في الترتيب</span></div><div><b>{view==='core'?data?.summary.coreFailed??0:data?.summary.bounceFailed??0}</b><span>مستبعدة بدليل</span></div><div><b>{view==='core'?data?.summary.coreUnknown??0:data?.summary.bounceUnknown??0}</b><span>بيانات تحتاج تحققًا</span></div></div>
    <details><summary>كيف تُقرأ الدرجة والأهلية؟</summary><p>القائمة تعرض فقط الشركات التي اجتازت كل بوابات الفئة، ثم ترتبها بالدرجة من الأعلى إلى الأقل. FAIL أو UNKNOWN لا يمكن أن تنقذه درجة عالية؛ ويبقى في تقرير الجولة مع سبب استبعاده. البيانات الناقصة لا تصبح صفرًا أو PASS.</p><p>حالة النموذج الحالية <b>تشخيصية</b>. لا تُفعّل أوزان تنبؤية أو احتمالات قبل dataset تاريخي Point-in-Time يشمل الشركات المشطوبة واختبار نهائي مغلق.</p></details>
    </>}
   </section>
   <div className="utility-row"><span>{loading?'جارٍ تحميل القائمة…':`${evaluated.length} نتيجة معروضة${search?` · ${search}`:''}`}</span><div><button onClick={()=>void refresh()} disabled={loading} aria-label="تحديث القائمة"><RefreshCw size={17} className={loading?'spin':''}/></button><button onClick={exportData} aria-label="تصدير النتائج"><Download size={17}/></button><button onClick={()=>setSettings(true)} aria-label="الإشعارات ومركز البيانات"><Bell size={17}/><Database size={17}/></button></div></div>
   {data?.dataRunId&&data.run?.id!==data.dataRunId&&<p className="muted">نعرض آخر نتيجة محفوظة حتى ينتهي الفحص الجديد؛ لن تُستبدل بنتيجة لا تزال قيد المعالجة.</p>}
   {loading?<div className="list-loading" role="status"><RefreshCw className="spin"/> جارٍ تحميل البيانات المحفوظة…</div>:evaluated.length?<ul className="stock-list">{evaluated.map(({s,e},index)=><li className={`stock-card ${strategy} ${favorites.includes(s.symbol)?'saved':''}`} key={s.symbol}>
    <button className="card-open" aria-label={`فتح ملف ${s.symbol}`} onClick={()=>openCompany(s,e)}/>
    <div className="stock-top"><div className="stock-identity"><span className="rank-number" dir="ltr">#{index+1}</span><b dir="ltr">{s.symbol}</b><button className="copy-button" onClick={()=>copy(s.symbol)} aria-label={`نسخ ${s.symbol}`}>{copied===s.symbol?'تم':'نسخ'}</button><button className={`star-button ${favorites.includes(s.symbol)?'saved':''}`} onClick={()=>favorite(s)} disabled={saving===s.symbol} aria-label={`${favorites.includes(s.symbol)?'إزالة':'إضافة'} ${s.symbol} ${favorites.includes(s.symbol)?'من':'إلى'} المفضلة`}><Star size={21} fill={favorites.includes(s.symbol)?'currentColor':'none'}/></button><span dir="auto">{s.nameAr||s.name}</span></div><div className="card-score"><strong>{e.score==null?'—':e.score.toFixed(1)}</strong><small>من 100 · {e.status==='PASS'?'مؤهل للفئة':e.status==='FAIL'?'فشل بوابة أهلية':'بيانات غير مثبتة'}</small><em className={e.status.toLowerCase()}>{e.status==='PASS'?'الأهلية مؤكدة':e.status==='FAIL'?'مرفوض':'يحتاج تحققًا'} · تغطية {e.scoreCoverage.toFixed(1)}%</em></div></div>
    <div className="stock-price"><b dir="ltr">{price(s.price)}</b><span className={s.dailyChange==null?'muted':s.dailyChange>=0?'pass':'fail'}>{s.dailyChange==null?'تغير الجلسة غير متاح':`${percent(s.dailyChange)} آخر جلسة`}</span></div><p className="stock-meta" dir="auto">{s.exchange||'السوق غير متاح'} · ${money(s.marketCap)}</p>
    <div className="check-chips">{e.checks.filter(c=>!['provenance','freshness','filingFreshness','conflict'].includes(c.id)).map(c=><span key={c.id} className={c.status.toLowerCase()}>{mark[c.status]} {checkLabel[c.id]||c.label}</span>)}</div>
    {view==='favorites'&&!e.screeningQualified&&<p className="card-warning">{e.status==='FAIL'?'فشل بوابة سلامة':'بوابات السلامة غير مثبتة'}: {e.checks.filter(c=>c.status!=='PASS').map(c=>checkLabel[c.id]||c.label).join('، ')}</p>}
   </li>)}</ul>:<section className="empty-state"><h2>{view==='favorites'?'لم تضف أي سهم إلى المفضلة':search?'لا توجد نتائج مطابقة':data?.dataRun?'لا توجد شركات مؤهلة في هذه اللقطة':'لم تُنشأ لقطة سوق بعد'}</h2><p>{view==='favorites'?'اضغط النجمة بجانب السهم لحفظه هنا.':search?'ابحث برمز سهم لفتح ملفه، أو امسح البحث لرؤية القائمة.':data?.dataRun?'الجولة محفوظة؛ راجع تقرير الجولة لرؤية كل الشركات وأسباب استبعادها.':'ابدأ فحص السوق. ستظهر فقط الشركات التي تجتاز كل بوابات الفئة، مرتبة بدرجة تشخيصية.'}</p>{!data?.dataRun&&view!=='favorites'&&<button className="scan-button" onClick={()=>scan()} disabled={busy||progress.active}>فحص السوق</button>}</section>}
   {hasMore&&!loading&&<button className="load-more" onClick={()=>refresh(true)}>عرض المزيد <ChevronDown size={16}/></button>}
   <footer className="radar-footer"><h3>ما لا تفعله هذه الأداة</h3><p>لا تحول الدرجة إلى وعد بالعائد. الشراء الداخلي يُجلب من نماذج Form 4 عند فتح السهم، وكل قيمة ناقصة تبقى غير متاحة. النموذج الحالي ترتيب تشخيصي إلى أن ينجح الاختبار التاريخي المغلق.</p><button onClick={()=>setSettings(true)}>المنهجية والمصادر وسجل التدقيق</button></footer>
   </>}
  </main>
  <CompanySheet snapshot={selected} strategy={strategy} baselineEvaluation={selectedEvaluation} loading={detailLoading} error={detailError} onClose={closeCompany} onRetry={()=>selected&&openCompany(selected,selectedEvaluation)} favorite={selected?favorites.includes(selected.symbol):false} onFavorite={()=>selected&&favorite(selected)} onCopy={()=>selected&&copy(selected.symbol)}/>
  <Dialog open={accountOpen} onOpenChange={setAccountOpen}><DialogContent className="account-dialog" dir="rtl"><DialogTitle>{account?'حساب المزامنة':'مزامنة بياناتك بين الأجهزة'}</DialogTitle><DialogDescription>{account?'المحفظة والمفضلة محفوظتان على هذا الحساب ويمكن فتحهما من الهاتف والكمبيوتر.':'أنشئ حسابًا بكلمة مرور حتى تظهر المحفظة والمفضلة نفسها على كل أجهزتك.'}</DialogDescription>{account?<div className="account-status"><div><UserRound size={22}/><b dir="ltr">{account.username}</b></div><p>آخر التغييرات تُحفظ على الخادم وتظهر بعد تسجيل الدخول بهذا الحساب.</p><button className="account-submit" onClick={()=>void logout()} disabled={accountBusy}><LogOut size={17}/>{accountBusy?'جارٍ التنفيذ…':'تسجيل الخروج'}</button></div>:<form className="account-form" onSubmit={accountAction}><div className="account-mode" role="tablist" aria-label="نوع الحساب"><button type="button" className={accountMode==='login'?'active':''} onClick={()=>setAccountMode('login')}>تسجيل الدخول</button><button type="button" className={accountMode==='signup'?'active':''} onClick={()=>setAccountMode('signup')}>إنشاء حساب</button></div><label>اسم المستخدم<input required minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" autoComplete="username" value={accountUsername} onChange={event=>setAccountUsername(event.target.value)} placeholder="مثال: yousef" dir="ltr"/></label><label>كلمة المرور<input required minLength={8} maxLength={128} type="password" autoComplete={accountMode==='login'?'current-password':'new-password'} value={accountPassword} onChange={event=>setAccountPassword(event.target.value)} placeholder="8 أحرف على الأقل" dir="ltr"/></label><p>بياناتك الحالية على هذا الجهاز ستُنقل إلى الحساب عند الإنشاء أو تسجيل الدخول.</p><button className="account-submit" disabled={accountBusy}>{accountBusy?<RefreshCw className="spin" size={17}/>:accountMode==='login'?<LogIn size={17}/>:<UserRound size={17}/>} {accountBusy?'جارٍ الحفظ…':accountMode==='login'?'دخول ومزامنة':'إنشاء ومزامنة'}</button></form>}</DialogContent></Dialog>
  <Dialog open={settings} onOpenChange={setSettings}><DialogContent className="settings-dialog" dir="rtl" showCloseButton={false}><DialogClose className="absolute top-4 left-4" aria-label="إغلاق مركز البيانات"><X size={20}/></DialogClose><DialogTitle>مركز البيانات والإشعارات</DialogTitle><DialogDescription>حالة المصادر والفحص، وأدوات حفظ النتائج ومراجعتها.</DialogDescription>
   <div className="settings-scroll">{(error||notice)&&<div className={`message ${error?'error':''}`} role={error?'alert':'status'}>{error||notice}</div>}<section><h3>إشعار اكتمال الفحص</h3><p>على iPhone: افتح الموقع في Safari ← أضف إلى الشاشة الرئيسية ← افتحه من الأيقونة ← فعّل الإشعارات ← وافق على الإذن ← اختبر الإشعار.</p><div className="action-pair"><button onClick={()=>notifications()} disabled={notificationBusy}>تفعيل الإشعارات</button><button onClick={()=>notifications(true)} disabled={notificationBusy}>اختبار الإشعار</button></div><small>قبول الإرسال من المزود ليس دليل وصول على الهاتف.</small></section>
   <section><h3>حالة نموذج {strategy==='bounce'?'فرص الارتداد':'القيمة الأساسية'}</h3><dl className="data-grid"><div><dt>نسخة النموذج</dt><dd dir="ltr">{SPECS[strategy].model.version}</dd></div><div><dt>نوع الدرجة</dt><dd>تشخيصية</dd></div><div><dt>احتمال النتيجة</dt><dd>محجوب</dd></div><div><dt>الاعتماد التاريخي</dt><dd>لم يكتمل</dd></div></dl><p>{SPECS[strategy].model.objective}</p><p className="muted">السبب: لا تتوفر بعد مجموعة PIT مكتملة تشمل الشركات المشطوبة ونتائج مستقبلية ناضجة. لن تُعرض أوزان مدرّبة أو احتمالات مصطنعة.</p></section>
   <section><h3>دراسة التحسين والتحقق</h3><p>{VALIDATION_REPORT.bounce.status}. هذه مقارنة تاريخية سعرية مجانية وليست احتمال ربح ولا اعتمادًا لإنتاج الأسهم.</p><dl className="data-grid"><div><dt>خط الأساس النهائي</dt><dd dir="ltr">{VALIDATION_REPORT.bounce.final.baseline.toFixed(2)}%</dd></div><div><dt>المرشح النهائي</dt><dd dir="ltr">{VALIDATION_REPORT.bounce.final.challenger.toFixed(2)}%</dd></div><div><dt>العشوائي المطابق</dt><dd dir="ltr">{VALIDATION_REPORT.bounce.final.random.toFixed(2)}%</dd></div><div><dt>عدد النتائج الناضجة</dt><dd dir="ltr">{VALIDATION_REPORT.bounce.final.observations} / {VALIDATION_REPORT.bounce.final.firms} شركات</dd></div></dl><p className="muted">المرشح: {VALIDATION_REPORT.bounce.candidate}. فاصل الثقة للمرشح {VALIDATION_REPORT.bounce.final.ciLow.toFixed(2)}–{VALIDATION_REPORT.bounce.final.ciHigh.toFixed(2)}%، وفاصل فرق الشركات {VALIDATION_REPORT.bounce.final.clusteredDeltaLow.toFixed(2)}–{VALIDATION_REPORT.bounce.final.clusteredDeltaHigh.toFixed(2)} نقطة مئوية؛ لذلك لم تُستبدل أوزان الإنتاج به.</p><p className="muted">Core: {VALIDATION_REPORT.core.status}. {VALIDATION_REPORT.core.reason}</p></section>
   {reportOpen&&(data?.run||data?.dataRun)&&<ScanReport key={`${data?.run?.id??data?.dataRun?.id}:${strategy}`} runId={(data?.run?.id??data?.dataRun?.id)!} strategy={strategy} onOpen={symbol=>{setSettings(false);void openCompany({symbol,name:symbol,asOf:new Date().toISOString(),provenance:{}},null)}}/>}
   <section><h3>تغطية آخر فحص</h3><dl className="data-grid"><div><dt>دليل السوق</dt><dd>{data?.run?.universe_total??'—'}</dd></div><div><dt>أسعار متاحة</dt><dd>{data?.run?.quote_coverage??'—'}</dd></div><div><dt>شركات لها أساسيات</dt><dd>{data?.run?.fundamental_coverage??'—'}</dd></div><div><dt>طلبات غير مكتملة</dt><dd>{data?.run?.failed??'—'}</dd></div></dl>{data?.coverage&&<><p>تغطية الحقول من {data.coverage.total.toLocaleString('en-US')} لقطة محفوظة:</p><div className="coverage-chips">{([['revenue','إيرادات'],['netIncome','صافي الدخل'],['fcf','FCF'],['cash','نقد'],['debt','دين'],['medianDollarVolume20d','سيولة 20 يومًا'],['return12m','عائد سنة'],['low52w','قاع 52 أسبوعًا'],['ma30w','MA30W'],['dilution','تخفيف']] as const).map(([key,label])=><span key={key}>{label}: {Math.round(data.coverage!.fields[key]/Math.max(1,data.coverage!.total)*100)}%</span>)}</div></>}<p>{data?.run?.source||'لا يوجد فحص بعد'}</p><p>الحقول غير المتاحة تبقى غير مثبتة. راجع مصدر كل قيمة وتاريخ توفرها داخل ملف الشركة؛ عدم وجود رقم لا يتحول إلى صفر.</p><div className="action-pair"><button onClick={()=>scan('quick')} disabled={busy||progress.active}>فحص عينة 12 سهمًا</button><button onClick={()=>refresh()}>تحديث الحالة</button></div></section>
   <section><h3>التصدير والاستيراد</h3><div className="export-links"><a href="/api/export?kind=audit" download>سجل التدقيق</a><a href="/api/export?kind=spec" download>مواصفة المحرك</a><a href="/api/export?kind=schema" download>قالب البيانات</a></div><label className="file-import">استيراد لقطة JSON موثقة<input type="file" accept="application/json" disabled={busy} onChange={e=>importFile(e.target.files?.[0])}/></label></section>
   <section><h3>خصوصية المفضلة</h3><p>المفضلة منفصلة لكل هوية دخول، أو لكل متصفح للزائر غير المسجل، ومحفوظة على الخادم. لم تُنقل عناصر القائمة المشتركة السابقة إلى قائمتك. حذف ملفات تعريف الارتباط للزائر غير المسجل يفقده مفتاح قائمته.</p></section></div>
  </DialogContent></Dialog>
 </div>;
}
