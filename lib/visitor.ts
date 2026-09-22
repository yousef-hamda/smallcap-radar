import { db, ensureSchema } from './storage';
import { ACCOUNT_COOKIE, accountOwner, digest } from './account';

/** A private server-side identity keyed by an account or an unguessable cookie. */
export type VisitorIdentity = { owner: string; cookie: string | null; accountId?: string; username?: string };

export function visitor(request: Request) {
 // ChatGPT identity headers are trustworthy only behind the ChatGPT Sites
 // boundary. A public Railway/Node client can otherwise forge this header and
 // read or mutate another user's watchlist and portfolio.
 const hostname=new URL(request.url).hostname.toLowerCase();
 const rawUser=request.headers.get('oai-authenticated-user-id')?.trim();
 const user=hostname.endsWith('.chatgpt.site')&&rawUser&&rawUser.length<=256?rawUser:null;
 if (user) return { owner: `user:${user}`, cookie: null };
 const existing = request.headers.get('cookie')?.match(/(?:^|;\s*)radar-visitor=([a-f0-9-]{36})(?:;|$)/)?.[1];
 const id = existing || crypto.randomUUID();
 return {
   owner: `visitor:${id}`,
   cookie: existing ? null : `radar-visitor=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`,
 };
}

export async function resolveVisitor(request: Request): Promise<VisitorIdentity> {
 const anonymous = visitor(request);
 const token = request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${ACCOUNT_COOKIE}=([^;]+)`))?.[1];
 if (!token) return anonymous;
 try {
  await ensureSchema();
  const row = await db().prepare('SELECT s.account_id,a.username,s.expires_at FROM radar_sessions s JOIN radar_accounts a ON a.id=s.account_id WHERE s.token_hash=?').bind(await digest(token)).first() as any;
  if (!row || Number(row.expires_at) <= Date.now()) {
   if (row) await db().prepare('DELETE FROM radar_sessions WHERE token_hash=?').bind(await digest(token)).run();
   return anonymous;
  }
  await db().prepare('UPDATE radar_sessions SET last_seen_at=? WHERE token_hash=?').bind(new Date().toISOString(), await digest(token)).run();
  return { owner: accountOwner(String(row.account_id)), cookie: anonymous.cookie, accountId: String(row.account_id), username: String(row.username) };
 } catch {
  return anonymous;
 }
}
