import { describe, expect, it, vi } from 'vitest';
import { executionBus, toSseFrame } from './execution-bus';
import type { ExecutionEvent } from '@/types/execution';
import { step } from '@/test/fixtures';

/**
 * The pub/sub layer between the engine and an SSE connection.
 *
 * The behaviour that matters is *replay*: a browser subscribes a few
 * milliseconds after `POST /api/executions` returns, so a bus that only
 * forwarded live events would drop the opening of every run.
 */

let counter = 0;
const freshId = () => `exec_test_${(counter += 1)}_${Math.random().toString(36).slice(2)}`;

const runStart = (executionId: string): ExecutionEvent => ({
  type: 'run.start',
  executionId,
  workflowId: 'wf_1',
  task: 'do the thing',
  layers: [['a'], ['b']],
});

const runFinish = (executionId: string): ExecutionEvent => ({
  type: 'run.finish',
  executionId,
  status: 'success',
  error: null,
  metrics: {
    totalDurationMs: 1_000,
    totalAgentTimeMs: 1_200,
    totalTokens: 100,
    promptTokens: 60,
    completionTokens: 40,
    totalCostUsd: 0.001,
    successRate: 1,
    averageConfidence: 0.9,
    averageLatencyMs: 600,
    nodeCount: 2,
    edgeCount: 1,
    layerCount: 2,
    executedCount: 2,
    failedCount: 0,
    skippedCount: 0,
    retryCount: 0,
    parallelizationScore: 0,
    complexityScore: 0.2,
  },
});

describe('live delivery', () => {
  it('delivers events to a subscriber', () => {
    const id = freshId();
    const listener = vi.fn();

    executionBus.subscribe(id, listener);
    executionBus.publish(runStart(id));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0]).toMatchObject({ type: 'run.start' });
  });

  it('fans out to every subscriber', () => {
    const id = freshId();
    const a = vi.fn();
    const b = vi.fn();

    executionBus.subscribe(id, a);
    executionBus.subscribe(id, b);
    executionBus.publish(runStart(id));

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('keeps runs isolated from each other', () => {
    const mine = freshId();
    const theirs = freshId();
    const listener = vi.fn();

    executionBus.subscribe(mine, listener);
    executionBus.publish(runStart(theirs));

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', () => {
    const id = freshId();
    const listener = vi.fn();

    const unsubscribe = executionBus.subscribe(id, listener);
    unsubscribe();
    executionBus.publish(runStart(id));

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('replay', () => {
  it('replays buffered events to a late subscriber', () => {
    // This is the real-world case: the client subscribes after the run started.
    const id = freshId();
    executionBus.publish(runStart(id));
    executionBus.publish({ type: 'step.start', executionId: id, nodeId: 'a', layer: 0, attempt: 1 });

    const listener = vi.fn();
    executionBus.subscribe(id, listener);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0]![0]).toMatchObject({ type: 'run.start' });
    expect(listener.mock.calls[1]![0]).toMatchObject({ type: 'step.start' });
  });

  it('replays in publication order', () => {
    const id = freshId();
    const types = ['run.start', 'step.start', 'step.finish'] as const;

    executionBus.publish(runStart(id));
    executionBus.publish({ type: 'step.start', executionId: id, nodeId: 'a', layer: 0, attempt: 1 });
    executionBus.publish({ type: 'step.finish', executionId: id, nodeId: 'a', step: step() });

    const seen: string[] = [];
    executionBus.subscribe(id, (event) => seen.push(event.type));

    expect(seen).toEqual([...types]);
  });

  it('continues delivering live events after the replay', () => {
    const id = freshId();
    executionBus.publish(runStart(id));

    const listener = vi.fn();
    executionBus.subscribe(id, listener);
    executionBus.publish({ type: 'step.start', executionId: id, nodeId: 'a', layer: 0, attempt: 1 });

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('exposes the buffer for inspection', () => {
    const id = freshId();
    executionBus.publish(runStart(id));

    expect(executionBus.getBufferedEvents(id)).toHaveLength(1);
  });

  it('returns an empty buffer for an unknown run', () => {
    expect(executionBus.getBufferedEvents('never-existed')).toEqual([]);
  });

  it('hands back a copy so a caller cannot corrupt the buffer', () => {
    const id = freshId();
    executionBus.publish(runStart(id));

    executionBus.getBufferedEvents(id).push(runFinish(id));

    expect(executionBus.getBufferedEvents(id)).toHaveLength(1);
  });
});

describe('completion', () => {
  it('marks a run finished once it emits a terminal event', () => {
    const id = freshId();
    expect(executionBus.isFinished(id)).toBe(false);

    executionBus.publish(runStart(id));
    expect(executionBus.isFinished(id)).toBe(false);

    executionBus.publish(runFinish(id));
    expect(executionBus.isFinished(id)).toBe(true);
  });

  it('treats a run error as terminal too', () => {
    const id = freshId();
    executionBus.publish({ type: 'run.error', executionId: id, error: 'engine exploded' });

    expect(executionBus.isFinished(id)).toBe(true);
  });

  it('replays a completed run without leaving a listener attached', () => {
    // A finished run will never emit again; holding the listener would leak.
    const id = freshId();
    executionBus.publish(runStart(id));
    executionBus.publish(runFinish(id));

    const listener = vi.fn();
    const unsubscribe = executionBus.subscribe(id, listener);

    expect(listener).toHaveBeenCalledTimes(2);

    // Anything published afterwards must not reach the detached listener.
    executionBus.publish({ type: 'step.start', executionId: id, nodeId: 'z', layer: 0, attempt: 1 });
    expect(listener).toHaveBeenCalledTimes(2);

    expect(() => unsubscribe()).not.toThrow();
  });

  it('reports an unknown run as unfinished', () => {
    expect(executionBus.isFinished('never-existed')).toBe(false);
  });
});

describe('toSseFrame', () => {
  it('emits a named SSE event with a JSON payload', () => {
    const frame = toSseFrame(runStart('exec_1'));

    expect(frame.startsWith('event: run.start\n')).toBe(true);
    expect(frame.endsWith('\n\n')).toBe(true);
  });

  it('round-trips the event through JSON', () => {
    const event = runStart('exec_1');
    const dataLine = toSseFrame(event).split('\n')[1]!;

    expect(JSON.parse(dataLine.replace(/^data: /, ''))).toEqual(event);
  });

  it('names each event type so the browser can register a listener per type', () => {
    // The client uses addEventListener(type) — a generic `message` frame would
    // never be delivered.
    const frame = toSseFrame({
      type: 'step.finish',
      executionId: 'exec_1',
      nodeId: 'a',
      step: step(),
    });

    expect(frame).toContain('event: step.finish');
  });
});
