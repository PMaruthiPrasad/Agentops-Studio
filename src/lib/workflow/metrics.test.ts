import { describe, expect, it } from 'vitest';
import { computeMetrics, computeSpeedup, emptyMetrics } from './metrics';
import { fanOutGraph, graph, node, serialGraph, step } from '@/test/fixtures';

describe('computeMetrics', () => {
  it('sums tokens and cost across every step', () => {
    const steps = [
      step({ nodeId: 'a', usage: { promptTokens: 100, completionTokens: 40, totalTokens: 140 }, costUsd: 0.002 }),
      step({ nodeId: 'b', usage: { promptTokens: 200, completionTokens: 60, totalTokens: 260 }, costUsd: 0.003 }),
    ];

    const metrics = computeMetrics(steps, serialGraph('a', 'b'), 2, 5_000);

    expect(metrics.promptTokens).toBe(300);
    expect(metrics.completionTokens).toBe(100);
    expect(metrics.totalTokens).toBe(400);
    expect(metrics.totalCostUsd).toBeCloseTo(0.005, 6);
  });

  it('excludes skipped nodes from the success rate', () => {
    // Two ran and succeeded; one was pruned by a branch. That is 100%, not 67%.
    const steps = [
      step({ nodeId: 'a', status: 'success' }),
      step({ nodeId: 'b', status: 'success' }),
      step({ nodeId: 'c', status: 'skipped' }),
    ];

    const metrics = computeMetrics(steps, serialGraph('a', 'b', 'c'), 3, 1_000);

    expect(metrics.successRate).toBe(1);
    expect(metrics.executedCount).toBe(2);
    expect(metrics.skippedCount).toBe(1);
  });

  it('reports a partial success rate when a node fails', () => {
    const steps = [
      step({ nodeId: 'a', status: 'success' }),
      step({ nodeId: 'b', status: 'failed' }),
    ];

    const metrics = computeMetrics(steps, serialGraph('a', 'b'), 2, 1_000);

    expect(metrics.successRate).toBe(0.5);
    expect(metrics.failedCount).toBe(1);
  });

  it('averages confidence over successful steps only', () => {
    // A failed step reports confidence 0; including it would drag the mean down
    // and misrepresent the work that actually completed.
    const steps = [
      step({ nodeId: 'a', status: 'success', confidence: 0.9 }),
      step({ nodeId: 'b', status: 'success', confidence: 0.7 }),
      step({ nodeId: 'c', status: 'failed', confidence: 0 }),
    ];

    const metrics = computeMetrics(steps, serialGraph('a', 'b', 'c'), 3, 1_000);

    expect(metrics.averageConfidence).toBeCloseTo(0.8, 4);
  });

  it('separates wall clock from summed agent time', () => {
    // Two 1s nodes running in parallel: 2s of agent time, 1s of wall clock.
    const steps = [
      step({ nodeId: 'leaf1', durationMs: 1_000 }),
      step({ nodeId: 'leaf2', durationMs: 1_000 }),
    ];

    const metrics = computeMetrics(steps, fanOutGraph(2), 2, 1_000);

    expect(metrics.totalAgentTimeMs).toBe(2_000);
    expect(metrics.totalDurationMs).toBe(1_000);
  });

  it('counts retries across the run', () => {
    const steps = [step({ nodeId: 'a', retries: 2 }), step({ nodeId: 'b', retries: 1 })];

    expect(computeMetrics(steps, serialGraph('a', 'b'), 2, 1_000).retryCount).toBe(3);
  });

  it('carries the graph shape through to the metrics', () => {
    const metrics = computeMetrics([], fanOutGraph(3), 2, 0);

    expect(metrics.nodeCount).toBe(4);
    expect(metrics.edgeCount).toBe(3);
    expect(metrics.layerCount).toBe(2);
    expect(metrics.parallelizationScore).toBeGreaterThan(0);
  });

  it('returns zeroes rather than NaN when nothing ran', () => {
    const metrics = computeMetrics([], graph([node('a')]), 0, 0);

    expect(metrics.successRate).toBe(0);
    expect(metrics.averageConfidence).toBe(0);
    expect(metrics.averageLatencyMs).toBe(0);
    expect(Number.isNaN(metrics.successRate)).toBe(false);
  });

  it('averages latency over successful steps', () => {
    const steps = [
      step({ nodeId: 'a', status: 'success', durationMs: 1_000 }),
      step({ nodeId: 'b', status: 'success', durationMs: 3_000 }),
      step({ nodeId: 'c', status: 'skipped', durationMs: 0 }),
    ];

    expect(computeMetrics(steps, serialGraph('a', 'b', 'c'), 3, 4_000).averageLatencyMs).toBe(2_000);
  });
});

describe('emptyMetrics', () => {
  it('produces a zeroed shape that still describes the graph', () => {
    const metrics = emptyMetrics(serialGraph('a', 'b'));

    expect(metrics.totalTokens).toBe(0);
    expect(metrics.nodeCount).toBe(2);
    expect(metrics.executedCount).toBe(0);
  });
});

describe('computeSpeedup', () => {
  it('reports the multiplier over serial execution', () => {
    const metrics = computeMetrics(
      [step({ nodeId: 'leaf1', durationMs: 1_000 }), step({ nodeId: 'leaf2', durationMs: 1_000 })],
      fanOutGraph(2),
      2,
      1_000,
    );

    expect(computeSpeedup(metrics)).toBe(2);
  });

  it('reports 1× for a serial run', () => {
    const metrics = computeMetrics(
      [step({ nodeId: 'a', durationMs: 500 }), step({ nodeId: 'b', durationMs: 500 })],
      serialGraph('a', 'b'),
      2,
      1_000,
    );

    expect(computeSpeedup(metrics)).toBe(1);
  });

  it('avoids dividing by zero on an instant run', () => {
    expect(computeSpeedup(emptyMetrics(serialGraph('a')))).toBe(1);
  });
});
