import { DATA_FIELD_REGISTRY, sourceRegistrySummary } from '@/lib/source-registry';

export const runtime = 'edge';

export async function GET() {
  return Response.json(sourceRegistrySummary(), {
    headers: {
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
      'X-Data-Field-Families': String(DATA_FIELD_REGISTRY.length),
    },
  });
}
