/** A private server-side watchlist, keyed by platform identity or an unguessable cookie. */
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
