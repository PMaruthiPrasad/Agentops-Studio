import type { NextRequest } from 'next/server';
import { ok, route } from '@/lib/api-response';
import { extractPdfText, MAX_DOCUMENT_BYTES } from '@/lib/documents/extract';
import { ServiceError } from '@/services/errors';

export const dynamic = 'force-dynamic';
/** pdf.js needs real Node APIs; the edge runtime cannot host it. */
export const runtime = 'nodejs';

/**
 * POST /api/documents/extract — multipart upload, text back.
 *
 * Deliberately separate from starting a run: extraction is slow and fallible,
 * and the user should find out that a PDF is a scan *before* committing to a
 * billable execution. The run request stays plain JSON carrying the text.
 */
export const POST = route(async (request: NextRequest) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw ServiceError.badRequest('Expected a multipart form upload.');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    throw ServiceError.badRequest('Attach the PDF as a "file" field.');
  }

  // Checked before reading the body into memory as well as inside the
  // extractor, which is what a direct service-layer caller would hit.
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw ServiceError.badRequest(
      `That file is over the ${(MAX_DOCUMENT_BYTES / 1024 / 1024).toFixed(0)} MB limit.`,
    );
  }

  const name = file.name || 'document.pdf';
  if (!name.toLowerCase().endsWith('.pdf')) {
    throw ServiceError.badRequest('Only PDF files can be attached.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  return ok(await extractPdfText(name, bytes));
});
