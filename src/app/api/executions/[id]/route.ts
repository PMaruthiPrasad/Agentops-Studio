import type { NextRequest } from 'next/server';
import { noContent, ok, route } from '@/lib/api-response';
import { deleteExecution, getExecution } from '@/services/execution.service';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/executions/:id — full run record including every step. */
export const GET = route(async (_request: NextRequest, context: RouteContext) => {
  const { id } = await context.params;
  return ok(await getExecution(id));
});

/** DELETE /api/executions/:id */
export const DELETE = route(async (_request: NextRequest, context: RouteContext) => {
  const { id } = await context.params;
  await deleteExecution(id);
  return noContent();
});
