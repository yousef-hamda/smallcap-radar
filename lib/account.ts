import { db, ensureSchema } from './storage';

export const ACCOUNT_COOKIE = 'radar-session';
export const accountUsernamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;
const SESSION_TTL = 60 * 60 * 24 * 180;
const PASSWORD_ITERATIONS = 120_000;

const toBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

const fromBase64Url = (value: string) => {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(normalized);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};

export async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(bytes));
}

export async function hashPassword(password: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PASSWORD_ITERATIONS, hash: 'SHA-256' }, key, 256);
  return { salt: toBase64Url(salt), hash: toBase64Url(new Uint8Array(bits)) };
}

export async function verifyPassword(password: string, saltText: string, expectedHash: string) {
  try {
    const actual = fromBase64Url((await hashPassword(password, fromBase64Url(saltText))).hash);
    const expected = fromBase64Url(expectedHash);
    if (actual.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ expected[index];
    return difference === 0;
  } catch {
    return false;
  }
}

export function accountOwner(accountId: string) {
  return `account:${accountId}`;
}

export function sessionCookie(token: string, request: Request, maxAge = SESSION_TTL) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${ACCOUNT_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export async function createSession(accountId: string, request: Request) {
  await ensureSchema();
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date().toISOString();
  await db().prepare('INSERT INTO radar_sessions(token_hash,account_id,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?)')
    .bind(await digest(token), accountId, now, now, Date.now() + SESSION_TTL * 1000).run();
  return { token, cookie: sessionCookie(token, request) };
}

/** Move anonymous device data into an account without overwriting newer account data. */
export async function mergeOwnerData(fromOwner: string, toOwner: string) {
  if (!fromOwner || fromOwner === toOwner || !fromOwner.startsWith('visitor:')) return;
  const d = db();
  await d.batch([
    d.prepare('INSERT OR IGNORE INTO personal_watchlist(owner,symbol,created_at,payload) SELECT ?,symbol,created_at,payload FROM personal_watchlist WHERE owner=?').bind(toOwner, fromOwner),
    d.prepare('DELETE FROM personal_watchlist WHERE owner=?').bind(fromOwner),
    d.prepare('INSERT OR IGNORE INTO portfolio_revisions(owner,revision) SELECT ?,revision FROM portfolio_revisions WHERE owner=?').bind(toOwner, fromOwner),
    d.prepare('UPDATE portfolio_revisions SET revision=MAX(revision,COALESCE((SELECT revision FROM portfolio_revisions WHERE owner=?),0)) WHERE owner=?').bind(fromOwner, toOwner),
    d.prepare('DELETE FROM portfolio_transactions WHERE owner=? AND id IN (SELECT id FROM portfolio_transactions WHERE owner=?)').bind(fromOwner, toOwner),
    d.prepare('UPDATE portfolio_transactions SET owner=? WHERE owner=?').bind(toOwner, fromOwner),
    d.prepare('DELETE FROM portfolio_revisions WHERE owner=?').bind(fromOwner),
    d.prepare('DELETE FROM push_subscriptions WHERE owner=? AND endpoint IN (SELECT endpoint FROM push_subscriptions WHERE owner=?)').bind(fromOwner, toOwner),
    d.prepare('UPDATE push_subscriptions SET owner=? WHERE owner=?').bind(toOwner, fromOwner),
  ]);
}

export const accountSessionTtl = SESSION_TTL;
