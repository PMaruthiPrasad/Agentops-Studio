import { describe, expect, it, vi } from 'vitest';
import { computeBackoff, mapWithConcurrency, TimeoutError, withTimeout } from './concurrency';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('mapWithConcurrency', () => {
  it('returns results in input order regardless of completion order', async () => {
    const results = await mapWithConcurrency([30, 10, 20], 3, async (delay) => {
      await tick(delay);
      return delay;
    });

    expect(results).toEqual([30, 10, 20]);
  });

  it('never exceeds the concurrency ceiling', async () => {
    let active = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await tick(5);
      active -= 1;
      return null;
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('actually runs work in parallel', async () => {
    const started = Date.now();
    await mapWithConcurrency([20, 20, 20, 20], 4, async (delay) => {
      await tick(delay);
      return delay;
    });

    // Serial would be ~80ms; parallel should land far below that.
    expect(Date.now() - started).toBeLessThan(70);
  });

  it('returns an empty array for empty input without calling the mapper', async () => {
    const fn = vi.fn();
    await expect(mapWithConcurrency([], 4, fn)).resolves.toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('runs serially when the limit is 1', async () => {
    const order: number[] = [];

    await mapWithConcurrency([3, 2, 1], 1, async (value) => {
      await tick(value);
      order.push(value);
      return value;
    });

    expect(order).toEqual([3, 2, 1]);
  });

  it('caps workers at the item count when the limit exceeds it', async () => {
    const results = await mapWithConcurrency([1, 2], 99, async (value) => value * 2);
    expect(results).toEqual([2, 4]);
  });

  it('passes the index to the mapper', async () => {
    const results = await mapWithConcurrency(['a', 'b', 'c'], 2, async (item, index) =>
      `${index}:${item}`,
    );

    expect(results).toEqual(['0:a', '1:b', '2:c']);
  });
});

describe('withTimeout', () => {
  it('resolves when the operation finishes in time', async () => {
    await expect(withTimeout(1_000, undefined, async () => 'done')).resolves.toBe('done');
  });

  it('throws a TimeoutError when the deadline passes', async () => {
    const slow = withTimeout(20, undefined, async (signal) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 500);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
      return 'never';
    });

    await expect(slow).rejects.toBeInstanceOf(TimeoutError);
  });

  it('signals the callback so a well-behaved provider can stop early', async () => {
    let sawAbort = false;

    await withTimeout(15, undefined, async (signal) => {
      signal.addEventListener('abort', () => {
        sawAbort = true;
      });
      await tick(60);
      return null;
    }).catch(() => null);

    expect(sawAbort).toBe(true);
  });

  it('propagates a parent cancellation', async () => {
    const controller = new AbortController();
    let sawAbort = false;

    const promise = withTimeout(5_000, controller.signal, async (signal) => {
      signal.addEventListener('abort', () => {
        sawAbort = true;
      });
      await tick(50);
      return 'finished';
    });

    controller.abort();
    await promise;

    expect(sawAbort).toBe(true);
  });

  it('aborts immediately when the parent signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    let abortedAtStart = false;
    await withTimeout(1_000, controller.signal, async (signal) => {
      abortedAtStart = signal.aborted;
      return null;
    });

    expect(abortedAtStart).toBe(true);
  });

  it('rethrows the original error when the operation fails before the deadline', async () => {
    const boom = new Error('provider exploded');

    await expect(
      withTimeout(1_000, undefined, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });
});

describe('computeBackoff', () => {
  it('grows exponentially across attempts', () => {
    const first = Array.from({ length: 40 }, () => computeBackoff(1));
    const third = Array.from({ length: 40 }, () => computeBackoff(3));

    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean(third)).toBeGreaterThan(mean(first));
  });

  it('stays inside the jitter band for a given attempt', () => {
    // Full jitter: between 50% and 100% of the exponential value.
    for (let i = 0; i < 100; i += 1) {
      const delay = computeBackoff(2, 300);
      expect(delay).toBeGreaterThanOrEqual(300);
      expect(delay).toBeLessThanOrEqual(600);
    }
  });

  it('honours the ceiling on high attempt numbers', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(computeBackoff(20, 300, 8_000)).toBeLessThanOrEqual(8_000);
    }
  });

  it('jitters so a failed layer does not retry in lockstep', () => {
    const values = new Set(Array.from({ length: 50 }, () => computeBackoff(3)));
    expect(values.size).toBeGreaterThan(1);
  });
});
