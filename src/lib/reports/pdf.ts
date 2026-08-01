import PDFDocument from 'pdfkit';
import { sectionHeading, type ReportSection, type RunReport } from './report-model';

/**
 * PDF export.
 *
 * Generated server-side with pdfkit rather than sent through the browser's
 * print dialog, so the download is a file rather than a five-step manual
 * detour, and so both exports come out of the same report model. Only the
 * standard PostScript fonts are used — they are built into every PDF reader, so
 * nothing has to be embedded and no font asset has to ship.
 */

const MARGIN = 56;
const BODY_SIZE = 10.5;

export function renderReportPdf(report: RunReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      info: { Title: `${report.workflowName} — report`, Author: 'AgentOps Studio' },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(20).fillColor('#111111').text(report.workflowName);

    doc
      .moveDown(0.3)
      .font('Helvetica-Oblique')
      .fontSize(9)
      .fillColor('#666666')
      .text(
        report.completedAt
          ? `Completed ${formatStamp(report.completedAt)}`
          : 'Run did not complete',
      );

    heading(doc, 'Request');
    body(doc, report.task);

    if (report.document) {
      heading(doc, 'Source document');
      doc
        .font('Helvetica-Oblique')
        .fontSize(9)
        .fillColor('#666666')
        .text(
          report.document.truncated ? `${report.document.name} (truncated)` : report.document.name,
        );
      doc.moveDown(0.4);
      body(doc, report.document.text);
    }

    heading(doc, 'Findings');
    for (const section of report.sections) {
      renderSection(doc, section);
    }

    doc.end();
  });
}

type Doc = InstanceType<typeof PDFDocument>;

function renderSection(doc: Doc, section: ReportSection): void {
  // Keep a heading with at least a little of its text: a subheading stranded at
  // the foot of a page is the classic generated-PDF tell.
  if (doc.y > doc.page.height - MARGIN - 80) doc.addPage();

  doc
    .moveDown(0.8)
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor('#111111')
    .text(sectionHeading(section));
  doc.moveDown(0.3);

  if (!section.response) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(BODY_SIZE)
      .fillColor('#666666')
      .text(section.note ?? '');
    return;
  }

  body(doc, section.response);
}

function heading(doc: Doc, text: string): void {
  doc.moveDown(1).font('Helvetica-Bold').fontSize(14).fillColor('#111111').text(text);
  doc.moveDown(0.4);
}

function body(doc: Doc, text: string): void {
  doc.font('Helvetica').fontSize(BODY_SIZE).fillColor('#222222');

  for (const block of text.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    doc.text(trimmed, { align: 'left', lineGap: 2 });
    doc.moveDown(0.5);
  }
}

function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
}
