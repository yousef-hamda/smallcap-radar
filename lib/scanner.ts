import { currentHash, db, ensureSchema, insertSnapshot, log } from './storage';
import { companySnapshot, consumeProviderIssues, historicalMarketData, quickSymbols, universe,yahooBulkQuotes } from './providers';
import { fetchBulkFundamentals, fetchCompanyFactsFallback, needsCompanyFacts, preliminarySnapshot, type BulkFundamentals } from './bulk';
import { bounceHistoryMetrics, reviewShareSplits } from './research';
import { NON_TRADABLE_NAME, SPECS } from './strategy-spec';

const BATCH_SIZE = 1;
const HISTORY_BATCH_SIZE = 18;
const PROVIDER_CONCURRENCY = 6;
const SCORE_BATCH_SIZE = 200;
const COMPANY_FACTS_BATCH_SIZE = 12;
export const SCAN_SOURCE_VERSION = 'Bulk Quotes/SEC Frames + Company Facts v10';
const UNIVERSE_PAGE=1000;
async function saveUniverse(runId:string,companies:any[],kind='candidates'){
 const statements=[];
 for(let offset=0;offset<companies.length;offset+=UNIVERSE_PAGE)statements.push(db().prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(`universe:${runId}:${kind}:${offset/UNIVERSE_PAGE}`,'scan directory checkpoint',new Date().toISOString(),JSON.stringify(companies.slice(offset,offset+UNIVERSE_PAGE))));
 if(statements.length)await db().batch(statements);
}
async function universePage(runId:string,kind:string,index:number){const row=await db().prepare('SELECT payload FROM raw_cache WHERE key=?').bind(`universe:${runId}:${kind}:${index}`).first() as any;return row?JSON.parse(row.payload):[];}
async function runCompanies(run:any){
 if(run.universe!=='paged-v1')return JSON.parse(run.universe||'[]');
 if(run.stage===4){const row=await db().prepare('SELECT payload FROM raw_cache WHERE key=?').bind(`universe:${run.id}:ciks`).first() as any;return JSON.parse(row?.payload||'[]').map((cik:number)=>({cik}));}
 const count=run.stage===9?SCORE_BATCH_SIZE:run.stage===5?COMPANY_FACTS_BATCH_SIZE:run.source.includes('quick')?BATCH_SIZE:HISTORY_BATCH_SIZE;
 const kind=run.stage===10?'history':'candidates';
 const companies:any[]=[];
 const start=Math.floor(run.offset/UNIVERSE_PAGE),end=Math.floor(Math.min(run.total-1,run.offset+count-1)/UNIVERSE_PAGE);
 for(let index=start;index<=end;index++){const page=await universePage(run.id,kind,index);for(let j=0;j<page.length;j++)companies[index*UNIVERSE_PAGE+j]=page[j];}
 return companies;
}

function preliminaryCandidates(companies: any[]) {
  return companies.filter((company) => {
    if (NON_TRADABLE_NAME.test(String(company.name || ''))) return false;
    const marketCap = Number(company.marketCap);
    const price = Number(company.price);
    return Number.isFinite(marketCap) && marketCap >= SPECS.core.marketCap.min && marketCap <= SPECS.core.marketCap.max && Number.isFinite(price) && price > 0;
  });
}

export function bounceHistoryCandidate(snapshot: any) {
  if (snapshot?.securityType !== 'common' || Number(snapshot.marketCap) < SPECS.bounce.marketCap.min || Number(snapshot.marketCap) > SPECS.bounce.marketCap.max || Number(snapshot.price) <= 0) return false;
  // Return, low and MA30W are weighted factors, not rejection filters. Every
  // in-range common share gets the historical evidence needed to score it.
  return true;
}

export function historyCandidate(snapshot: any) {
  if (bounceHistoryCandidate(snapshot)) return true;
  if (snapshot?.securityType !== 'common' || Number(snapshot.marketCap) < SPECS.core.marketCap.min || Number(snapshot.marketCap) > SPECS.core.marketCap.max || Number(snapshot.price) <= 0) return false;
  // Core entry economics are weighted. Fetch history for every in-range
  // common share so the Entry Point factor and audit trail are comparable.
  return true;
}

export const publicRun = (run: any) => ({
  ...run,
  universe: undefined,
  retry_queue: undefined,
  retryPending: JSON.parse(run.retry_queue || '[]').length,
});

export async function startScan(modeInput: unknown) {
  await ensureSchema();
  if (modeInput != null && modeInput !== 'quick' && modeInput !== 'full') throw Object.assign(new Error('نوع الفحص غير صالح'), {status:400});
  const mode = modeInput === 'quick' ? 'quick' : 'full';
  const source = `${SCAN_SOURCE_VERSION} · ${mode}`;
  const database = db();
  const activeSql = "SELECT * FROM strategy_runs WHERE strategy_hash=? AND source LIKE 'Bulk Quotes/%' AND status IN ('running','partial') AND stage<13 ORDER BY created_at DESC LIMIT 1";
  const previous = await database.prepare(activeSql).bind(currentHash()).first();
  if (previous && previous.strategy_hash === currentHash() && (previous.stage < 13 || previous.offset < previous.total || JSON.parse(previous.retry_queue || '[]').length)) return publicRun(previous);
  const recent = await database.prepare('SELECT created_at FROM strategy_runs WHERE source=? ORDER BY created_at DESC LIMIT 1').bind(source).first() as any;
  if (recent && Date.now() - Date.parse(recent.created_at) < 30_000) throw Object.assign(new Error('انتظر نصف دقيقة قبل بدء فحص جديد من النوع نفسه.'), { status: 429 });

  // A single conditional INSERT serializes concurrent quick/full starts in D1.
  // No provider work runs on the user's start request; stage zero is durable.
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const inserted = await database.prepare("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,universe,strategy_hash) SELECT ?,?,?,'running',?,'[]',? WHERE NOT EXISTS(SELECT 1 FROM strategy_runs WHERE strategy_hash=? AND source LIKE 'Bulk Quotes/%' AND status IN ('running','partial') AND stage<13)").bind(id,now,now,source,currentHash(),currentHash()).run();
  return publicRun(inserted.meta.changes
    ? await database.prepare('SELECT * FROM strategy_runs WHERE id=?').bind(id).first()
    : await database.prepare(activeSql).bind(currentHash()).first());
}

async function initializeRun(run:any) {
  const database=db(), id=run.id, mode=String(run.source).includes('quick')?'quick':'full';
  try {
    const companies = await universe({skipYahoo:true});
    if (!companies.length) throw new Error('دليل الشركات المحلي فارغ');
    for (const issue of consumeProviderIssues()) await log(id, 'providers', issue);
    const universeTotal = companies.length;
    const quoteCoverage = companies.filter((company: any) => Number.isFinite(company.price) && Number.isFinite(company.marketCap)).length;
    const directory=mode==='quick'?companies.filter((c:any)=>quickSymbols.includes(c.ticker)):companies;
    await saveUniverse(id,directory,'quotes');
    await database.prepare("UPDATE strategy_runs SET universe='paged-v1',total=?,universe_total=?,quote_coverage=?,stage=1,offset=0,lease_until=0,retry_queue='[]',error=NULL,updated_at=? WHERE id=?").bind(directory.length, universeTotal, quoteCoverage, new Date().toISOString(), id).run();
    await log(id, 'universe', `Loaded ${universeTotal} directory rows (${mode}); quotes will be checkpointed in groups of ${UNIVERSE_PAGE}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'تعذّر تجهيز دليل الشركات';
    const attempt=Number(JSON.parse(run.retry_queue||'[]')[0]?.attempt||0)+1;
    await database.prepare('UPDATE strategy_runs SET status=?,error=?,retry_queue=?,lease_until=0,updated_at=? WHERE id=?').bind(attempt>=3?'failed':'running',message,attempt>=3?'[]':JSON.stringify([{stage:0,attempt}]),new Date().toISOString(),id).run();
    await log(id,'universe',`Attempt ${attempt}: ${message}`);
  }
  const updated=await database.prepare('SELECT * FROM strategy_runs WHERE id=?').bind(id).first();
  return {run:publicRun(updated),done:updated.status==='failed'};
}

export async function processScanBatch(runId: string) {
  await ensureSchema();
  const database = db();
  let run: any = await database.prepare('SELECT * FROM strategy_runs WHERE id=?').bind(runId).first();
  if (!run) throw Object.assign(new Error('الفحص غير موجود'), { status: 404 });
  if (run.strategy_hash !== currentHash()) throw Object.assign(new Error('تغيرت الاستراتيجية. ابدأ فحصًا جديدًا.'), { status: 409 });
  const initialQueue = JSON.parse(run.retry_queue || '[]');
  if ((run.stage >= 13 && run.offset >= run.total && !initialQueue.length) || !['running', 'partial'].includes(run.status)) return { run: publicRun(run), done: true };

  const lock = await database.prepare("UPDATE strategy_runs SET lease_until=?,status='running' WHERE id=? AND lease_until<? AND offset=? AND stage=? AND retry_queue=?").bind(Date.now() + 90_000, run.id, Date.now(), run.offset, run.stage, run.retry_queue).run();
  if (!lock.meta.changes) return { run: publicRun(run), done: false, busy: true };

  if(run.stage===0)return initializeRun(run);

  if(run.stage===1){
    const index=Math.floor(run.offset/UNIVERSE_PAGE);
    const entries=await universePage(run.id,'quotes',index);
    const quoted=await yahooBulkQuotes(entries);
    await database.prepare('UPDATE raw_cache SET payload=?,retrieved_at=? WHERE key=?').bind(JSON.stringify(quoted),new Date().toISOString(),`universe:${run.id}:quotes:${index}`).run();
    for(const issue of consumeProviderIssues())await log(run.id,'quotes',issue);
    const offset=run.offset+entries.length;
    if(!entries.length&&run.offset<run.total){
      const attempt=Number(initialQueue[0]?.attempt||0)+1,message='ملف تقدم دليل السوق مفقود؛ تعذّر استئناف صفحة الأسعار.';
      await database.prepare('UPDATE strategy_runs SET status=?,error=?,retry_queue=?,lease_until=0,updated_at=? WHERE id=?').bind(attempt>=3?'failed':'running',message,attempt>=3?'[]':JSON.stringify([{stage:1,attempt}]),new Date().toISOString(),run.id).run();
      await log(run.id,'quotes',`Attempt ${attempt}: ${message}`);
      const updated=await database.prepare('SELECT * FROM strategy_runs WHERE id=?').bind(run.id).first();
      return {run:publicRun(updated),done:attempt>=3};
    }
    if(offset>=run.total){
      const all=[];for(let page=0;page<Math.ceil(run.total/UNIVERSE_PAGE);page++)all.push(...await universePage(run.id,'quotes',page));
      const candidates=String(run.source).includes('quick')?all.filter((c:any)=>quickSymbols.includes(c.ticker)):preliminaryCandidates(all);
      await saveUniverse(run.id,candidates);
      await database.prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(`universe:${run.id}:ciks`,'candidate CIK checkpoint',new Date().toISOString(),JSON.stringify(candidates.map((c:any)=>c.cik))).run();
      await database.prepare("UPDATE strategy_runs SET total=?,screened_out=?,quote_coverage=?,stage=?,offset=0,lease_until=0,retry_queue='[]',updated_at=? WHERE id=?").bind(candidates.length,run.universe_total-candidates.length,all.filter((c:any)=>Number.isFinite(c.price)&&Number.isFinite(c.marketCap)).length,String(run.source).includes('quick')?3:4,new Date().toISOString(),run.id).run();
    }else await database.prepare("UPDATE strategy_runs SET offset=?,lease_until=0,retry_queue='[]',updated_at=? WHERE id=?").bind(offset,new Date().toISOString(),run.id).run();
    return {run:publicRun(await database.prepare('SELECT * FROM strategy_runs WHERE id=?').bind(run.id).first()),done:false};
  }

  const companies = await runCompanies(run);
  const isQuick = String(run.source).includes('quick');

  if (!isQuick && run.stage === 4) {
    try {
      if(!companies.length&&run.total>0)throw Error('ملف CIK المرشحين مفقود؛ لا يمكن اعتبار SEC مكتملًا.');
      const previousRows=(await database.prepare('SELECT cik,payload FROM bulk_fundamentals WHERE run_id=?').bind(run.id).all()).results as any[];
      const initial=new Map<number,BulkFundamentals>(previousRows.map(row=>[Number(row.cik),JSON.parse(row.payload)]));
      const bulk = await fetchBulkFundamentals(companies.map((company: any) => Number(company.cik)),new Date(),{offset:run.offset,limit:4,initial});
      const statements = bulk.changed.map(cik=>database.prepare('INSERT OR REPLACE INTO bulk_fundamentals(run_id,cik,payload) VALUES(?,?,?)').bind(run.id,cik,JSON.stringify(bulk.fundamentals.get(cik))));
      for (let index = 0; index < statements.length; index += 75) await database.batch(statements.slice(index, index + 75));
      const pageRequests = bulk.success + bulk.failed + bulk.optionalSuccess + bulk.optionalFailed;
      const effectiveRequests = Number(run.sec_requests||0) + pageRequests;
      const effectiveSuccess = Number(run.sec_success||0)+bulk.success+bulk.optionalSuccess;
      const effectiveFailed = Number(run.sec_failed||0)+bulk.failed+bulk.optionalFailed;
      const error = effectiveFailed ? `SEC Frames: ${effectiveSuccess}/${effectiveRequests} طلبًا ناجحًا. ${bulk.errors.join('؛ ')||run.error||''}` : '';
      const nextStage = bulk.done ? (run.total ? 5 : 9) : 4;
      await database.prepare("UPDATE strategy_runs SET stage=?,offset=?,processed=0,sec_requests=?,sec_success=?,sec_failed=?,fundamental_coverage=?,error=?,updated_at=?,lease_until=0,retry_queue='[]' WHERE id=?").bind(nextStage,bulk.done?0:bulk.nextOffset,effectiveRequests, effectiveSuccess, effectiveFailed, bulk.fundamentals.size, error.slice(0,4000), new Date().toISOString(), run.id).run();
      await log(run.id, 'sec_frames', `SEC Frames baseline ${effectiveSuccess}/${effectiveRequests}; optional IFRS ${bulk.optionalSuccess}/${bulk.optionalRequests}; coverage ${bulk.fundamentals.size}/${companies.length}; annual ${bulk.annual}; instant ${bulk.instant}; source ${bulk.fallbackUsed ? 'bundled official dated snapshot' : 'live API'}${bulk.done && run.total ? '؛ ستبدأ الآن استعادة Company Facts للحقول الناقصة' : ''}`);
      run = await database.prepare('SELECT * FROM strategy_runs WHERE id=?').bind(run.id).first();
      return { run: publicRun(run), done: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SEC Frames stage failed';
      const attempt=Number(initialQueue[0]?.attempt||0)+1;
      // Exhausted SEC attempts still evaluate the quotes as UNKNOWN and retain
      // companies, rather than trapping the background baton on this stage.
      await database.prepare("UPDATE strategy_runs SET status='running',stage=?,offset=?,sec_failed=MAX(sec_failed,1),error=?,updated_at=?,lease_until=0,retry_queue=? WHERE id=?").bind(attempt>=3?9:4,attempt>=3?0:run.offset,message,new Date().toISOString(),attempt>=3?'[]':JSON.stringify([{stage:4,attempt}]),run.id).run();
      await log(run.id, 'sec_frames', message);
      run = await database.prepare('SELECT * FROM strategy_runs WHERE id=?').bind(run.id).first();
      return { run: publicRun(run), done: false };
    }
  }

  if (!isQuick && run.stage === 5) {
    const rows = (await database.prepare('SELECT cik,payload FROM bulk_fundamentals WHERE run_id=?').bind(run.id).all()).results as any[];
    const facts = new Map<number, BulkFundamentals>(rows.map((row) => [Number(row.cik), JSON.parse(row.payload)]));
    const queue = JSON.parse(run.retry_queue || '[]');
    const retrying = run.offset >= run.total;
    const jobs = retrying ? queue.slice(0, COMPANY_FACTS_BATCH_SIZE) : companies.slice(run.offset, run.offset + COMPANY_FACTS_BATCH_SIZE).map((company: any) => ({ company, attempt: 0 }));
    const remaining = retrying ? queue.slice(COMPANY_FACTS_BATCH_SIZE) : queue;
    const candidates: number[] = jobs.map((job: any) => Number(job.company?.cik)).filter((cik: number): cik is number => Number.isFinite(cik) && needsCompanyFacts(facts.get(cik))) as number[];
    const fallback = candidates.length ? await fetchCompanyFactsFallback([...new Set(candidates)], new Date(), facts) : { fundamentals: facts, changed: [], requests: 0, success: 0, empty: 0, failed: 0, failedCiks: [], errors: [] };
    const failedSet = new Set(fallback.failedCiks);
    for (const job of jobs) {
      const cik = Number(job.company?.cik);
      if (failedSet.has(cik) && job.attempt < 2) remaining.push({ ...job, attempt: job.attempt + 1 });
    }
    const statements = fallback.changed.map((cik) => database.prepare('INSERT OR REPLACE INTO bulk_fundamentals(run_id,cik,payload) VALUES(?,?,?)').bind(run.id, cik, JSON.stringify(fallback.fundamentals.get(cik))));
    for (let index = 0; index < statements.length; index += 75) await database.batch(statements.slice(index, index + 75));
    const nextOffset = retrying ? run.offset : run.offset + jobs.length;
    const done = nextOffset >= run.total && remaining.length === 0;
    const nextError = fallback.failed ? `SEC Company Facts: ${fallback.success}/${fallback.requests} طلبًا ناجحًا${fallback.empty ? `، ${fallback.empty} دون حقائق معيارية قابلة للاستخدام` : ''}. ${fallback.errors.join('؛ ')||run.error||''}` : run.error;
    await database.prepare("UPDATE strategy_runs SET stage=?,offset=?,processed=0,sec_requests=?,sec_success=?,sec_failed=?,fundamental_coverage=?,error=?,updated_at=?,lease_until=0,retry_queue=? WHERE id=?").bind(done?9:5,done?0:nextOffset,Number(run.sec_requests||0)+fallback.requests,Number(run.sec_success||0)+fallback.success,Number(run.sec_failed||0)+fallback.failed,fallback.fundamentals.size,(nextError||'').slice(0,4000),new Date().toISOString(),JSON.stringify(remaining),run.id).run();
    await log(run.id, 'sec_companyfacts', `استعادة Company Facts: ${fallback.success}/${fallback.requests} طلبًا؛ ${fallback.empty} بلا حقائق معيارية؛ ${fallback.failed} فشل؛ تغطية الحقول ${fallback.fundamentals.size}/${run.total}${done ? '؛ اكتملت مرحلة الاستعادة' : ''}`);
    run = await database.prepare('SELECT * FROM strategy_runs WHERE id=?').bind(run.id).first();
    return { run: publicRun(run), done: false };
  }

  if (!isQuick && run.stage === 9) {
    const rows = (await database.prepare('SELECT cik,payload FROM bulk_fundamentals WHERE run_id=?').bind(run.id).all()).results as any[];
    const facts = new Map<number, BulkFundamentals>(rows.map((row) => [Number(row.cik), JSON.parse(row.payload)]));
    const entries = companies.slice(run.offset, run.offset + SCORE_BATCH_SIZE);
    const now = new Date().toISOString();
    const snapshots:{company:any;snapshot:ReturnType<typeof preliminarySnapshot>}[]=entries.map((company:any)=>({company,snapshot:preliminarySnapshot(company,facts.get(Number(company.cik)),now)}));
    const writes = snapshots.map(({snapshot}:{snapshot:ReturnType<typeof preliminarySnapshot>}) => insertSnapshot(run.id,snapshot));
    const historyCandidates=snapshots.filter(({snapshot}:{snapshot:ReturnType<typeof preliminarySnapshot>})=>historyCandidate(snapshot)).map(({company}:{company:any})=>company);
    writes.push(database.prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(`universe:${run.id}:history-candidate:${Math.floor(run.offset/SCORE_BATCH_SIZE)}`,'scan history candidate checkpoint',now,JSON.stringify(historyCandidates)));
    const offset = run.offset + entries.length;
    const done = offset >= run.total;
    // A full run needs one additional, bounded history pass before it is
    // complete. The bulk snapshot intentionally does not pretend to contain
    // MA30W, so Bounce is enriched from real historical bars afterwards.
    if(!done)writes.push(database.prepare("UPDATE strategy_runs SET offset=?,processed=?,stage=9,status='running',updated_at=?,lease_until=0 WHERE id=?").bind(offset,offset,now,run.id));
    for (let index = 0; index < writes.length; index += 75) await database.batch(writes.slice(index, index + 75));
    if(done){
      const history=[];
      for(let page=0;page<Math.ceil(run.total/SCORE_BATCH_SIZE);page++){
        const row=await database.prepare('SELECT payload FROM raw_cache WHERE key=?').bind(`universe:${run.id}:history-candidate:${page}`).first() as any;
        if(row)history.push(...JSON.parse(row.payload));
      }
      await saveUniverse(run.id,history,'history');
      await database.prepare("UPDATE strategy_runs SET total=?,offset=0,processed=?,stage=10,status='running',updated_at=?,lease_until=0 WHERE id=?").bind(history.length,history.length,now,run.id).run();
      await log(run.id,'history',`History requests reduced from ${offset} screened rows to ${history.length} candidates.`);
    }
    run = await database.prepare('SELECT * FROM strategy_runs WHERE id=?').bind(run.id).first();
    return { run: publicRun(run), done: false };
  }

  if (!isQuick && run.stage === 10) {
    const retrying=run.offset>=run.total;
    const queue=JSON.parse(run.retry_queue||'[]');
    const jobs=retrying?queue.slice(0,HISTORY_BATCH_SIZE):companies.slice(run.offset,run.offset+HISTORY_BATCH_SIZE).map((company:any)=>({company,attempt:0}));
    const remaining=retrying?queue.slice(HISTORY_BATCH_SIZE):queue;
    const entries=jobs.map((job:any)=>job.company);
    const now = new Date().toISOString();
    const writes: any[] = [];
    const rows=entries.length?(await database.prepare(`SELECT symbol,payload FROM fundamental_snapshots WHERE run_id=? AND symbol IN (${entries.map(()=>'?').join(',')})`).bind(run.id,...entries.map((c:any)=>c.ticker)).all()).results:[];
    const bySymbol=new Map<string,any>(rows.map((row:any)=>[row.symbol,row]));
    const outcomes:any[]=[];
    for(let start=0;start<entries.length;start+=PROVIDER_CONCURRENCY)outcomes.push(...await Promise.all(entries.slice(start,start+PROVIDER_CONCURRENCY).map(async (company: any) => {
      const row = bySymbol.get(company.ticker);
      if (!row) {await log(run.id,'history',`${company.ticker}: snapshot missing`);return {company,failed:true};}
      let snapshot = JSON.parse(row.payload);
      if (!historyCandidate(snapshot)) return { snapshot, company, skipped: true };
      snapshot.dataIssues=(snapshot.dataIssues??[]).filter((issue:string)=>!issue.startsWith('تعذّر تحميل تاريخ'));
      try {
        const cacheKey=`scan-history:v2:${company.ticker}:${now.slice(0,10)}`;
        const cached=await database.prepare('SELECT retrieved_at,payload FROM raw_cache WHERE key=?').bind(cacheKey).first() as any;
        const historical:Awaited<ReturnType<typeof historicalMarketData>>=cached&&Date.parse(now)-Date.parse(cached.retrieved_at)<24*60*60_000?JSON.parse(cached.payload):await historicalMarketData(company.ticker, now, 550);
        if(!cached||cached.retrieved_at!==historical.retrievedAt)await database.prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(cacheKey,historical.source,historical.retrievedAt,JSON.stringify(historical)).run();
        const history = historical.history.filter((bar): bar is typeof bar & { close: number } => Number.isFinite(bar.close));
        const metrics = bounceHistoryMetrics(history, now);
        // The historical observations were retrieved after the bulk row was
        // created; advance the snapshot timestamp so provenance/freshness do
        // not incorrectly label these newer facts as future data.
        snapshot.asOf = now;
        const last = history.at(-1);
        const historyEvidence={source:historical.source,url:historical.url,retrievedAt:historical.retrievedAt,availableAt:historical.availableAt,periodEnd:last?.date??now.slice(0,10),confidence:'medium' as const};
        snapshot=reviewShareSplits(snapshot,historical.splits,history[0]?.date??'',last?.date??'',historyEvidence);
        if (metrics.return12m != null) {
          snapshot.return12m = metrics.return12m;
          snapshot.provenance.return12m = { ...historyEvidence,tag:'12-month return' };
        }
        if (metrics.low52w != null) {
          snapshot.low52w = metrics.low52w;
          snapshot.provenance.low52w = { ...historyEvidence,tag:'52-week low' };
        }
        const yearBars = history.filter(bar => Date.parse(bar.date) >= Date.parse(now) - 365 * 86_400_000);
        if (yearBars.length >= 240) {
          snapshot.high52w = Math.max(...yearBars.map(bar => bar.high ?? bar.close));
          snapshot.provenance.high52w = { ...historyEvidence,tag:'52-week high' };
        }
        if (metrics.ma30w != null) {
          snapshot.ma30w = metrics.ma30w;
          snapshot.provenance.ma30w = { ...historyEvidence,tag:'30 completed weekly closes' };
        } else {
          snapshot.dataIssues = [...(snapshot.dataIssues ?? []), 'لم تتوفر 30 أسبوعاً متواصلاً صالحاً لحساب MA30W.'];
        }
        const dollarVolumes = history.slice(-20).map(bar => Number.isFinite(bar.volume) && bar.volume! >= 0 ? bar.close * bar.volume! : Number.NaN).filter(Number.isFinite).sort((a, b) => a - b);
        if (dollarVolumes.length === 20) {
          snapshot.medianDollarVolume20d = (dollarVolumes[9] + dollarVolumes[10]) / 2;
          snapshot.liquidityReviewed = true;
          snapshot.provenance.medianDollarVolume20d = { ...historyEvidence,tag:'20-session median dollar volume' };
        } else {
          snapshot.dataIssues = [...(snapshot.dataIssues ?? []), 'لا تتوفر 20 جلسة مكتملة مع السعر والحجم لحساب وسيط السيولة.'];
        }
        // Keep the durable screening row compact. Full bars remain available
        // through /api/company and are fetched on demand for the chart.
      } catch (error) {
        snapshot.dataIssues = [...(snapshot.dataIssues ?? []), `تعذّر تحميل تاريخ الارتداد: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`];
        await log(run.id,'history',`${company.ticker}: ${snapshot.dataIssues.at(-1)}`);
      }
      return { snapshot, company, failed: snapshot.dataIssues?.some((issue: string) => issue.startsWith('تعذّر تحميل تاريخ')) === true };
    })));
    const historyFailed = outcomes.filter(outcome => outcome?.failed).length;
    for (const [index,outcome] of outcomes.entries()) {
      if(outcome.snapshot&&!outcome.skipped)writes.push(insertSnapshot(run.id,outcome.snapshot));
      if(outcome.failed&&jobs[index].attempt<2)remaining.push({...jobs[index],attempt:jobs[index].attempt+1});
    }
    const offset = retrying?run.offset:run.offset + entries.length;
    const done = offset >= run.total && remaining.length===0;
    const totalFailed = retrying?Math.max(0,Number(run.failed||0)-(entries.length-historyFailed)):Number(run.failed||0)+historyFailed;
    writes.push(database.prepare('UPDATE strategy_runs SET offset=?,processed=total,stage=?,status=?,failed=?,error=?,updated_at=?,lease_until=0,retry_queue=? WHERE id=?').bind(offset, done ? 13 : 10, done ? (totalFailed||run.sec_failed ? 'partial' : 'complete') : 'running', totalFailed, totalFailed ? `تعذّر جلب التاريخ لـ${totalFailed} شركة؛ محاولات متبقية ${remaining.length}` : run.sec_failed?run.error:null, now,JSON.stringify(remaining), run.id));
    await database.batch(writes);
    run = await database.prepare('SELECT * FROM strategy_runs WHERE id=?').bind(run.id).first();
    return { run: publicRun(run), done };
  }

  const retrying = run.offset >= run.total;
  const queue = JSON.parse(run.retry_queue || '[]');
  const entries = retrying ? queue.slice(0, BATCH_SIZE) : companies.slice(run.offset, run.offset + BATCH_SIZE).map((company: any) => ({ company, attempt: 0 }));
  const remaining = retrying ? queue.slice(BATCH_SIZE) : queue;
  let success = 0, failed = 0, lastError = '';
  const writes: any[] = [];
  const outcomes = await Promise.all(entries.map(async (entry: any) => {
    try { return { entry, snapshot: await companySnapshot(entry.company) } }
    catch (error) { return { entry, error } }
  }));

  for (const outcome of outcomes) {
    const company = outcome.entry.company;
    if ('snapshot' in outcome) {
      writes.push(insertSnapshot(run.id, outcome.snapshot));
      success++;
    } else {
      failed++;
      lastError = outcome.error instanceof Error ? outcome.error.message : 'Unknown provider error';
      if (outcome.entry.attempt < 2) remaining.push({ company, attempt: outcome.entry.attempt + 1 });
      await log(run.id, 'company', `${company.ticker}: ${lastError}`);
    }
  }

  const offset = retrying ? run.offset : run.offset + entries.length;
  const totalFailed = retrying ? Math.max(0, run.failed - success) : run.failed + failed;
  const done = offset >= run.total && remaining.length === 0;
  const status = done ? (totalFailed ? 'partial' : 'complete') : (failed === entries.length ? 'partial' : 'running');
  writes.push(database.prepare('UPDATE strategy_runs SET offset=?,processed=processed+?,failed=?,stage=?,status=?,error=?,updated_at=?,lease_until=0,retry_queue=? WHERE id=?').bind(offset, success, totalFailed, done ? 13 : 4, status, lastError || run.error, new Date().toISOString(), JSON.stringify(remaining), run.id));
  await database.batch(writes);
  run = await database.prepare('SELECT * FROM strategy_runs WHERE id=?').bind(run.id).first();
  return { run: publicRun(run), done };
}
