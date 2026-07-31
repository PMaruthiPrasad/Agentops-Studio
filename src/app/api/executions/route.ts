import type { NextRequest } from 'next/server';
import { created, ok, parseJsonBody, parseQuery, route } from '@/lib/api-response';
import { listExecutionsQuerySchema, startExecutionSchema } from '@/types/api';
import { listExecutions, startExecution } from '@/services/execution.service';

export const dynamic = 'force-dynamic';

/** GET /api/executions — run history, newest first. */
export const GET = route(async (request: NextRequest) => {
  const query = parseQuery(request, listExecutionsQuerySchema);
  return ok(await listExecutions(query));
});

/**
 * POST /api/executions — start a run.
 *
 * Returns as soon as the execution row exists; the run continues in the
 * background. Subscribe to `/api/executions/:id/stream` for live progress.
 */
export const POST = route(async (request: NextRequest) => {
  const input = await parseJsonBody(request, startExecutionSchema);
  const { executionId } = await startExecution(input);

  return created({
    executionId,
    streamUrl: `/api/executions/${executionId}/stream`,
  });
});
