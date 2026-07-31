import { z } from 'zod';

/**
 * Provider-facing contracts.
 *
 * Nothing in this file knows about React, Next, or Prisma — the provider layer
 * is plain TypeScript so it can be unit-tested and reused outside the app.
 */

export const PROVIDER_IDS = ['mock', 'openai', 'anthropic'] as const;

export const providerIdSchema = z.enum(PROVIDER_IDS);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const tokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const EMPTY_USAGE: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

export type FinishReason = 'stop' | 'length' | 'content_filter' | 'error';

/**
 * Extra context handed to the provider. Real providers ignore it; the mock
 * provider uses it to synthesise output that actually looks like the agent
 * in question produced it.
 */
export interface CompletionContext {
  agentType: string;
  agentName: string;
  nodeId: string;
  nodeLabel: string;
  /** The end-user task driving the whole workflow run. */
  task: string;
  /** Rendered summaries of upstream node outputs, oldest first. */
  upstream: Array<{ nodeId: string; agentType: string; label: string; output: string }>;
  attempt: number;
}

export interface LLMCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  /** Overrides the provider's default model when supplied. */
  model?: string;
  context?: CompletionContext;
  signal?: AbortSignal;
}

export interface LLMCompletionResponse {
  content: string;
  usage: TokenUsage;
  model: string;
  provider: ProviderId;
  finishReason: FinishReason;
  /**
   * 0..1 self-reported confidence. Real providers derive it from finish reason
   * and response shape; the mock provider derives it from a seeded PRNG.
   */
  confidence: number;
  latencyMs: number;
  costUsd: number;
}

/**
 * The single seam every LLM integration implements. Swapping providers is a
 * registry lookup — no call site changes.
 */
export interface LLMProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly defaultModel: string;

  /** True when the provider has the credentials/config it needs to run. */
  isAvailable(): boolean;

  complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse>;

  /** Cost in USD for the given usage on the given model. */
  estimateCost(usage: TokenUsage, model?: string): number;
}

/** Per-1M-token pricing, matching how vendors publish their rates. */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: ProviderId,
    readonly retryable: boolean = true,
    // `Error` already declares `cause` under the ES2022 lib.
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
