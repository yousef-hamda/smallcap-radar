import { db, ensureSchema } from '@/lib/storage';
import { accountOwner, accountUsernamePattern, createSession, digest, hashPassword, mergeOwnerData, sessionCookie, verifyPassword } from '@/lib/account';
import { body, json, sameOrigin, statusOf } from '@/lib/http';
import { resolveVisitor } from '@/lib/visitor';

const cookieExpired = (request: Request) => sessionCookie('', request, 0);

function withCookies(response: Response, request: Request, cookies: string[]) {
  for (const cookie of cookies) response.headers.append('Set-Cookie', cookie);
  return response;
}

export async function GET(request: Request) {
  try {
    const identity = await resolveVisitor(request);
    const response = json({ account: identity.accountId ? { username: identity.username } : null });
    if (identity.cookie) response.headers.set('Set-Cookie', identity.cookie);
    return response;
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'تعذّر قراءة حالة الحساب.' }, statusOf(error, 503));
  }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    await ensureSchema();
    const payload = await body(request, 20_000) as { action?: unknown; username?: unknown; password?: unknown };
    const action = String(payload.action || '');
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    const identity = await resolveVisitor(request);

    if (action === 'logout') {
      const token = request.headers.get('cookie')?.match(/(?:^|;\s*)radar-session=([^;]+)/)?.[1];
      if (token) await db().prepare('DELETE FROM radar_sessions WHERE token_hash=?').bind(await digest(token)).run();
      return withCookies(json({ account: null }), request, [cookieExpired(request)]);
    }
    if (action !== 'signup' && action !== 'login') return json({ error: 'عملية الحساب غير معروفة.' }, 400);
    if (!accountUsernamePattern.test(username)) return json({ error: 'اسم المستخدم يجب أن يكون من 3 إلى 32 حرفًا أو رقمًا.' }, 400);
    if (password.length < 8 || password.length > 128) return json({ error: 'كلمة المرور يجب أن تكون من 8 إلى 128 حرفًا.' }, 400);

    let account: any;
    if (action === 'signup') {
      const existing = await db().prepare('SELECT id FROM radar_accounts WHERE lower(username)=lower(?)').bind(username).first();
      if (existing) return json({ error: 'اسم المستخدم مستخدم بالفعل.' }, 409);
      const id = crypto.randomUUID(), now = new Date().toISOString(), credentials = await hashPassword(password);
      await db().prepare('INSERT INTO radar_accounts(id,username,password_salt,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)')
        .bind(id, username, credentials.salt, credentials.hash, now, now).run();
      account = { id, username };
    } else {
      account = await db().prepare('SELECT id,username,password_salt,password_hash FROM radar_accounts WHERE lower(username)=lower(?)').bind(username).first() as any;
      if (!account || !(await verifyPassword(password, String(account.password_salt), String(account.password_hash)))) return json({ error: 'اسم المستخدم أو كلمة المرور غير صحيح.' }, 401);
    }

    const owner = accountOwner(String(account.id));
    await mergeOwnerData(identity.owner, owner);
    const session = await createSession(String(account.id), request);
    const response = json({ account: { username: String(account.username) } });
    const cookies = [session.cookie];
    if (identity.cookie) cookies.unshift(identity.cookie);
    return withCookies(response, request, cookies);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'تعذّر حفظ الحساب.' }, statusOf(error, 503));
  }
}
