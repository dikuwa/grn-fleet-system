'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithRetry } from '@/lib/fetch-with-retry';

/**
 * useLoadWithRetry — a reusable data-loading hook for client pages that fetch
 * on mount with raw `fetch()` (i.e. pages not backed by TanStack Query).
 *
 * Every dashboard page repeated the same boilerplate: a `fetchWithRetry` call
 * wrapped in loading/error state, a `fetched` ref to avoid double-fetching in
 * StrictMode, and a manual reload for refresh buttons. This hook captures that
 * shape and adds the failure resilience the global QueryClient retry policy
 * would otherwise provide.
 *
 * - Fetches on mount and whenever `url` or `enabled` changes.
 * - Retries transient failures via fetchWithRetry (backoff + jitter).
 * - Keeps the last successful data on error so the page doesn't blank out.
 * - Ignores stale responses: a slow earlier request cannot clobber a newer
 *   one, and unmounted components never set state.
 * - Exposes `reload` for refresh buttons and post-mutation refetching.
 *
 * Pages with several response slices (e.g. vehicles + summary) pass no
 * `select` and derive their slices from `data`; single-payload pages can pass
 * `select` to shape it directly.
 */

export interface UseLoadWithRetryOptions<T> {
  /** Initial value for `data` before the first request resolves. */
  initialData?: T;
  /** Extract the payload from the parsed JSON body (default: body as-is). */
  select?: (json: unknown) => T;
  /** Skip fetching until true (e.g. while the session resolves). Default true. */
  enabled?: boolean;
  /** Error message used when the response is not ok. */
  errorMessage?: string;
}

export interface UseLoadWithRetryResult<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  /** Re-run the load; resolves once the refresh has completed (or failed). */
  reload: () => Promise<void>;
}

/** Module-level fetch + parse. No component state, so it is trivially safe to
 * call from both the effect's loader and future callers. */
async function fetchPayload(url: string, errorMessage: string): Promise<unknown> {
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(errorMessage);
  return res.json();
}

export function useLoadWithRetry<T>(
  url: string | null,
  options: UseLoadWithRetryOptions<T> = {},
): UseLoadWithRetryResult<T> {
  const { initialData, select, enabled = true, errorMessage = 'Failed to load data' } = options;

  const [data, setData] = useState<T | undefined>(initialData);
  // Not loading from the start when there is nothing to load yet (no url or
  // disabled), so pages cannot spin forever on an early return.
  const [loading, setLoading] = useState(() => Boolean(url) && enabled);
  const [error, setError] = useState<string | null>(null);

  // Reset the load state when the url changes (the documented "adjusting state
  // when props change" pattern, same as useAttentionBadges), so a dynamic-url
  // consumer sees a spinner and no stale error for the new resource.
  const [previousUrl, setPreviousUrl] = useState(url);
  if (previousUrl !== url) {
    setPreviousUrl(url);
    setLoading(Boolean(url) && enabled);
    setError(null);
  }

  // Bumped by `reload` to re-run the load effect. Keeping the load trigger as
  // effect state (rather than calling a setState-carrying function from the
  // effect) keeps every synchronous setState out of the effect body.
  const [reloadTick, setReloadTick] = useState(0);

  // Lets `reload()` resolve only once the load it triggered has completed, so
  // callers can `await` a refresh (e.g. the post-mutation refetch pattern).
  const pendingReloadRef = useRef<{ resolve: () => void } | null>(null);

  // Keep the latest `select` in a ref so a re-created inline function on
  // parent render does not re-trigger the load effect. The ref is updated in
  // an effect (declared before the load effect) so the next load always sees
  // the newest selector.
  const selectRef = useRef(select);
  useEffect(() => {
    selectRef.current = select;
  }, [select]);

  // Guards against overlapping loads and stale writes after unmount.
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!url || !enabled) return;
    let cancelled = false;
    const requestId = ++requestIdRef.current;

    const load = async () => {
      try {
        const payload = await fetchPayload(url, errorMessage);
        if (cancelled || requestIdRef.current !== requestId) return; // superseded or unmounted
        const selectFn = selectRef.current;
        setData(selectFn ? selectFn(payload) : (payload as T));
        setError(null);
      } catch (err) {
        if (cancelled || requestIdRef.current !== requestId) return;
        setError(err instanceof Error ? err.message : errorMessage);
      } finally {
        if (requestIdRef.current === requestId) setLoading(false);
        if (!cancelled && requestIdRef.current === requestId) {
          pendingReloadRef.current?.resolve();
          pendingReloadRef.current = null;
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [url, enabled, errorMessage, reloadTick]);

  /** Manual refresh: shows the spinner immediately, clears the error, and
   * resolves once the re-fetch has settled. */
  const reload = useCallback(() => {
    if (!url || !enabled) return Promise.resolve();
    setLoading(true);
    setError(null);
    return new Promise<void>((resolve) => {
      pendingReloadRef.current = { resolve };
      setReloadTick((tick) => tick + 1);
    });
  }, [url, enabled]);

  return { data, loading, error, reload };
}
