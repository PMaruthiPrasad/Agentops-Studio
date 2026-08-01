import { extractText, getDocumentProxy } from 'unpdf';
import { ServiceError } from '@/services/errors';
import { MAX_DOCUMENT_CHARS, type RunDocument } from '@/types/agent';

/**
 * PDF → text, once, at upload.
 *
 * Extraction deliberately happens here rather than at the provider: the
 * `LLMProvider` interface speaks in strings, and that is the seam which let
 * Vertex AI slot in without touching a single call site. Sending a PDF natively
 * would mean widening that interface for a capability only one of the four
 * providers has, so the file is reduced to text and every provider sees the
 * same thing.
 *
 * The cost of that choice is real and worth naming: layout is lost, so tables
 * and multi-column pages flatten into reading order, and a scanned agreement
 * with no text layer extracts as nothing at all. The empty-result path below
 * says so rather than silently running a workflow against a blank document.
 */

/** Upload ceiling. Large enough for a long agreement, small enough to parse fast. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** Runs of whitespace that survive PDF extraction and waste tokens. */
const EXCESS_BLANK_LINES = /\n{3,}/g;
const TRAILING_SPACES = / +$/gm;

export async function extractPdfText(name: string, bytes: Uint8Array): Promise<RunDocument> {
  if (bytes.byteLength === 0) {
    throw ServiceError.badRequest('That file is empty.');
  }

  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw ServiceError.badRequest(
      `That file is ${formatMb(bytes.byteLength)}, over the ${formatMb(MAX_DOCUMENT_BYTES)} limit.`,
    );
  }

  let pages: number;
  let raw: string;
  try {
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: true });
    pages = result.totalPages;
    raw = result.text;
  } catch (cause) {
    // A corrupt or password-protected file is the user's problem to fix, so the
    // message has to be specific enough to act on.
    throw ServiceError.badRequest(
      `Could not read "${name}" as a PDF. It may be corrupt or password-protected.`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }

  const text = raw.replace(TRAILING_SPACES, '').replace(EXCESS_BLANK_LINES, '\n\n').trim();

  if (!text) {
    throw ServiceError.badRequest(
      `No text found in "${name}". Scanned or image-only PDFs need OCR before they can be read.`,
    );
  }

  const truncated = text.length > MAX_DOCUMENT_CHARS;

  return {
    name,
    text: truncated ? text.slice(0, MAX_DOCUMENT_CHARS) : text,
    pages,
    truncated,
  };
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
