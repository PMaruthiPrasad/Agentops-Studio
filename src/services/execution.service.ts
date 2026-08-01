import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { stringifyJsonColumn } from '@/lib/serialization';
import { toErrorMessage } from '@/lib/utils';
import {
  createDefaultDependencies,
  executeWorkflow,
  type EngineRunResult,
} from '@/lib/workflow/executor';
import { WorkflowValidationError } from '@/lib/workflow/validate';
import { TopologyError } from '@/lib/workflow/topology';
import type { RunDocument } from '@/types/agent';
import type {
  ExecutionEvent,
  ExecutionResult,
  ExecutionStep,
  ExecutionSummary,
} from '@/types/execution';
import type { WorkflowGraph } from '@/types/workflow';
import type { ListExecutionsQuery, StartExecutionInput } from '@/types/api';
import { ServiceError } from './errors';
import { executionBus } from './execution-bus';
import { toExecutionResult, toExecutionSummary, type ExecutionWithSteps } from './mappers';
import { getWorkflow } from './workflow.service';

/**
 * Execution orchestration.
 *
 * Responsibilities, in order:
 *   1. Resolve the graph to run (saved, or the canvas override).
 *   2. Create the `Execution` row up front, so a run is inspectable while it is
 *      still in flight and survives a crash as a `running` record rather than
 *      vanishing.
 *   3. Hand off to the engine, relaying its events to the bus (for SSE) and to
 *      the database (for durability).
 *   4. Write the aggregate metrics when it finishes.
 *
 * `startExecution` returns as soon as the row exists — the run itself continues
 * in the background. The client subscribes to the SSE stream for progress.
 */

export interface StartedExecution {
  executionId: string;
  /** Resolves when the run finishes. Awaited by scripts and tests, not by routes. */
  completion: Promise<ExecutionResult>;
}

export async function startExecution(input: StartExecutionInput): Promise<StartedExecution> {
  const workflow = await getWorkflow(input.workflowId);
  const graph = input.graphOverride ?? workflow.graph;

  if (graph.nodes.length === 0) {
    throw ServiceError.badRequest(
      'This workflow has no agents. Add at least one node before running.',
    );
  }

  const env = getEnv();

  const execution = await prisma.execution.create({
    data: {
      workflowId: workflow.id,
      workflowName: workflow.name,
      task: input.task,
      status: 'running',
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      graphSnapshot: stringifyJsonColumn(graph),
      // Persisted up front, with the graph snapshot, so a run stays readable
      // even if it fails half way — the report should always be able to show
      // what the agents were given.
      documentName: input.document?.name ?? null,
      documentText: input.document?.text ?? null,
      documentPages: input.document?.pages ?? 0,
      documentTruncated: input.document?.truncated ?? false,
    },
  });

  const completion = runAndPersist({
    executionId: execution.id,
    workflowId: workflow.id,
    workflowName: workflow.name,
    task: input.task,
    document: input.document ?? null,
    graph,
    maxConcurrency: input.maxConcurrency ?? env.ENGINE_MAX_CONCURRENCY,
    maxAttempts: env.ENGINE_MAX_ATTEMPTS,
    nodeTimeoutMs: env.ENGINE_NODE_TIMEOUT_MS,
  });

  // The route does not await this; surface failures rather than letting an
  // unhandled rejection take the process down.
  completion.catch(() => undefined);

  return { executionId: execution.id, completion };
}

interface RunArgs {
  executionId: string;
  workflowId: string;
  workflowName: string;
  task: string;
  document: RunDocument | null;
  graph: WorkflowGraph;
  maxConcurrency: number;
  maxAttempts: number;
  nodeTimeoutMs: number;
}

async function runAndPersist(args: RunArgs): Promise<ExecutionResult> {
  // Steps are persisted as they land so a long run is inspectable mid-flight.
  // Writes are queued rather than awaited inline, keeping DB latency off the
  // engine's critical path while still guaranteeing ordering.
  const writes: Array<Promise<unknown>> = [];
  let sequence = 0;

  const emit = (event: ExecutionEvent): void => {
    executionBus.publish(event);

    if (event.type === 'step.finish') {
      const order = sequence;
      sequence += 1;
      writes.push(persistStep(args.executionId, event.step, order));
    }
  };

  const deps = createDefaultDependencies(emit);

  let result: EngineRunResult;

  try {
    result = await executeWorkflow(
      {
        executionId: args.executionId,
        workflowId: args.workflowId,
        workflowName: args.workflowName,
        task: args.task,
        document: args.document,
        graph: args.graph,
        maxConcurrency: args.maxConcurrency,
        maxAttempts: args.maxAttempts,
        nodeTimeoutMs: args.nodeTimeoutMs,
      },
      deps,
    );
  } catch (error) {
    const message = toErrorMessage(error);

    await prisma.execution.update({
      where: { id: args.executionId },
      data: { status: 'failed', error: message, completedAt: new Date() },
    });

    executionBus.publish({ type: 'run.error', executionId: args.executionId, error: message });

    if (error instanceof WorkflowValidationError || error instanceof TopologyError) {
      throw ServiceError.validation(message);
    }
    throw ServiceError.engine(message);
  }

  // Let every queued step write land before the aggregates are written.
  await Promise.allSettled(writes);

  const { metrics } = result;

  await prisma.execution.update({
    where: { id: args.executionId },
    data: {
      status: result.status,
      completedAt: new Date(result.completedAt),
      durationMs: metrics.totalDurationMs,
      totalTokens: metrics.totalTokens,
      promptTokens: metrics.promptTokens,
      completionTokens: metrics.completionTokens,
      totalCostUsd: metrics.totalCostUsd,
      successRate: metrics.successRate,
      averageConfidence: metrics.averageConfidence,
      averageLatencyMs: metrics.averageLatencyMs,
      layerCount: metrics.layerCount,
      retryCount: metrics.retryCount,
      parallelizationScore: metrics.parallelizationScore,
      complexityScore: metrics.complexityScore,
      error: result.error,
    },
  });

  return getExecution(args.executionId);
}

async function persistStep(
  executionId: string,
  step: ExecutionStep,
  sequence: number,
): Promise<void> {
  try {
    await prisma.executionStep.create({
      data: {
        executionId,
        nodeKey: step.nodeId,
        agentType: step.agentType,
        label: step.label,
        status: step.status,
        layer: step.layer,
        sequence,
        attempts: step.attempts,
        retries: step.retries,
        startedAt: step.startedAt ? new Date(step.startedAt) : null,
        completedAt: step.completedAt ? new Date(step.completedAt) : null,
        durationMs: step.durationMs,
        systemPrompt: step.systemPrompt,
        prompt: step.prompt,
        response: step.response,
        promptTokens: step.usage.promptTokens,
        completionTokens: step.usage.completionTokens,
        totalTokens: step.usage.totalTokens,
        costUsd: step.costUsd,
        confidence: step.confidence,
        provider: step.provider,
        model: step.model,
        error: step.error,
        skipReason: step.skipReason,
      },
    });
  } catch (error) {
    // A failed step write must not abort the run — the engine's in-memory
    // result is still correct and gets reported.
    console.error(`[execution] failed to persist step ${step.nodeId}:`, toErrorMessage(error));
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function getExecution(id: string): Promise<ExecutionResult> {
  const row = await prisma.execution.findUnique({
    where: { id },
    include: { steps: { orderBy: [{ layer: 'asc' }, { sequence: 'asc' }] } },
  });
  if (!row) throw ServiceError.notFound('Execution', id);
  return toExecutionResult(row as ExecutionWithSteps);
}

export async function listExecutions(query: ListExecutionsQuery): Promise<ExecutionSummary[]> {
  const where: Prisma.ExecutionWhereInput = {};
  if (query.workflowId) where.workflowId = query.workflowId;
  if (query.status) where.status = query.status;

  const rows = await prisma.execution.findMany({
    where,
    include: { _count: { select: { steps: true } } },
    orderBy: { startedAt: 'desc' },
    take: query.limit,
    skip: query.offset,
  });

  return rows.map(toExecutionSummary);
}

export async function deleteExecution(id: string): Promise<void> {
  const existing = await prisma.execution.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw ServiceError.notFound('Execution', id);
  await prisma.execution.delete({ where: { id } });
}

/** True once the run has reached a terminal state in the database. */
export async function isExecutionComplete(id: string): Promise<boolean> {
  const row = await prisma.execution.findUnique({ where: { id }, select: { status: true } });
  if (!row) return false;
  return row.status !== 'running' && row.status !== 'pending';
}
