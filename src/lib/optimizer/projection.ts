import type { WorkflowProjection } from '@/types/optimizer';
import type { WorkflowGraph, WorkflowNode } from '@/types/workflow';
import { AGENT_DEFINITIONS } from '@/lib/agents/definitions';
import {
  computeComplexityScore,
  computeCriticalPath,
  computeParallelizationScore,
  computeTopology,
} from '@/lib/workflow/topology';

/**
 * Static, pre-execution projection of what a workflow will cost and how long
 * it will take.
 *
 * This is how the optimizer can quantify a suggestion without running anything.
 * Latency is the **critical path**, not the sum of node latencies — that
 * distinction is the whole reason parallelising a branch shows up as a saving.
 */

export function nodeLatencyMs(node: WorkflowNode): number {
  const definition = AGENT_DEFINITIONS[node.type] ?? AGENT_DEFINITIONS.custom;
  const base = definition.estimatedLatencyMs;

  // A raised token budget lengthens generation roughly linearly.
  const tokenRatio = (node.config.maxTokens ?? definition.maxTokens) / definition.maxTokens;
  return Math.round(base * Math.max(0.4, tokenRatio));
}

export function nodeCostUsd(node: WorkflowNode): number {
  const definition = AGENT_DEFINITIONS[node.type] ?? AGENT_DEFINITIONS.custom;
  const base = definition.estimatedCostUsd;
  const tokenRatio = (node.config.maxTokens ?? definition.maxTokens) / definition.maxTokens;
  return base * Math.max(0.4, tokenRatio);
}

export function projectWorkflow(graph: WorkflowGraph): WorkflowProjection {
  if (graph.nodes.length === 0) {
    return {
      estimatedLatencyMs: 0,
      estimatedCostUsd: 0,
      nodeCount: 0,
      edgeCount: 0,
      layerCount: 0,
      parallelizationScore: 0,
      complexityScore: 0,
    };
  }

  let layerCount = graph.nodes.length;
  let criticalPathMs = graph.nodes.reduce((total, node) => total + nodeLatencyMs(node), 0);

  try {
    layerCount = computeTopology(graph).layers.length;
    criticalPathMs = computeCriticalPath(graph, nodeLatencyMs).totalWeight;
  } catch {
    // A cyclic or malformed graph can't be ordered. Fall back to the serial
    // estimate rather than failing the whole report — the validator will
    // surface the real problem separately.
  }

  return {
    estimatedLatencyMs: Math.round(criticalPathMs),
    estimatedCostUsd: Number(
      graph.nodes.reduce((total, node) => total + nodeCostUsd(node), 0).toFixed(6),
    ),
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    layerCount,
    parallelizationScore: computeParallelizationScore(graph.nodes.length, layerCount),
    complexityScore: computeComplexityScore(graph, layerCount),
  };
}

/** Wall-clock a graph would take with zero parallelism — the pessimistic bound. */
export function projectSerialLatencyMs(graph: WorkflowGraph): number {
  return graph.nodes.reduce((total, node) => total + nodeLatencyMs(node), 0);
}
