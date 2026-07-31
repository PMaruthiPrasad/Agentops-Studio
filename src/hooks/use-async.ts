'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toErrorMessage } from '@/lib/utils';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  /** True only on the first load — a refresh keeps the old data visible. */
  loading: boolean;
  /** True while any fetch (including a refresh) is in flight. */
  refreshing: boolean;
  refresh: () => void;
  /** Replace the cached value without a round trip (after a mutation). */
  setData: (updater: T | ((current: T | null) => T | null)) => void;
}

/**
 * Data fetching for client components.
 *
 * The app has one reader per resource and no cross-page cache to invalidate, so
 * a focused hook beats pulling in a query library: it aborts in-flight requests
 * on unmount, keeps stale data visible while refreshing (no layout flash), and
 * lets callers patch the cache locally after a mutation.
 *
 * @param fetcher Receives an AbortSignal — pass it through to `api.*`.
 * @param deps Re-runs the fetch when these change, like `useEffect`.
 */
export function useAsync<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[] = [],
): AsyncState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // `fetcher` is typically an inline arrow; holding it in a ref keeps it out of
  // the effect's dependency list so the caller doesn't have to memoise it.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const mountedRef = useRef(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setRefreshing(true);

    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (controller.signal.aborted || !mountedRef.current) return;
        setDataState(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || !mountedRef.current) return;
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(toErrorMessage(cause));
      })
      .finally(() => {
        if (controller.signal.aborted || !mountedRef.current) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const setData = useCallback((updater: T | ((current: T | null) => T | null)) => {
    setDataState((current) =>
      typeof updater === 'function' ? (updater as (c: T | null) => T | null)(current) : updater,
    );
  }, []);

  return { data, error, loading, refreshing, refresh, setData };
}
