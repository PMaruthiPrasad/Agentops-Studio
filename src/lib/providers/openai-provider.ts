import OpenAI from 'openai';
import {
  ProviderError,
  type LLMCompletionRequest,
  type LLMCompletionResponse,
  type LLMProvider,
  type ProviderId,
  type TokenUsage,
} from '@/types/provider';
import { getEnv } from '@/lib/env';
import { calculateCost, DEFAULT_MODELS } from './pricing';
import { buildUsage } from './tokens';

/**
 * Real OpenAI integration. Only ever selected when `OPENAI_API_KEY` is set;
 * the registry silently falls back to the mock provider otherwise, which is
 * what lets the app run with no configuration at all.
 */
export class OpenAIProvider implements LLMProvider {
  readonly id: ProviderId = 'openai';
  readonly name = 'OpenAI';
  readonly defaultModel: string;

  private readonly apiKey: string | undefined;
  private readonly baseURL: string | undefined;
  private client: OpenAI | null = null;

  constructor(options: { apiKey?: string; baseURL?: string; model?: string } = {}) {
    const env = getEnv();
    this.apiKey = options.apiKey ?? env.OPENAI_API_KEY;
    this.baseURL = options.baseURL ?? env.OPENAI_BASE_URL;
    this.defaultModel = options.model ?? env.OPENAI_DEFAULT_MODEL ?? DEFAULT_MODELS.openai;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  estimateCost(usage: TokenUsage, model?: string): number {
    return calculateCost(usage, model ?? this.defaultModel);
  }

  private getClient(): OpenAI {
    if (!this.apiKey) {
      throw new ProviderError('OPENAI_API_KEY is not configured', this.id, false);
    }
    this.client ??= new OpenAI({
      apiKey: this.apiKey,
      ...(this.baseURL ? { baseURL: this.baseURL } : {}),
      maxRetries: 0, // The engine owns retry policy; don't double-retry.
    });
    return this.client;
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const model = request.model ?? this.defaultModel;
    const startedAt = Date.now();

    try {
      const completion = await this.getClient().chat.completions.create(
        {
          model,
          temperature: request.temperature,
          max_completion_tokens: request.maxTokens,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt },
          ],
        },
        { signal: request.signal },
      );

      const choice = completion.choices[0];
      const content = choice?.message?.content ?? '';

      if (!content) {
        throw new ProviderError('OpenAI returned an empty completion', this.id, true);
      }

      // Prefer the API's own accounting; fall back to estimation only if absent.
      const usage: TokenUsage = completion.usage
        ? {
            promptTokens: completion.usage.prompt_tokens,
            completionTokens: completion.usage.completion_tokens,
            totalTokens: completion.usage.total_tokens,
          }
        : buildUsage(`${request.systemPrompt}\n${request.userPrompt}`, content);

      const finishReason = choice?.finish_reason;

      return {
        content,
        usage,
        model: completion.model || model,
        provider: this.id,
        finishReason: finishReason === 'length' ? 'length' : 'stop',
        confidence: deriveConfidence(finishReason, content),
        latencyMs: Date.now() - startedAt,
        costUsd: this.estimateCost(usage, completion.model || model),
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        `OpenAI request failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        isRetryable(error),
        error,
      );
    }
  }
}

/**
 * No API exposes a confidence score, so we derive a defensible proxy: a clean
 * stop with a substantive body scores high, a truncated or terse response
 * scores lower. Documented as a heuristic rather than dressed up as a metric.
 */
function deriveConfidence(finishReason: string | null | undefined, content: string): number {
  let confidence = finishReason === 'stop' ? 0.9 : 0.62;
  if (content.length < 200) confidence -= 0.12;
  if (content.length > 1_200) confidence += 0.04;
  if (/\b(unclear|unsure|cannot determine|insufficient information)\b/i.test(content)) {
    confidence -= 0.2;
  }
  return Number(Math.min(0.99, Math.max(0.2, confidence)).toFixed(3));
}

function isRetryable(error: unknown): boolean {
  if (error instanceof OpenAI.APIError) {
    // 4xx other than 408/429 are caller errors — retrying just burns budget.
    if (error.status === undefined) return true;
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return true;
}
