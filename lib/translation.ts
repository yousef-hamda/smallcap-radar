import type { Snapshot } from './engine';

type TranslationResult = { text: string; source: string };

const GOOGLE_TRANSLATE = 'https://translate.googleapis.com/translate_a/single';
const translationCache = new Map<string, { expiresAt: number; value: TranslationResult | null }>();
const inFlight = new Map<string, Promise<TranslationResult | null>>();
const MAX_CACHE = 256;
const TTL = 24 * 60 * 60_000;
const MAX_TRANSLATION_CONCURRENCY = 3;
let activeTranslations = 0;
const translationQueue: Array<() => void> = [];

const hasArabic = (value: string) => /[\u0600-\u06ff]/.test(value);
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

async function withTranslationSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeTranslations >= MAX_TRANSLATION_CONCURRENCY) {
    await new Promise<void>(resolve => translationQueue.push(resolve));
  }
  activeTranslations += 1;
  try {
    return await work();
  } finally {
    activeTranslations -= 1;
    translationQueue.shift()?.();
  }
}

function remember(key: string, value: TranslationResult | null) {
  if (translationCache.size >= MAX_CACHE) translationCache.delete(translationCache.keys().next().value!);
  translationCache.set(key, { expiresAt: Date.now() + TTL, value });
  return value;
}

/**
 * Translate provider text at the edge and keep the source language alongside
 * it. The request is deliberately best effort: financial numbers and source
 * links remain usable if the translation provider is unavailable.
 */
export async function translateToArabic(input: unknown, maxLength = 2_800): Promise<TranslationResult | null> {
  if (typeof input !== 'string') return null;
  const text = clean(input).slice(0, maxLength);
  if (!text) return null;
  if (hasArabic(text)) return { text, source: 'original Arabic text' };
  const key = `en→ar:${text}`;
  const cached = translationCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    try {
      const url = new URL(GOOGLE_TRANSLATE);
      url.searchParams.set('client', 'gtx');
      url.searchParams.set('sl', 'auto');
      url.searchParams.set('tl', 'ar');
      url.searchParams.set('dt', 't');
      url.searchParams.set('q', text);
      const response = await withTranslationSlot(() => fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4_000) }));
      if (!response.ok) return remember(key, null);
      const payload = await response.json() as unknown;
      const rows = Array.isArray(payload) && Array.isArray(payload[0]) ? payload[0] : [];
      const translated = rows.map(row => Array.isArray(row) ? row[0] : '').filter(value => typeof value === 'string').join('');
      return remember(key, translated ? { text: clean(translated), source: 'Google Translate · English to Arabic' } : null);
    } catch {
      return remember(key, null);
    }
  })();
  inFlight.set(key, request);
  try { return await request; } finally { inFlight.delete(key); }
}

async function translatedField(value: string | undefined, maxLength?: number) {
  return (await translateToArabic(value, maxLength))?.text;
}

/** Enrich the deep company file without changing any sourced numeric value. */
export async function translateSnapshotContent(snapshot: Snapshot): Promise<Snapshot> {
  const news = snapshot.news ?? [];
  const sourceTranslations = new Map<string, Promise<string | undefined>>();
  const translateSource = (source: string | undefined) => {
    if (!source) return Promise.resolve(undefined);
    const existing = sourceTranslations.get(source);
    if (existing) return existing;
    const request = translatedField(source, 120);
    sourceTranslations.set(source, request);
    return request;
  };
  const [nameAr, descriptionAr, sectorAr, industryAr, translatedNews] = await Promise.all([
    translatedField(snapshot.name, 220),
    translatedField(snapshot.description, 3_600),
    translatedField(snapshot.sector, 120),
    translatedField(snapshot.industry, 160),
    Promise.all(news.map(async item => ({
      ...item,
      titleAr: (await translateToArabic(item.title, 500))?.text,
      sourceAr: await translateSource(item.source),
    }))),
  ]);
  const next: Snapshot = {
    ...snapshot,
    nameAr: nameAr || snapshot.nameAr,
    descriptionAr: descriptionAr || snapshot.descriptionAr,
    sectorAr: sectorAr || snapshot.sectorAr,
    industryAr: industryAr || snapshot.industryAr,
    news: translatedNews,
  };
  const translationIssues = [
    snapshot.name && !nameAr && !hasArabic(snapshot.name) ? 'تعذّرت ترجمة اسم الشركة إلى العربية.' : '',
    snapshot.description && !descriptionAr && !hasArabic(snapshot.description) ? 'تعذّرت ترجمة وصف الشركة إلى العربية.' : '',
    news.some(item => item.title && !item.titleAr && !hasArabic(item.title)) ? 'تعذّرت ترجمة خبر واحد أو أكثر إلى العربية.' : '',
  ].filter(Boolean);
  if (translationIssues.length) next.dataIssues = [...new Set([...(snapshot.dataIssues ?? []), ...translationIssues])];
  if (next.nameAr || next.descriptionAr || next.sectorAr || next.industryAr || translatedNews.some(item => item.titleAr)) {
    next.provenance = {
      ...next.provenance,
      translation: {
        source: 'Google Translate · best effort Arabic enrichment',
        periodEnd: snapshot.asOf.slice(0, 10),
        availableAt: snapshot.asOf,
        retrievedAt: new Date().toISOString(),
        confidence: 'medium',
      },
    };
  }
  return next;
}
