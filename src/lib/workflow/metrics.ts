import type { ExecutionMetrics, ExecutionStep } from '@/types/execution';
import type { WorkflowGraph } from '@/types/workflow';
import { computeComplexityScore, computeParallelizationScore } from './topology';

/**
 * Aggregate run metrics.
 *
 * Pure function of (steps, graph, wall clock) so the dashboard, the API, and
 * the tests all compute identical numbers. No component ever does this maths.
 */
export function computeMetrics(
  steps: ExecutionStep[],
  graph: WorkflowGraph,
  layerCount: number,
  totalDurationMs: number,
): ExecutionMetrics {
  const attempted = steps.filter((step) => step.status !== 'skipped' && step.status !== 'pending');
  const succeeded = steps.filter((step) => step.status === 'success');
  const failed = steps.filter((step) => step.status === 'failed');
  const skipped = steps.filter((step) => step.status === 'skipped');

  const promptTokens = sumBy(steps, (s) => s.usage.promptTokens);
  const completionTokens = sumBy(steps, (s) => s.usage.completionTokens);
  const totalAgentTimeMs = sumBy(steps, (s) => s.durationMs);

  // Confidence is only meaningful for steps that actually produced output.
  const confidences = succeeded.map((s) => s.confidence);

  return {
    totalDurationMs,
    totalAgentTimeMs,
    totalTokens: promptTokens + completionTokens,
    promptTokens,
    completionTokens,
    totalCostUsd: round(sumBy(steps, (s) => s.costUsd), 6),
    successRate: attempted.length === 0 ? 0 : round(succeeded.length / attempted.length, 4),
    averageConfidence: confidences.length === 0 ? 0 : round(mean(confidences), 4),
    averageLatencyMs:
      succeeded.length === 0 ? 0 : Math.round(mean(succeeded.map((s) => s.durationMs))),
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    layerCount,
    executedCount: attempted.length,
    failedCount: failed.length,
    skippedCount: skipped.length,
    retryCount: sumBy(steps, (s) => s.retries),
    parallelizationScore: computeParallelizationScore(graph.nodes.length, layerCount),
    complexityScore: computeComplexityScore(graph, layerCount),
  };
}

export function emptyMetrics(graph: WorkflowGraph): ExecutionMetrics {
  return computeMetrics([], graph, 0, 0);
}

/**
 * Speedup versus running every node one after another.
 *
 * Reported as a multiplier (2.4× means the parallel graph finished in 42% of
 * the serial time).
 */
export function computeSpeedup(metrics: ExecutionMetrics): number {
  if (metrics.totalDurationMs <= 0) return 1;
  return round(metrics.totalAgentTimeMs / metrics.totalDurationMs, 2);
}

function sumBy<T>(items: T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
