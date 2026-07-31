import { z } from 'zod';
import { agentTypeSchema } from './agent';
import { providerIdSchema } from './provider';

/**
 * Graph shapes. `WorkflowGraph` is the contract between the React Flow canvas,
 * the execution engine, the optimizer, and the database — all four speak this
 * exact structure, which is why none of them need to know about each other.
 */

/** Fields a node may override on top of its agent type's defaults. */
export const nodeConfigSchema = z.object({
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(64).max(32_000).optional(),
  provider: providerIdSchema.optional(),
  model: z.string().min(1).optional(),
  /** Total attempts including the first. 1 disables retries for this node. */
  maxAttempts: z.number().int().min(1).max(5).optional(),
  notes: z.string().max(1_000).optional(),
});
export type NodeConfig = z.infer<typeof nodeConfigSchema>;

export const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});
export type Position = z.infer<typeof positionSchema>;

export const workflowNodeSchema = z.object({
  /** Stable key within the graph; also the React Flow node id. */
  id: z.string().min(1),
  type: agentTypeSchema,
  label: z.string().min(1).max(80),
  description: z.string().max(500).default(''),
  position: positionSchema,
  config: nodeConfigSchema.default({}),
});
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;

/**
 * Branching. An edge either always fires, or fires only when a predicate over
 * the *source node's* result holds. Evaluated by a tiny hand-written
 * interpreter — never `eval`.
 */
export const CONDITION_FIELDS = ['confidence', 'status', 'tokens', 'cost', 'output'] as const;
export const conditionFieldSchema = z.enum(CONDITION_FIELDS);
export type ConditionField = z.infer<typeof conditionFieldSchema>;

export const CONDITION_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains'] as const;
export const conditionOperatorSchema = z.enum(CONDITION_OPERATORS);
export type ConditionOperator = z.infer<typeof conditionOperatorSchema>;

export const edgeConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('always') }),
  z.object({
    kind: z.literal('expression'),
    field: conditionFieldSchema,
    operator: conditionOperatorSchema,
    value: z.union([z.string(), z.number()]),
  }),
]);
export type EdgeCondition = z.infer<typeof edgeConditionSchema>;

export const ALWAYS: EdgeCondition = { kind: 'always' };

export const workflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().max(80).optional(),
  condition: edgeConditionSchema.default(ALWAYS),
});
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;

export const workflowGraphSchema = z.object({
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
});
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;

export const EMPTY_GRAPH: WorkflowGraph = { nodes: [], edges: [] };

export const workflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(1_000),
  tags: z.array(z.string().min(1).max(32)),
  isFavorite: z.boolean(),
  version: z.number().int().positive(),
  graph: workflowGraphSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Workflow = z.infer<typeof workflowSchema>;

/** Lightweight row used by list views — omits the graph payload. */
export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  tags: string[];
  isFavorite: boolean;
  version: number;
  nodeCount: number;
  edgeCount: number;
  executionCount: number;
  lastExecutedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowVersionSummary {
  id: string;
  version: number;
  message: string;
  nodeCount: number;
  edgeCount: number;
  createdAt: string;
}

/** Portable file format produced by "Export JSON". */
export const workflowExportSchema = z.object({
  formatVersion: z.literal(1),
  exportedAt: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  graph: workflowGraphSchema,
});
export type WorkflowExport = z.infer<typeof workflowExportSchema>;
