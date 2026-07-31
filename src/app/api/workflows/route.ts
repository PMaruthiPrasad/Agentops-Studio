import type { NextRequest } from 'next/server';
import { created, ok, parseJsonBody, parseQuery, route } from '@/lib/api-response';
import { createWorkflowSchema, listWorkflowsQuerySchema } from '@/types/api';
import { createWorkflow, listWorkflows } from '@/services/workflow.service';

export const dynamic = 'force-dynamic';

/** GET /api/workflows — list with search, tag, and favorite filters. */
export const GET = route(async (request: NextRequest) => {
  const query = parseQuery(request, listWorkflowsQuerySchema);
  return ok(await listWorkflows(query));
});

/** POST /api/workflows — create a workflow, optionally with an initial graph. */
export const POST = route(async (request: NextRequest) => {
  const input = await parseJsonBody(request, createWorkflowSchema);
  return created(await createWorkflow(input));
});
