/** A private server-side watchlist, keyed by platform identity or an unguessable cookie. */
export function visitor(request: Request) {
 const user = request.headers.get('oai-authenticated-user-id');
 if (user) return { owner: `user:${user}`, cookie: null };
 const existing = request.headers.get('cookie')?.match(/(?:^|;\s*)radar-visitor=([a-f0-9-]{36})(?:;|$)/)?.[1];
 const id = existing || crypto.randomUUID();
 return {
  owner: `visitor:${id}`,
  cookie: existing ? null : `radar-visitor=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`,
 };
}
