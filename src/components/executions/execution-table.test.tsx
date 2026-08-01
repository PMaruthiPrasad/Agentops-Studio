import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExecutionTable } from './execution-table';
import type { ExecutionSummary } from '@/types/execution';

function makeExecution(overrides: Partial<ExecutionSummary> = {}): ExecutionSummary {
  return {
    id: 'exec_1',
    workflowId: 'wf_1',
    workflowName: 'Contract risk review',
    task: 'Review a software licensing agreement and identify legal risks.',
    status: 'success',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 8_400,
    totalTokens: 12_400,
    totalCostUsd: 0.0412,
    successRate: 1,
    averageConfidence: 0.86,
    stepCount: 6,
    ...overrides,
  };
}

describe('ExecutionTable', () => {
  it('renders one row per run with formatted metrics', () => {
    render(<ExecutionTable executions={[makeExecution()]} />);

    const row = screen.getAllByRole('row')[1];
    expect(row).toBeDefined();

    expect(within(row!).getByText('Contract risk review')).toBeInTheDocument();
    // Sub-10s durations keep two decimals, so 8_400ms reads as "8.40s".
    expect(within(row!).getByText('8.40s')).toBeInTheDocument();
    expect(within(row!).getByText('12.4k')).toBeInTheDocument();
    expect(within(row!).getByText('$0.0412')).toBeInTheDocument();
    expect(within(row!).getByText('86%')).toBeInTheDocument();
  });

  it('links each run to its report and its workflow', () => {
    render(<ExecutionTable executions={[makeExecution()]} />);

    expect(screen.getByRole('link', { name: 'Contract risk review' })).toHaveAttribute(
      'href',
      '/workflows/wf_1',
    );
    expect(
      screen.getByRole('link', { name: /Review a software licensing agreement/ }),
    ).toHaveAttribute('href', '/executions/exec_1');
  });

  it('gives the run link a hit area covering the whole row', () => {
    // Regression: the report was reachable only from the task text and a small
    // chevron, so clicking the status, the cost or the row's empty space did
    // nothing — and the workflow name, the most obvious target, navigated away
    // to the builder instead. jsdom does no layout, so this asserts the
    // mechanism: a stretched link inside a positioned row.
    render(<ExecutionTable executions={[makeExecution()]} />);

    const row = screen.getAllByRole('row')[1];
    const runLink = screen.getByRole('link', { name: /Review a software licensing agreement/ });

    expect(row?.className).toContain('relative');
    expect(runLink.className).toContain('after:absolute');
    expect(runLink.className).toContain('after:inset-0');
  });

  it('exposes exactly two links per row', () => {
    // The chevron used to be a third anchor to the same destination, which is
    // just an extra tab stop for keyboard users.
    render(<ExecutionTable executions={[makeExecution()]} />);

    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('drops the workflow column when the table is already scoped to one', () => {
    render(<ExecutionTable executions={[makeExecution()]} hideWorkflow />);

    expect(screen.queryByRole('columnheader', { name: 'Workflow' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Task' })).toBeInTheDocument();
  });

  it('shows the status of a failed run', () => {
    render(<ExecutionTable executions={[makeExecution({ status: 'failed' })]} />);

    expect(screen.getByText('Failed')).toBeInTheDocument();
  });
});
