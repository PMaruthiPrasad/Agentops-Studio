import type { EdgeCondition } from '@/types/workflow';
import type { StepStatus } from '@/types/execution';

/**
 * Branch condition evaluation.
 *
 * Conditions are a closed grammar (field / operator / literal) evaluated by
 * this interpreter. There is deliberately no `eval`, no `new Function`, and no
 * expression parser: user-authored graph data must never become executable
 * code, and a fixed grammar is also far easier to render in a UI and reason
 * about in the optimizer.
 */

export interface ConditionSubject {
  status: StepStatus;
  confidence: number;
  tokens: number;
  cost: number;
  output: string;
}

export interface ConditionEvaluation {
  passed: boolean;
  /** Human-readable explanation, stored as the skip reason when it fails. */
  reason: string;
}

function describeCondition(condition: EdgeCondition): string {
  if (condition.kind === 'always') return 'always';
  return `${condition.field} ${OPERATOR_LABELS[condition.operator]} ${JSON.stringify(condition.value)}`;
}

const OPERATOR_LABELS: Record<string, string> = {
  eq: '==',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  contains: 'contains',
};

function readField(subject: ConditionSubject, field: string): string | number {
  switch (field) {
    case 'confidence':
      return subject.confidence;
    case 'tokens':
      return subject.tokens;
    case 'cost':
      return subject.cost;
    case 'status':
      return subject.status;
    case 'output':
      return subject.output;
    default:
      return '';
  }
}

export function evaluateCondition(
  condition: EdgeCondition,
  subject: ConditionSubject,
): ConditionEvaluation {
  if (condition.kind === 'always') {
    return { passed: true, reason: 'unconditional edge' };
  }

  const actual = readField(subject, condition.field);
  const expected = condition.value;
  const description = describeCondition(condition);

  let passed: boolean;

  switch (condition.operator) {
    case 'eq':
      passed = looseEquals(actual, expected);
      break;
    case 'neq':
      passed = !looseEquals(actual, expected);
      break;
    case 'gt':
      passed = toNumber(actual) > toNumber(expected);
      break;
    case 'gte':
      passed = toNumber(actual) >= toNumber(expected);
      break;
    case 'lt':
      passed = toNumber(actual) < toNumber(expected);
      break;
    case 'lte':
      passed = toNumber(actual) <= toNumber(expected);
      break;
    case 'contains':
      passed = String(actual).toLowerCase().includes(String(expected).toLowerCase());
      break;
    default:
      // Unknown operator: fail open so a bad condition can't silently
      // strand the rest of the graph.
      passed = true;
      break;
  }

  const actualDisplay = typeof actual === 'number' ? formatNumber(actual) : truncateForMessage(actual);

  return {
    passed,
    reason: passed
      ? `condition met (${description}; actual ${actualDisplay})`
      : `condition not met (${description}; actual ${actualDisplay})`,
  };
}

function looseEquals(a: string | number, b: string | number): boolean {
  if (typeof a === 'number' || typeof b === 'number') {
    const na = toNumber(a);
    const nb = toNumber(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  }
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function toNumber(value: string | number): number {
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function truncateForMessage(value: string | number): string {
  const text = String(value);
  return text.length > 40 ? `"${text.slice(0, 39)}…"` : `"${text}"`;
}

/** Renders a condition for display on a canvas edge. */
export function formatCondition(condition: EdgeCondition): string {
  return condition.kind === 'always' ? '' : describeCondition(condition);
}
