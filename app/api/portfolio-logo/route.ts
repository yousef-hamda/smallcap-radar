import { db, ensureSchema } from '@/lib/storage';
import { visitor } from '@/lib/visitor';

const symbolPattern = /^[A-Z][A-Z0-9.^-]{0,15}$/;
const imageHeaders = (contentType: string) => ({ 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
type LogoAsset = { bytes: Uint8Array; contentType: string; fallback?: boolean };
const logoCache = new Map<string, { expiresAt: number; asset: LogoAsset }>();
const logoInFlight = new Map<string, Promise<LogoAsset>>();
const LOGO_TTL = 24 * 60 * 60_000;
const FALLBACK_TTL = 10 * 60_000;

function assetResponse(asset: LogoAsset) {
  return new Response(asset.bytes.slice(), { headers: imageHeaders(asset.contentType) });
}

function fallback(symbol: string): LogoAsset {
  let hash = 0;
  for (const character of symbol) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const colors = ['#0f766e', '#2563eb', '#7c3aed', '#be123c', '#b45309', '#047857'];
  const color = colors[hash % colors.length];
  const letters = symbol.replace(/[^A-Z0-9]/g, '').slice(0, 3);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="24" fill="${color}"/><text x="48" y="58" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="white">${letters}</text></svg>`;
  return { bytes: new TextEncoder().encode(svg), contentType: 'image/svg+xml; charset=utf-8', fallback: true };
}

async function safeImage(url: string): Promise<LogoAsset | null> {
  try {
    const response = await fetch(url, { headers: { Accept: 'image/png,image/svg+xml,image/webp,image/x-icon;q=0.8' }, redirect: 'error', signal: AbortSignal.timeout(4_000) });
    const contentType = response.headers.get('content-type') || '';
    const length = Number(response.headers.get('content-length') || 0);
    const mediaType=contentType.toLowerCase().split(';',1)[0].trim();
    if (!response.ok || !['image/png','image/jpeg','image/webp','image/svg+xml','image/x-icon','image/vnd.microsoft.icon'].includes(mediaType) || length > 500_000) return null;
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 500_000) return null;
    return { bytes: new Uint8Array(bytes), contentType };
  } catch { return null; }
}

async function resolveLogo(symbol: string, website: string | null) {
  const key = `${symbol}|${website || ''}`;
  const cached = logoCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.asset;
  logoCache.delete(key);
  const existing = logoInFlight.get(key);
  if (existing) return existing;
  const request = (async () => {
    let domainLogo: Promise<LogoAsset | null> = Promise.resolve(null);
    if (website) {
      try {
        const url = new URL(website);
        if (url.protocol === 'https:' && !/^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname)) {
          domainLogo = safeImage(`https://logo.clearbit.com/${encodeURIComponent(url.hostname)}`);
        }
      } catch { /* invalid provider website falls through to the symbol logo */ }
    }
    // Run trusted logo lookups together so one unavailable provider does not
    // make every portfolio row wait through two sequential network timeouts.
    const [financialLogo, companyLogo, parqetLogo] = await Promise.all([
      safeImage(`https://financialmodelingprep.com/image-stock/${encodeURIComponent(symbol)}.png`),
      domainLogo,
      safeImage(`https://assets.parqet.com/logos/symbol/${encodeURIComponent(symbol)}.png`),
    ]);
    const asset = financialLogo || companyLogo || parqetLogo || await safeImage(`https://images.financialmodelingprep.com/symbol/${encodeURIComponent(symbol)}.png`) || fallback(symbol);
    logoCache.set(key, { expiresAt: Date.now() + (asset.fallback ? FALLBACK_TTL : LOGO_TTL), asset });
    return asset;
  })();
  logoInFlight.set(key, request);
  try { return await request; } finally { logoInFlight.delete(key); }
}

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get('symbol')?.trim().toUpperCase() || '';
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
  const asset = await resolveLogo(symbol, typeof website === 'string' ? website : null);
  return assetResponse(asset);
}
