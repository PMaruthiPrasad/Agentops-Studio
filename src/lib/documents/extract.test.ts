import { describe, expect, it } from 'vitest';
import { extractPdfText, MAX_DOCUMENT_BYTES } from './extract';
import { buildTestPdf } from './pdf-fixture';
import { ServiceError } from '@/services/errors';
import { MAX_DOCUMENT_CHARS } from '@/types/agent';

describe('extractPdfText', () => {
  it('reads the text out of a real PDF', async () => {
    const pdf = buildTestPdf(['MASTER LICENCE AGREEMENT', 'Clause 7.2 — indemnity is uncapped.']);

    const document = await extractPdfText('licence.pdf', pdf);

    expect(document.name).toBe('licence.pdf');
    expect(document.text).toContain('MASTER LICENCE AGREEMENT');
    expect(document.text).toContain('indemnity is uncapped');
    expect(document.pages).toBe(1);
    expect(document.truncated).toBe(false);
  });

  it('collapses the whitespace that PDF extraction leaves behind', async () => {
    const pdf = buildTestPdf(['First line', '', '', '', 'Second line']);

    const { text } = await extractPdfText('spacing.pdf', pdf);

    // Every blank run costs tokens on every node, so runs of three or more
    // newlines are not worth paying for.
    expect(text).not.toMatch(/\n{3,}/);
  });

  it('rejects an empty file', async () => {
    await expect(extractPdfText('empty.pdf', new Uint8Array())).rejects.toThrow(ServiceError);
    await expect(extractPdfText('empty.pdf', new Uint8Array())).rejects.toThrow(/empty/i);
  });

  it('rejects a file over the size limit before parsing it', async () => {
    const oversized = new Uint8Array(MAX_DOCUMENT_BYTES + 1);

    await expect(extractPdfText('huge.pdf', oversized)).rejects.toThrow(/limit/i);
  });

  it('reports a file it cannot parse as a PDF rather than throwing raw', async () => {
    const notAPdf = new TextEncoder().encode('This is a plain text file, not a PDF at all.');

    // The message has to name the file and suggest a cause — "Invalid XRef
    // stream header" from pdf.js is not something a user can act on.
    await expect(extractPdfText('notes.pdf', notAPdf)).rejects.toThrow(
      /Could not read "notes\.pdf" as a PDF/,
    );
  });

  it('flags a document that had to be truncated', async () => {
    // One long line repeated past the ceiling: every node receives this text,
    // so an unbounded document would multiply cost by the node count.
    const line = 'The Licensee shall indemnify the Licensor without limitation.';
    const repeats = Math.ceil(MAX_DOCUMENT_CHARS / line.length) + 50;
    const pdf = buildTestPdf(Array.from({ length: repeats }, () => line));

    const document = await extractPdfText('long.pdf', pdf);

    expect(document.truncated).toBe(true);
    expect(document.text.length).toBe(MAX_DOCUMENT_CHARS);
  });
});
