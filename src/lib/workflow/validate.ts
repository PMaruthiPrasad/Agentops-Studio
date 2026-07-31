import { workflowGraphSchema, type WorkflowGraph } from '@/types/workflow';

/**
 * Graph validation.
 *
 * Runs before execution *and* on every save, so a broken graph can never reach
 * the engine. Errors block; warnings are surfaced in the UI but do not stop a
 * run — an isolated node is a smell, not a bug.
 */

export interface ValidationIssue {
  code: string;
  message: string;
  nodeIds?: string[];
  edgeIds?: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export class WorkflowValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(`Workflow validation failed: ${issues.map((i) => i.message).join('; ')}`);
    this.name = 'WorkflowValidationError';
  }
}

/**
 * Depth-first cycle detection over the directed graph.
 *
 * Returns the node ids forming the first cycle found, in order, so the UI can
 * highlight the actual loop instead of just saying "there is a cycle".
 */
export function findCycle(graph: WorkflowGraph): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const edge of graph.edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const node of graph.nodes) colour.set(node.id, WHITE);

  const stack: string[] = [];

  function visit(nodeId: string): string[] | null {
    colour.set(nodeId, GREY);
    stack.push(nodeId);

    for (const next of adjacency.get(nodeId) ?? []) {
      const state = colour.get(next);
      if (state === GREY) {
        // Found a back-edge: slice the cycle out of the current DFS stack.
        const start = stack.indexOf(next);
        return [...stack.slice(start), next];
      }
      if (state === WHITE) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
    }

    stack.pop();
    colour.set(nodeId, BLACK);
    return null;
  }

  for (const node of graph.nodes) {
    if (colour.get(node.id) === WHITE) {
      const cycle = visit(node.id);
      if (cycle) return cycle;
    }
  }

  return null;
}

export function validateGraph(graph: WorkflowGraph): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const parsed = workflowGraphSchema.safeParse(graph);
  if (!parsed.success) {
    errors.push({
      code: 'SCHEMA_INVALID',
      message: parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'graph'}: ${issue.message}`)
        .join('; '),
    });
    return { valid: false, errors, warnings };
  }

  const nodes = parsed.data.nodes;
  const edges = parsed.data.edges;

  if (nodes.length === 0) {
    errors.push({ code: 'EMPTY_GRAPH', message: 'Workflow has no nodes to execute.' });
    return { valid: false, errors, warnings };
  }

  /* Duplicate ids -------------------------------------------------------- */
  const nodeIds = new Set<string>();
  const duplicateNodeIds: string[] = [];
  for (const node of nodes) {
    if (nodeIds.has(node.id)) duplicateNodeIds.push(node.id);
    nodeIds.add(node.id);
  }
  if (duplicateNodeIds.length > 0) {
    errors.push({
      code: 'DUPLICATE_NODE_ID',
      message: `Duplicate node ids: ${duplicateNodeIds.join(', ')}`,
      nodeIds: duplicateNodeIds,
    });
  }

  const edgeIds = new Set<string>();
  const duplicateEdgeIds: string[] = [];
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) duplicateEdgeIds.push(edge.id);
    edgeIds.add(edge.id);
  }
  if (duplicateEdgeIds.length > 0) {
    errors.push({
      code: 'DUPLICATE_EDGE_ID',
      message: `Duplicate edge ids: ${duplicateEdgeIds.join(', ')}`,
      edgeIds: duplicateEdgeIds,
    });
  }

  /* Dangling edges ------------------------------------------------------- */
  const dangling = edges.filter((e) => !nodeIds.has(e.source) || !nodeIds.has(e.target));
  if (dangling.length > 0) {
    errors.push({
      code: 'DANGLING_EDGE',
      message: `${dangling.length} edge(s) reference a node that does not exist.`,
      edgeIds: dangling.map((e) => e.id),
    });
  }

  /* Self loops ----------------------------------------------------------- */
  const selfLoops = edges.filter((e) => e.source === e.target);
  if (selfLoops.length > 0) {
    errors.push({
      code: 'SELF_LOOP',
      message: `A node cannot depend on itself (${selfLoops.map((e) => e.source).join(', ')}).`,
      edgeIds: selfLoops.map((e) => e.id),
    });
  }

  /* Cycles --------------------------------------------------------------- */
  const cycle = findCycle(parsed.data);
  if (cycle) {
    errors.push({
      code: 'CYCLE_DETECTED',
      message: `Graph contains a cycle: ${cycle.join(' → ')}. Execution order is undefined.`,
      nodeIds: cycle,
    });
  }

  /* Warnings ------------------------------------------------------------- */
  const connected = new Set<string>();
  for (const edge of edges) {
    connected.add(edge.source);
    connected.add(edge.target);
  }
  const isolated = nodes.filter((n) => !connected.has(n.id));
  if (isolated.length > 0 && nodes.length > 1) {
    warnings.push({
      code: 'ISOLATED_NODE',
      message: `${isolated.length} node(s) are not connected to anything and will run on their own.`,
      nodeIds: isolated.map((n) => n.id),
    });
  }

  const hasIncoming = new Set(edges.map((e) => e.target));
  const roots = nodes.filter((n) => !hasIncoming.has(n.id));
  if (roots.length === 0 && nodes.length > 0) {
    errors.push({
      code: 'NO_ENTRY_POINT',
      message: 'Every node has an incoming edge, so there is no entry point.',
    });
  }

  const duplicateEdgePairs = new Map<string, number>();
  for (const edge of edges) {
    const key = `${edge.source}->${edge.target}`;
    duplicateEdgePairs.set(key, (duplicateEdgePairs.get(key) ?? 0) + 1);
  }
  const repeated = [...duplicateEdgePairs.entries()].filter(([, count]) => count > 1);
  if (repeated.length > 0) {
    warnings.push({
      code: 'PARALLEL_EDGES',
      message: `Repeated connections between the same nodes: ${repeated.map(([k]) => k).join(', ')}.`,
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Validate or throw. Used by the engine entry point. */
export function assertValidGraph(graph: WorkflowGraph): void {
  const result = validateGraph(graph);
  if (!result.valid) {
    throw new WorkflowValidationError(result.errors);
  }
}
