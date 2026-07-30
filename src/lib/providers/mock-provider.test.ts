import { describe, expect, it } from 'vitest';
import { MockProvider } from './mock-provider';
import { ProviderError } from '@/types/provider';
import type { CompletionContext, LLMCompletionRequest } from '@/types/provider';

function context(overrides: Partial<CompletionContext> = {}): CompletionContext {
  return {
    agentType: overrides.agentType ?? 'planner',
    agentName: overrides.agentName ?? 'Planner',
    nodeId: overrides.nodeId ?? 'node_1',
    nodeLabel: overrides.nodeLabel ?? 'Planner',
    task: overrides.task ?? 'Review a licensing agreement for risk.',
    upstream: overrides.upstream ?? [],
    attempt: overrides.attempt ?? 1,
  };
}

function request(overrides: Partial<LLMCompletionRequest> = {}): LLMCompletionRequest {
  return {
    systemPrompt: overrides.systemPrompt ?? 'You are a Planner agent.',
    userPrompt: overrides.userPrompt ?? '# Task\nReview a licensing agreement.',
    temperature: overrides.temperature ?? 0.3,
    maxTokens: overrides.maxTokens ?? 2_000,
    ...(overrides.model ? { model: overrides.model } : {}),
    context: overrides.context ?? context(),
    ...(overrides.signal ? { signal: overrides.signal } : {}),
  };
}

/** Instant and never randomly failing, so these tests assert behaviour not luck. */
const provider = () => new MockProvider({ latencyFactor: 0, failureRate: 0 });

describe('availability', () => {
  it('is always available — that is the entire point', () => {
    expect(provider().isAvailable()).toBe(true);
  });

  it('identifies itself as the mock provider', () => {
    const p = provider();
    expect(p.id).toBe('mock');
    expect(p.defaultModel).toBe('mock-sim-1');
  });
});

describe('determinism', () => {
  it('returns identical output for an identical request', async () => {
    const [a, b] = await Promise.all([
      provider().complete(request()),
      provider().complete(request()),
    ]);

    expect(a.content).toBe(b.content);
    expect(a.confidence).toBe(b.confidence);
    expect(a.usage.totalTokens).toBe(b.usage.totalTokens);
  });

  it('varies output when the task changes', async () => {
    const a = await provider().complete(request({ context: context({ task: 'Task one' }) }));
    const b = await provider().complete(request({ context: context({ task: 'Task two' }) }));

    expect(a.content).not.toBe(b.content);
  });

  it('varies output between retry attempts', async () => {
    // A retry that reproduced the identical draw would fail forever.
    const first = await provider().complete(request({ context: context({ attempt: 1 }) }));
    const second = await provider().complete(request({ context: context({ attempt: 2 }) }));

    expect(first.content).not.toBe(second.content);
  });

  it('varies output between agent types', async () => {
    const planner = await provider().complete(
      request({ context: context({ agentType: 'planner' }) }),
    );
    const coder = await provider().complete(
      request({ context: context({ agentType: 'coder', agentName: 'Coder' }) }),
    );

    expect(planner.content).not.toBe(coder.content);
  });
});

describe('response shape', () => {
  it('returns content, usage, cost and confidence', async () => {
    const response = await provider().complete(request());

    expect(response.content.length).toBeGreaterThan(0);
    expect(response.usage.totalTokens).toBeGreaterThan(0);
    expect(response.usage.totalTokens).toBe(
      response.usage.promptTokens + response.usage.completionTokens,
    );
    expect(response.costUsd).toBeGreaterThan(0);
    expect(response.provider).toBe('mock');
  });

  it('keeps confidence inside a plausible band', async () => {
    const response = await provider().complete(request());

    expect(response.confidence).toBeGreaterThanOrEqual(0.35);
    expect(response.confidence).toBeLessThanOrEqual(0.99);
  });

  it('produces agent-shaped output rather than lorem ipsum', async () => {
    const response = await provider().complete(
      request({ context: context({ agentType: 'planner', agentName: 'Planner' }) }),
    );

    // A planner should read like a plan.
    expect(response.content.length).toBeGreaterThan(200);
    expect(response.content).toMatch(/[#\-*\d]/);
  });

  it('honours the model override', async () => {
    const response = await provider().complete(request({ model: 'custom-model' }));

    expect(response.model).toBe('custom-model');
  });

  it('reports finish reason stop when within budget', async () => {
    const response = await provider().complete(request({ maxTokens: 8_000 }));

    expect(response.finishReason).toBe('stop');
  });
});

describe('maxTokens', () => {
  it('truncates and reports length when the response exceeds the budget', async () => {
    const response = await provider().complete(request({ maxTokens: 40 }));

    expect(response.finishReason).toBe('length');
    expect(response.content).toContain('truncated');
  });

  it('produces a shorter response under a tighter budget', async () => {
    const tight = await provider().complete(request({ maxTokens: 60 }));
    const loose = await provider().complete(request({ maxTokens: 8_000 }));

    expect(tight.usage.completionTokens).toBeLessThan(loose.usage.completionTokens);
  });
});

describe('failure simulation', () => {
  it('throws a retryable ProviderError when the failure rate is 1', async () => {
    const failing = new MockProvider({ latencyFactor: 0, failureRate: 1 });

    await expect(failing.complete(request())).rejects.toBeInstanceOf(ProviderError);

    const error = (await failing.complete(request()).catch((e: unknown) => e)) as ProviderError;
    // Simulated 503s must be retryable, or the engine's retry path is never exercised.
    expect(error.retryable).toBe(true);
    expect(error.provider).toBe('mock');
  });

  it('never fails when the failure rate is 0', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        provider().complete(request({ context: context({ nodeId: `n${i}` }) })),
      ),
    );

    expect(results).toHaveLength(25);
  });
});

describe('cancellation', () => {
  it('rejects with a non-retryable error when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const error = (await provider()
      .complete(request({ signal: controller.signal }))
      .catch((e: unknown) => e)) as ProviderError;

    expect(error).toBeInstanceOf(ProviderError);
    // Retrying a cancelled request would defeat the cancellation.
    expect(error.retryable).toBe(false);
  });
});

describe('estimateCost', () => {
  it('prices usage against the mock model', () => {
    const cost = provider().estimateCost({
      promptTokens: 1_000_000,
      completionTokens: 0,
      totalTokens: 1_000_000,
    });

    expect(cost).toBeCloseTo(0.2, 6);
  });
});

describe('latency simulation', () => {
  it('reports zero latency when the factor is zeroed for tests', async () => {
    const response = await provider().complete(request());
    expect(response.latencyMs).toBe(0);
  });

  it('reports non-zero latency at the default factor', async () => {
    const realistic = new MockProvider({ latencyFactor: 1, failureRate: 0 });
    const response = await realistic.complete(request({ maxTokens: 50 }));

    expect(response.latencyMs).toBeGreaterThan(0);
  });
});
