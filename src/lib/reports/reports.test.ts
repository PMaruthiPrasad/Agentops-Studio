import { describe, expect, it } from 'vitest';
import { extractText, getDocumentProxy } from 'unpdf';
import { buildRunReport, reportFileSlug } from './report-model';
import { renderReportDocx } from './docx';
import { renderReportPdf } from './pdf';
import type { ExecutionResult, ExecutionStep } from '@/types/execution';

function makeStep(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: 'step_1',
    executionId: 'exec_1',
    nodeId: 'node_a',
    agentType: 'legal_validator',
    label: 'Legal Validator',
    status: 'success',
    layer: 0,
    attempts: 1,
    retries: 0,
    startedAt: '2026-08-01T10:00:00.000Z',
    completedAt: '2026-08-01T10:00:02.000Z',
    durationMs: 2_000,
    systemPrompt: 'You are a Legal Validator agent.',
    prompt: '# Task\nReview it.',
    response: 'Clause 7.2 is an uncapped indemnity and blocks signature.',
    usage: { promptTokens: 400, completionTokens: 120, totalTokens: 520 },
    costUsd: 0.0035,
    confidence: 0.82,
    provider: 'google',
    model: 'gemini-3.6-flash',
    error: null,
    skipReason: null,
    ...overrides,
  };
}

function makeExecution(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    id: 'exec_abcd1234',
    workflowId: 'wf_1',
    workflowName: 'Contract risk review',
    task: 'Find the risks that block signature',
    document: null,
    status: 'success',
    startedAt: '2026-08-01T10:00:00.000Z',
    completedAt: '2026-08-01T10:01:00.000Z',
    steps: [makeStep()],
    metrics: {
      totalDurationMs: 60_000,
      totalAgentTimeMs: 2_000,
      totalTokens: 520,
      promptTokens: 400,
      completionTokens: 120,
      totalCostUsd: 0.0035,
      successRate: 1,
      averageConfidence: 0.82,
      averageLatencyMs: 2_000,
      nodeCount: 1,
      edgeCount: 0,
      layerCount: 1,
      executedCount: 1,
      failedCount: 0,
      skippedCount: 0,
      retryCount: 0,
      parallelizationScore: 0,
      complexityScore: 0.1,
    },
    error: null,
    ...overrides,
  };
}

describe('buildRunReport', () => {
  it('keeps the request, the document and each agent response', () => {
    const report = buildRunReport(
      makeExecution({
        document: { name: 'licence.pdf', text: 'Clause 7.2 …', pages: 3, truncated: false },
      }),
    );

    expect(report.task).toBe('Find the risks that block signature');
    expect(report.document?.name).toBe('licence.pdf');
    expect(report.sections).toHaveLength(1);
    expect(report.sections[0]?.response).toContain('uncapped indemnity');
  });

  it('explains an empty section instead of dropping the agent', () => {
    // A step that silently vanishes from the report reads as an omission.
    const report = buildRunReport(
      makeExecution({
        steps: [
          makeStep({ status: 'skipped', response: '', skipReason: 'upstream branch not taken' }),
        ],
      }),
    );

    expect(report.sections[0]?.response).toBe('');
    expect(report.sections[0]?.note).toContain('upstream branch not taken');
  });

  it('names a failed step rather than showing a blank', () => {
    const report = buildRunReport(
      makeExecution({ steps: [makeStep({ status: 'failed', response: '', error: 'timeout' })] }),
    );

    expect(report.sections[0]?.note).toMatch(/failed/i);
  });

  it('builds a filename from the workflow name and run id', () => {
    expect(reportFileSlug(buildRunReport(makeExecution()))).toBe('contract-risk-review-abcd1234');
  });
});

describe('renderReportDocx', () => {
  it('produces a real Office Open XML package', async () => {
    const file = await renderReportDocx(buildRunReport(makeExecution()));

    // `PK\x03\x04` — a .docx is a zip. An HTML file with a .doc extension,
    // the usual shortcut, would not start with this.
    expect(file.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(file.byteLength).toBeGreaterThan(1_000);
  });
});

describe('renderReportPdf', () => {
  it('produces a PDF whose text survives extraction', async () => {
    const report = buildRunReport(
      makeExecution({
        document: {
          name: 'licence.pdf',
          text: 'Clause 7.2 — the indemnity is uncapped.',
          pages: 3,
          truncated: false,
        },
      }),
    );

    const file = await renderReportPdf(report);
    expect(file.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // Read it back with the same extractor the app uses for uploads: if the
    // text does not survive a round trip, the export is a picture of a report.
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(file)), {
      mergePages: true,
    });

    expect(text).toContain('Contract risk review');
    expect(text).toContain('Find the risks that block signature');
    expect(text).toContain('the indemnity is uncapped');
    expect(text).toContain('uncapped indemnity and blocks signature');
  });

  it('leaves the run telemetry out', async () => {
    // The whole point of this document: the reader wants the findings, not the
    // cost, the token counts, the model name or the prompts.
    const file = await renderReportPdf(buildRunReport(makeExecution()));
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(file)), {
      mergePages: true,
    });

    expect(text).not.toContain('gemini-3.6-flash');
    expect(text).not.toContain('0.0035');
    expect(text).not.toContain('520');
    expect(text).not.toContain('You are a Legal Validator agent.');
    expect(text).not.toMatch(/confidence/i);
  });
});
