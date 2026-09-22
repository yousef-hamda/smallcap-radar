import { z } from 'zod';
import { db, ensureSchema } from '@/lib/storage';
import { body as readBody, json, sameOrigin, statusOf } from '@/lib/http';
import { resolveVisitor, type VisitorIdentity } from '@/lib/visitor';
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

const MAX_TRANSACTIONS = 5_000;

async function portfolioRevision(owner: string) {
  await db().prepare('INSERT OR IGNORE INTO portfolio_revisions(owner,revision) VALUES(?,0)').bind(owner).run();
  return Number((await db().prepare('SELECT revision FROM portfolio_revisions WHERE owner=?').bind(owner).first() as any)?.revision ?? 0);
}

const changes=(result:any)=>Number(result?.meta?.changes||0);
async function commitAtRevision(owner:string,revision:number,mutation:any){
  // D1 batches are transactional. The mutation is guarded by the revision it
  // was validated against, preventing two concurrent sells from both passing
  // the balance check and creating a negative position.
  const [changed,bumped]=await db().batch([
    mutation,
    db().prepare('UPDATE portfolio_revisions SET revision=revision+1 WHERE owner=? AND revision=?').bind(owner,revision),
  ]);
  return changes(changed)===1&&changes(bumped)===1;
}

function assertDate(date: string) {
  const parsed = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed)) throw Object.assign(Error('تاريخ العملية غير صالح.'), { status: 400 });
  if (date > new Date().toISOString().slice(0, 10)) throw Object.assign(Error('لا يمكن حفظ عملية بتاريخ مستقبلي.'), { status: 400 });
  if (date < '1970-01-01') throw Object.assign(Error('تاريخ العملية أقدم من النطاق المدعوم.'), { status: 400 });
}

async function respond(request: Request, identity: VisitorIdentity) {
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
    const identity = await resolveVisitor(request);
    return await respond(request, identity);
  } catch (error: any) { return json({ error: error.message || 'تعذّر تحميل المحفظة.' }, error.status || 503); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request); await ensureSchema();
    const parsed = inputSchema.safeParse(await readBody(request,20_000));
    if (!parsed.success) return json({ error: 'تحقق من الرمز، نوع العملية، العدد، السعر والتاريخ.' }, 400);
    assertDate(parsed.data.tradeDate);
    const identity = await resolveVisitor(request), revision=await portfolioRevision(identity.owner), current=await readPortfolioTransactions(identity.owner);
    if(current.length>=MAX_TRANSACTIONS)return json({error:`بلغت المحفظة حد ${MAX_TRANSACTIONS.toLocaleString('en-US')} عملية.`},422);
    const asset = await canonicalPortfolioAsset(parsed.data.symbol);
    if (!asset) return json({ error: 'الشركة غير موجودة في دليل الأسهم الأمريكية.' }, 404);
    const now = new Date().toISOString(), id = crypto.randomUUID();
    const candidate: PortfolioTransaction = { id, symbol: asset.symbol, companyName: asset.name, side: parsed.data.side as PortfolioSide, quantity: parsed.data.quantity, price: parsed.data.price, fees: parsed.data.fees, tradeDate: parsed.data.tradeDate, note: parsed.data.note, metadata: asset.metadata, createdAt: now, updatedAt: now };
    try { validateLedger([...current, candidate]); }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'عملية البيع تتجاوز الرصيد.' }, 409); }
    const saved=await commitAtRevision(identity.owner,revision,db().prepare('INSERT INTO portfolio_transactions(id,owner,symbol,company_name,side,quantity,price,fees,trade_date,note,metadata,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM portfolio_revisions WHERE owner=? AND revision=?)')
      .bind(id, identity.owner, asset.symbol, asset.name, parsed.data.side, parsed.data.quantity, parsed.data.price, parsed.data.fees, parsed.data.tradeDate, parsed.data.note, JSON.stringify(asset.metadata), now, now,identity.owner,revision));
    if(!saved)return json({error:'تغيّرت المحفظة أثناء الحفظ؛ أعد المحاولة.'},409);
    return await respond(request, identity);
  } catch (error: any) { return json({ error: error.message || 'تعذّر حفظ العملية.' }, statusOf(error,503)); }
}

export async function PUT(request: Request) {
  try {
    sameOrigin(request); await ensureSchema();
    const parsed = inputSchema.required({ id: true }).safeParse(await readBody(request,20_000));
    if (!parsed.success) return json({ error: 'بيانات تعديل العملية غير صالحة.' }, 400);
    assertDate(parsed.data.tradeDate);
    const identity = await resolveVisitor(request),revision=await portfolioRevision(identity.owner);
    const existing = await db().prepare('SELECT created_at FROM portfolio_transactions WHERE id=? AND owner=?').bind(parsed.data.id, identity.owner).first() as any;
    if (!existing) return json({ error: 'العملية غير موجودة.' }, 404);
    const asset = await canonicalPortfolioAsset(parsed.data.symbol);
    if (!asset) return json({ error: 'الشركة غير موجودة في دليل الأسهم الأمريكية.' }, 404);
    const now = new Date().toISOString();
    const candidate: PortfolioTransaction = { id: parsed.data.id, symbol: asset.symbol, companyName: asset.name, side: parsed.data.side, quantity: parsed.data.quantity, price: parsed.data.price, fees: parsed.data.fees, tradeDate: parsed.data.tradeDate, note: parsed.data.note, metadata: asset.metadata, createdAt: String(existing.created_at), updatedAt: now };
    const remaining = (await readPortfolioTransactions(identity.owner)).filter(transaction => transaction.id !== parsed.data.id);
    try { validateLedger([...remaining, candidate]); }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'التعديل يجعل رصيد الأسهم سالبًا.' }, 409); }
    const saved=await commitAtRevision(identity.owner,revision,db().prepare('UPDATE portfolio_transactions SET symbol=?,company_name=?,side=?,quantity=?,price=?,fees=?,trade_date=?,note=?,metadata=?,updated_at=? WHERE id=? AND owner=? AND EXISTS(SELECT 1 FROM portfolio_revisions WHERE owner=? AND revision=?)')
      .bind(asset.symbol, asset.name, parsed.data.side, parsed.data.quantity, parsed.data.price, parsed.data.fees, parsed.data.tradeDate, parsed.data.note, JSON.stringify(asset.metadata), now, parsed.data.id, identity.owner,identity.owner,revision));
    if(!saved)return json({error:'تغيّرت المحفظة أثناء التعديل؛ أعد المحاولة.'},409);
    return await respond(request, identity);
  } catch (error: any) { return json({ error: error.message || 'تعذّر تعديل العملية.' }, statusOf(error,503)); }
}

export async function DELETE(request: Request) {
  try {
    sameOrigin(request); await ensureSchema();
    const payload = await readBody(request,20_000), id = typeof payload?.id === 'string' ? payload.id : '';
    if (!z.string().uuid().safeParse(id).success) return json({ error: 'معرّف العملية غير صالح.' }, 400);
    const identity = await resolveVisitor(request),revision=await portfolioRevision(identity.owner);
    const current=await readPortfolioTransactions(identity.owner);
    if(!current.some(transaction=>transaction.id===id))return json({ error: 'العملية غير موجودة.' }, 404);
    const remaining = current.filter(transaction => transaction.id !== id);
    try { validateLedger(remaining); }
    catch { return json({ error: 'لا يمكن حذف هذه العملية لأنها ستجعل عملية بيع لاحقة بلا رصيد كافٍ.' }, 409); }
    const saved=await commitAtRevision(identity.owner,revision,db().prepare('DELETE FROM portfolio_transactions WHERE id=? AND owner=? AND EXISTS(SELECT 1 FROM portfolio_revisions WHERE owner=? AND revision=?)').bind(id, identity.owner,identity.owner,revision));
    if(!saved)return json({error:'تغيّرت المحفظة أثناء الحذف؛ حدّث الصفحة وأعد المحاولة.'},409);
    return await respond(request, identity);
  } catch (error: any) { return json({ error: error.message || 'تعذّر حذف العملية.' }, statusOf(error,503)); }
}
