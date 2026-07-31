import { describe, expect, it } from 'vitest';
import {
  acceptsSamplingParams,
  calculateCost,
  DEFAULT_MODELS,
  FALLBACK_PRICING,
  getPricing,
  MODEL_PRICING,
  usesThinkingBudget,
} from './pricing';
import { PROVIDER_IDS, type TokenUsage } from '@/types/provider';

const usage = (promptTokens: number, completionTokens: number): TokenUsage => ({
  promptTokens,
  completionTokens,
  totalTokens: promptTokens + completionTokens,
});

describe('getPricing', () => {
  it('returns published pricing for a known model', () => {
    expect(getPricing('claude-opus-5')).toEqual({ inputPerMillion: 5, outputPerMillion: 25 });
  });

  it('prices the Vertex default from the table rather than the fallback', () => {
    // A Google run reporting fallback pricing would quietly feed wrong numbers
    // to the optimizer's cost findings.
    expect(getPricing('gemini-3.6-flash')).not.toBe(FALLBACK_PRICING);
    expect(getPricing('gemini-3.6-flash')).toEqual({
      inputPerMillion: 0.3,
      outputPerMillion: 2.5,
    });
  });

  it('falls back rather than pricing an unknown model at zero', () => {
    // Silently reporting $0.00 for a real run would be worse than an estimate.
    expect(getPricing('some-model-released-tomorrow')).toBe(FALLBACK_PRICING);
    expect(FALLBACK_PRICING.inputPerMillion).toBeGreaterThan(0);
  });

  it('prices output above input for every model', () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.outputPerMillion, model).toBeGreaterThan(pricing.inputPerMillion);
    }
  });
});

describe('calculateCost', () => {
  it('charges input and output at their separate rates', () => {
    // 1M input at $5 + 1M output at $25.
    expect(calculateCost(usage(1_000_000, 1_000_000), 'claude-opus-5')).toBeCloseTo(30, 6);
  });

  it('scales linearly with usage', () => {
    const single = calculateCost(usage(1_000, 500), 'claude-opus-5');
    const double = calculateCost(usage(2_000, 1_000), 'claude-opus-5');

    expect(double).toBeCloseTo(single * 2, 9);
  });

  it('is zero for zero usage', () => {
    expect(calculateCost(usage(0, 0), 'claude-opus-5')).toBe(0);
  });

  it('prices the mock model low enough to keep demo numbers believable', () => {
    const mockCost = calculateCost(usage(1_000, 500), DEFAULT_MODELS.mock);
    const opusCost = calculateCost(usage(1_000, 500), 'claude-opus-5');

    expect(mockCost).toBeGreaterThan(0);
    expect(mockCost).toBeLessThan(opusCost);
  });
});

describe('DEFAULT_MODELS', () => {
  it('defaults every provider to a model that is in the pricing table', () => {
    for (const [provider, model] of Object.entries(DEFAULT_MODELS)) {
      expect(MODEL_PRICING[model], `${provider} → ${model}`).toBeDefined();
    }
  });

  it('defaults to the mock provider model for mock', () => {
    expect(DEFAULT_MODELS.mock).toBe('mock-sim-1');
  });

  it('covers every registered provider id', () => {
    // The `Record<ProviderId, string>` type enforces this at compile time; this
    // asserts it at runtime so a widened union can't ship a hole.
    for (const id of PROVIDER_IDS) {
      expect(DEFAULT_MODELS[id], id).toBeTruthy();
    }
  });
});

describe('acceptsSamplingParams', () => {
  it.each(['claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-fable-5'])(
    'reports that %s rejects temperature',
    (model) => {
      // Sending temperature to these is a 400, not an ignored field.
      expect(acceptsSamplingParams(model)).toBe(false);
    },
  );

  it.each(['claude-sonnet-4-5', 'claude-haiku-4-5', 'gpt-4o-mini', 'gemini-3.6-flash'])(
    'reports that %s still accepts temperature',
    (model) => {
      expect(acceptsSamplingParams(model)).toBe(true);
    },
  );

  it('matches dated variants of a listed model', () => {
    expect(acceptsSamplingParams('claude-opus-5-20260101')).toBe(false);
  });
});

describe('usesThinkingBudget', () => {
  it('flags the models whose thinking shares the max_tokens budget', () => {
    expect(usesThinkingBudget('claude-opus-5')).toBe(true);
    expect(usesThinkingBudget('claude-haiku-4-5')).toBe(false);
  });

  it('flags Gemini, which thinks out of maxOutputTokens', () => {
    // Verified against Vertex: a 1,400-token request came back truncated with
    // thinking tokens consuming most of the budget.
    expect(usesThinkingBudget('gemini-2.5-flash')).toBe(true);
    expect(usesThinkingBudget('gemini-3.6-flash')).toBe(true);
  });

  it('is independent of whether a model accepts sampling params', () => {
    // Gemini takes a temperature happily but still bills thinking against the
    // output budget — conflating the two would truncate every Gemini response.
    expect(acceptsSamplingParams('gemini-2.5-flash')).toBe(true);
    expect(usesThinkingBudget('gemini-2.5-flash')).toBe(true);
  });
});
