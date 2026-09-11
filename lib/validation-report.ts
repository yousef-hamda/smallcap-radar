/**
 * Frozen research evidence shown in the Data Center.
 *
 * These are not production probabilities. The Bounce numbers come from the
 * reproducible free price-only study dated 2026-09-11. Core remains blocked
 * because no point-in-time fundamentals/outcome panel is available.
 */
export const VALIDATION_REPORT = Object.freeze({
  generatedAt: '2026-09-11',
  bounce: Object.freeze({
    status: 'استكشافية — غير مفعّلة في الإنتاج',
    universe: '1,000 رمزًا حاليًا؛ 556 رمزًا بتاريخ ≥500 جلسة؛ 402 شركة أنتجت إشارات',
    final: Object.freeze({ baseline: 41.8663, challenger: 44.8454, random: 42.0103, observations: 388, firms: 174, ciLow: 39.9714, ciHigh: 49.8204, deltaBaseline: 2.9790, deltaRandom: 2.8351, clusteredDeltaLow: -0.9461, clusteredDeltaHigh: 8.2811 }),
    candidate: 'هبوط ≤ −55%، ابتعاد ≥20% عن قاع 52 أسبوعًا، دون بوابة MA30W',
    reference: Object.freeze({ strategy: 47.2, random: 37.2, maHoldoutBefore: 46.0, maHoldoutAfter: 54.8 }),
    dataHash: '64e6d4ea1a5f98e635b576c8cb1cc964249ab96dad7a1d1b2baaf42c022466f1',
  }),
  core: Object.freeze({
    status: 'محجوب — لا توجد نسبة قابلة للإثبات',
    reason: 'الأساسيات المضمنة لقطة حالية وليست Point-in-Time مع نتائج 12/24 شهرًا وشركات مشطوبة.',
  }),
});
