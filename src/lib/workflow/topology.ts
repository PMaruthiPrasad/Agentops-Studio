import type { WorkflowGraph, WorkflowNode } from '@/types/workflow';
import { findCycle } from './validate';

/**
 * Topological layering.
 *
 * Kahn's algorithm, but instead of producing a flat linear order we peel the
 * graph one *layer* at a time. Every node in a layer has all its dependencies
 * satisfied by earlier layers and none by its own peers — which means the whole
 * layer can be dispatched concurrently. That single fact is what gives the
 * engine parallelism and the optimizer something meaningful to measure.
 */

export interface TopologyResult {
  /** Node ids grouped by layer, in execution order. */
  layers: string[][];
  /** Fast lookup: node id → layer index. */
  layerOf: Map<string, number>;
  /** Incoming edges per node, precomputed for the executor. */
  incoming: Map<string, string[]>;
  /** Outgoing edges per node. */
  outgoing: Map<string, string[]>;
}

export class TopologyError extends Error {
  constructor(message: string, readonly cycle: string[]) {
    super(message);
    this.name = 'TopologyError';
  }
}

export function buildAdjacency(graph: WorkflowGraph): {
  incoming: Map<string, string[]>;
  outgoing: Map<string, string[]>;
} {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();

  for (const node of graph.nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }

  for (const edge of graph.edges) {
    outgoing.get(edge.source)?.push(edge.target);
    incoming.get(edge.target)?.push(edge.source);
  }

  return { incoming, outgoing };
}

export function computeTopology(graph: WorkflowGraph): TopologyResult {
  const cycle = findCycle(graph);
  if (cycle) {
    throw new TopologyError(
      `Cannot order a cyclic graph: ${cycle.join(' → ')}`,
      cycle,
    );
  }

  const { incoming, outgoing } = buildAdjacency(graph);

  const indegree = new Map<string, number>();
  for (const node of graph.nodes) {
    indegree.set(node.id, incoming.get(node.id)?.length ?? 0);
  }

  const layers: string[][] = [];
  const layerOf = new Map<string, number>();

  // Preserve authoring order within a layer so the UI is stable across runs.
  const orderIndex = new Map<string, number>();
  graph.nodes.forEach((node, index) => orderIndex.set(node.id, index));

  let frontier = graph.nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .map((node) => node.id);

  let processed = 0;

  while (frontier.length > 0) {
    const layer = [...frontier].sort(
      (a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0),
    );
    const layerIndex = layers.length;
    layers.push(layer);

    const nextFrontier: string[] = [];
    for (const nodeId of layer) {
      layerOf.set(nodeId, layerIndex);
      processed += 1;

      for (const target of outgoing.get(nodeId) ?? []) {
        const remaining = (indegree.get(target) ?? 0) - 1;
        indegree.set(target, remaining);
        if (remaining === 0) nextFrontier.push(target);
      }
    }

    frontier = nextFrontier;
  }

  // Defensive: acyclicity was already checked, so this should be unreachable.
  if (processed !== graph.nodes.length) {
    throw new TopologyError('Topological sort did not cover every node', []);
  }

  return { layers, layerOf, incoming, outgoing };
}

/**
 * Parallelization score in [0, 1].
 *
 * 0 = fully serial (one node per layer). 1 = fully parallel (a single layer).
 * Defined as the fraction of serial steps eliminated: `1 - (layers-1)/(nodes-1)`.
 */
export function computeParallelizationScore(nodeCount: number, layerCount: number): number {
  if (nodeCount <= 1) return 0;
  if (layerCount <= 1) return 1;
  const score = 1 - (layerCount - 1) / (nodeCount - 1);
  return Number(Math.max(0, Math.min(1, score)).toFixed(3));
}

/**
 * Structural complexity in [0, 1].
 *
 * A blend of size, connectivity, depth, and branching. Normalised against a
 * "large workflow" reference of ~20 nodes so the number stays comparable across
 * workflows rather than growing without bound.
 */
export function computeComplexityScore(graph: WorkflowGraph, layerCount: number): number {
  const nodeCount = graph.nodes.length;
  if (nodeCount === 0) return 0;

  const edgeCount = graph.edges.length;
  const branchingNodes = countBranchPoints(graph);
  const conditionalEdges = graph.edges.filter((e) => e.condition.kind !== 'always').length;

  const sizeFactor = Math.min(1, nodeCount / 20);
  const densityFactor = Math.min(1, edgeCount / Math.max(1, nodeCount * 1.6));
  const depthFactor = Math.min(1, layerCount / 10);
  const branchFactor = Math.min(1, (branchingNodes + conditionalEdges) / Math.max(1, nodeCount));

  const score =
    sizeFactor * 0.3 + densityFactor * 0.25 + depthFactor * 0.25 + branchFactor * 0.2;

  return Number(Math.max(0, Math.min(1, score)).toFixed(3));
}

/** Nodes with more than one outgoing edge — where the graph actually branches. */
export function countBranchPoints(graph: WorkflowGraph): number {
  const counts = new Map<string, number>();
  for (const edge of graph.edges) {
    counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

/** Nodes with more than one incoming edge — where branches merge back together. */
export function countMergePoints(graph: WorkflowGraph): number {
  const counts = new Map<string, number>();
  for (const edge of graph.edges) {
    counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

/** Nodes with no outgoing edges — the graph's terminal outputs. */
export function findTerminalNodes(graph: WorkflowGraph): WorkflowNode[] {
  const hasOutgoing = new Set(graph.edges.map((e) => e.source));
  return graph.nodes.filter((node) => !hasOutgoing.has(node.id));
}

/** Nodes with no incoming edges — where execution starts. */
export function findRootNodes(graph: WorkflowGraph): WorkflowNode[] {
  const hasIncoming = new Set(graph.edges.map((e) => e.target));
  return graph.nodes.filter((node) => !hasIncoming.has(node.id));
}

/**
 * Longest path by accumulated node weight — the true lower bound on wall-clock
 * time, since everything off the critical path overlaps with it.
 */
export function computeCriticalPath(
  graph: WorkflowGraph,
  weightOf: (node: WorkflowNode) => number,
): { path: string[]; totalWeight: number } {
  const topology = computeTopology(graph);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  const best = new Map<string, { weight: number; from: string | null }>();

  for (const layer of topology.layers) {
    for (const nodeId of layer) {
      const node = nodeById.get(nodeId);
      const ownWeight = node ? weightOf(node) : 0;

      let bestPredecessor: string | null = null;
      let bestWeight = 0;

      for (const predecessor of topology.incoming.get(nodeId) ?? []) {
        const candidate = best.get(predecessor)?.weight ?? 0;
        if (candidate > bestWeight) {
          bestWeight = candidate;
          bestPredecessor = predecessor;
        }
      }

      best.set(nodeId, { weight: bestWeight + ownWeight, from: bestPredecessor });
    }
  }

  let endNode: string | null = null;
  let totalWeight = 0;
  for (const [nodeId, entry] of best) {
    if (entry.weight > totalWeight) {
      totalWeight = entry.weight;
      endNode = nodeId;
    }
  }

  const path: string[] = [];
  let cursor = endNode;
  while (cursor) {
    path.unshift(cursor);
    cursor = best.get(cursor)?.from ?? null;
  }

  return { path, totalWeight };
}
