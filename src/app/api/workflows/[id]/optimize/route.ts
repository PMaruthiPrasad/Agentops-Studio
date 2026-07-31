import type { NextRequest } from 'next/server';
import { ok, route } from '@/lib/api-response';
import { optimizeWorkflowSchema } from '@/types/api';
import { optimizeWorkflow } from '@/services/optimizer.service';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/workflows/:id/optimize
 *
 * Analyses the saved graph, or `graphOverride` when the builder wants to
 * evaluate unsaved canvas edits. Set `includeNarrative: false` to skip the LLM
 * summary and get a purely deterministic response.
 */
export const POST = route(async (request: NextRequest, context: RouteContext) => {
  const { id } = await context.params;

  const raw: unknown = await request.json().catch(() => ({}));
  const input = optimizeWorkflowSchema.parse(raw ?? {});

  return ok(await optimizeWorkflow(id, input));
});
