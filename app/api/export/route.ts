import { SPECS } from '@/lib/engine';
import { fixtures } from '@/lib/fixtures';
import { readAudit, readState } from '@/lib/storage';

export async function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get('kind');
  const value = kind === 'spec'
    ? SPECS
    : kind === 'schema'
      ? {
          description: 'Import a Snapshot[] array, not this wrapper. This example is SYNTHETIC and must be replaced with sourced observations.',
          example: fixtures[0],
          required: ['symbol', 'name', 'asOf', 'provenance'],
          metricUnits: { marketCap: 'USD', revenue: 'USD', return12m: 'decimal (-0.4 = -40%)', dilution: 'split-adjusted decimal', ma30w: 'last close of each 30 fully completed consecutive trading weeks' },
          limits: { records: 500, bytes: 4_000_000 },
        }
      : kind === 'audit' ? await readAudit() : await readState();
  return new Response(JSON.stringify(value, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="radar-${kind || 'audit'}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
