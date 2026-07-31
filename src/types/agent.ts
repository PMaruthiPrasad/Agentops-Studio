import { z } from 'zod';
import { providerIdSchema, tokenUsageSchema, type TokenUsage, type ProviderId } from './provider';

/**
 * The reusable agent taxonomy. Adding a type here is the only change needed to
 * surface a new agent in the palette, the engine, and the optimizer.
 */
export const AGENT_TYPES = [
  'planner',
  'researcher',
  'retriever',
  'knowledge',
  'coder',
  'reviewer',
  'critic',
  'tester',
  'legal_validator',
  'custom',
] as const;

export const agentTypeSchema = z.enum(AGENT_TYPES);
export type AgentType = z.infer<typeof agentTypeSchema>;

export const agentConfigSchema = z.object({
  id: z.string().min(1),
  type: agentTypeSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(500),
  systemPrompt: z.string().min(1),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(64).max(32_000),
  provider: providerIdSchema,
  model: z.string().min(1).optional(),
  /** Rough per-invocation cost used for pre-run projections in the optimizer. */
  estimatedCostUsd: z.number().nonnegative(),
  /** Rough per-invocation latency used for pre-run projections. */
  estimatedLatencyMs: z.number().int().nonnegative(),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

/** Output of one upstream node, handed to the next agent in the graph. */
export interface UpstreamOutput {
  nodeId: string;
  agentType: AgentType;
  label: string;
  output: string;
  confidence: number;
}

export interface AgentExecutionInput {
  /** The workflow-level task the user typed. */
  task: string;
  upstream: UpstreamOutput[];
  nodeId: string;
  nodeLabel: string;
  attempt: number;
  signal?: AbortSignal;
}

export interface AgentExecutionResult {
  output: string;
  /** Agent-specific parsed payload (subtasks, findings, risks, …). */
  structured: Record<string, unknown>;
  systemPrompt: string;
  userPrompt: string;
  usage: TokenUsage;
  costUsd: number;
  confidence: number;
  latencyMs: number;
  provider: ProviderId;
  model: string;
}

/** Persisted, user-editable defaults for an agent type. */
export const agentConfigurationRecordSchema = agentConfigSchema.extend({
  isBuiltIn: z.boolean(),
});
export type AgentConfigurationRecord = z.infer<typeof agentConfigurationRecordSchema>;

export const agentUsageSchema = tokenUsageSchema;
