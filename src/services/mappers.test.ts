import { describe, expect, it } from 'vitest';
import { toExecutionResult, type ExecutionWithSteps } from './mappers';

/**
 * The document survives a run only as four columns on the execution row — the
 * uploaded file is never kept. These cover the read half of that round trip.
 */
function makeRow(overrides: Partial<ExecutionWithSteps> = {}): ExecutionWithSteps {
  return {
    id: 'exec_1',
    workflowId: 'wf_1',
    workflowName: 'Contract risk review',
    task: 'Find the risks that block signature',
    status: 'success',
    startedAt: new Date('2026-08-01T10:00:00Z'),
    completedAt: new Date('2026-08-01T10:01:00Z'),
    durationMs: 60_000,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalCostUsd: 0,
    successRate: 1,
    averageConfidence: 0.9,
    averageLatencyMs: 0,
    nodeCount: 0,
    edgeCount: 0,
    layerCount: 0,
    retryCount: 0,
    parallelizationScore: 0,
    complexityScore: 0,
    error: null,
    graphSnapshot: '{"nodes":[],"edges":[]}',
    documentName: null,
    documentText: null,
    documentPages: 0,
    documentTruncated: false,
    steps: [],
    ...overrides,
  } as ExecutionWithSteps;
}

describe('toExecutionResult document mapping', () => {
  it('rebuilds an attached document from its columns', () => {
    const result = toExecutionResult(
      makeRow({
        documentName: 'licence.pdf',
        documentText: 'Clause 7.2 — the indemnity is uncapped.',
        documentPages: 12,
        documentTruncated: true,
      }),
    );

    expect(result.document).toEqual({
      name: 'licence.pdf',
      text: 'Clause 7.2 — the indemnity is uncapped.',
      pages: 12,
      truncated: true,
    });
  });

  it('reports no document when none was attached', () => {
    expect(toExecutionResult(makeRow()).document).toBeNull();
  });

  it('treats a name without text as no document rather than an empty one', () => {
    // An empty document rendered in the report would imply the agents were
    // handed a blank file, which is a different failure from "none attached".
    const result = toExecutionResult(makeRow({ documentName: 'licence.pdf', documentText: '' }));

    expect(result.document).toBeNull();
  });
});
