import { describe, expect, it } from 'vitest';
import { evaluateCondition, formatCondition, type ConditionSubject } from './conditions';
import type { ConditionField, ConditionOperator, EdgeCondition } from '@/types/workflow';

function subject(overrides: Partial<ConditionSubject> = {}): ConditionSubject {
  return {
    status: overrides.status ?? 'success',
    confidence: overrides.confidence ?? 0.82,
    tokens: overrides.tokens ?? 1_500,
    cost: overrides.cost ?? 0.004,
    output: overrides.output ?? 'The contract carries an uncapped indemnity in clause 7.2.',
  };
}

function expr(
  field: ConditionField,
  operator: ConditionOperator,
  value: string | number,
): EdgeCondition {
  return { kind: 'expression', field, operator, value };
}

describe('evaluateCondition', () => {
  it('always passes an unconditional edge', () => {
    const result = evaluateCondition({ kind: 'always' }, subject());

    expect(result.passed).toBe(true);
    expect(result.reason).toBe('unconditional edge');
  });

  describe('numeric comparisons', () => {
    it.each([
      ['gte', 0.8, true],
      ['gte', 0.82, true],
      ['gte', 0.9, false],
      ['gt', 0.82, false],
      ['gt', 0.5, true],
      ['lt', 0.9, true],
      ['lt', 0.8, false],
      ['lte', 0.82, true],
      ['lte', 0.5, false],
    ] as const)('confidence %s %s → %s', (operator, value, expected) => {
      const result = evaluateCondition(expr('confidence', operator, value), subject());
      expect(result.passed).toBe(expected);
    });

    it('compares tokens and cost numerically', () => {
      expect(evaluateCondition(expr('tokens', 'gt', 1_000), subject()).passed).toBe(true);
      expect(evaluateCondition(expr('cost', 'lt', 0.01), subject()).passed).toBe(true);
    });

    it('coerces a numeric string so a UI-entered value still compares as a number', () => {
      // "0.9" typed into the inspector must not become a string comparison,
      // where "0.82" > "0.9" is false for the wrong reason.
      const result = evaluateCondition(expr('confidence', 'lt', '0.9'), subject());
      expect(result.passed).toBe(true);
    });
  });

  describe('equality', () => {
    it('matches a status exactly', () => {
      expect(evaluateCondition(expr('status', 'eq', 'success'), subject()).passed).toBe(true);
      expect(evaluateCondition(expr('status', 'eq', 'failed'), subject()).passed).toBe(false);
    });

    it('is case-insensitive on strings', () => {
      expect(evaluateCondition(expr('status', 'eq', 'SUCCESS'), subject()).passed).toBe(true);
    });

    it('inverts correctly for neq', () => {
      expect(evaluateCondition(expr('status', 'neq', 'failed'), subject()).passed).toBe(true);
      expect(evaluateCondition(expr('status', 'neq', 'success'), subject()).passed).toBe(false);
    });

    it('treats equal numbers as equal regardless of literal type', () => {
      expect(evaluateCondition(expr('confidence', 'eq', '0.82'), subject()).passed).toBe(true);
    });
  });

  describe('contains', () => {
    it('finds a substring in the output', () => {
      expect(evaluateCondition(expr('output', 'contains', 'indemnity'), subject()).passed).toBe(
        true,
      );
    });

    it('ignores case', () => {
      expect(evaluateCondition(expr('output', 'contains', 'INDEMNITY'), subject()).passed).toBe(
        true,
      );
    });

    it('fails when absent', () => {
      expect(evaluateCondition(expr('output', 'contains', 'arbitration'), subject()).passed).toBe(
        false,
      );
    });
  });

  describe('reason text', () => {
    it('explains a pass with the actual value', () => {
      const result = evaluateCondition(expr('confidence', 'gte', 0.5), subject());

      expect(result.reason).toContain('condition met');
      expect(result.reason).toContain('confidence >= 0.5');
      expect(result.reason).toContain('0.820');
    });

    it('explains a failure — this becomes the recorded skip reason', () => {
      const result = evaluateCondition(expr('confidence', 'gte', 0.95), subject());

      expect(result.reason).toContain('condition not met');
      expect(result.reason).toContain('0.820');
    });

    it('truncates a long output value so the reason stays readable', () => {
      const long = 'x'.repeat(500);
      const result = evaluateCondition(expr('output', 'eq', 'nope'), subject({ output: long }));

      expect(result.reason.length).toBeLessThan(120);
      expect(result.reason).toContain('…');
    });
  });

  it('fails open on an unknown operator rather than stranding the graph', () => {
    const bogus = {
      kind: 'expression',
      field: 'confidence',
      operator: 'approximately',
      value: 1,
    } as unknown as EdgeCondition;

    expect(evaluateCondition(bogus, subject()).passed).toBe(true);
  });

  it('does not pass a numeric comparison against unparseable text', () => {
    // NaN comparisons are false in every direction — the edge simply does not fire.
    const result = evaluateCondition(expr('output', 'gt', 5), subject({ output: 'not a number' }));
    expect(result.passed).toBe(false);
  });
});

describe('formatCondition', () => {
  it('renders nothing for an unconditional edge', () => {
    expect(formatCondition({ kind: 'always' })).toBe('');
  });

  it('renders an expression for the canvas', () => {
    expect(formatCondition(expr('confidence', 'gte', 0.7))).toBe('confidence >= 0.7');
  });
});
