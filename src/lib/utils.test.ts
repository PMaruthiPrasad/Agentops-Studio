import { describe, expect, it, vi } from 'vitest';
import {
  average,
  clamp,
  cn,
  formatCost,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatTokens,
  groupBy,
  isAbortError,
  round,
  sleep,
  slugify,
  sum,
  titleCase,
  toErrorMessage,
  truncate,
} from './utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, undefined, 'b')).toBe('a b');
  });

  it('lets a later Tailwind class win over an earlier conflicting one', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '<1ms'],
    [1, '1ms'],
    [999, '999ms'],
    [1_000, '1.00s'],
    [8_400, '8.40s'],
    [12_000, '12.0s'],
    [60_000, '1m 0s'],
    [95_000, '1m 35s'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it('returns a dash for nonsense', () => {
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(-5)).toBe('—');
  });
});

describe('formatCost', () => {
  it.each([
    [0, '$0.00'],
    [0.000012, '$0.00001'],
    [0.0412, '$0.0412'],
    [1.5, '$1.50'],
    [1234.5, '$1234.50'],
  ])('formats %d as %s', (usd, expected) => {
    expect(formatCost(usd)).toBe(expected);
  });

  it('keeps enough precision that a sub-cent run is not shown as free', () => {
    expect(formatCost(0.00002)).not.toBe('$0.00');
  });

  it('returns a dash for nonsense', () => {
    expect(formatCost(Number.NaN)).toBe('—');
  });
});

describe('formatTokens', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1_000, '1.0k'],
    [12_400, '12.4k'],
    [1_500_000, '1.50M'],
  ])('formats %i as %s', (tokens, expected) => {
    expect(formatTokens(tokens)).toBe(expected);
  });
});

describe('formatPercent', () => {
  it('renders a ratio as a percentage', () => {
    expect(formatPercent(0.86)).toBe('86%');
    expect(formatPercent(1)).toBe('100%');
  });

  it('honours a digit count', () => {
    expect(formatPercent(0.8642, 1)).toBe('86.4%');
  });
});

describe('formatNumber', () => {
  it('groups thousands', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });
});

describe('formatRelativeTime', () => {
  it('reports never for a missing value', () => {
    expect(formatRelativeTime(null)).toBe('never');
    expect(formatRelativeTime(undefined)).toBe('never');
  });

  it.each([
    [10_000, 'just now'],
    [5 * 60_000, '5m ago'],
    [3 * 3_600_000, '3h ago'],
    [2 * 86_400_000, '2d ago'],
    [45 * 86_400_000, '1mo ago'],
    [400 * 86_400_000, '1y ago'],
  ])('describes %ims ago', (ago, expected) => {
    expect(formatRelativeTime(new Date(Date.now() - ago))).toBe(expected);
  });

  it('treats a future timestamp as just now rather than showing a negative', () => {
    expect(formatRelativeTime(new Date(Date.now() + 60_000))).toBe('just now');
  });

  it('reports unknown for an unparseable string', () => {
    expect(formatRelativeTime('not a date')).toBe('unknown');
  });
});

describe('numeric helpers', () => {
  it('clamps into range', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('rounds to a digit count', () => {
    expect(round(1.23456, 2)).toBe(1.23);
    expect(round(1.23456)).toBe(1.23);
  });

  it('averages and sums', () => {
    expect(average([1, 2, 3])).toBe(2);
    expect(sum([1, 2, 3])).toBe(6);
  });

  it('returns 0 rather than NaN for an empty average', () => {
    expect(average([])).toBe(0);
    expect(sum([])).toBe(0);
  });
});

describe('string helpers', () => {
  it('truncates with an ellipsis', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
  });

  it('leaves short text alone', () => {
    expect(truncate('abc', 10)).toBe('abc');
  });

  it('slugifies', () => {
    expect(slugify('  Legal Contract Risk Review! ')).toBe('legal-contract-risk-review');
  });

  it('title-cases across separators', () => {
    expect(titleCase('legal_validator')).toBe('Legal Validator');
    expect(titleCase('long-serial-chain')).toBe('Long Serial Chain');
  });
});

describe('groupBy', () => {
  it('groups while preserving insertion order', () => {
    const grouped = groupBy(
      [
        { type: 'b', id: 1 },
        { type: 'a', id: 2 },
        { type: 'b', id: 3 },
      ],
      (item) => item.type,
    );

    expect([...grouped.keys()]).toEqual(['b', 'a']);
    expect(grouped.get('b')).toHaveLength(2);
  });

  it('returns an empty map for empty input', () => {
    expect(groupBy([], () => 'x').size).toBe(0);
  });
});

describe('error helpers', () => {
  it('recognises an abort', () => {
    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(new DOMException('Timeout', 'TimeoutError'))).toBe(true);
    expect(isAbortError(new Error('boom'))).toBe(false);
  });

  it('extracts a message from anything', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom');
    expect(toErrorMessage('boom')).toBe('boom');
    expect(toErrorMessage({ code: 500 })).toBe('{"code":500}');
  });

  it('survives an unserialisable value', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(toErrorMessage(circular)).toBe('Unknown error');
  });
});

describe('sleep', () => {
  it('resolves after the delay', async () => {
    const started = Date.now();
    await sleep(20);

    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  it('resolves immediately for a non-positive delay', async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
  });

  it('rejects when the signal aborts mid-sleep', async () => {
    const controller = new AbortController();
    const promise = sleep(1_000, controller.signal);

    controller.abort();

    await expect(promise).rejects.toThrowError(/Aborted/);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(sleep(1_000, controller.signal)).rejects.toThrowError(/Aborted/);
  });

  it('does not leave a timer behind after an abort', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const controller = new AbortController();
    const promise = sleep(5_000, controller.signal);

    controller.abort();
    await promise.catch(() => null);

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
