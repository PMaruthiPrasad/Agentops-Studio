import { describe, expect, it, vi } from 'vitest';
import {
  executeWorkflow,
  type EngineDependencies,
  type EngineRunResult,
  type ExecuteWorkflowOptions,
} from './executor';
import { WorkflowValidationError } from './validate';
import { TimeoutError } from './concurrency';
import { ProviderError } from '@/types/provider';
import type { ExecutionEvent } from '@/types/execution';
import type { WorkflowGraph, WorkflowNode } from '@/types/workflow';
import {
  agentConfig,
  createTestClock,
  edge,
  fanOutGraph,
  graph,
  node,
  serialGraph,
  StubAgent,
  type StubBehavior,
} from '@/test/fixtures';

/**
 * Engine harness.
 *
 * Every dependency the engine takes is injected, so these tests run with a
 * frozen clock, no real sleeping, and stub agents — they assert orchestration
 * (layering, activation, retries, status) rather than model behaviour.
 */
function harness(behaviors: Record<string, StubBehavior> = {}) {
  const clock = createTestClock();
  const events: ExecutionEvent[] = [];
  const waits: number[] = [];
  let ids = 0;

  const deps: EngineDependencies = {
    buildAgent: (n: WorkflowNode) =>
      new StubAgent(agentConfig(n.type), behaviors[n.id] ?? {}, clock.advance),
    now: () => clock.now(),
    emit: (event) => events.push(event),
    wait: async (ms) => {
      waits.push(ms);
      // Retry backoff is simulated, not slept — keeps the suite fast.
      clock.advance(ms);
    },
    nextId: () => `step_${(ids += 1)}`,
  };

  return { deps, events, waits, clock };
}

function run(
  g: WorkflowGraph,
  deps: EngineDependencies,
  overrides: Partial<ExecuteWorkflowOptions> = {},
) {
  return executeWorkflow(
    {
      executionId: 'exec_1',
      workflowId: 'wf_1',
      workflowName: 'Test workflow',
      task: 'Do the thing',
      graph: g,
      ...overrides,
    },
    deps,
  );
}

const eventTypes = (events: ExecutionEvent[]) => events.map((e) => e.type);
const stepFor = (result: EngineRunResult, nodeId: string) =>
  result.steps.find((s) => s.nodeId === nodeId);

describe('happy path', () => {
  it('runs every node and reports success', async () => {
    const { deps } = harness();
    const result = await run(serialGraph('a', 'b', 'c'), deps);

    expect(result.status).toBe('success');
    expect(result.steps).toHaveLength(3);
    expect(result.steps.every((s) => s.status === 'success')).toBe(true);
    expect(result.error).toBeNull();
  });

  it('assigns each step its topological layer', async () => {
    const { deps } = harness();
    const result = await run(serialGraph('a', 'b', 'c'), deps);

    expect(stepFor(result, 'a')?.layer).toBe(0);
    expect(stepFor(result, 'b')?.layer).toBe(1);
    expect(stepFor(result, 'c')?.layer).toBe(2);
  });

  it('records the prompts and usage the agent returned', async () => {
    const { deps } = harness({ a: { output: 'the answer', totalTokens: 400, costUsd: 0.02 } });
    const result = await run(graph([node('a')]), deps);

    const step = stepFor(result, 'a')!;
    expect(step.response).toBe('the answer');
    expect(step.prompt).toContain('Do the thing');
    expect(step.usage.totalTokens).toBe(400);
    expect(step.costUsd).toBe(0.02);
  });

  it('emits the full event sequence in order', async () => {
    const { deps, events } = harness();
    await run(serialGraph('a', 'b'), deps);

    expect(eventTypes(events)).toEqual([
      'run.start',
      'step.start',
      'step.finish',
      'step.start',
      'step.finish',
      'run.finish',
    ]);
  });

  it('announces the layer plan up front so the UI can render the graph', async () => {
    const { deps, events } = harness();
    await run(fanOutGraph(2), deps);

    const start = events[0];
    expect(start?.type).toBe('run.start');
    if (start?.type === 'run.start') {
      expect(start.layers).toEqual([['root'], ['leaf1', 'leaf2']]);
    }
  });
});

describe('data flow', () => {
  it('passes an upstream node output to its dependant', async () => {
    const seen: string[] = [];
    const { deps } = harness({
      a: { output: 'result of A' },
      b: { onExecute: (input) => seen.push(...input.upstream.map((u) => u.output)) },
    });

    await run(serialGraph('a', 'b'), deps);

    expect(seen).toEqual(['result of A']);
  });

  it('gives a join node the output of every satisfied predecessor', async () => {
    let count = 0;
    const { deps } = harness({
      c: { onExecute: (input) => (count = input.upstream.length) },
    });

    await run(
      graph([node('a'), node('b'), node('c')], [edge('a', 'c'), edge('b', 'c')]),
      deps,
    );

    expect(count).toBe(2);
  });

  it('gives an entry node no upstream context', async () => {
    let count = -1;
    const { deps } = harness({ a: { onExecute: (input) => (count = input.upstream.length) } });

    await run(graph([node('a')]), deps);

    expect(count).toBe(0);
  });
});

describe('parallelism', () => {
  it('dispatches a whole layer concurrently', async () => {
    let active = 0;
    let peak = 0;

    const clock = createTestClock();
    const behavior: StubBehavior = {
      onExecute: () => {
        active += 1;
        peak = Math.max(peak, active);
        queueMicrotask(() => {
          active -= 1;
        });
      },
    };

    const deps: EngineDependencies = {
      buildAgent: (n) => new StubAgent(agentConfig(n.type), behavior, clock.advance),
      now: () => clock.now(),
      emit: () => {},
      wait: async () => {},
      nextId: (() => {
        let i = 0;
        return () => `s${(i += 1)}`;
      })(),
    };

    await run(fanOutGraph(4), deps, { maxConcurrency: 4 });

    expect(peak).toBeGreaterThan(1);
  });

  it('honours the concurrency ceiling', async () => {
    let active = 0;
    let peak = 0;
    const clock = createTestClock();

    const deps: EngineDependencies = {
      buildAgent: (n) =>
        new StubAgent(
          agentConfig(n.type),
          {
            onExecute: () => {
              active += 1;
              peak = Math.max(peak, active);
              queueMicrotask(() => {
                active -= 1;
              });
            },
          },
          clock.advance,
        ),
      now: () => clock.now(),
      emit: () => {},
      wait: async () => {},
      nextId: (() => {
        let i = 0;
        return () => `s${(i += 1)}`;
      })(),
    };

    await run(fanOutGraph(8), deps, { maxConcurrency: 2 });

    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('branch conditions', () => {
  const conditional = () =>
    graph(
      [node('gate'), node('taken'), node('pruned')],
      [
        edge('gate', 'taken', {
          kind: 'expression',
          field: 'confidence',
          operator: 'gte',
          value: 0.5,
        }),
        edge('gate', 'pruned', {
          kind: 'expression',
          field: 'confidence',
          operator: 'gte',
          value: 0.99,
        }),
      ],
    );

  it('runs the branch whose condition passes and skips the other', async () => {
    const { deps } = harness({ gate: { confidence: 0.8 } });
    const result = await run(conditional(), deps);

    expect(stepFor(result, 'taken')?.status).toBe('success');
    expect(stepFor(result, 'pruned')?.status).toBe('skipped');
  });

  it('records why the branch was pruned', async () => {
    const { deps } = harness({ gate: { confidence: 0.8 } });
    const result = await run(conditional(), deps);

    const skipped = stepFor(result, 'pruned')!;
    expect(skipped.skipReason).toContain('condition not met');
    expect(skipped.skipReason).toContain('0.800');
  });

  it('emits a skip event so the canvas prunes immediately', async () => {
    const { deps, events } = harness({ gate: { confidence: 0.8 } });
    await run(conditional(), deps);

    const skip = events.find((e) => e.type === 'step.skip');
    expect(skip).toBeDefined();
    if (skip?.type === 'step.skip') expect(skip.nodeId).toBe('pruned');
  });

  it('prunes the whole subtree below an unsatisfied branch', async () => {
    const g = graph(
      [node('gate'), node('mid'), node('leaf')],
      [
        edge('gate', 'mid', {
          kind: 'expression',
          field: 'confidence',
          operator: 'gte',
          value: 0.99,
        }),
        edge('mid', 'leaf'),
      ],
    );

    const { deps } = harness({ gate: { confidence: 0.2 } });
    const result = await run(g, deps);

    expect(stepFor(result, 'mid')?.status).toBe('skipped');
    expect(stepFor(result, 'leaf')?.status).toBe('skipped');
    expect(stepFor(result, 'leaf')?.skipReason).toBeTruthy();
  });

  it('activates a join on an OR basis — one satisfied edge is enough', async () => {
    const g = graph(
      [node('a'), node('b'), node('join')],
      [
        edge('a', 'join', {
          kind: 'expression',
          field: 'confidence',
          operator: 'gte',
          value: 0.99,
        }),
        edge('b', 'join'),
      ],
    );

    const { deps } = harness({ a: { confidence: 0.1 }, b: { confidence: 0.9 } });
    const result = await run(g, deps);

    expect(stepFor(result, 'join')?.status).toBe('success');
  });

  it('does not hand a join output from a branch that was not taken', async () => {
    let upstreamIds: string[] = [];
    const g = graph(
      [node('a'), node('b'), node('join')],
      [
        edge('a', 'join', {
          kind: 'expression',
          field: 'confidence',
          operator: 'gte',
          value: 0.99,
        }),
        edge('b', 'join'),
      ],
    );

    const { deps } = harness({
      a: { confidence: 0.1 },
      b: { confidence: 0.9 },
      join: { onExecute: (input) => (upstreamIds = input.upstream.map((u) => u.nodeId)) },
    });

    await run(g, deps);

    expect(upstreamIds).toEqual(['b']);
  });
});

describe('retries', () => {
  it('retries a retryable failure and succeeds on a later attempt', async () => {
    const { deps, waits } = harness({
      a: { fail: (attempt) => (attempt < 3 ? new ProviderError('flaky', 'mock', true) : null) },
    });

    const result = await run(graph([node('a')]), deps, { maxAttempts: 3 });
    const step = stepFor(result, 'a')!;

    expect(step.status).toBe('success');
    expect(step.attempts).toBe(3);
    expect(step.retries).toBe(2);
    expect(waits).toHaveLength(2);
  });

  it('emits a retry event carrying the error and the backoff', async () => {
    const { deps, events } = harness({
      a: { fail: (attempt) => (attempt < 2 ? new ProviderError('rate limited', 'mock', true) : null) },
    });

    await run(graph([node('a')]), deps, { maxAttempts: 3 });

    const retry = events.find((e) => e.type === 'step.retry');
    expect(retry).toBeDefined();
    if (retry?.type === 'step.retry') {
      expect(retry.error).toContain('rate limited');
      expect(retry.backoffMs).toBeGreaterThan(0);
    }
  });

  it('does not retry a non-retryable failure', async () => {
    const { deps, waits } = harness({
      a: { fail: () => new ProviderError('bad api key', 'anthropic', false) },
    });

    const result = await run(graph([node('a')]), deps, { maxAttempts: 5 });

    // Retrying a credentials problem only burns time and money.
    expect(stepFor(result, 'a')?.attempts).toBe(1);
    expect(waits).toHaveLength(0);
  });

  it('gives up after the attempt limit and records the failure', async () => {
    const { deps } = harness({ a: { fail: () => new ProviderError('always down', 'mock', true) } });

    const result = await run(graph([node('a')]), deps, { maxAttempts: 2 });
    const step = stepFor(result, 'a')!;

    expect(step.status).toBe('failed');
    expect(step.attempts).toBe(2);
    expect(step.error).toContain('always down');
  });

  it('lets a node cap retries below the run-wide default', async () => {
    const capped = node('a', 'custom', { config: { maxAttempts: 1 } });
    const { deps } = harness({ a: { fail: () => new ProviderError('down', 'mock', true) } });

    const result = await run(graph([capped]), deps, { maxAttempts: 5 });

    expect(stepFor(result, 'a')?.attempts).toBe(1);
  });

  it('never retries a deliberate abort', async () => {
    // AbortController throws a DOMException, which does not subclass Error in
    // every runtime — retrying it would defeat the cancellation.
    const { deps, waits } = harness({
      a: { fail: () => new DOMException('Aborted', 'AbortError') },
    });

    const result = await run(graph([node('a')]), deps, { maxAttempts: 5 });

    expect(stepFor(result, 'a')?.attempts).toBe(1);
    expect(waits).toHaveLength(0);
  });

  it('treats a timeout as retryable', async () => {
    const { deps } = harness({
      a: { fail: (attempt) => (attempt < 2 ? new TimeoutError(50) : null) },
    });

    const result = await run(graph([node('a')]), deps, { maxAttempts: 3 });

    expect(stepFor(result, 'a')?.status).toBe('success');
    expect(stepFor(result, 'a')?.retries).toBe(1);
  });
});

describe('failure isolation', () => {
  it('keeps running the rest of the layer when one node fails', async () => {
    const { deps } = harness({
      leaf1: { fail: () => new ProviderError('boom', 'mock', false) },
    });

    const result = await run(fanOutGraph(3), deps);

    expect(stepFor(result, 'leaf1')?.status).toBe('failed');
    expect(stepFor(result, 'leaf2')?.status).toBe('success');
    expect(stepFor(result, 'leaf3')?.status).toBe('success');
  });

  it('reports partial when some nodes succeeded and some failed', async () => {
    const { deps } = harness({ leaf1: { fail: () => new ProviderError('boom', 'mock', false) } });
    const result = await run(fanOutGraph(2), deps);

    expect(result.status).toBe('partial');
    expect(result.error).toContain('boom');
  });

  it('reports failed when nothing succeeded', async () => {
    const { deps } = harness({ a: { fail: () => new ProviderError('boom', 'mock', false) } });
    const result = await run(graph([node('a')]), deps);

    expect(result.status).toBe('failed');
  });

  it('names the failing node in the run error, and counts the rest', async () => {
    const { deps } = harness({
      leaf1: { fail: () => new ProviderError('first', 'mock', false) },
      leaf2: { fail: () => new ProviderError('second', 'mock', false) },
    });

    const result = await run(fanOutGraph(2), deps);

    expect(result.error).toMatch(/leaf[12] failed/);
    expect(result.error).toContain('+1 more');
  });

  it('skips a dependant when its only upstream failed', async () => {
    const { deps } = harness({ a: { fail: () => new ProviderError('boom', 'mock', false) } });
    const result = await run(serialGraph('a', 'b'), deps);

    expect(stepFor(result, 'b')?.status).toBe('skipped');
    expect(stepFor(result, 'b')?.skipReason).toContain('failed');
  });
});

describe('cancellation', () => {
  it('stops dispatching layers once the signal aborts', async () => {
    const controller = new AbortController();
    const { deps } = harness({
      a: { onExecute: () => controller.abort() },
    });

    const result = await run(serialGraph('a', 'b', 'c'), deps, { signal: controller.signal });

    expect(result.status).toBe('cancelled');
    expect(stepFor(result, 'a')?.status).toBe('success');
    expect(stepFor(result, 'c')?.status).toBe('skipped');
  });

  it('marks unreached nodes with a cancellation reason', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await run(serialGraph('a', 'b'), harness().deps, {
      signal: controller.signal,
    });

    expect(result.status).toBe('cancelled');
    expect(stepFor(result, 'a')?.skipReason).toContain('cancelled');
  });

  it('reports a cancellation in the run error', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await run(graph([node('a')]), harness().deps, { signal: controller.signal });

    expect(result.error).toBe('Run cancelled');
  });
});

describe('validation', () => {
  it('refuses to execute a cyclic graph', async () => {
    const cyclic = graph([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]);

    await expect(run(cyclic, harness().deps)).rejects.toBeInstanceOf(WorkflowValidationError);
  });

  it('refuses to execute an empty graph', async () => {
    await expect(run(graph([]), harness().deps)).rejects.toBeInstanceOf(WorkflowValidationError);
  });

  it('refuses a graph with a dangling edge', async () => {
    const broken = graph([node('a')], [edge('a', 'ghost')]);

    await expect(run(broken, harness().deps)).rejects.toBeInstanceOf(WorkflowValidationError);
  });
});

describe('result shape', () => {
  it('covers every node in the graph exactly once', async () => {
    const { deps } = harness({ gate: { confidence: 0.1 } });
    const g = graph(
      [node('gate'), node('a'), node('b')],
      [
        edge('gate', 'a', {
          kind: 'expression',
          field: 'confidence',
          operator: 'gte',
          value: 0.9,
        }),
        edge('a', 'b'),
      ],
    );

    const result = await run(g, deps);

    expect(result.steps).toHaveLength(3);
    expect(new Set(result.steps.map((s) => s.nodeId)).size).toBe(3);
  });

  it('orders steps by layer so the timeline reads correctly', async () => {
    const { deps } = harness();
    const result = await run(serialGraph('a', 'b', 'c'), deps);

    const layers = result.steps.map((s) => s.layer);
    expect(layers).toEqual([...layers].sort((x, y) => x - y));
  });

  it('computes metrics consistent with the steps', async () => {
    const { deps } = harness({
      root: { totalTokens: 100, costUsd: 0.001 },
      leaf1: { totalTokens: 200, costUsd: 0.002 },
      leaf2: { totalTokens: 300, costUsd: 0.003 },
    });

    const result = await run(fanOutGraph(2), deps);

    expect(result.metrics.totalTokens).toBe(600);
    expect(result.metrics.totalCostUsd).toBeCloseTo(0.006, 6);
    expect(result.metrics.nodeCount).toBe(3);
    expect(result.metrics.layerCount).toBe(2);
  });

  it('returns ISO timestamps and the layer plan', async () => {
    const { deps } = harness();
    const result = await run(serialGraph('a', 'b'), deps);

    expect(() => new Date(result.startedAt).toISOString()).not.toThrow();
    expect(result.layers).toEqual([['a'], ['b']]);
    expect(result.executionId).toBe('exec_1');
  });

  it('measures duration from the injected clock', async () => {
    const { deps } = harness({ a: { advanceClockMs: 250 } });
    const result = await run(graph([node('a')]), deps);

    expect(stepFor(result, 'a')?.durationMs).toBe(250);
    expect(result.metrics.totalDurationMs).toBe(250);
  });

  it('emits run.finish carrying the final status and metrics', async () => {
    const { deps, events } = harness();
    await run(serialGraph('a', 'b'), deps);

    const finish = events.at(-1);
    expect(finish?.type).toBe('run.finish');
    if (finish?.type === 'run.finish') {
      expect(finish.status).toBe('success');
      expect(finish.metrics.nodeCount).toBe(2);
    }
  });
});

describe('agent construction', () => {
  it('builds one agent per executed node', async () => {
    const buildAgent = vi.fn((n: WorkflowNode) => new StubAgent(agentConfig(n.type), {}));
    const { deps } = harness();

    await run(serialGraph('a', 'b', 'c'), { ...deps, buildAgent });

    expect(buildAgent).toHaveBeenCalledTimes(3);
  });

  it('does not build an agent for a skipped node', async () => {
    const buildAgent = vi.fn((n: WorkflowNode) =>
      new StubAgent(agentConfig(n.type), n.id === 'gate' ? { confidence: 0.1 } : {}),
    );
    const { deps } = harness();

    const g = graph(
      [node('gate'), node('pruned')],
      [
        edge('gate', 'pruned', {
          kind: 'expression',
          field: 'confidence',
          operator: 'gte',
          value: 0.9,
        }),
      ],
    );

    await run(g, { ...deps, buildAgent });

    expect(buildAgent).toHaveBeenCalledTimes(1);
  });
});
