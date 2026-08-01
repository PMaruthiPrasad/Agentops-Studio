import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type ISectionOptions,
} from 'docx';
import { sectionHeading, type ReportSection, type RunReport } from './report-model';

/**
 * Word export.
 *
 * Built with the `docx` package rather than the common trick of serving HTML
 * with a `.doc` extension: that produces a file Word will open but which is not
 * a Word document, and it degrades badly the moment anyone edits or converts
 * it. A real `.docx` is a few more lines and behaves like a document.
 */

export async function renderReportDocx(report: RunReport): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ text: report.workflowName, heading: HeadingLevel.TITLE }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [
        new TextRun({
          text: report.completedAt
            ? `Completed ${formatStamp(report.completedAt)}`
            : 'Run did not complete',
          italics: true,
          color: '666666',
        }),
      ],
    }),
    new Paragraph({ text: 'Request', heading: HeadingLevel.HEADING_1 }),
    ...toParagraphs(report.task),
  ];

  if (report.document) {
    children.push(
      new Paragraph({ text: 'Source document', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({
        children: [
          new TextRun({
            text: report.document.truncated
              ? `${report.document.name} (truncated)`
              : report.document.name,
            italics: true,
            color: '666666',
          }),
        ],
      }),
      ...toParagraphs(report.document.text),
    );
  }

  children.push(new Paragraph({ text: 'Findings', heading: HeadingLevel.HEADING_1 }));

  for (const section of report.sections) {
    children.push(...sectionParagraphs(section));
  }

  const sections: ISectionOptions[] = [{ children }];
  return Packer.toBuffer(new Document({ sections }));
}

function sectionParagraphs(section: ReportSection): Paragraph[] {
  const heading = new Paragraph({
    text: sectionHeading(section),
    heading: HeadingLevel.HEADING_2,
  });

  if (!section.response) {
    return [
      heading,
      new Paragraph({
        children: [new TextRun({ text: section.note ?? '', italics: true, color: '666666' })],
      }),
    ];
  }

  return [heading, ...toParagraphs(section.response)];
}

/** Blank lines separate paragraphs; single newlines stay as line breaks. */
function toParagraphs(text: string): Paragraph[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      return new Paragraph({
        children: lines.map(
          (line, index) => new TextRun({ text: line, ...(index > 0 ? { break: 1 } : {}) }),
        ),
      });
    });
}

function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
}
