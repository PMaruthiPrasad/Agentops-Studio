import type {
  Execution as ExecutionRow,
  ExecutionStep as ExecutionStepRow,
  Workflow as WorkflowRow,
  WorkflowEdge as WorkflowEdgeRow,
  WorkflowNode as WorkflowNodeRow,
  AgentConfiguration as AgentConfigurationRow,
} from '@prisma/client';

import { agentTypeSchema, type AgentConfig, type AgentType, type RunDocument } from '@/types/agent';
import { providerIdSchema, type ProviderId } from '@/types/provider';
import {
  edgeConditionSchema,
  nodeConfigSchema,
  ALWAYS,
  type EdgeCondition,
  type NodeConfig,
  type Workflow,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from '@/types/workflow';
import {
  executionStatusSchema,
  stepStatusSchema,
  type ExecutionMetrics,
  type ExecutionResult,
  type ExecutionStatus,
  type ExecutionStep,
  type ExecutionSummary,
  type StepStatus,
} from '@/types/execution';
import { parseJsonColumn, parseTags } from '@/lib/serialization';

/**
 * The anti-corruption layer between Prisma rows and domain types.
 *
 * Every string column that represents an enum, and every TEXT column that
 * represents JSON, is validated here rather than cast. A row written by an
 * older version of the app degrades to a sane default instead of producing a
 * `WorkflowNode` whose `type` is a string the rest of the code has never heard of.
 */

function toAgentType(value: string): AgentType {
  const parsed = agentTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : 'custom';
}

function toProviderId(value: string): ProviderId {
  const parsed = providerIdSchema.safeParse(value);
  return parsed.success ? parsed.data : 'mock';
}

function toExecutionStatus(value: string): ExecutionStatus {
  const parsed = executionStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : 'failed';
}

function toStepStatus(value: string): StepStatus {
  const parsed = stepStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : 'failed';
}

/* -------------------------------------------------------------------------- */
/* Graph                                                                      */
/* -------------------------------------------------------------------------- */

export function toWorkflowNode(row: WorkflowNodeRow): WorkflowNode {
  return {
    id: row.nodeKey,
    type: toAgentType(row.agentType),
    label: row.label,
    description: row.description,
    position: { x: row.positionX, y: row.positionY },
    config: parseJsonColumn<NodeConfig>(row.config, nodeConfigSchema, {}),
  };
}

export function toWorkflowEdge(row: WorkflowEdgeRow): WorkflowEdge {
  return {
    id: row.edgeKey,
    source: row.sourceKey,
    target: row.targetKey,
    condition: parseJsonColumn<EdgeCondition>(row.condition, edgeConditionSchema, ALWAYS),
    ...(row.label ? { label: row.label } : {}),
  };
}

export function toWorkflowGraph(nodes: WorkflowNodeRow[], edges: WorkflowEdgeRow[]): WorkflowGraph {
  return {
    nodes: nodes.map(toWorkflowNode),
    edges: edges.map(toWorkflowEdge),
  };
}

export type WorkflowWithGraph = WorkflowRow & {
  nodes: WorkflowNodeRow[];
  edges: WorkflowEdgeRow[];
};

export function toWorkflow(row: WorkflowWithGraph): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tags: parseTags(row.tags),
    isFavorite: row.isFavorite,
    version: row.version,
    graph: toWorkflowGraph(row.nodes, row.edges),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Execution                                                                  */
/* -------------------------------------------------------------------------- */

export function toExecutionStep(row: ExecutionStepRow): ExecutionStep {
  return {
    id: row.id,
    executionId: row.executionId,
    nodeId: row.nodeKey,
    agentType: toAgentType(row.agentType),
    label: row.label,
    status: toStepStatus(row.status),
    layer: row.layer,
    attempts: row.attempts,
    retries: row.retries,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    systemPrompt: row.systemPrompt,
    prompt: row.prompt,
    response: row.response,
    usage: {
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      totalTokens: row.totalTokens,
    },
    costUsd: row.costUsd,
    confidence: row.confidence,
    provider: toProviderId(row.provider),
    model: row.model,
    error: row.error,
    skipReason: row.skipReason,
  };
}

export function toExecutionMetrics(row: ExecutionRow, steps: ExecutionStep[]): ExecutionMetrics {
  return {
    totalDurationMs: row.durationMs,
    totalAgentTimeMs: steps.reduce((total, step) => total + step.durationMs, 0),
    totalTokens: row.totalTokens,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalCostUsd: row.totalCostUsd,
    successRate: row.successRate,
    averageConfidence: row.averageConfidence,
    averageLatencyMs: row.averageLatencyMs,
    nodeCount: row.nodeCount,
    edgeCount: row.edgeCount,
    layerCount: row.layerCount,
    executedCount: steps.filter((s) => s.status !== 'skipped' && s.status !== 'pending').length,
    failedCount: steps.filter((s) => s.status === 'failed').length,
    skippedCount: steps.filter((s) => s.status === 'skipped').length,
    retryCount: row.retryCount,
    parallelizationScore: row.parallelizationScore,
    complexityScore: row.complexityScore,
  };
}

export type ExecutionWithSteps = ExecutionRow & { steps: ExecutionStepRow[] };

/**
 * Rebuild the attachment from its columns.
 *
 * The name is the discriminator: a run either had a document or it didn't, and
 * a row with a name but no text would mean extraction succeeded and the text
 * was lost, which nothing in the write path can produce.
 */
function toRunDocument(row: ExecutionRow): RunDocument | null {
  if (!row.documentName || !row.documentText) return null;

  return {
    name: row.documentName,
    text: row.documentText,
    pages: row.documentPages,
    truncated: row.documentTruncated,
  };
}

export function toExecutionResult(row: ExecutionWithSteps): ExecutionResult {
  const steps = row.steps.map(toExecutionStep);
  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowName: row.workflowName,
    task: row.task,
    document: toRunDocument(row),
    status: toExecutionStatus(row.status),
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    steps,
    metrics: toExecutionMetrics(row, steps),
    error: row.error,
  };
}

export function toExecutionSummary(
  row: ExecutionRow & { _count?: { steps: number } },
): ExecutionSummary {
  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowName: row.workflowName,
    task: row.task,
    status: toExecutionStatus(row.status),
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    totalTokens: row.totalTokens,
    totalCostUsd: row.totalCostUsd,
    successRate: row.successRate,
    averageConfidence: row.averageConfidence,
    stepCount: row._count?.steps ?? row.nodeCount,
  };
}

/* -------------------------------------------------------------------------- */
/* Agent configuration                                                        */
/* -------------------------------------------------------------------------- */

export function toAgentConfig(row: AgentConfigurationRow): AgentConfig {
  return {
    id: row.id,
    type: toAgentType(row.agentType),
    name: row.name,
    description: row.description,
    systemPrompt: row.systemPrompt,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    // NULL means "inherit the env default" — only a stored value pins it.
    ...(row.provider ? { provider: toProviderId(row.provider) } : {}),
    ...(row.model ? { model: row.model } : {}),
    estimatedCostUsd: row.estimatedCostUsd,
    estimatedLatencyMs: row.estimatedLatencyMs,
  };
}
