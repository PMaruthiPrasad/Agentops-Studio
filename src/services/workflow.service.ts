import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { serializeTags, stringifyJsonColumn } from '@/lib/serialization';
import { graphSignature } from '@/lib/workflow/graph-utils';
import { validateGraph } from '@/lib/workflow/validate';
import { EMPTY_GRAPH, type Workflow, type WorkflowGraph, type WorkflowSummary, type WorkflowVersionSummary, type WorkflowExport } from '@/types/workflow';
import type {
  CreateWorkflowInput,
  ListWorkflowsQuery,
  UpdateWorkflowInput,
} from '@/types/api';
import { ServiceError } from './errors';
import { toWorkflow, type WorkflowWithGraph } from './mappers';

/**
 * Workflow persistence.
 *
 * The graph is stored decomposed into `WorkflowNode` / `WorkflowEdge` rows
 * rather than as one JSON blob. That costs a little write complexity and buys
 * indexable, queryable structure — "how many workflows use a Legal Validator?"
 * is a query rather than a full-table scan and parse.
 *
 * Writes replace the node/edge set inside a transaction; partial graph state is
 * never observable.
 */

const withGraph = {
  nodes: { orderBy: { nodeKey: 'asc' } },
  edges: { orderBy: { edgeKey: 'asc' } },
} satisfies Prisma.WorkflowInclude;

export async function listWorkflows(query: ListWorkflowsQuery): Promise<WorkflowSummary[]> {
  const where: Prisma.WorkflowWhereInput = {};

  if (query.favorite !== undefined) {
    where.isFavorite = query.favorite;
  }

  if (query.search) {
    // SQLite's LIKE is case-insensitive for ASCII, which is what `contains` compiles to.
    where.OR = [
      { name: { contains: query.search } },
      { description: { contains: query.search } },
      { tags: { contains: query.search.toLowerCase() } },
    ];
  }

  if (query.tag) {
    // Tags are a JSON array in TEXT; match the quoted token to avoid
    // "legal" also matching "legalese".
    where.tags = { contains: `"${query.tag.toLowerCase()}"` };
  }

  const rows = await prisma.workflow.findMany({
    where,
    include: {
      _count: { select: { nodes: true, edges: true, runs: true } },
      runs: {
        orderBy: { startedAt: 'desc' },
        take: 1,
        select: { startedAt: true },
      },
    },
    orderBy: [{ isFavorite: 'desc' }, { updatedAt: 'desc' }],
    take: query.limit,
    skip: query.offset,
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    tags: JSON.parse(row.tags || '[]') as string[],
    isFavorite: row.isFavorite,
    version: row.version,
    nodeCount: row._count.nodes,
    edgeCount: row._count.edges,
    executionCount: row._count.runs,
    lastExecutedAt: row.runs[0]?.startedAt.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function getWorkflow(id: string): Promise<Workflow> {
  const row = await prisma.workflow.findUnique({ where: { id }, include: withGraph });
  if (!row) throw ServiceError.notFound('Workflow', id);
  return toWorkflow(row as WorkflowWithGraph);
}

export async function createWorkflow(input: CreateWorkflowInput): Promise<Workflow> {
  const graph = input.graph ?? EMPTY_GRAPH;
  assertGraphIsSaveable(graph);

  const created = await prisma.$transaction(async (tx) => {
    const workflow = await tx.workflow.create({
      data: {
        name: input.name,
        description: input.description,
        tags: serializeTags(input.tags),
        version: 1,
      },
    });

    await writeGraph(tx, workflow.id, graph);
    await tx.workflowVersion.create({
      data: {
        workflowId: workflow.id,
        version: 1,
        snapshot: stringifyJsonColumn(graph),
        message: 'Initial version',
      },
    });

    return workflow.id;
  });

  return getWorkflow(created);
}

export async function updateWorkflow(id: string, input: UpdateWorkflowInput): Promise<Workflow> {
  const existing = await prisma.workflow.findUnique({ where: { id }, include: withGraph });
  if (!existing) throw ServiceError.notFound('Workflow', id);

  if (input.graph) assertGraphIsSaveable(input.graph);

  const currentGraph = toWorkflow(existing as WorkflowWithGraph).graph;
  // Only cut a new version when the structure actually changed — renaming a
  // workflow should not create a version snapshot.
  const graphChanged =
    input.graph !== undefined && graphSignature(input.graph) !== graphSignature(currentGraph);

  await prisma.$transaction(async (tx) => {
    const data: Prisma.WorkflowUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.tags !== undefined) data.tags = serializeTags(input.tags);
    if (input.isFavorite !== undefined) data.isFavorite = input.isFavorite;
    if (graphChanged) data.version = { increment: 1 };

    await tx.workflow.update({ where: { id }, data });

    if (input.graph && graphChanged) {
      await tx.workflowNode.deleteMany({ where: { workflowId: id } });
      await tx.workflowEdge.deleteMany({ where: { workflowId: id } });
      await writeGraph(tx, id, input.graph);

      await tx.workflowVersion.create({
        data: {
          workflowId: id,
          version: existing.version + 1,
          snapshot: stringifyJsonColumn(input.graph),
          message: input.versionMessage?.trim() || describeGraphChange(currentGraph, input.graph),
        },
      });
    }
  });

  return getWorkflow(id);
}

export async function deleteWorkflow(id: string): Promise<void> {
  const existing = await prisma.workflow.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw ServiceError.notFound('Workflow', id);
  // Cascades to nodes, edges, versions, executions, and steps.
  await prisma.workflow.delete({ where: { id } });
}

export async function duplicateWorkflow(id: string, name?: string): Promise<Workflow> {
  const source = await getWorkflow(id);

  return createWorkflow({
    name: name?.trim() || `${source.name} (copy)`,
    description: source.description,
    tags: source.tags,
    graph: source.graph,
  });
}

export async function toggleFavorite(id: string): Promise<Workflow> {
  const existing = await prisma.workflow.findUnique({
    where: { id },
    select: { isFavorite: true },
  });
  if (!existing) throw ServiceError.notFound('Workflow', id);

  await prisma.workflow.update({
    where: { id },
    data: { isFavorite: !existing.isFavorite },
  });

  return getWorkflow(id);
}

export async function listVersions(id: string): Promise<WorkflowVersionSummary[]> {
  const rows = await prisma.workflowVersion.findMany({
    where: { workflowId: id },
    orderBy: { version: 'desc' },
    take: 50,
  });

  return rows.map((row) => {
    const snapshot = safeParseGraph(row.snapshot);
    return {
      id: row.id,
      version: row.version,
      message: row.message,
      nodeCount: snapshot.nodes.length,
      edgeCount: snapshot.edges.length,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

/** Restore a historical snapshot as a new version — history is never rewritten. */
export async function restoreVersion(id: string, version: number): Promise<Workflow> {
  const snapshot = await prisma.workflowVersion.findUnique({
    where: { workflowId_version: { workflowId: id, version } },
  });
  if (!snapshot) throw ServiceError.notFound(`Version ${version} of workflow`, id);

  return updateWorkflow(id, {
    graph: safeParseGraph(snapshot.snapshot),
    versionMessage: `Restored from v${version}`,
  });
}

export async function exportWorkflow(id: string): Promise<WorkflowExport> {
  const workflow = await getWorkflow(id);
  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    name: workflow.name,
    description: workflow.description,
    tags: workflow.tags,
    graph: workflow.graph,
  };
}

export async function listAllTags(): Promise<Array<{ tag: string; count: number }>> {
  const rows = await prisma.workflow.findMany({ select: { tags: true } });
  const counts = new Map<string, number>();

  for (const row of rows) {
    for (const tag of JSON.parse(row.tags || '[]') as string[]) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

type TransactionClient = Prisma.TransactionClient;

async function writeGraph(tx: TransactionClient, workflowId: string, graph: WorkflowGraph): Promise<void> {
  if (graph.nodes.length > 0) {
    await tx.workflowNode.createMany({
      data: graph.nodes.map((node) => ({
        workflowId,
        nodeKey: node.id,
        agentType: node.type,
        label: node.label,
        description: node.description,
        positionX: node.position.x,
        positionY: node.position.y,
        config: stringifyJsonColumn(node.config),
      })),
    });
  }

  if (graph.edges.length > 0) {
    await tx.workflowEdge.createMany({
      data: graph.edges.map((edge) => ({
        workflowId,
        edgeKey: edge.id,
        sourceKey: edge.source,
        targetKey: edge.target,
        label: edge.label ?? null,
        condition: stringifyJsonColumn(edge.condition),
      })),
    });
  }
}

/**
 * An empty graph is a legitimate saved state (you just created the workflow),
 * so validation only rejects graphs that are actively broken.
 */
function assertGraphIsSaveable(graph: WorkflowGraph): void {
  if (graph.nodes.length === 0) return;

  const result = validateGraph(graph);
  if (!result.valid) {
    throw ServiceError.validation(
      `Workflow graph is invalid: ${result.errors.map((e) => e.message).join('; ')}`,
      result.errors,
    );
  }
}

function describeGraphChange(before: WorkflowGraph, after: WorkflowGraph): string {
  const nodeDelta = after.nodes.length - before.nodes.length;
  const edgeDelta = after.edges.length - before.edges.length;

  const parts: string[] = [];
  if (nodeDelta > 0) parts.push(`+${nodeDelta} node${nodeDelta > 1 ? 's' : ''}`);
  if (nodeDelta < 0) parts.push(`${nodeDelta} node${nodeDelta < -1 ? 's' : ''}`);
  if (edgeDelta > 0) parts.push(`+${edgeDelta} edge${edgeDelta > 1 ? 's' : ''}`);
  if (edgeDelta < 0) parts.push(`${edgeDelta} edge${edgeDelta < -1 ? 's' : ''}`);

  return parts.length > 0 ? `Graph updated (${parts.join(', ')})` : 'Graph updated';
}

function safeParseGraph(raw: string): WorkflowGraph {
  try {
    const parsed = JSON.parse(raw) as WorkflowGraph;
    return { nodes: parsed.nodes ?? [], edges: parsed.edges ?? [] };
  } catch {
    return EMPTY_GRAPH;
  }
}
