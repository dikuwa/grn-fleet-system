import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// The hook only consumes fetchWithRetry from the wrapper, so the rest of the
// module graph is stubbed — no network or DB dependencies in unit tests.
vi.mock('@/lib/fetch-with-retry', () => ({
  fetchWithRetry: vi.fn(),
}));

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as unknown as Response;
}

async function loadHook() {
  const { useLoadWithRetry } = await import('@/lib/use-load-with-retry');
  const { fetchWithRetry } = await import('@/lib/fetch-with-retry');
  return { useLoadWithRetry, fetchMock: vi.mocked(fetchWithRetry) };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useLoadWithRetry', () => {
  it('fetches the url on mount and returns the parsed payload', async () => {
    const { useLoadWithRetry, fetchMock } = await loadHook();
    fetchMock.mockResolvedValue(jsonResponse({ total: 3 }));

    const { result } = renderHook(() => useLoadWithRetry<{ total: number }>('/api/things'));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith('/api/things');
    expect(result.current.data).toEqual({ total: 3 });
    expect(result.current.error).toBeNull();
  });

  it('shapes the payload through select', async () => {
    const { useLoadWithRetry, fetchMock } = await loadHook();
    fetchMock.mockResolvedValue(jsonResponse({ rows: [1, 2, 3] }));

    const { result } = renderHook(() =>
      useLoadWithRetry<number[]>('/api/things', {
        select: (json) => (json as { rows: number[] }).rows,
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([1, 2, 3]);
  });

  it('surfaces the error message when the response is not ok', async () => {
    const { useLoadWithRetry, fetchMock } = await loadHook();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, false));

    const { result } = renderHook(() =>
      useLoadWithRetry('/api/things', { errorMessage: 'Custom failure' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Custom failure');
    expect(result.current.data).toBeUndefined();
  });

  it('surfaces the error when fetchWithRetry exhausts its retries', async () => {
    const { useLoadWithRetry, fetchMock } = await loadHook();
    fetchMock.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useLoadWithRetry<number>('/api/things'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('network down');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous data when a reload fails', async () => {
    const { useLoadWithRetry, fetchMock } = await loadHook();
    fetchMock.mockResolvedValueOnce(jsonResponse(10));

    const { result } = renderHook(() => useLoadWithRetry<number>('/api/things'));
    await waitFor(() => expect(result.current.data).toBe(10));

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    // Note: reload()'s promise resolves once the re-fetch settles, but the act()
    // harness does not drive the effect's post-await microtask chain, so the
    // reload is fired unawaited and the outcome is asserted with waitFor.
    act(() => {
      void result.current.reload();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe(10);
    expect(result.current.error).toBe('offline');
  });

  it('reload() re-runs the load and updates the data', async () => {
    const { useLoadWithRetry, fetchMock } = await loadHook();
    fetchMock.mockResolvedValueOnce(jsonResponse(1)).mockResolvedValueOnce(jsonResponse(2));

    const { result } = renderHook(() => useLoadWithRetry<number>('/api/things'));
    await waitFor(() => expect(result.current.data).toBe(1));

    act(() => {
      void result.current.reload();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.data).toBe(2));
  });

  it('does not fetch when url is null', async () => {
    const { useLoadWithRetry, fetchMock } = await loadHook();

    const { result } = renderHook(() => useLoadWithRetry<unknown>(null));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('does not fetch while enabled is false', async () => {
    const { useLoadWithRetry, fetchMock } = await loadHook();

    renderHook(() => useLoadWithRetry<unknown>('/api/things', { enabled: false }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refetches when the url changes', async () => {
    const { useLoadWithRetry, fetchMock } = await loadHook();
    fetchMock
      .mockResolvedValueOnce(jsonResponse('one'))
      .mockResolvedValueOnce(jsonResponse('two'));

    const { result, rerender } = renderHook(({ url }: { url: string | null }) =>
      useLoadWithRetry<string>(url),
      { initialProps: { url: '/api/one' } },
    );
    await waitFor(() => expect(result.current.data).toBe('one'));

    act(() => rerender({ url: '/api/two' }));
    await waitFor(() => expect(result.current.data).toBe('two'));
    expect(fetchMock).toHaveBeenCalledWith('/api/two');
  });

  it('ignores a stale response that resolves after a newer request', async () => {
    const { useLoadWithRetry, fetchMock } = await loadHook();
    let resolveFirst!: (value: Response) => void;
    let resolveSecond!: (value: Response) => void;
    fetchMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const { result, rerender } = renderHook(({ url }: { url: string }) =>
      useLoadWithRetry<string>(url),
      { initialProps: { url: '/api/one' } },
    );

    // The first request is still in flight when the url changes, so the
    // second request supersedes it.
    act(() => rerender({ url: '/api/two' }));

    await act(async () => {
      resolveFirst(jsonResponse('stale'));
      await Promise.resolve();
    });
    await act(async () => {
      resolveSecond(jsonResponse('fresh'));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe('fresh');
  });
});
