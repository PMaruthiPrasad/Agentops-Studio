import { describe, expect, it } from 'vitest';
import { describeCondition, explainCondition } from './condition-format';

describe('condition formatting', () => {
  it('renders an expression compactly for the canvas chip', () => {
    expect(
      describeCondition({ kind: 'expression', field: 'confidence', operator: 'gte', value: 0.7 }),
    ).toBe('confidence ≥ 0.7');
  });

  it('renders nothing for an unconditional edge', () => {
    expect(describeCondition({ kind: 'always' })).toBe('');
  });

  it('explains an unconditional edge in words', () => {
    expect(explainCondition({ kind: 'always' })).toBe('Always runs the target node.');
  });

  it('explains an expression in words', () => {
    expect(
      explainCondition({ kind: 'expression', field: 'status', operator: 'eq', value: 'success' }),
    ).toBe("Runs the target only when the source's status equals success.");
  });

  it('keeps comparison operators grammatical', () => {
    expect(
      explainCondition({ kind: 'expression', field: 'confidence', operator: 'gte', value: 0.7 }),
    ).toBe("Runs the target only when the source's confidence is at least 0.7.");
  });
});
