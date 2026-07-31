import type { NextRequest } from 'next/server';
import { noContent, ok, parseJsonBody, route } from '@/lib/api-response';
import { updateWorkflowSchema } from '@/types/api';
import { deleteWorkflow, getWorkflow, updateWorkflow } from '@/services/workflow.service';

export const dynamic = 'force-dynamic';

/** Next 15 delivers dynamic route params asynchronously. */
type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/workflows/:id — full workflow including its graph. */
export const GET = route(async (_request: NextRequest, context: RouteContext) => {
  const { id } = await context.params;
  return ok(await getWorkflow(id));
});

/** PATCH /api/workflows/:id — partial update; a graph change cuts a new version. */
export const PATCH = route(async (request: NextRequest, context: RouteContext) => {
  const { id } = await context.params;
  const input = await parseJsonBody(request, updateWorkflowSchema);
  return ok(await updateWorkflow(id, input));
});

/** DELETE /api/workflows/:id — cascades to nodes, edges, versions, and runs. */
export const DELETE = route(async (_request: NextRequest, context: RouteContext) => {
  const { id } = await context.params;
  await deleteWorkflow(id);
  return noContent();
});
