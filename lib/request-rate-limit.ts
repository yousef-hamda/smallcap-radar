import { db, ensureSchema } from './storage';
import { httpError } from './http';

const clientAddress = (request: Request) => {
  // In Railway's proxy chain the edge appends the connecting address last.
  // Ignore caller-supplied CF-Connecting-IP on the Railway origin.
  const forwarded=request.headers.get('x-forwarded-for')?.split(',').map(value=>value.trim()).filter(Boolean);
  return forwarded?.at(-1)||'shared-unknown-client';
};

/** Fixed-window, database-coordinated limiter shared by Worker isolates. */
export async function enforceRequestLimit(request: Request, action: string, limit: number, windowMs: number, now = Date.now(), scope: 'client' | 'global' = 'client') {
  await ensureSchema();
  const address = clientAddress(request).slice(0, 128);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scope === 'global' ? 'global' : address)));
  const clientHash = [...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const start = Math.floor(now / windowMs) * windowMs;
  const bucket = `${action}:${clientHash}:${start}`;
  const expiresAt = start + windowMs * 2;
  const row = await db().prepare('INSERT INTO request_rate_limits(bucket,requests,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET requests=requests+1 RETURNING requests').bind(bucket, expiresAt).first() as any;
  if (Number(row?.requests ?? 0) > limit) {
    throw Object.assign(httpError(429, 'تم تجاوز حد الطلبات؛ حاول مجددًا بعد قليل.'), { retryAfter: Math.max(1, Math.ceil((start + windowMs - now) / 1000)) });
  }
  if (Number(row?.requests) === 1) await db().prepare('DELETE FROM request_rate_limits WHERE expires_at<?').bind(now).run();
}
