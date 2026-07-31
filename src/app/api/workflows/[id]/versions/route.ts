import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { ok, parseJsonBody, route } from '@/lib/api-response';
import { listVersions, restoreVersion } from '@/services/workflow.service';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const restoreSchema = z.object({
  version: z.number().int().positive(),
});

/** GET /api/workflows/:id/versions — snapshot history, newest first. */
export const GET = route(async (_request: NextRequest, context: RouteContext) => {
  const { id } = await context.params;
  return ok(await listVersions(id));
});

/**
 * POST /api/workflows/:id/versions — restore a snapshot.
 *
 * Restoring appends a new version rather than rewinding, so history is
 * append-only and a restore is itself undoable.
 */
export const POST = route(async (request: NextRequest, context: RouteContext) => {
  const { id } = await context.params;
  const { version } = await parseJsonBody(request, restoreSchema);
  return ok(await restoreVersion(id, version));
});
