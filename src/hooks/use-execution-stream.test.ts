import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExecutionStream } from './use-execution-stream';
import type { ExecutionEvent, ExecutionStep } from '@/types/execution';

/**
 * Minimal EventSource stand-in.
 *
 * jsdom has no EventSource, and the hook's whole job is turning *named* SSE
 * events into node state — so the fake has to dispatch by event name, exactly
 * as the server does.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CLOSED = 2;

  readyState = 1;
  onerror: (() => void) | null = null;
  closed = false;

  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    const bucket = this.listeners.get(type) ?? new Set();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  /** Dispatch a server event onto this connection. */
  emit(event: ExecutionEvent) {
    const bucket = this.listeners.get(event.type);
    if (!bucket) return;
    for (const listener of bucket) {
      listener({ data: JSON.stringify(event) } as MessageEvent<string>);
    }
  }

  emitNamed(type: string, data: unknown) {
    const bucket = this.listeners.get(type);
    if (!bucket) return;
    for (const listener of bucket) {
      listener({ data: JSON.stringify(data) } as MessageEvent<string>);
    }
  }
}

function makeStep(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: 'step_1',
    executionId: 'exec_1',
    nodeId: 'a',
    agentType: 'planner',
    label: 'Planner',
    status: 'success',
    layer: 0,
    attempts: 1,
    retries: 0,
    startedAt: null,
    completedAt: null,
    durationMs: 1_200,
    systemPrompt: '',
    prompt: '',
    response: '',
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    costUsd: 0.002,
    confidence: 0.9,
    provider: 'mock',
    model: 'mock-1',
    error: null,
    skipReason: null,
    ...overrides,
  };
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function latest(): FakeEventSource {
  const source = FakeEventSource.instances.at(-1);
  if (!source) throw new Error('no EventSource was opened');
  return source;
}

describe('useExecutionStream', () => {
  it('stays idle without an execution id', () => {
    const { result } = renderHook(() => useExecutionStream(null));

    expect(result.current.phase).toBe('idle');
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('subscribes to the stream for the given execution', () => {
    renderHook(() => useExecutionStream('exec_1'));

    expect(latest().url).toBe('/api/executions/exec_1/stream');
  });

  it('seeds every node as pending from the run.start layers', () => {
    const { result } = renderHook(() => useExecutionStream('exec_1'));

    act(() => {
      latest().emit({
        type: 'run.start',
        executionId: 'exec_1',
        workflowId: 'wf_1',
        task: 'test',
        layers: [['a'], ['b', 'c']],
      });
    });

    expect(result.current.phase).toBe('running');
    expect(Object.keys(result.current.nodes)).toEqual(['a', 'b', 'c']);
    expect(result.current.nodes.a?.status).toBe('pending');
    expect(result.current.progress).toBe(0);
  });

  it('tracks a node through running to finished, with metrics', () => {
    const { result } = renderHook(() => useExecutionStream('exec_1'));

    act(() => {
      latest().emit({
        type: 'run.start',
        executionId: 'exec_1',
        workflowId: 'wf_1',
        task: 'test',
        layers: [['a'], ['b']],
      });
    });

    act(() => {
      latest().emit({ type: 'step.start', executionId: 'exec_1', nodeId: 'a', layer: 0, attempt: 1 });
    });
    expect(result.current.nodes.a?.status).toBe('running');

    act(() => {
      latest().emit({
        type: 'step.finish',
        executionId: 'exec_1',
        nodeId: 'a',
        step: makeStep(),
      });
    });

    const node = result.current.nodes.a;
    expect(node?.status).toBe('success');
    expect(node?.durationMs).toBe(1_200);
    expect(node?.totalTokens).toBe(150);
    // One of two nodes is terminal.
    expect(result.current.progress).toBe(0.5);
  });

  it('counts a skipped node as complete', () => {
    const { result } = renderHook(() => useExecutionStream('exec_1'));

    act(() => {
      latest().emit({
        type: 'run.start',
        executionId: 'exec_1',
        workflowId: 'wf_1',
        task: 'test',
        layers: [['a']],
      });
    });

    act(() => {
      latest().emit({
        type: 'step.skip',
        executionId: 'exec_1',
        nodeId: 'a',
        reason: 'confidence too low',
      });
    });

    expect(result.current.nodes.a?.status).toBe('skipped');
    expect(result.current.progress).toBe(1);
  });

  it('records a retry attempt without losing the running state', () => {
    const { result } = renderHook(() => useExecutionStream('exec_1'));

    act(() => {
      latest().emit({
        type: 'step.retry',
        executionId: 'exec_1',
        nodeId: 'a',
        attempt: 2,
        error: 'provider timeout',
        backoffMs: 500,
      });
    });

    expect(result.current.nodes.a?.status).toBe('running');
    expect(result.current.nodes.a?.attempt).toBe(2);
    expect(result.current.nodes.a?.error).toBe('provider timeout');
  });

  it('reports the terminal status and closes the connection', () => {
    const onFinish = vi.fn();
    const { result } = renderHook(() => useExecutionStream('exec_1', { onFinish }));

    act(() => {
      latest().emit({
        type: 'run.finish',
        executionId: 'exec_1',
        status: 'partial',
        error: null,
        metrics: {
          totalDurationMs: 4_000,
          totalAgentTimeMs: 6_000,
          totalTokens: 900,
          promptTokens: 600,
          completionTokens: 300,
          totalCostUsd: 0.01,
          successRate: 0.5,
          averageConfidence: 0.7,
          averageLatencyMs: 2_000,
          nodeCount: 2,
          edgeCount: 1,
          layerCount: 2,
          executedCount: 2,
          failedCount: 1,
          skippedCount: 0,
          retryCount: 1,
          parallelizationScore: 0.33,
          complexityScore: 0.2,
        },
      });
    });

    expect(result.current.phase).toBe('finished');
    expect(result.current.status).toBe('partial');
    expect(result.current.metrics?.totalDurationMs).toBe(4_000);
    expect(onFinish).toHaveBeenCalledWith('partial');
    expect(latest().closed).toBe(true);
  });

  it('treats run.closed as a completed run rather than an error', () => {
    const { result } = renderHook(() => useExecutionStream('exec_1'));

    // The server sends this when the run finished before anyone subscribed.
    act(() => {
      latest().emitNamed('run.closed', { executionId: 'exec_1' });
    });

    expect(result.current.phase).toBe('finished');
    expect(result.current.error).toBeNull();
  });

  it('surfaces a dropped connection only when no terminal event arrived', () => {
    const { result } = renderHook(() => useExecutionStream('exec_1'));

    act(() => {
      const source = latest();
      source.readyState = FakeEventSource.CLOSED;
      source.onerror?.();
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.error).toMatch(/Lost connection/);
  });

  it('closes the connection on unmount', () => {
    const { unmount } = renderHook(() => useExecutionStream('exec_1'));
    const source = latest();

    unmount();

    expect(source.closed).toBe(true);
  });
});
