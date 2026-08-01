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

/**
 * Ceiling on extracted document text, in characters — roughly 60k tokens, or a
 * 100-page agreement. Every node in the graph receives the document, so this
 * number is multiplied by the node count on each run: it is a cost control as
 * much as a payload limit.
 */
export const MAX_DOCUMENT_CHARS = 240_000;

export const agentConfigSchema = z.object({
  id: z.string().min(1),
  type: agentTypeSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(500),
  systemPrompt: z.string().min(1),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(64).max(32_000),
  /**
   * Pins this agent to a specific provider. Left unset — the normal case — the
   * agent inherits `DEFAULT_LLM_PROVIDER`, which is what makes the env switch
   * actually govern runs rather than merely label them.
   */
  provider: providerIdSchema.optional(),
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

/**
 * A document attached to a run, already reduced to text.
 *
 * Extraction happens once, at upload, rather than per node: the text is what
 * gets stored, replayed into every prompt, and shown in the report, so the
 * original file never has to be kept or re-parsed. Defined here, at the deepest
 * layer that consumes it, and re-exported for the API and UI.
 */
export const runDocumentSchema = z.object({
  name: z.string().min(1).max(200),
  text: z.string().min(1).max(MAX_DOCUMENT_CHARS),
  /** Pages the extractor saw. 0 when the source has no page concept. */
  pages: z.number().int().nonnegative(),
  /** True when the source was longer than `MAX_DOCUMENT_CHARS`. */
  truncated: z.boolean(),
});
export type RunDocument = z.infer<typeof runDocumentSchema>;

export interface AgentExecutionInput {
  /** The workflow-level task the user typed. */
  task: string;
  /** Attached source material, replayed into every node's prompt. */
  document?: RunDocument | null;
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
