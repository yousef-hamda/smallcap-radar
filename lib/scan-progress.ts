export type ScanRun = {
 id: string; status: string; source: string; stage: number; offset: number;
 processed: number; total: number; failed: number; retryPending?: number;
 created_at: string; updated_at: string; universe_total?: number;
 quote_coverage?: number; fundamental_coverage?: number; sec_failed?: number;
 error?: string; strategy_hash?: string;
};

/** Operational phase weights, not an ETA or a financial score. Never ticks by time. */
export function scanProgress(run: ScanRun | null | undefined) {
 if (!run) return { percent: 0, phase: 'لم يبدأ الفحص', active: false };
 const fraction = run.total > 0 ? Math.min(1, Math.max(0, run.offset / run.total)) : 0;
 const terminal = run.stage >= 13 && run.offset >= run.total && !run.retryPending;
 const active = ['running', 'partial'].includes(run.status) && !terminal;
 if (run.status === 'complete' && terminal) return { percent: 100, phase: 'اكتمل الفحص وحُفظت النتائج', active: false };
 let percent = 0, phase = 'تجهيز السوق وجلب الأسعار الجماعية';
 if (run.source.includes('quick')) { percent = fraction * 99; phase = 'فحص العينة — ليس السوق الكامل'; }
 else if (run.stage >= 10) { percent = 60 + fraction * 39.99; phase = 'التحقق من التاريخ والسيولة للمرشحين'; }
 else if (run.stage >= 9) { percent = 35 + fraction * 25; phase = 'تقييم الشركات وحفظ النتائج الأولية'; }
 else if (run.stage >= 4) { percent = 20; phase = 'جلب الأساسيات الجماعية SEC Frames'; }
 if (run.status === 'failed') phase = 'توقف الفحص بسبب خطأ';
 if (terminal && run.status === 'partial') phase = 'انتهى الفحص بنتائج جزئية — بيانات لم تكتمل';
 return { percent: Math.floor(percent * 100) / 100, phase, active };
}
