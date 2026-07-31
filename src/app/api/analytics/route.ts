import type { NextRequest } from 'next/server';
import { ok, parseQuery, route } from '@/lib/api-response';
import { analyticsQuerySchema } from '@/types/api';
import { getAnalytics } from '@/services/analytics.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/analytics?days=30&workflowId=…
 *
 * Overview cards, per-agent performance, daily timeline, status breakdown, and
 * recent runs — everything the analytics page renders, computed server-side.
 */
export const GET = route(async (request: NextRequest) => {
  const query = parseQuery(request, analyticsQuerySchema);
  return ok(await getAnalytics(query));
});
