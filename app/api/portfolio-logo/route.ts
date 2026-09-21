import { db, ensureSchema } from '@/lib/storage';
import { visitor } from '@/lib/visitor';

const symbolPattern = /^[A-Z][A-Z0-9.^-]{0,15}$/;
const imageHeaders = (contentType: string) => ({ 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
type LogoAsset = { bytes: Uint8Array; contentType: string; fallback?: boolean };
const logoCache = new Map<string, { expiresAt: number; asset: LogoAsset }>();
const logoInFlight = new Map<string, Promise<LogoAsset>>();
const LOGO_TTL = 24 * 60 * 60_000;
const FALLBACK_TTL = 10 * 60_000;

// First party favicons cover the companies most often used in the portfolio.
// Ticker based providers remain the primary source for the rest of the stock universe.
const KNOWN_DOMAINS: Record<string, string> = {
  AAPL: 'apple.com',
  AMZN: 'amazon.com',
  AVGO: 'broadcom.com',
  GOOGL: 'google.com',
  MSFT: 'microsoft.com',
  NVDA: 'nvidia.com',
  RKLB: 'rocketlabusa.com',
  SOFI: 'sofi.com',
  TSLA: 'tesla.com',
};

function assetResponse(asset: LogoAsset) {
  return new Response(asset.bytes.slice(), { headers: imageHeaders(asset.contentType) });
}

function fallback(symbol: string): LogoAsset {
  let hash = 0;
  for (const character of symbol) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const colors = ['#0f766e', '#2563eb', '#7c3aed', '#be123c', '#b45309', '#047857'];
  const color = colors[hash % colors.length];
  const angle = 18 + hash % 45;
  // The final safety net is a branded geometric mark instead of a plain ticker badge.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="#111827"/></linearGradient></defs><rect width="96" height="96" rx="24" fill="url(#g)"/><g transform="rotate(${angle} 48 48)" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round"><path stroke-width="8" d="M23 62 38 46l11 10 24-25"/><path stroke-width="5" opacity=".72" d="M23 72h50"/></g><circle cx="73" cy="31" r="5" fill="#fff"/></svg>`;
  return { bytes: new TextEncoder().encode(svg), contentType: 'image/svg+xml; charset=utf-8', fallback: true };
}

async function safeImage(url: string): Promise<LogoAsset | null> {
  try {
    // The URLs are fixed provider endpoints (the website host is encoded
    // after HTTPS/private-network validation). Follow provider redirects so
    // the same resolver behaves consistently in Vite preview and Workers.
    const response = await fetch(url, { headers: { Accept: 'image/png,image/svg+xml,image/webp,image/x-icon;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(4_000) });
    const contentType = response.headers.get('content-type') || '';
    const length = Number(response.headers.get('content-length') || 0);
    const mediaType=contentType.toLowerCase().split(';',1)[0].trim();
    if (!response.ok || !['image/png','image/jpeg','image/webp','image/svg+xml','image/x-icon','image/vnd.microsoft.icon'].includes(mediaType) || length > 500_000) return null;
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 500_000) return null;
    return { bytes: new Uint8Array(bytes), contentType };
  } catch { return null; }
}

async function resolveLogo(symbol: string, website: string | null, forceRefresh = false) {
  const key = `${symbol}|${website || ''}`;
  if (forceRefresh) logoCache.delete(key);
  const cached = logoCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.asset;
  logoCache.delete(key);
  const existing = logoInFlight.get(key);
  if (existing) return existing;
  const request = (async () => {
    let websiteLogo: Promise<LogoAsset | null> = Promise.resolve(null);
    const websiteDomain = website ? (() => {
      try {
        const url = new URL(website);
        return url.protocol === 'https:' && !/^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname) ? url.hostname : null;
      } catch { return null; }
    })() : null;
    const domain = websiteDomain || KNOWN_DOMAINS[symbol];
    if (domain) websiteLogo = safeImage(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`);
    // Run trusted logo lookups together so one unavailable provider does not
    // make every portfolio row wait through two sequential network timeouts.
    const [financialLogo, companyLogo, parqetLogo, marketCapLogo, faviconLogo] = await Promise.all([
      safeImage(`https://financialmodelingprep.com/image-stock/${encodeURIComponent(symbol)}.png`),
      websiteLogo,
      safeImage(`https://assets.parqet.com/logos/symbol/${encodeURIComponent(symbol)}.png`),
      safeImage(`https://companiesmarketcap.com/img/company-logos/128/${encodeURIComponent(symbol)}.png`),
      safeImage(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(KNOWN_DOMAINS[symbol] || `${symbol.toLowerCase()}.com`)}&sz=128`),
    ]);
    const asset = financialLogo || companyLogo || parqetLogo || marketCapLogo || faviconLogo || await safeImage(`https://images.financialmodelingprep.com/symbol/${encodeURIComponent(symbol)}.png`) || fallback(symbol);
    logoCache.set(key, { expiresAt: Date.now() + (asset.fallback ? FALLBACK_TTL : LOGO_TTL), asset });
    return asset;
  })();
  logoInFlight.set(key, request);
  try { return await request; } finally { logoInFlight.delete(key); }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = params.get('symbol')?.trim().toUpperCase() || '';
  const forceRefresh = params.get('retry') === '1';
  if (!symbolPattern.test(symbol)) return new Response('Invalid symbol', { status: 400 });
  let website: unknown = null;
  try {
    await ensureSchema();
    const identity = visitor(request);
    const row = await db().prepare('SELECT metadata FROM portfolio_transactions WHERE owner=? AND symbol=? ORDER BY updated_at DESC LIMIT 1').bind(identity.owner, symbol).first() as any;
    website = row?.metadata ? JSON.parse(String(row.metadata))?.website : null;
    if (typeof website !== 'string') {
      const snapshot = await db().prepare("SELECT json_extract(payload,'$.website') AS website FROM fundamental_snapshots WHERE symbol=? ORDER BY as_of DESC,id DESC LIMIT 1").bind(symbol).first() as any;
      website = snapshot?.website;
    }
  } catch { /* logo fallback remains available even when metadata is unavailable */ }
  const asset = await resolveLogo(symbol, typeof website === 'string' ? website : null, forceRefresh);
  return assetResponse(asset);
}
