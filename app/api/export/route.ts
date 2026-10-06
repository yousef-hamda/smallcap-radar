import { OPPORTUNITY_SPEC } from '@/lib/opportunity-spec';
import { fixtures } from '@/lib/fixtures';
import { readAudit, readState } from '@/lib/storage';
import { json, statusOf } from '@/lib/http';
import { requestedRankRelease } from '@/lib/rank-release';

export async function GET(req: Request) {
 try {
  const params = new URL(req.url).searchParams;
  const kind = params.get('kind');
  if (kind != null && !['spec', 'schema', 'audit', 'data'].includes(kind)) return json({ error: 'نوع التصدير غير صالح' }, 400);
  if (kind == null || kind === 'data') {
    const first = await readState({...requestedRankRelease(params),opportunityState:'all',limit:250});
    const encoder = new TextEncoder();
    let page = first, offset = 0, started = false, finished = false;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (finished) { controller.close(); return; }
          if (!started) {
            controller.enqueue(encoder.encode(`${JSON.stringify({release:first.release,dataRun:first.dataRun,summary:first.summary}).slice(0,-1)},"results":[`));
            started = true;
          } else if (offset && first.release) {
            page = await readState({runId:first.release.runId,releaseToken:first.release.token,opportunityState:'all',limit:250,offset});
          }
          const records = page.snapshots.map((snapshot:any,index:number)=>({snapshot,evaluation:page.storedEvaluations[index].opportunity,rank:page.rankPositions[index]}));
          if (records.length) controller.enqueue(encoder.encode(`${offset?',':''}${records.map((record:unknown)=>JSON.stringify(record)).join(',')}`));
          offset += records.length;
          if (!page.page.hasMore) {
            if (offset !== first.summary.total) throw Error('Export count changed during publication');
            controller.enqueue(encoder.encode(']}')); finished = true; controller.close();
          }
        } catch (error) { controller.error(error); }
      },
      cancel() { finished = true; },
    });
    return new Response(stream,{headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="radar-data.json"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
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
 } catch(error) { return json({error:error instanceof Error?error.message:'تعذّر التصدير'},statusOf(error,503)); }
}
