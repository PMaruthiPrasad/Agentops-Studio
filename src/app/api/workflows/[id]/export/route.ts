import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { handleError } from '@/lib/api-response';
import { slugify } from '@/lib/utils';
import { exportWorkflow } from '@/services/workflow.service';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/workflows/:id/export
 *
 * Returns the portable JSON document directly (not wrapped in the `{ data }`
 * envelope) with a download disposition, so the browser saves a file that can
 * be re-imported as-is.
 */
export async function GET(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const document = await exportWorkflow(id);
    const filename = `${slugify(document.name) || 'workflow'}.agentops.json`;

    return new NextResponse(JSON.stringify(document, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
