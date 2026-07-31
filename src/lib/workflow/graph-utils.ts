import type { AgentType } from '@/types/agent';
import type { GraphPatch } from '@/types/optimizer';
import {
  ALWAYS,
  type Position,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from '@/types/workflow';
import { AGENT_DEFINITIONS } from '@/lib/agents/definitions';

/**
 * Immutable graph edits.
 *
 * Every mutation returns a new graph. That is what makes undo/redo in the
 * builder a plain array of snapshots, and what lets the optimizer preview a fix
 * without touching the user's canvas.
 */

export function createGraph(nodes: WorkflowNode[] = [], edges: WorkflowEdge[] = []): WorkflowGraph {
  return { nodes, edges };
}

export function createNode(
  type: AgentType,
  position: Position,
  overrides: Partial<Omit<WorkflowNode, 'type' | 'position'>> = {},
): WorkflowNode {
  const definition = AGENT_DEFINITIONS[type];
  return {
    id: overrides.id ?? generateNodeId(type),
    type,
    label: overrides.label ?? definition.name,
    description: overrides.description ?? definition.description,
    position,
    config: overrides.config ?? {},
  };
}

export function addNode(graph: WorkflowGraph, node: WorkflowNode): WorkflowGraph {
  return { ...graph, nodes: [...graph.nodes, node] };
}

export function removeNodes(graph: WorkflowGraph, nodeIds: string[]): WorkflowGraph {
  const doomed = new Set(nodeIds);
  return {
    nodes: graph.nodes.filter((node) => !doomed.has(node.id)),
    // Removing a node must remove its edges, or the graph fails validation.
    edges: graph.edges.filter((edge) => !doomed.has(edge.source) && !doomed.has(edge.target)),
  };
}

export function updateNode(
  graph: WorkflowGraph,
  nodeId: string,
  patch: Partial<WorkflowNode>,
): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
  };
}

export function connectNodes(
  graph: WorkflowGraph,
  source: string,
  target: string,
  options: { label?: string; condition?: WorkflowEdge['condition'] } = {},
): WorkflowGraph {
  const exists = graph.edges.some((edge) => edge.source === source && edge.target === target);
  if (exists || source === target) return graph;

  const edge: WorkflowEdge = {
    id: generateEdgeId(source, target),
    source,
    target,
    condition: options.condition ?? ALWAYS,
    ...(options.label ? { label: options.label } : {}),
  };

  return { ...graph, edges: [...graph.edges, edge] };
}

export function removeEdges(graph: WorkflowGraph, edgeIds: string[]): WorkflowGraph {
  const doomed = new Set(edgeIds);
  return { ...graph, edges: graph.edges.filter((edge) => !doomed.has(edge.id)) };
}

/**
 * Duplicate a node, offset slightly so it doesn't land exactly on top of the
 * original. Incoming/outgoing edges are intentionally *not* copied — the user
 * decides how the clone should be wired.
 */
export function duplicateNode(graph: WorkflowGraph, nodeId: string): WorkflowGraph {
  const source = graph.nodes.find((node) => node.id === nodeId);
  if (!source) return graph;

  const clone: WorkflowNode = {
    ...source,
    id: generateNodeId(source.type),
    label: nextCopyLabel(graph, source.label),
    position: { x: source.position.x + 48, y: source.position.y + 48 },
    config: { ...source.config },
  };

  return addNode(graph, clone);
}

function nextCopyLabel(graph: WorkflowGraph, label: string): string {
  const base = label.replace(/\s+\(\d+\)$/, '');
  const taken = new Set(graph.nodes.map((node) => node.label));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base} (${index})`)) index += 1;
  return `${base} (${index})`;
}

/** Apply an optimizer patch. Order matters: remove, then update, then add. */
export function applyPatch(graph: WorkflowGraph, patch: GraphPatch): WorkflowGraph {
  let next = graph;

  if (patch.removeEdgeIds?.length) {
    next = removeEdges(next, patch.removeEdgeIds);
  }

  if (patch.removeNodeIds?.length) {
    next = removeNodes(next, patch.removeNodeIds);
  }

  if (patch.updateNodes?.length) {
    for (const update of patch.updateNodes) {
      const { id, ...rest } = update;
      next = updateNode(next, id, rest);
    }
  }

  if (patch.addEdges?.length) {
    const existing = new Set(next.edges.map((edge) => `${edge.source}->${edge.target}`));
    const nodeIds = new Set(next.nodes.map((node) => node.id));
    const additions = patch.addEdges.filter(
      (edge) =>
        // Never introduce an edge the patch's own node removals invalidated.
        nodeIds.has(edge.source) &&
        nodeIds.has(edge.target) &&
        !existing.has(`${edge.source}->${edge.target}`),
    );
    next = { ...next, edges: [...next.edges, ...additions] };
  }

  return next;
}

export function cloneGraph(graph: WorkflowGraph): WorkflowGraph {
  return {
    nodes: graph.nodes.map((node) => ({ ...node, position: { ...node.position }, config: { ...node.config } })),
    edges: graph.edges.map((edge) => ({ ...edge, condition: { ...edge.condition } })),
  };
}

let nodeCounter = 0;
let edgeCounter = 0;

export function generateNodeId(type: AgentType): string {
  nodeCounter += 1;
  return `${type}_${Date.now().toString(36)}${nodeCounter.toString(36)}`;
}

export function generateEdgeId(source: string, target: string): string {
  edgeCounter += 1;
  return `e_${source}_${target}_${edgeCounter.toString(36)}`;
}

/** Stable structural signature — used to detect real graph changes on save. */
export function graphSignature(graph: WorkflowGraph): string {
  const nodes = [...graph.nodes]
    .map((n) => `${n.id}:${n.type}:${n.label}:${JSON.stringify(n.config)}`)
    .sort()
    .join('|');
  const edges = [...graph.edges]
    .map((e) => `${e.source}>${e.target}:${JSON.stringify(e.condition)}`)
    .sort()
    .join('|');
  return `${nodes}#${edges}`;
}
