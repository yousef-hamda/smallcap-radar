import { companyBySymbol, companySnapshot } from '@/lib/providers';
import { db, ensureSchema } from '@/lib/storage';
import { json } from '@/lib/http';

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
    const snapshot = await companySnapshot(company);
    await db().prepare('INSERT OR REPLACE INTO raw_cache(key,source,retrieved_at,payload) VALUES(?,?,?,?)').bind(cacheKey, 'Nasdaq history + SEC Company Facts', new Date().toISOString(), JSON.stringify(snapshot)).run();
    return json({ snapshot, cached: false });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'تعذّر تحميل التحقق العميق' }, 503);
  }
}
