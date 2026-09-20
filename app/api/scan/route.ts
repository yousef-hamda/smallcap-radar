import { body, json, sameOrigin, statusOf } from '@/lib/http';
import { processScanBatch, startScan } from '@/lib/scanner';

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const input = await body(request,8_000);
    if (input.action === 'start') return json({ run: await startScan(input.mode) });
    if (input.action === 'step' && typeof input.runId === 'string') return json(await processScanBatch(input.runId));
    return json({ error: 'عملية غير صالحة' }, 400);
  } catch (error: any) {
    return json({ error: error.message || 'تعذّر إكمال الفحص. النتائج السابقة محفوظة.' }, statusOf(error,503));
  }
}
