import {
  ProviderError,
  type LLMCompletionRequest,
  type LLMCompletionResponse,
  type LLMProvider,
  type ProviderId,
  type TokenUsage,
} from '@/types/provider';
import { getEnv } from '@/lib/env';
import { sleep } from '@/lib/utils';
import { calculateCost, DEFAULT_MODELS } from './pricing';
import { buildUsage } from './tokens';
import { createSeededRandom, hashString } from './mock/random';
import { generateMockContent } from './mock/templates';

export interface MockProviderOptions {
  /** Multiplies simulated latency. 0 = instant (tests). */
  latencyFactor?: number;
  /** Probability in [0,1] that a call throws a retryable error. */
  failureRate?: number;
  model?: string;
}

/**
 * The default provider. Produces agent-shaped output with realistic latency,
 * token accounting, cost, and an occasional transient failure so the retry path
 * in the engine is exercised rather than merely implemented.
 *
 * Everything is derived from a seed built out of the request, so a given
 * request always yields the same response — the UI looks alive, the tests stay
 * deterministic.
 */
export class MockProvider implements LLMProvider {
  readonly id: ProviderId = 'mock';
  readonly name = 'Mock (simulated)';
  readonly defaultModel: string;

  private readonly latencyFactor: number;
  private readonly failureRate: number;

  constructor(options: MockProviderOptions = {}) {
    const env = getEnv();
    this.defaultModel = options.model ?? DEFAULT_MODELS.mock;
    this.latencyFactor = options.latencyFactor ?? env.MOCK_LATENCY_FACTOR;
    this.failureRate = options.failureRate ?? env.MOCK_FAILURE_RATE;
  }

  /** Always true — that is the entire point of this provider. */
  isAvailable(): boolean {
    return true;
  }

  estimateCost(usage: TokenUsage, model?: string): number {
    return calculateCost(usage, model ?? this.defaultModel);
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const model = request.model ?? this.defaultModel;
    const context = request.context;

    // Seed from the semantic content of the request. The attempt number is part
    // of the seed so a retry produces a *different* draw — otherwise a failing
    // request would fail identically forever.
    const seed = hashString(
      [
        context?.agentType ?? 'custom',
        context?.nodeId ?? 'node',
        context?.task ?? '',
        request.systemPrompt,
        request.userPrompt,
        String(context?.attempt ?? 1),
        request.temperature.toFixed(2),
      ].join('|'),
    );
    const rng = createSeededRandom(seed);

    const content = generateMockContent(
      context ?? {
        agentType: 'custom',
        agentName: 'Custom Agent',
        nodeId: 'node',
        nodeLabel: 'Custom Agent',
        task: request.userPrompt,
        upstream: [],
        attempt: 1,
      },
      rng,
    );

    // Respect maxTokens the way a real API would: truncate and report `length`.
    const usageBeforeCap = buildUsage(
      `${request.systemPrompt}\n${request.userPrompt}`,
      content,
    );
    const overBudget = usageBeforeCap.completionTokens > request.maxTokens;
    const finalContent = overBudget
      ? `${content.slice(0, Math.floor(content.length * (request.maxTokens / usageBeforeCap.completionTokens)))}\n\n_[truncated: hit maxTokens=${request.maxTokens}]_`
      : content;

    const usage = buildUsage(`${request.systemPrompt}\n${request.userPrompt}`, finalContent);

    // Latency scales with output size plus a fixed "time to first token".
    const baseLatency = 180 + usage.completionTokens * rng.float(1.4, 3.1);
    const jitter = rng.float(0.82, 1.35);
    const latencyMs = Math.round(baseLatency * jitter * this.latencyFactor);

    await sleep(latencyMs, request.signal);

    if (request.signal?.aborted) {
      throw new ProviderError('Request aborted', this.id, false);
    }

    // Simulated transient failure. Drawn *after* the sleep so a failing call
    // still costs wall-clock time, like a real timeout would.
    if (rng.next() < this.failureRate) {
      throw new ProviderError(
        `Simulated upstream failure (503) from mock provider on attempt ${context?.attempt ?? 1}`,
        this.id,
        true,
      );
    }

    // Higher temperature widens the confidence spread and lowers its floor —
    // the same directional effect you see with real sampling.
    const spread = 0.10 + request.temperature * 0.09;
    const confidence = Math.min(
      0.99,
      Math.max(0.35, rng.float(0.88 - spread, 0.97 - spread * 0.35)),
    );

    return {
      content: finalContent,
      usage,
      model,
      provider: this.id,
      finishReason: overBudget ? 'length' : 'stop',
      confidence: Number(confidence.toFixed(3)),
      latencyMs,
      costUsd: this.estimateCost(usage, model),
    };
  }
}
