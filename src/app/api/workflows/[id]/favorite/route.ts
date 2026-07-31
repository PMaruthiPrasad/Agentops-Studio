import type { NextRequest } from 'next/server';
import { ok, route } from '@/lib/api-response';
import { toggleFavorite } from '@/services/workflow.service';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** POST /api/workflows/:id/favorite — toggles the favorite flag. */
export const POST = route(async (_request: NextRequest, context: RouteContext) => {
  const { id } = await context.params;
  return ok(await toggleFavorite(id));
});
