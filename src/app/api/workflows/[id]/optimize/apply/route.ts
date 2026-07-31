import type { NextRequest } from 'next/server';
import { ok, parseJsonBody, route } from '@/lib/api-response';
import { applySuggestionsSchema } from '@/types/api';
import { applyOptimizations } from '@/services/optimizer.service';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/workflows/:id/optimize/apply
 *
 * Returns the patched graph. Deliberately does not persist — the builder puts
 * the result on the canvas as an undoable edit and the user decides whether to
 * save it.
 */
export const POST = route(async (request: NextRequest, context: RouteContext) => {
  const { id } = await context.params;
  const input = await parseJsonBody(request, applySuggestionsSchema);
  return ok(await applyOptimizations(id, input));
});
