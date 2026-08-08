import type { ModelPricing, ProviderId, TokenUsage } from '@/types/provider';

/**
 * Published list prices in USD per 1M tokens.
 *
 * Kept in one table so cost accounting is auditable and a price change is a
 * one-line edit rather than a hunt through the codebase.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gpt-4.1': { inputPerMillion: 2, outputPerMillion: 8 },
  'gpt-4.1-mini': { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  'gpt-4.1-nano': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'o4-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },

  // Anthropic
  'claude-opus-5': { inputPerMillion: 5, outputPerMillion: 25 },
  'claude-opus-4-8': { inputPerMillion: 5, outputPerMillion: 25 },
  'claude-sonnet-5': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-sonnet-4-6': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-sonnet-4-5': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-haiku-4-5': { inputPerMillion: 1, outputPerMillion: 5 },

  // Google (Vertex AI)
  'gemini-2.5-flash': { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  // Confirmed against the published Vertex rates (2026-08-08). 3.6 Flash is a
  // tier above 2.5 Flash, not the same price — every cost figure reported for a
  // Google run comes from this row, so it is checked rather than inherited.
  'gemini-3.6-flash': { inputPerMillion: 0.75, outputPerMillion: 3.75 },

  // Mock — priced like a small hosted model so demo numbers stay believable.
  'mock-sim-1': { inputPerMillion: 0.2, outputPerMillion: 0.8 },
};

/** Used when a model isn't in the table, so cost is never silently zero. */
export const FALLBACK_PRICING: ModelPricing = { inputPerMillion: 1, outputPerMillion: 4 };

export function getPricing(model: string): ModelPricing {
  return MODEL_PRICING[model] ?? FALLBACK_PRICING;
}

export function calculateCost(usage: TokenUsage, model: string): number {
  const pricing = getPricing(model);
  const input = (usage.promptTokens / 1_000_000) * pricing.inputPerMillion;
  const output = (usage.completionTokens / 1_000_000) * pricing.outputPerMillion;
  return input + output;
}

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  mock: 'mock-sim-1',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-opus-5',
  google: 'gemini-3.6-flash',
};

/**
 * Models that reject `temperature` / `top_p` / `top_k`.
 *
 * The current Anthropic frontier models removed sampling parameters — sending
 * one is a 400, not a silently ignored field. Agent configs here all carry a
 * temperature, so the provider has to drop it for these models rather than
 * forward it blindly.
 */
const NO_SAMPLING_PARAMS = [
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-sonnet-5',
  'claude-fable-5',
  'claude-mythos-5',
];

export function acceptsSamplingParams(model: string): boolean {
  return !NO_SAMPLING_PARAMS.some((prefix) => model.startsWith(prefix));
}

/**
 * Models where thinking is on by default and shares the output-token budget
 * with the visible response.
 *
 * An agent asking for 1,400 tokens can otherwise spend most of them thinking
 * and return a truncated answer, so the provider raises a floor for these.
 *
 * Note this is a *different* property from `acceptsSamplingParams`: Gemini
 * takes a temperature happily but still bills thinking against
 * `maxOutputTokens`, which was verified against Vertex — a 1,400-token Planner
 * came back truncated with `thoughtsTokenCount` eating the budget.
 */
const THINKING_BUDGET_MODELS = [...NO_SAMPLING_PARAMS, 'gemini-2.5', 'gemini-3'];

export function usesThinkingBudget(model: string): boolean {
  return THINKING_BUDGET_MODELS.some((prefix) => model.startsWith(prefix));
}
