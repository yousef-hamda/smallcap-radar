import { createRun, currentHash, db, ensureSchema, insertSnapshot, log } from './storage';
import { companySnapshot, quickSymbols, universe } from './providers';

const BATCH_SIZE = 12;
export const SCAN_SOURCE_VERSION = 'Nasdaq/SEC v5';

const nonTradable = /\b(etf|fund|trust|warrant|right|unit|preferred|depositary|senior note|bond|debenture|limited partnership)\b|,\s*L\.P\./i;

function preliminaryCandidates(companies: any[]) {
  return companies.filter((company) => {
    if (nonTradable.test(String(company.name || ''))) return false;
    const marketCap = Number(company.marketCap);
    const price = Number(company.price);
    return Number.isFinite(marketCap) && marketCap >= 25_000_000 && marketCap <= 2_000_000_000 && Number.isFinite(price) && price > 0;
  });
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
    if (mode === 'quick') {
      const bySymbol = new Map(companies.map((company: any) => [company.ticker, company]));
      companies = quickSymbols.map((symbol) => bySymbol.get(symbol)).filter(Boolean) as any[];
    } else companies = preliminaryCandidates(companies);
    const screenedOut = universeTotal - companies.length;
    await database.prepare('UPDATE strategy_runs SET universe=?,total=?,universe_total=?,screened_out=?,stage=3 WHERE id=?').bind(JSON.stringify(companies), companies.length, universeTotal, screenedOut, id).run();
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
