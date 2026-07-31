import type { ConditionOperator, EdgeCondition } from '@/types/workflow';

/** Symbols read faster than words on a crowded canvas. */
const OPERATOR_SYMBOL: Record<ConditionOperator, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  contains: '⊃',
};

/** Phrased so it reads as a sentence in both the dropdown and `explainCondition`. */
export const OPERATOR_LABEL: Record<ConditionOperator, string> = {
  eq: 'equals',
  neq: 'does not equal',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  contains: 'contains',
};

/** Compact form for edge chips: `confidence ≥ 0.7`. */
export function describeCondition(condition: EdgeCondition): string {
  if (condition.kind === 'always') return '';
  return `${condition.field} ${OPERATOR_SYMBOL[condition.operator]} ${condition.value}`;
}

/** Sentence form for panels and tooltips. */
export function explainCondition(condition: EdgeCondition): string {
  if (condition.kind === 'always') return 'Always runs the target node.';
  return `Runs the target only when the source's ${condition.field} ${OPERATOR_LABEL[condition.operator]} ${condition.value}.`;
}
