import { OPPORTUNITY_SPEC } from '@/lib/opportunity-spec';
import { fixtures } from '@/lib/fixtures';
import { readAudit, readState } from '@/lib/storage';
import { json } from '@/lib/http';

export async function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get('kind');
  if (kind != null && !['spec', 'schema', 'audit', 'data'].includes(kind)) return json({ error: 'نوع التصدير غير صالح' }, 400);
  const value = kind === 'spec'
    ? OPPORTUNITY_SPEC
    : kind === 'schema'
      ? {
          description: 'Import a Snapshot[] array, not this wrapper. This example is SYNTHETIC and must be replaced with sourced observations. Every listing receives eight deterministic grades and a final fixed-weight rating; source coverage and safety findings are disclosed separately.',
          example: fixtures[0],
          required: ['symbol', 'name', 'asOf', 'provenance'],
          metricUnits: { marketCap: 'USD', revenue: 'reported currency unless explicitly converted with sourced FX', return12m: 'decimal (-0.4 = -40%)', dilution: 'split-adjusted decimal', price: 'last completed regular session close' },
          limits: { records: 500, bytes: 4_000_000 },
        }
      : kind === 'audit' ? await readAudit() : await readState();
  const filename=kind==='spec'||kind==='schema'||kind==='audit'?kind:'data';
  return new Response(JSON.stringify(value, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="radar-${filename}.json"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
