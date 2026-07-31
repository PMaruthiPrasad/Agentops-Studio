/**
 * Bounded-concurrency helpers used by the executor.
 *
 * A parallel layer might contain twenty nodes; firing twenty simultaneous LLM
 * calls is how you get rate-limited. These primitives keep the fan-out under an
 * explicit ceiling without pulling in a dependency.
 */

/**
 * Runs `fn` over `items` with at most `limit` in flight, preserving input order
 * in the returned array. `fn` is expected not to reject — the executor converts
 * failures into result objects so one bad node cannot abort its whole layer.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  const workerCount = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await fn(item, index);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

export class TimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Runs an abortable operation under a deadline.
 *
 * The callback receives a signal that fires on either the deadline or the
 * caller's own cancellation, so a well-behaved provider stops work promptly
 * instead of leaking a request behind a rejected promise.
 */
export async function withTimeout<T>(
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  if (parentSignal?.aborted) controller.abort();

  try {
    return await fn(controller.signal);
  } catch (error) {
    if (timedOut) throw new TimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

/**
 * Exponential backoff with full jitter.
 *
 * Jitter matters more than the exponent here: without it, every node in a
 * failed layer retries in lockstep and re-creates the burst that caused the
 * failure.
 */
export function computeBackoff(attempt: number, baseMs = 300, maxMs = 8_000): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}
