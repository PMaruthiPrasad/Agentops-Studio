import type { NextRequest } from 'next/server';
import { created, route } from '@/lib/api-response';
import { duplicateWorkflowSchema } from '@/types/api';
import { duplicateWorkflow } from '@/services/workflow.service';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/workflows/:id/duplicate
 *
 * Body is optional — an empty body clones with a "(copy)" suffix.
 */
export const POST = route(async (request: NextRequest, context: RouteContext) => {
  const { id } = await context.params;

  const raw: unknown = await request.json().catch(() => ({}));
  const { name } = duplicateWorkflowSchema.parse(raw ?? {});

  return created(await duplicateWorkflow(id, name));
});
