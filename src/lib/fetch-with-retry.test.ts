import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithRetry } from '@/lib/fetch-with-retry';

const FAST_DELAY = 1; // ms — enough for real backoff, negligible test time

function mockFetch(...responses: Response[]) {
  const fn = vi.fn();
  responses.forEach((res) => fn.mockResolvedValueOnce(res));
  // Any unmatched call rejects like the real fetch does on network errors.
  fn.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function jsonResponse(status: number) {
  return new Response(JSON.stringify({ ok: status < 400 }), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchWithRetry', () => {
  it('returns the response on the first success', async () => {
    const fetchMock = mockFetch(jsonResponse(200));
    const res = await fetchWithRetry('/api/foo');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx and succeeds once the backend recovers', async () => {
    const fetchMock = mockFetch(jsonResponse(503), jsonResponse(503), jsonResponse(200));
    const res = await fetchWithRetry('/api/foo', { retryDelayMs: FAST_DELAY });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries on 429 (rate limit)', async () => {
    const fetchMock = mockFetch(jsonResponse(429), jsonResponse(200));
    const res = await fetchWithRetry('/api/foo', { retryDelayMs: FAST_DELAY });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry 4xx client errors', async () => {
    const fetchMock = mockFetch(jsonResponse(404));
    const res = await fetchWithRetry('/api/foo', { retries: 5, retryDelayMs: FAST_DELAY });
    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on transient network failures (fetch rejects)', async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithRetry('/api/foo', { retryDelayMs: FAST_DELAY });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws the last network error once retries are exhausted', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchWithRetry('/api/foo', { retries: 2, retryDelayMs: FAST_DELAY }),
    ).rejects.toThrow('Failed to fetch');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('respects a custom retryOnStatus predicate', async () => {
    const fetchMock = mockFetch(jsonResponse(401), jsonResponse(200));
    const res = await fetchWithRetry('/api/foo', {
      retryDelayMs: FAST_DELAY,
      retryOnStatus: (status) => status === 401, // treat 401 as transient here
    });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('passes through init options to fetch', async () => {
    const fetchMock = mockFetch(jsonResponse(200));
    await fetchWithRetry('/api/foo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/foo',
      expect.objectContaining({ method: 'POST', headers: expect.any(Object) }),
    );
  });
});
