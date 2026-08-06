'use client';

/**
 * fetchWithRetry — a minimal fetch wrapper for client components that load
 * data with raw `fetch()` in a `useEffect` (i.e. pages not backed by TanStack
 * Query, so the global QueryClient retry policy does not apply).
 *
 * On a cold server / cold Neon connection the first request can fail with a
 * transient network error or a 5xx/429 while the connection pool warms up.
 * Without retries such pages render a permanent error card. This helper
 * retries exactly those transient failures (never 4xx client errors) with
 * exponential backoff and jitter.
 *
 * Behaviour contract:
 * - Network errors (fetch throwing) are retried and, if all attempts fail,
 *   the final error is rethrown so existing `catch`/`setError` paths still run.
 * - Non-retryable responses (any 4xx, or whatever `retryOnStatus` rejects)
 *   are returned immediately so existing `if (!res.ok)` paths still work.
 * - Retryable responses (5xx/429) are returned after the final attempt, so a
 *   genuinely failing backend still surfaces its status to the caller.
 */

export interface FetchWithRetryOptions extends RequestInit {
  /** Additional attempts after the first (default 2 → 3 total). */
  retries?: number;
  /** Base backoff delay in ms; doubles per attempt with random jitter. */
  retryDelayMs?: number;
  /** Override which HTTP statuses are retryable (default: >=500 or 429). */
  retryOnStatus?: (status: number) => boolean;
}

const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 400;

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: FetchWithRetryOptions = {},
): Promise<Response> {
  const { retries = DEFAULT_RETRIES, retryDelayMs = DEFAULT_RETRY_DELAY_MS, retryOnStatus, ...fetchInit } = init;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, fetchInit);
      if (res.ok) return res;
      const shouldRetry = retryOnStatus ? retryOnStatus(res.status) : res.status >= 500 || res.status === 429;
      if (!shouldRetry || attempt === retries) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === retries) throw err;
    }

    // Exponential backoff with jitter so a fleet of clients does not
    // synchronise its retries against a waking backend.
    const delay = retryDelayMs * 2 ** attempt + Math.random() * retryDelayMs;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw lastError;
}
