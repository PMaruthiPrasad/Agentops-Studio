import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { parseQuery, route } from '@/lib/api-response';
import { buildRunReport, reportFileSlug } from '@/lib/reports/report-model';
import { renderReportDocx } from '@/lib/reports/docx';
import { renderReportPdf } from '@/lib/reports/pdf';
import { getExecution } from '@/services/execution.service';

export const dynamic = 'force-dynamic';
/** pdfkit and docx both need Node streams and buffers. */
export const runtime = 'nodejs';

const querySchema = z.object({ format: z.enum(['docx', 'pdf']) });

const CONTENT_TYPES = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
} as const;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/executions/:id/report?format=docx|pdf
 *
 * Both formats render from the same `RunReport`, so the Word file and the PDF
 * cannot drift apart or from what the page shows.
 */
export const GET = route(async (request: NextRequest, context: RouteContext) => {
  const { id } = await context.params;
  const { format } = parseQuery(request, querySchema);

  const report = buildRunReport(await getExecution(id));
  const file = format === 'docx' ? await renderReportDocx(report) : await renderReportPdf(report);

  return new NextResponse(new Uint8Array(file), {
    headers: {
      'Content-Type': CONTENT_TYPES[format],
      'Content-Length': String(file.byteLength),
      // `attachment` so the browser saves it instead of trying to display it.
      'Content-Disposition': `attachment; filename="${reportFileSlug(report)}.${format}"`,
      'Cache-Control': 'no-store',
    },
  });
});
