import { z } from 'zod';
import { db, ensureSchema } from '@/lib/storage';
import { json, sameOrigin } from '@/lib/http';
import { visitor } from '@/lib/visitor';
import { searchCompanies } from '@/lib/providers';
import { canonicalPortfolioAsset, readPortfolio, readPortfolioTransactions } from '@/lib/portfolio-storage';
import { validateLedger, type PortfolioSide, type PortfolioTransaction } from '@/lib/portfolio';

const inputSchema = z.object({
  id: z.string().uuid().optional(),
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9.^-]{0,15}$/),
  side: z.enum(['buy', 'sell']),
  quantity: z.number().finite().positive().max(1_000_000_000),
  price: z.number().finite().positive().max(10_000_000),
  fees: z.number().finite().min(0).max(10_000_000).default(0),
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).default(''),
}).strict();

const parseBody = async (request: Request) => {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 20_000) throw Object.assign(Error('الطلب أكبر من الحد المسموح.'), { status: 413 });
  try { return await request.json(); } catch { throw Object.assign(Error('بيانات العملية ليست JSON صالحًا.'), { status: 400 }); }
};

function assertDate(date: string) {
  const parsed = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed)) throw Object.assign(Error('تاريخ العملية غير صالح.'), { status: 400 });
  if (date > new Date().toISOString().slice(0, 10)) throw Object.assign(Error('لا يمكن حفظ عملية بتاريخ مستقبلي.'), { status: 400 });
  if (date < '1970-01-01') throw Object.assign(Error('تاريخ العملية أقدم من النطاق المدعوم.'), { status: 400 });
}

async function respond(request: Request, identity: ReturnType<typeof visitor>) {
  const response = json(await readPortfolio(identity.owner));
  if (identity.cookie) response.headers.set('Set-Cookie', identity.cookie);
  return response;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url), query = url.searchParams.get('q')?.trim() || '';
    if (query) {
      if (query.length > 100) return json({ error: 'عبارة البحث طويلة جدًا.' }, 400);
      return json({ results: searchCompanies(query).map(company => ({ symbol: company.ticker, name: company.name, exchange: company.exchange, price: company.price ?? null, sector: company.sector, industry: company.industry })) });
    }
    const identity = visitor(request);
    return await respond(request, identity);
  } catch (error: any) { return json({ error: error.message || 'تعذّر تحميل المحفظة.' }, error.status || 503); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request); await ensureSchema();
    const parsed = inputSchema.safeParse(await parseBody(request));
    if (!parsed.success) return json({ error: 'تحقق من الرمز، نوع العملية، العدد، السعر والتاريخ.' }, 400);
    assertDate(parsed.data.tradeDate);
    const identity = visitor(request), asset = await canonicalPortfolioAsset(parsed.data.symbol);
    if (!asset) return json({ error: 'الشركة غير موجودة في دليل الأسهم الأمريكية.' }, 404);
    const now = new Date().toISOString(), id = crypto.randomUUID();
    const candidate: PortfolioTransaction = { id, symbol: asset.symbol, companyName: asset.name, side: parsed.data.side as PortfolioSide, quantity: parsed.data.quantity, price: parsed.data.price, fees: parsed.data.fees, tradeDate: parsed.data.tradeDate, note: parsed.data.note, metadata: asset.metadata, createdAt: now, updatedAt: now };
    try { validateLedger([...(await readPortfolioTransactions(identity.owner)), candidate]); }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'عملية البيع تتجاوز الرصيد.' }, 409); }
    await db().prepare('INSERT INTO portfolio_transactions(id,owner,symbol,company_name,side,quantity,price,fees,trade_date,note,metadata,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, identity.owner, asset.symbol, asset.name, parsed.data.side, parsed.data.quantity, parsed.data.price, parsed.data.fees, parsed.data.tradeDate, parsed.data.note, JSON.stringify(asset.metadata), now, now).run();
    return await respond(request, identity);
  } catch (error: any) { return json({ error: error.message || 'تعذّر حفظ العملية.' }, error.status || 503); }
}

export async function PUT(request: Request) {
  try {
    sameOrigin(request); await ensureSchema();
    const parsed = inputSchema.required({ id: true }).safeParse(await parseBody(request));
    if (!parsed.success) return json({ error: 'بيانات تعديل العملية غير صالحة.' }, 400);
    assertDate(parsed.data.tradeDate);
    const identity = visitor(request);
    const existing = await db().prepare('SELECT created_at FROM portfolio_transactions WHERE id=? AND owner=?').bind(parsed.data.id, identity.owner).first() as any;
    if (!existing) return json({ error: 'العملية غير موجودة.' }, 404);
    const asset = await canonicalPortfolioAsset(parsed.data.symbol);
    if (!asset) return json({ error: 'الشركة غير موجودة في دليل الأسهم الأمريكية.' }, 404);
    const now = new Date().toISOString();
    const candidate: PortfolioTransaction = { id: parsed.data.id, symbol: asset.symbol, companyName: asset.name, side: parsed.data.side, quantity: parsed.data.quantity, price: parsed.data.price, fees: parsed.data.fees, tradeDate: parsed.data.tradeDate, note: parsed.data.note, metadata: asset.metadata, createdAt: String(existing.created_at), updatedAt: now };
    const remaining = (await readPortfolioTransactions(identity.owner)).filter(transaction => transaction.id !== parsed.data.id);
    try { validateLedger([...remaining, candidate]); }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'التعديل يجعل رصيد الأسهم سالبًا.' }, 409); }
    await db().prepare('UPDATE portfolio_transactions SET symbol=?,company_name=?,side=?,quantity=?,price=?,fees=?,trade_date=?,note=?,metadata=?,updated_at=? WHERE id=? AND owner=?')
      .bind(asset.symbol, asset.name, parsed.data.side, parsed.data.quantity, parsed.data.price, parsed.data.fees, parsed.data.tradeDate, parsed.data.note, JSON.stringify(asset.metadata), now, parsed.data.id, identity.owner).run();
    return await respond(request, identity);
  } catch (error: any) { return json({ error: error.message || 'تعذّر تعديل العملية.' }, error.status || 503); }
}

export async function DELETE(request: Request) {
  try {
    sameOrigin(request); await ensureSchema();
    const body = await parseBody(request), id = typeof body?.id === 'string' ? body.id : '';
    if (!z.string().uuid().safeParse(id).success) return json({ error: 'معرّف العملية غير صالح.' }, 400);
    const identity = visitor(request);
    const remaining = (await readPortfolioTransactions(identity.owner)).filter(transaction => transaction.id !== id);
    try { validateLedger(remaining); }
    catch { return json({ error: 'لا يمكن حذف هذه العملية لأنها ستجعل عملية بيع لاحقة بلا رصيد كافٍ.' }, 409); }
    const result = await db().prepare('DELETE FROM portfolio_transactions WHERE id=? AND owner=?').bind(id, identity.owner).run() as any;
    if (!Number(result?.meta?.changes)) return json({ error: 'العملية غير موجودة.' }, 404);
    return await respond(request, identity);
  } catch (error: any) { return json({ error: error.message || 'تعذّر حذف العملية.' }, error.status || 503); }
}
