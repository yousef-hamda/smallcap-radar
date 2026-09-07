import { createRun, currentHash, db, ensureSchema, insertSnapshot, log } from './storage';
import { companySnapshot, historicalMarketData, quickSymbols, universe } from './providers';
import { fetchBulkFundamentals, preliminarySnapshot, type BulkFundamentals } from './bulk';
import { bounceHistoryMetrics } from './research';

const BATCH_SIZE = 12;
const HISTORY_BATCH_SIZE = 48;
const SCORE_BATCH_SIZE = 600;
export const SCAN_SOURCE_VERSION = 'Bulk Quotes/SEC Frames v6';

const nonTradable = /\b(etf|fund|trust|warrant|right|unit|preferred|depositary|senior note|bond|debenture|limited partnership)\b|,\s*L\.P\./i;

function preliminaryCandidates(companies: any[]) {
  return companies.filter((company) => {
    if (nonTradable.test(String(company.name || ''))) return false;
    const marketCap = Number(company.marketCap);
    const price = Number(company.price);
    return Number.isFinite(marketCap) && marketCap >= 25_000_000 && marketCap <= 2_000_000_000 && Number.isFinite(price) && price > 0;
  });
}

function bounceHistoryCandidate(snapshot: any) {
  // Bulk quotes are not guaranteed to contain 52-week fields (Yahoo can be
  // rate-limited). History enrichment therefore runs for every small-cap
  // common stock and computes the missing values from the same dated bars.
  return snapshot?.securityType === 'common' && Number(snapshot.marketCap) >= 25_000_000 && Number(snapshot.marketCap) <= 600_000_000 && Number(snapshot.price) > 0;
}

export const publicRun = (run: any) => ({
  ...run,
  universe: undefined,
  retry_queue: undefined,
  retryPending: JSON.parse(run.retry_queue || '[]').length,
});

export async function startScan(modeInput: unknown) {
  await ensureSchema();
  const mode = modeInput === 'quick' ? 'quick' : 'full';
  const source = `${SCAN_SOURCE_VERSION} · ${mode}`;
  const database = db();
  const previous = await database.prepare("SELECT * FROM strategy_runs WHERE source=? AND status IN ('running','partial') ORDER BY created_at DESC LIMIT 1").bind(source).first();
  if (previous && previous.strategy_hash === currentHash() && (previous.offset < previous.total || JSON.parse(previous.retry_queue || '[]').length)) return publicRun(previous);
  const recent = await database.prepare('SELECT created_at FROM strategy_runs WHERE source=? ORDER BY created_at DESC LIMIT 1').bind(source).first() as any;
  if (recent && Date.now() - Date.parse(recent.created_at) < 30_000) throw Object.assign(new Error('انتظر نصف دقيقة قبل بدء فحص جديد من النوع نفسه.'), { status: 429 });

  const id = await createRun(source);
  try {
    let companies = await universe();
    if (!companies.length) throw new Error('دليل الشركات المحلي فارغ');
    const universeTotal = companies.length;
    const quoteCoverage = companies.filter((company: any) => Number.isFinite(company.price) && Number.isFinite(company.marketCap)).length;
    if (mode === 'quick') {
      const bySymbol = new Map(companies.map((company: any) => [company.ticker, company]));
      companies = quickSymbols.map((symbol) => bySymbol.get(symbol)).filter(Boolean) as any[];
    } else companies = preliminaryCandidates(companies);
    const screenedOut = universeTotal - companies.length;
    await database.prepare('UPDATE strategy_runs SET universe=?,total=?,universe_total=?,screened_out=?,quote_coverage=?,stage=? WHERE id=?').bind(JSON.stringify(companies), companies.length, universeTotal, screenedOut, quoteCoverage, mode === 'quick' ? 3 : 4, id).run();
    await log(id, 'universe', `Loaded ${universeTotal} exchange-listed symbols; ${companies.length} passed security type, price and $25M-$2B preliminary gates (${mode})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'تعذّر تجهيز دليل الشركات';
    await database.prepare("UPDATE strategy_runs SET status='failed',error=? WHERE id=?").bind(message, id).run();
    throw Object.assign(new Error(`تعذّر تجهيز دليل الشركات: ${message}`), { status: 502 });
  }
  return publicRun(await database.prepare('SELECT * FROM strategy_runs WHERE id=?').bind(id).first());
}

export async function processScanBatch(runId: string) {
  await ensureSchema();
  const database = db();
  let run: any = await database.prepare('SELECT * FROM strategy_runs WHERE id=?').bind(runId).first();
  if (!run) throw Object.assign(new Error('الفحص غير موجود'), { status: 404 });
  if (run.strategy_hash !== currentHash()) throw Object.assign(new Error('تغيرت الاستراتيجية. ابدأ فحصًا جديدًا.'), { status: 409 });
  const initialQueue = JSON.parse(run.retry_queue || '[]');
  if ((run.offset >= run.total && !initialQueue.length) || !['running', 'partial'].includes(run.status)) return { run: publicRun(run), done: true };

  const lock = await database.prepare("UPDATE strategy_runs SET lease_until=?,status='running' WHERE id=? AND lease_until<? AND offset=? AND retry_queue=?").bind(Date.now() + 90_000, run.id, Date.now(), run.offset, run.retry_queue).run();
  if (!lock.meta.changes) return { run: publicRun(run), done: false, busy: true };

  const companies = JSON.parse(run.universe || '[]');
  const isQuick = String(run.source).includes('quick');

  if (!isQuick && run.stage === 4) {
    try {
      const bulk = await fetchBulkFundamentals(companies.map((company: any) => Number(company.cik)));
      await database.prepare('DELETE FROM bulk_fundamentals WHERE run_id=?').bind(run.id).run();
      const statements = [...bulk.fundamentals.entries()].map(([cik, payload]) => database.prepare('INSERT INTO bulk_fundamentals(run_id,cik,payload) VALUES(?,?,?)').bind(run.id, cik, JSON.stringify(payload)));
      for (let index = 0; index < statements.length; index += 75) await database.batch(statements.slice(index, index + 75));
      const effectiveSuccess = bulk.fallbackUsed ? bulk.requests : bulk.success;
      const effectiveFailed = bulk.fallbackUsed ? 0 : bulk.failed;
      const error = effectiveFailed ? `SEC Frames: ${bulk.success}/${bulk.requests} requests succeeded. ${bulk.errors.join('؛ ')}` : '';
      await database.prepare('UPDATE strategy_runs SET stage=9,offset=0,processed=0,sec_requests=?,sec_success=?,sec_failed=?,fundamental_coverage=?,error=?,updated_at=?,lease_until=0 WHERE id=?').bind(bulk.requests, effectiveSuccess, effectiveFailed, bulk.fundamentals.size, error, new Date().toISOString(), run.id).run();
      await log(run.id, 'sec_frames', `SEC Frames datasets ${effectiveSuccess}/${bulk.requests}; coverage ${bulk.fundamentals.size}/${companies.length}; annual ${bulk.annual}; instant ${bulk.instant}; source ${bulk.fallbackUsed ? 'bundled official snapshot' : 'live API'}`);
      run = await database.prepare('SELECT * FROM strategy_runs WHERE id=?').bind(run.id).first();
      return { run: publicRun(run), done: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SEC Frames stage failed';
      await database.prepare("UPDATE strategy_runs SET status='partial',error=?,updated_at=?,lease_until=0 WHERE id=?").bind(message, new Date().toISOString(), run.id).run();
      await log(run.id, 'sec_frames', message);
      run = await database.prepare('SELECT * FROM strategy_runs WHERE id=?').bind(run.id).first();
      return { run: publicRun(run), done: false };
    }
  }

  if (!isQuick && run.stage === 9) {
    const rows = (await database.prepare('SELECT cik,payload FROM bulk_fundamentals WHERE run_id=?').bind(run.id).all()).results as any[];
    const facts = new Map<number, BulkFundamentals>(rows.map((row) => [Number(row.cik), JSON.parse(row.payload)]));
    const entries = companies.slice(run.offset, run.offset + SCORE_BATCH_SIZE);
    const now = new Date().toISOString();
    const writes = entries.map((company: any) => insertSnapshot(run.id, preliminarySnapshot(company, facts.get(Number(company.cik)), now)));
    const offset = run.offset + entries.length;
    const done = offset >= run.total;
    const status = done ? (run.sec_failed ? 'partial' : 'complete') : 'running';
    // A full run needs one additional, bounded history pass before it is
    // complete. The bulk snapshot intentionally does not pretend to contain
    // MA30W, so Bounce is enriched from real historical bars afterwards.
    writes.push(database.prepare('UPDATE strategy_runs SET offset=?,processed=processed+?,stage=?,status=?,updated_at=?,lease_until=0 WHERE id=?').bind(done ? 0 : offset, entries.length, done ? 10 : 9, done ? 'running' : status, now, run.id));
    for (let index = 0; index < writes.length; index += 75) await database.batch(writes.slice(index, index + 75));
    run = await database.prepare('SELECT * FROM strategy_runs WHERE id=?').bind(run.id).first();
    return { run: publicRun(run), done };
  }

  if (!isQuick && run.stage === 10) {
    const entries = companies.slice(run.offset, run.offset + HISTORY_BATCH_SIZE);
    const now = new Date().toISOString();
    const writes: any[] = [];
    const outcomes = await Promise.all(entries.map(async (company: any) => {
      const row = await database.prepare('SELECT payload FROM fundamental_snapshots WHERE id=?').bind(`${run.id}:${company.ticker}`).first() as any;
      if (!row) return null;
      const snapshot = JSON.parse(row.payload);
      if (!bounceHistoryCandidate(snapshot)) return { snapshot, company, skipped: true };
      try {
        const history = (await historicalMarketData(company.ticker, now)).history.filter((bar): bar is typeof bar & { close: number } => Number.isFinite(bar.close));
        const metrics = bounceHistoryMetrics(history, now);
        const last = history.at(-1);
        if (metrics.return12m != null) {
          snapshot.return12m = metrics.return12m;
          snapshot.provenance.return12m = { ...snapshot.provenance.price, source: 'Nasdaq Historical (official) · 12-month return', retrievedAt: now, availableAt: now, periodEnd: last?.date ?? now.slice(0, 10), confidence: 'high' };
        }
        if (metrics.low52w != null) {
          snapshot.low52w = metrics.low52w;
          snapshot.provenance.low52w = { ...snapshot.provenance.price, source: 'Nasdaq Historical (official) · 52-week low', retrievedAt: now, availableAt: now, periodEnd: last?.date ?? now.slice(0, 10), confidence: 'high' };
        }
        if (metrics.ma30w != null) {
          snapshot.ma30w = metrics.ma30w;
          snapshot.provenance.ma30w = { ...snapshot.provenance.price, source: 'Nasdaq Historical (official) · 30 completed weekly closes', retrievedAt: now, availableAt: now, periodEnd: last?.date ?? now.slice(0, 10), confidence: 'high' };
        } else {
          snapshot.dataIssues = [...(snapshot.dataIssues ?? []), 'لم تتوفر 30 أسبوعاً متواصلاً صالحاً لحساب MA30W.'];
        }
        snapshot.history = history;
      } catch (error) {
        snapshot.dataIssues = [...(snapshot.dataIssues ?? []), `تعذّر تحميل تاريخ الارتداد: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`];
      }
      return { snapshot, company };
    }));
    for (const outcome of outcomes) if (outcome) writes.push(insertSnapshot(run.id, outcome.snapshot));
    const offset = run.offset + entries.length;
    const done = offset >= run.total;
    writes.push(database.prepare('UPDATE strategy_runs SET offset=?,stage=?,status=?,updated_at=?,lease_until=0 WHERE id=?').bind(offset, done ? 13 : 10, done ? 'complete' : 'running', now, run.id));
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
