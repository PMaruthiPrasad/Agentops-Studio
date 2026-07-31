import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { StepCard } from './step-card';
import type { ExecutionStep } from '@/types/execution';

function makeStep(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: 'step_1',
    executionId: 'exec_1',
    nodeId: 'node_a',
    agentType: 'reviewer',
    label: 'Contract reviewer',
    status: 'success',
    layer: 2,
    attempts: 1,
    retries: 0,
    startedAt: '2026-07-30T10:00:00.000Z',
    completedAt: '2026-07-30T10:00:02.000Z',
    durationMs: 2_000,
    systemPrompt: 'You are a Reviewer agent.',
    prompt: 'Review the indemnity clause.',
    response: 'Blocking: clause 7.2 is uncapped.',
    usage: { promptTokens: 400, completionTokens: 120, totalTokens: 520 },
    costUsd: 0.0035,
    confidence: 0.82,
    provider: 'mock',
    model: 'mock-1',
    error: null,
    skipReason: null,
    ...overrides,
  };
}

describe('StepCard', () => {
  it('summarises the step without expanding it', () => {
    render(<StepCard step={makeStep()} />);

    expect(screen.getByText('Contract reviewer')).toBeInTheDocument();
    expect(screen.getByText(/2\.00s/)).toBeInTheDocument();
    expect(screen.getByText(/82%/)).toBeInTheDocument();
    // The prompt bodies stay collapsed until asked for.
    expect(screen.queryByText('You are a Reviewer agent.')).not.toBeInTheDocument();
  });

  it('reveals the exact prompts and response when expanded', async () => {
    const user = userEvent.setup();
    render(<StepCard step={makeStep()} />);

    await user.click(screen.getByRole('button', { name: /Contract reviewer/ }));

    expect(screen.getByText('You are a Reviewer agent.')).toBeInTheDocument();
    expect(screen.getByText('Review the indemnity clause.')).toBeInTheDocument();
    expect(screen.getByText('Blocking: clause 7.2 is uncapped.')).toBeInTheDocument();
  });

  it('opens straight to the error for a failed step', () => {
    render(<StepCard step={makeStep({ status: 'failed', error: 'Provider timed out' })} defaultOpen />);

    expect(screen.getByText(/Provider timed out/)).toBeInTheDocument();
  });

  it('explains why a step was skipped', () => {
    render(
      <StepCard
        step={makeStep({ status: 'skipped', skipReason: 'confidence < 0.7 on upstream node' })}
        defaultOpen
      />,
    );

    expect(screen.getByText(/confidence < 0\.7 on upstream node/)).toBeInTheDocument();
  });

  it('surfaces retries in the header', () => {
    render(<StepCard step={makeStep({ retries: 2, attempts: 3 })} />);

    expect(screen.getByText('2 retries')).toBeInTheDocument();
  });
});
