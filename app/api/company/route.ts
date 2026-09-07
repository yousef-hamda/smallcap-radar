import { companyBySymbol, companySnapshot } from '@/lib/providers';
import { db, ensureSchema } from '@/lib/storage';
import { json } from '@/lib/http';

const comparable = ['marketCap', 'revenue', 'netIncome', 'fcf', 'evSales'] as const;
function reconcile(current: any, previous: any) {
  const conflicts: string[] = [];
  let compared = 0;
  for (const key of comparable) {
    const a = current?.[key], b = previous?.[key];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    compared++;
    const denominator = Math.max(Math.abs(a), Math.abs(b), key === 'evSales' ? 0.1 : 1);
    const difference = Math.abs(a - b) / denominator;
    if (difference > 0.2) conflicts.push(`${key}: اختلاف ${(difference * 100).toFixed(1)}% بين الفحص الجماعي والتحقق التفصيلي`);
  }
  current.sourceConflicts = conflicts;
  current.confidence = conflicts.length ? 'D' : compared >= 3 ? 'B' : current.confidence ?? 'C';
  current.dataIssues = [...new Set([...(current.dataIssues ?? []), ...(compared ? [`تمت مقارنة ${compared} مقاييس مع لقطة الفحص الجماعي.`] : ['لم تتوفر لقطة سابقة كافية للمقارنة.'])])];
  return current;
}

export async function GET(request: Request) {
  try {
    const symbol = new URL(request.url).searchParams.get('symbol')?.trim().toUpperCase() ?? '';
    if (!/^[A-Z0-9.^-]{1,16}$/.test(symbol)) return json({ error: 'رمز غير صالح' }, 400);
    await ensureSchema();
    const cacheKey = `deep:${symbol}`;
    const cached = await db().prepare('SELECT retrieved_at,payload FROM raw_cache WHERE key=?').bind(cacheKey).first() as any;
    if (cached && Date.now() - Date.parse(cached.retrieved_at) < 30 * 60_000) return json({ snapshot: JSON.parse(cached.payload), cached: true });
    const company = companyBySymbol(symbol);
    if (!company) return json({ error: 'الشركة غير موجودة في الدليل' }, 404);
    let snapshot = await companySnapshot(company);
    const previousRow = await db().prepare('SELECT payload FROM fundamental_snapshots WHERE symbol=? ORDER BY as_of DESC LIMIT 1').bind(symbol).first() as any;
    snapshot = reconcile(snapshot, previousRow?.payload ? JSON.parse(previousRow.payload) : null);
    await db().prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(cacheKey, 'Nasdaq history + SEC Company Facts', new Date().toISOString(), JSON.stringify(snapshot)).run();
    return json({ snapshot, cached: false });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'تعذّر تحميل التحقق العميق' }, 503);
  }
}
