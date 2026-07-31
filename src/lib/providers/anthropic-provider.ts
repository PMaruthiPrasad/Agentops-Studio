import Anthropic from '@anthropic-ai/sdk';
import {
  ProviderError,
  type LLMCompletionRequest,
  type LLMCompletionResponse,
  type LLMProvider,
  type ProviderId,
  type TokenUsage,
} from '@/types/provider';
import { getEnv } from '@/lib/env';
import {
  acceptsSamplingParams,
  calculateCost,
  DEFAULT_MODELS,
  usesThinkingBudget,
} from './pricing';
import { buildUsage } from './tokens';

/**
 * Real Anthropic integration. Selected only when `ANTHROPIC_API_KEY` is set.
 *
 * Note the shape difference from OpenAI: the system prompt is a top-level
 * parameter rather than a message, and content comes back as a block array.
 * Normalising that here is exactly why the `LLMProvider` seam exists.
 */
/** Headroom so thinking tokens can't crowd out a short agent response. */
const THINKING_TOKEN_FLOOR = 8_000;

export class AnthropicProvider implements LLMProvider {
  readonly id: ProviderId = 'anthropic';
  readonly name = 'Anthropic';
  readonly defaultModel: string;

  private readonly apiKey: string | undefined;
  private readonly baseURL: string | undefined;
  private client: Anthropic | null = null;

  constructor(options: { apiKey?: string; baseURL?: string; model?: string } = {}) {
    const env = getEnv();
    this.apiKey = options.apiKey ?? env.ANTHROPIC_API_KEY;
    this.baseURL = options.baseURL ?? env.ANTHROPIC_BASE_URL;
    this.defaultModel = options.model ?? env.ANTHROPIC_DEFAULT_MODEL ?? DEFAULT_MODELS.anthropic;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  estimateCost(usage: TokenUsage, model?: string): number {
    return calculateCost(usage, model ?? this.defaultModel);
  }

  private getClient(): Anthropic {
    if (!this.apiKey) {
      throw new ProviderError('ANTHROPIC_API_KEY is not configured', this.id, false);
    }
    this.client ??= new Anthropic({
      apiKey: this.apiKey,
      ...(this.baseURL ? { baseURL: this.baseURL } : {}),
      maxRetries: 0, // The engine owns retry policy.
    });
    return this.client;
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const model = request.model ?? this.defaultModel;
    const startedAt = Date.now();

    // Current frontier models reject sampling parameters outright, and think
    // out of the same `max_tokens` budget as the reply — so a node's requested
    // temperature is dropped and its token ceiling floored rather than passed
    // through as-is. Older models keep the original behaviour.
    const maxTokens = usesThinkingBudget(model)
      ? Math.max(request.maxTokens, THINKING_TOKEN_FLOOR)
      : request.maxTokens;

    try {
      const message = await this.getClient().messages.create(
        {
          model,
          max_tokens: maxTokens,
          ...(acceptsSamplingParams(model) ? { temperature: request.temperature } : {}),
          system: request.systemPrompt,
          messages: [{ role: 'user', content: request.userPrompt }],
        },
        { signal: request.signal },
      );

      const content = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();

      if (!content) {
        throw new ProviderError('Anthropic returned an empty completion', this.id, true);
      }

      const usage: TokenUsage = message.usage
        ? {
            promptTokens: message.usage.input_tokens,
            completionTokens: message.usage.output_tokens,
            totalTokens: message.usage.input_tokens + message.usage.output_tokens,
          }
        : buildUsage(`${request.systemPrompt}\n${request.userPrompt}`, content);

      return {
        content,
        usage,
        model: message.model || model,
        provider: this.id,
        finishReason: message.stop_reason === 'max_tokens' ? 'length' : 'stop',
        confidence: deriveConfidence(message.stop_reason, content),
        latencyMs: Date.now() - startedAt,
        costUsd: this.estimateCost(usage, message.model || model),
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        `Anthropic request failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        isRetryable(error),
        error,
      );
    }
  }
}

/** Same heuristic as the OpenAI provider — see the note there. */
function deriveConfidence(stopReason: string | null | undefined, content: string): number {
  let confidence = stopReason === 'end_turn' ? 0.91 : 0.63;
  if (content.length < 200) confidence -= 0.12;
  if (content.length > 1_200) confidence += 0.04;
  if (/\b(unclear|unsure|cannot determine|insufficient information)\b/i.test(content)) {
    confidence -= 0.2;
  }
  return Number(Math.min(0.99, Math.max(0.2, confidence)).toFixed(3));
}

function isRetryable(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    if (error.status === undefined) return true;
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return true;
}
