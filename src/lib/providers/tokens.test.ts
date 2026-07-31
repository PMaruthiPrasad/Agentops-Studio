import { describe, expect, it } from 'vitest';
import { addUsage, buildUsage, estimateTokens } from './tokens';

describe('estimateTokens', () => {
  it('returns 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('never returns 0 for text that exists', () => {
    expect(estimateTokens('a')).toBeGreaterThanOrEqual(1);
  });

  it('grows with length', () => {
    const short = estimateTokens('The quick brown fox.');
    const long = estimateTokens('The quick brown fox. '.repeat(20));

    expect(long).toBeGreaterThan(short);
  });

  it('lands in the right ballpark for English prose', () => {
    // ~4 chars/token is the widely-quoted rule of thumb; stay near it.
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(10);
    const tokens = estimateTokens(text);

    expect(tokens).toBeGreaterThan(text.length / 6);
    expect(tokens).toBeLessThan(text.length / 2.5);
  });

  it('counts whitespace-heavy text as denser than raw length implies', () => {
    const prose = 'abcdefghij'.repeat(10);
    const spaced = 'a b c d e '.repeat(10);

    expect(estimateTokens(spaced)).toBeLessThan(estimateTokens(prose));
  });

  it('is deterministic', () => {
    expect(estimateTokens('same input')).toBe(estimateTokens('same input'));
  });
});

describe('buildUsage', () => {
  it('splits prompt and completion and totals them', () => {
    const usage = buildUsage('a prompt of some length', 'a rather longer completion body here');

    expect(usage.promptTokens).toBeGreaterThan(0);
    expect(usage.completionTokens).toBeGreaterThan(0);
    expect(usage.totalTokens).toBe(usage.promptTokens + usage.completionTokens);
  });

  it('reports zero completion tokens for an empty response', () => {
    const usage = buildUsage('prompt', '');

    expect(usage.completionTokens).toBe(0);
    expect(usage.totalTokens).toBe(usage.promptTokens);
  });
});

describe('addUsage', () => {
  it('sums each field independently', () => {
    const total = addUsage(
      { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      { promptTokens: 20, completionTokens: 7, totalTokens: 27 },
    );

    expect(total).toEqual({ promptTokens: 30, completionTokens: 12, totalTokens: 42 });
  });
});
