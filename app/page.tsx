'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Star,RefreshCw,Download,Bell,Database,Search,X,ChevronDown} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Progress} from '@/components/ui/progress';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {evaluateStrategy,SPECS,type Snapshot} from '@/lib/engine';
import {scanProgress,type ScanRun} from '@/lib/scan-progress';
import {saveOffline} from '@/lib/offline';
import {money,price,percent,day,mark,checkLabel} from './radar-format';
import CompanySheet from './company-sheet';

type View='core'|'bounce'|'favorites';
type RadarData={run:ScanRun|null;dataRun:ScanRun|null;dataRunId?:string;snapshots:Snapshot[];favorites:string[];summary:{total:number;coreQualified:number;bounceQualified:number;coreUnknown:number;bounceUnknown:number};page:{hasMore:boolean}};
const names:Record<View,string>={bounce:'فرص الارتداد',core:'القيمة الأساسية',favorites:'المفضلة'};
async function request<T>(url:string,options?:RequestInit):Promise<T>{const r=await fetch(url,options),p=await r.json();if(!r.ok)throw Error(p.error||'تعذّر الاتصال بالخادم');return p;}
const post=(data:unknown)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});

export default function RadarApp(){
 const [view,setView]=useState<View>('bounce'),[query,setQuery]=useState(''),[search,setSearch]=useState('');
 const [data,setData]=useState<RadarData|null>(null),[rows,setRows]=useState<Snapshot[]>([]),[favorites,setFavorites]=useState<string[]>([]);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [selected,setSelected]=useState<Snapshot|null>(null),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState('');
 const [settings,setSettings]=useState(false),[notificationBusy,setNotificationBusy]=useState(false),[saving,setSaving]=useState<string|null>(null);
 const [hasMore,setHasMore]=useState(false),[copied,setCopied]=useState('');
 const selection=useRef<AbortController|null>(null),lastView=useRef({view,search}),listRequest=useRef<AbortController|null>(null);
 const cursor=useRef(0),loadingRequest=useRef(false);
 const progress=scanProgress(data?.run),strategy=view==='core'?'core':'bounce';
 const refresh=useCallback(async(append=false)=>{
  listRequest.current?.abort();const controller=new AbortController();listRequest.current=controller;loadingRequest.current=true;
  const {view,search}=lastView.current,offset=append?cursor.current:0;
  try{
   const payload=await request<RadarData>(`/api/radar?strategy=${view}&q=${encodeURIComponent(search)}&limit=40&offset=${offset}`,{signal:controller.signal});
   if(controller.signal.aborted)return;
   setData(payload);setFavorites(payload.favorites);setHasMore(payload.page.hasMore);cursor.current=offset+payload.snapshots.length;
   setRows(old=>append?[...old,...payload.snapshots.filter(s=>!old.some(p=>p.symbol===s.symbol))]:payload.snapshots);
   void saveOffline({savedAt:new Date().toISOString(),run:payload.dataRun,snapshots:payload.snapshots}).catch(()=>{});
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'تعذّر تحميل البيانات');}
  finally{if(!controller.signal.aborted){setLoading(false);loadingRequest.current=false;}}
 },[]);
 useEffect(()=>{lastView.current={view,search};cursor.current=0;queueMicrotask(()=>{setLoading(true);setRows([]);void refresh()});return()=>listRequest.current?.abort()},[view,search,refresh]);
 useEffect(()=>{if(!progress.active)return;const timer=window.setInterval(()=>{if(!loadingRequest.current)void refresh()},2500);return()=>window.clearInterval(timer)},[progress.active,refresh]);
 useEffect(()=>{if('serviceWorker'in navigator)void navigator.serviceWorker.register('/sw.js').catch(()=>{});return()=>selection.current?.abort()},[]);

 async function scan(mode:'quick'|'full'='full'){
  setBusy(true);setError('');
  try{const p=await request<{run:ScanRun}>('/api/background-scan/start',post({mode}));setData(old=>old?{...old,run:p.run}:{run:p.run,dataRun:null,snapshots:[],favorites:[],summary:{total:0,coreQualified:0,bounceQualified:0,coreUnknown:0,bounceUnknown:0},page:{hasMore:false}});setNotice('بدأ الفحص على الخادم. يمكنك إغلاق التطبيق والعودة لنفس الجولة.');await refresh()}
  catch(e){setError(e instanceof Error?e.message:'تعذّر بدء الفحص')}finally{setBusy(false)}
 }
 async function favorite(s:Snapshot){
  if(saving)return;setSaving(s.symbol);setError('');
  try{const p=await request<{favorites:string[]}>('/api/radar',post({action:'favorite',symbol:s.symbol,saved:!favorites.includes(s.symbol)}));setFavorites(p.favorites);if(view==='favorites')await refresh()}
  catch(e){setError(e instanceof Error?e.message:'تعذّر حفظ المفضلة')}finally{setSaving(null)}
 }
 async function openCompany(s:Snapshot){
  selection.current?.abort();const controller=new AbortController();selection.current=controller;
  setSelected(s);setDetailLoading(true);setDetailError('');
  try{const p=await request<{snapshot:Snapshot}>(`/api/company?symbol=${encodeURIComponent(s.symbol)}`,{signal:controller.signal});if(!controller.signal.aborted)setSelected(p.snapshot)}
  catch(e){if(!controller.signal.aborted)setDetailError(e instanceof Error?e.message:'تعذّر تحديث الملف')}
  finally{if(!controller.signal.aborted)setDetailLoading(false)}
 }
 function closeCompany(){selection.current?.abort();setSelected(null);setDetailLoading(false)}
 async function copy(symbol:string){try{await navigator.clipboard.writeText(symbol);setCopied(symbol);window.setTimeout(()=>setCopied(''),1500)}catch{setNotice('تعذّر النسخ؛ يمكنك تحديد الرمز ونسخه يدويًا.')}}
 async function lookup(){
  setSearch(query.trim());
  if(!/^[A-Za-z][A-Za-z0-9.^-]{0,15}$/.test(query.trim()))return;
  const found=rows.find(s=>s.symbol===query.trim().toUpperCase());if(found){await openCompany(found);return;}
  setBusy(true);setError('');
  try{const p=await request<{snapshot:Snapshot}>(`/api/company?symbol=${encodeURIComponent(query.trim().toUpperCase())}`);setSelected(p.snapshot);setDetailError('')}
  catch(e){setError(e instanceof Error?e.message:'لا توجد بيانات لهذا الرمز')}finally{setBusy(false)}
 }
 async function notifications(testOnly=false){
  setNotificationBusy(true);setError('');
  try{
   if(!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window))throw Error('على iPhone افتح الموقع في Safari، أضفه للشاشة الرئيسية، ثم افتحه من الأيقونة لتفعيل الإشعارات.');
   const registration=await navigator.serviceWorker.ready;let subscription=await registration.pushManager.getSubscription();
   if(testOnly&&!subscription)throw Error('فعّل الإشعارات أولًا، ثم اختبر وصولها.');
   if(!testOnly){
    if(await Notification.requestPermission()!=='granted')throw Error('لم يُمنح إذن الإشعارات؛ راجع إعدادات المتصفح.');
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
 async function importFile(file?:File){if(!file)return;setBusy(true);try{if(file.size>4_000_000)throw Error('الحد الأقصى 4 MB');await request('/api/radar',post({action:'import',records:JSON.parse(await file.text())}));await refresh();setNotice('حُفظت اللقطة وأُعيد تقييمها.')}catch(e){setError(String(e))}finally{setBusy(false)}}
 const evaluated=useMemo(()=>rows.map(s=>({s,e:evaluateStrategy(strategy,s)})).filter(({e})=>view==='favorites'||e.screeningQualified),[rows,strategy,view]);
 const count=view==='favorites'?favorites.length:view==='core'?data?.summary.coreQualified:data?.summary.bounceQualified;
 return <div className="radar-app" dir="rtl">
  <header className="radar-header"><div className="header-inner">
   <div className="header-line"><div className="brand"><h1>رادار الشركات الصغيرة</h1><p>{(data?.summary.total??0).toLocaleString('en-US')} شركة مفحوصة · {day(data?.dataRun?.updated_at)}</p></div>
    <div className="header-actions"><button className={`favorite-pill ${view==='favorites'?'chosen':''}`} onClick={()=>setView('favorites')} aria-label={`المفضلة: ${favorites.length}`}><Star size={18} fill={view==='favorites'?'currentColor':'none'}/><span>{favorites.length}</span></button><button className="scan-button" onClick={()=>scan()} disabled={busy||progress.active}><RefreshCw size={16} className={busy||progress.active?'spin':''}/>{busy?'جارٍ البدء':progress.active?'جارٍ الفحص':'فحص السوق'}</button></div></div>
   <form className="search-box" onSubmit={e=>{e.preventDefault();void lookup()}}><Search size={18}/><input aria-label="ابحث برمز السهم أو اسم الشركة" placeholder="ابحث برمز السهم أو اسم الشركة" value={query} onChange={e=>{setQuery(e.target.value);if(!e.target.value)setSearch('')}}/><button disabled={!query.trim()||busy}>بحث</button></form>
  </div></header>
  <main className="radar-main">
   {(error||notice)&&<div className={`message ${error?'error':''}`} role={error?'alert':'status'}><span>{error||notice}</span><button aria-label="إغلاق الرسالة" onClick={()=>{setError('');setNotice('')}}><X size={16}/></button></div>}
   {(data?.run||busy)&&<section className="scan-panel" aria-label="تقدم فحص السوق"><div className="scan-heading"><b>{busy&&!data?.run?'تجهيز الفحص':progress.phase}</b><strong dir="ltr">{progress.percent.toFixed(2)}<small> / 100.00%</small></strong></div><Progress value={progress.percent} aria-label="تقدم الفحص" aria-valuetext={`${progress.percent.toFixed(2)} بالمئة، ${progress.phase}`}/><div className="scan-meta"><span>{(data?.run?.stage===10?data.run.offset:data?.run?.processed??0).toLocaleString('en-US')} / {(data?.run?.total??0).toLocaleString('en-US')} في المرحلة</span><span>{progress.active?'الفحص مستمر على الخادم':data?.run?.failed?`${data.run.failed} طلبًا غير مكتمل`:'النتائج محفوظة'}</span></div>{data?.run?.error&&<p className="muted">{data.run.error}</p>}<details><summary>تفاصيل التقدم</summary><p>النسبة تمثل مراحل العمل المنجزة، وليست نسبة الوقت المتبقي. لا تتحرك دون تحديث محفوظ من الخادم.</p><p dir="ltr">{data?.run?.id}</p><p>آخر تحديث: {data?.run?.updated_at||'بانتظار الخادم'}</p></details></section>}
   <Tabs value={view} onValueChange={v=>{setView(v as View);setQuery('');setSearch('')}} dir="rtl" className="main-tabs"><TabsList aria-label="القوائم الرئيسية">{(['bounce','core','favorites'] as View[]).map(v=><TabsTrigger key={v} value={v} className={v}>{names[v]} <span>({v==='favorites'?favorites.length:v==='core'?data?.summary.coreQualified??0:data?.summary.bounceQualified??0})</span></TabsTrigger>)}</TabsList></Tabs>
   <section className={`strategy-brief ${view}`}>
    {view==='favorites'?<><div className="section-line"><h2>المفضلة ({favorites.length})</h2><button className="text-button" onClick={()=>setView('bounce')}>عودة للكل</button></div><p>قائمتك الخاصة. الحفظ لا يجعل السهم مؤهلًا للاستراتيجية.</p></>:<>
     <p>{view==='bounce'?<>هدف مختلف عن بقية القوائم: البحث عن ارتداد قصير الأجل نحو <b>+20%</b>. الملف هنا معكوس — أسهم مهزومة هبطت أكثر من 35% خلال سنة وبدأت ترتد من قاعها، مع تحقق السيولة والتخفيف والانعكاس.</>:<>شركات قوية الأساسيات وسعرها منخفض — فحص التقييم والربحية والسيولة والميزانية. أفق القيمة الأساسية طويل الأجل؛ الدرجة لا تنقذ سهمًا فشل بوابة أساسية.</>}</p>
     <div className="brief-stats"><div><b>{count??0}</b><span>اجتازت كل البوابات</span></div><div><b>{view==='core'?data?.summary.coreUnknown??0:data?.summary.bounceUnknown??0}</b><span>بيانات تحتاج تحققًا</span></div><div><b>{data?.summary.total??0}</b><span>شركة في اللقطة</span></div></div>
     <details><summary>الأدلة الكاملة والمخاطر</summary><p>نعرض الأسهم التي اجتازت كل بوابات القبول فقط. البيانات الناقصة ليست نجاحًا. {view==='bounce'?'نسبة اكتمال البوابات ليست درجة الارتداد القديمة أو احتمال الربح.':'الدرجة التشخيصية قابلة لإعادة الحساب، وليست نموذجًا مثبتًا للتنبؤ بالعائد.'}</p><p>إحصاءات المرجع القديم {view==='bounce'?'65.6% مقابل 43.9% ووسيط 28 يومًا':'‎+23% مقابل +3% وانهيار 25%'} لا تمثل اختبارًا مُعادًا على بيانات هذه النسخة.</p></details>
    </>}
   </section>
   <div className="utility-row"><span>{loading?'جارٍ تحميل القائمة…':`${evaluated.length} نتيجة معروضة${search?` · ${search}`:''}`}</span><div><button onClick={exportData} aria-label="تصدير النتائج"><Download size={17}/></button><button onClick={()=>setSettings(true)} aria-label="الإشعارات ومركز البيانات"><Bell size={17}/><Database size={17}/></button></div></div>
   {data?.dataRunId&&data.run?.id!==data.dataRunId&&<p className="muted">نعرض آخر نتيجة محفوظة حتى ينتهي الفحص الجديد؛ لن تُستبدل بنتيجة لا تزال قيد المعالجة.</p>}
   {loading?<div className="list-loading" role="status"><RefreshCw className="spin"/> جارٍ تحميل البيانات المحفوظة…</div>:evaluated.length?<ul className="stock-list">{evaluated.map(({s,e})=><li className={`stock-card ${strategy} ${favorites.includes(s.symbol)?'saved':''}`} key={s.symbol}>
    <button className="card-open" aria-label={`فتح ملف ${s.symbol}`} onClick={()=>openCompany(s)}/>
    <div className="stock-top"><div className="stock-identity"><b dir="ltr">{s.symbol}</b><button className="copy-button" onClick={()=>copy(s.symbol)} aria-label={`نسخ ${s.symbol}`}>{copied===s.symbol?'تم':'نسخ'}</button><button className={`star-button ${favorites.includes(s.symbol)?'saved':''}`} onClick={()=>favorite(s)} disabled={saving===s.symbol} aria-label={`${favorites.includes(s.symbol)?'إزالة':'إضافة'} ${s.symbol} ${favorites.includes(s.symbol)?'من':'إلى'} المفضلة`}><Star size={21} fill={favorites.includes(s.symbol)?'currentColor':'none'}/></button><span dir="auto">{s.name}</span></div><div className="card-score"><strong>{strategy==='bounce'?`${e.checks.filter(c=>c.status==='PASS').length}/${e.checks.length}`:e.score==null?'—':e.score.toFixed(1)}</strong><small>{strategy==='bounce'?'بوابات مكتملة':'من 100 · تشخيصية'}</small></div></div>
    <div className="stock-price"><b dir="ltr">{price(s.price)}</b><span className={s.dailyChange==null?'muted':s.dailyChange>=0?'pass':'fail'}>{s.dailyChange==null?'تغير الجلسة غير متاح':`${percent(s.dailyChange)} آخر جلسة`}</span></div><p className="stock-meta" dir="auto">{s.exchange||'السوق غير متاح'} · ${money(s.marketCap)}</p>
    <div className="check-chips">{e.checks.filter(c=>!['provenance','freshness','filingFreshness','conflict'].includes(c.id)).map(c=><span key={c.id} className={c.status.toLowerCase()}>{mark[c.status]} {checkLabel[c.id]||c.label}</span>)}</div>
    {view==='favorites'&&!e.screeningQualified&&<p className="card-warning">{e.status==='FAIL'?'لم يجتز شروط القائمة':'القبول غير مثبت'}: {e.checks.filter(c=>c.status!=='PASS').map(c=>checkLabel[c.id]||c.label).join('، ')}</p>}
   </li>)}</ul>:<section className="empty-state"><h2>{view==='favorites'?'لم تضف أي سهم إلى المفضلة':search?'لا توجد نتائج مطابقة':data?.dataRun?'لا توجد أسهم مكتملة الشروط في هذه القائمة':'لم تُنشأ لقطة سوق بعد'}</h2><p>{view==='favorites'?'اضغط النجمة بجانب السهم لحفظه هنا.':search?'ابحث برمز سهم لفتح ملفه، أو امسح البحث لرؤية القائمة.':'ابدأ فحص السوق. ستظهر النتائج المقبولة بعد التحقق؛ البيانات الناقصة تبقى خارج القائمة.'}</p>{!data?.dataRun&&view!=='favorites'&&<button className="scan-button" onClick={()=>scan()} disabled={busy||progress.active}>فحص السوق</button>}</section>}
   {hasMore&&!loading&&<button className="load-more" onClick={()=>refresh(true)}>عرض المزيد <ChevronDown size={16}/></button>}
   <footer className="radar-footer"><h3>ما لا تفعله هذه الأداة</h3><p>لا تقرأ العقود تلقائيًا، ولا تعرف لماذا السهم راكد. الشراء الداخلي يُجلب من نماذج Form 4 عند فتح السهم. الدرجة تقيس مطابقة المعايير لا العائد المتوقع.</p><button onClick={()=>setSettings(true)}>المنهجية والمصادر وسجل التدقيق</button></footer>
  </main>
  <CompanySheet snapshot={selected} strategy={strategy} loading={detailLoading} error={detailError} onClose={closeCompany} onRetry={()=>selected&&openCompany(selected)} favorite={selected?favorites.includes(selected.symbol):false} onFavorite={()=>selected&&favorite(selected)} onCopy={()=>selected&&copy(selected.symbol)}/>
  <Dialog open={settings} onOpenChange={setSettings}><DialogContent className="settings-dialog" dir="rtl"><DialogTitle>مركز البيانات والإشعارات</DialogTitle><DialogDescription>حالة المصادر والفحص، وأدوات حفظ النتائج ومراجعتها.</DialogDescription>
   <div className="settings-scroll">{(error||notice)&&<div className={`message ${error?'error':''}`} role={error?'alert':'status'}>{error||notice}</div>}<section><h3>إشعار اكتمال الفحص</h3><p>على iPhone: افتح الموقع في Safari ← أضف إلى الشاشة الرئيسية ← افتحه من الأيقونة ← فعّل الإشعارات ← وافق على الإذن ← اختبر الإشعار.</p><div className="action-pair"><button onClick={()=>notifications()} disabled={notificationBusy}>تفعيل الإشعارات</button><button onClick={()=>notifications(true)} disabled={notificationBusy}>اختبار الإشعار</button></div><small>قبول الإرسال من المزود ليس دليل وصول على الهاتف.</small></section>
   <section><h3>تغطية آخر فحص</h3><dl className="data-grid"><div><dt>دليل السوق</dt><dd>{data?.run?.universe_total??'—'}</dd></div><div><dt>أسعار متاحة</dt><dd>{data?.run?.quote_coverage??'—'}</dd></div><div><dt>أساسيات متاحة</dt><dd>{data?.run?.fundamental_coverage??'—'}</dd></div><div><dt>طلبات غير مكتملة</dt><dd>{data?.run?.failed??'—'}</dd></div></dl><p>{data?.run?.source||'لا يوجد فحص بعد'}</p><p>قد تُستخدم لقطات مؤرخة عند تعذر المزود. راجع مصدر كل قيمة وتاريخ توفرها داخل ملف الشركة.</p><div className="action-pair"><button onClick={()=>scan('quick')} disabled={busy||progress.active}>فحص عينة 12 سهمًا</button><button onClick={()=>refresh()}>تحديث الحالة</button></div></section>
   <section><h3>التصدير والاستيراد</h3><div className="export-links"><a href="/api/export?kind=audit" download>سجل التدقيق</a><a href="/api/export?kind=spec" download>مواصفة المحرك</a><a href="/api/export?kind=schema" download>قالب البيانات</a></div><label className="file-import">استيراد لقطة JSON موثقة<input type="file" accept="application/json" disabled={busy} onChange={e=>importFile(e.target.files?.[0])}/></label></section>
   <section><h3>خصوصية المفضلة</h3><p>المفضلة منفصلة لكل هوية دخول، أو لكل متصفح للزائر غير المسجل، ومحفوظة على الخادم. لم تُنقل عناصر القائمة المشتركة السابقة إلى قائمتك. حذف ملفات تعريف الارتباط للزائر غير المسجل يفقده مفتاح قائمته.</p></section></div>
  </DialogContent></Dialog>
 </div>;
}
