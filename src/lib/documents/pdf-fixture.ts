/**
 * Builds a real, structurally valid PDF in memory.
 *
 * Tests for the extractor need genuine PDF bytes — a stubbed parser would only
 * prove the stub works. Writing the file format by hand keeps that honest
 * without checking a binary fixture into the repository.
 */

/** Lines that fit on a US Letter page at 14pt leading, starting at y=720. */
const LINES_PER_PAGE = 48;

export function buildTestPdf(lines: string[]): Uint8Array {
  // Text drawn past the bottom of the MediaBox is off the page, and a PDF
  // reader will not extract it — long documents have to be paginated for the
  // same reason a real one is.
  const pages = chunk(lines.length > 0 ? lines : [''], LINES_PER_PAGE);

  // Objects 1-3 are fixed (catalog, page tree, font); each page then
  // contributes a content stream and a page object.
  const objects: string[] = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const pageNumbers: number[] = [];

  for (const pageLines of pages) {
    const content =
      'BT\n/F1 12 Tf\n72 720 Td\n14 TL\n' +
      pageLines.map((line) => `(${escapePdfText(line)}) Tj\nT*\n`).join('') +
      'ET\n';

    objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
    const contentNumber = objects.length;

    objects.push(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        `/Contents ${contentNumber} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
    pageNumbers.push(objects.length);
  }

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] =
    `<< /Type /Pages /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(' ')}] ` +
    `/Count ${pageNumbers.length} >>`;

  let pdf = '%PDF-1.4\n';
  // Byte offset of each object, needed for the cross-reference table.
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** Parentheses and backslashes are PDF string syntax, not literal characters. */
function escapePdfText(value: string): string {
  return value.replace(/([\\()])/g, '\\$1');
}
