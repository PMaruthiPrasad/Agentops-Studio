import { z } from 'zod';
import { agentTypeSchema, type AgentType, type RunDocument } from './agent';

export type { RunDocument };
import { providerIdSchema, tokenUsageSchema } from './provider';

export const EXECUTION_STATUSES = [
  'pending',
  'running',
  'success',
  'partial',
  'failed',
  'cancelled',
] as const;
export const executionStatusSchema = z.enum(EXECUTION_STATUSES);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

export const STEP_STATUSES = [
  'pending',
  'running',
  'success',
  'failed',
  'skipped',
  'cancelled',
] as const;
export const stepStatusSchema = z.enum(STEP_STATUSES);
export type StepStatus = z.infer<typeof stepStatusSchema>;

/** One node's execution record. This is the unit engineers actually debug. */
export const executionStepSchema = z.object({
  id: z.string(),
  executionId: z.string(),
  nodeId: z.string(),
  agentType: agentTypeSchema,
  label: z.string(),
  status: stepStatusSchema,
  /** Topological layer — every step sharing a layer ran in parallel. */
  layer: z.number().int().nonnegative(),
  /** Attempts actually made (1 means it succeeded first try). */
  attempts: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  systemPrompt: z.string(),
  prompt: z.string(),
  response: z.string(),
  usage: tokenUsageSchema,
  costUsd: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  provider: providerIdSchema,
  model: z.string(),
  error: z.string().nullable(),
  /** Human-readable reason a step was skipped by a branch condition. */
  skipReason: z.string().nullable(),
});
export type ExecutionStep = z.infer<typeof executionStepSchema>;

/**
 * Aggregate run metrics. Every number the analytics dashboard shows is
 * computed here rather than in a component.
 */
export interface ExecutionMetrics {
  totalDurationMs: number;
  /** Sum of each step's own duration — exceeds wall clock when steps ran in parallel. */
  totalAgentTimeMs: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCostUsd: number;
  successRate: number;
  averageConfidence: number;
  averageLatencyMs: number;
  nodeCount: number;
  edgeCount: number;
  layerCount: number;
  executedCount: number;
  failedCount: number;
  skippedCount: number;
  retryCount: number;
  /** 0..1 — how much wall-clock the graph saves versus running everything serially. */
  parallelizationScore: number;
  /** 0..1 — normalised structural complexity (nodes, edges, branching, depth). */
  complexityScore: number;
}

export interface ExecutionResult {
  id: string;
  workflowId: string;
  workflowName: string;
  task: string;
  /** Document the run was given, as extracted text. Null when none was attached. */
  document: RunDocument | null;
  status: ExecutionStatus;
  startedAt: string;
  completedAt: string | null;
  steps: ExecutionStep[];
  metrics: ExecutionMetrics;
  error: string | null;
}

export interface ExecutionSummary {
  id: string;
  workflowId: string;
  workflowName: string;
  task: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number;
  totalTokens: number;
  totalCostUsd: number;
  successRate: number;
  averageConfidence: number;
  stepCount: number;
}

/* -------------------------------------------------------------------------- */
/* Live events                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Emitted by the engine and relayed to the browser over SSE. The canvas
 * animates directly off these, so they carry everything a node badge needs.
 */
export type ExecutionEvent =
  | { type: 'run.start'; executionId: string; workflowId: string; task: string; layers: string[][] }
  | { type: 'step.start'; executionId: string; nodeId: string; layer: number; attempt: number }
  | {
      type: 'step.retry';
      executionId: string;
      nodeId: string;
      attempt: number;
      error: string;
      backoffMs: number;
    }
  | { type: 'step.finish'; executionId: string; nodeId: string; step: ExecutionStep }
  | { type: 'step.skip'; executionId: string; nodeId: string; reason: string }
  | {
      type: 'run.finish';
      executionId: string;
      status: ExecutionStatus;
      metrics: ExecutionMetrics;
      error: string | null;
    }
  | { type: 'run.error'; executionId: string; error: string };

export type ExecutionEventType = ExecutionEvent['type'];

/** Node-level view model the canvas keeps in memory during a live run. */
export interface LiveNodeState {
  nodeId: string;
  status: StepStatus;
  attempt: number;
  durationMs: number;
  costUsd: number;
  totalTokens: number;
  confidence: number;
  error: string | null;
}

export interface AgentPerformance {
  agentType: AgentType;
  label: string;
  runs: number;
  averageLatencyMs: number;
  totalCostUsd: number;
  averageCostUsd: number;
  totalTokens: number;
  successRate: number;
  averageConfidence: number;
}

export interface AnalyticsOverview {
  workflowCount: number;
  executionCount: number;
  stepCount: number;
  totalCostUsd: number;
  totalTokens: number;
  averageLatencyMs: number;
  averageCostUsd: number;
  averageConfidence: number;
  successRate: number;
  averageComplexity: number;
  averageParallelization: number;
  averageAgentCount: number;
}

export interface TimelinePoint {
  date: string;
  executions: number;
  averageLatencyMs: number;
  totalCostUsd: number;
  totalTokens: number;
  successRate: number;
}

export interface AnalyticsPayload {
  overview: AnalyticsOverview;
  agents: AgentPerformance[];
  timeline: TimelinePoint[];
  recentExecutions: ExecutionSummary[];
  statusBreakdown: Array<{ status: ExecutionStatus; count: number }>;
}
