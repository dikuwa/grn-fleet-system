import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { WorkspaceId } from '@/lib/workspaces';

// The hook only consumes `getWorkspaceNavigation` from the registry, so the
// rest of the module is stubbed out — no server/DB dependencies in unit tests.
vi.mock('@/lib/dashboard-access', () => ({
  getWorkspaceNavigation: vi.fn(),
}));

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as unknown as Response;
}

async function loadHook() {
  const { useAttentionBadges } = await import('@/lib/use-attention-badges');
  const { getWorkspaceNavigation } = await import('@/lib/dashboard-access');
  const navMock = getWorkspaceNavigation as ReturnType<typeof vi.fn>;
  return { useAttentionBadges, navMock };
}

const fetchMock = () => vi.mocked(globalThis.fetch);

beforeEach(() => {
  // Fresh module graph per test so the hook's module-level countsCache is
  // isolated between tests (it intentionally persists across mounts/workspace
  // switches within a test).
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('useAttentionBadges', () => {
  it('fetches the badge endpoint declared by the workspace navigation and returns its count', async () => {
    const { useAttentionBadges, navMock } = await loadHook();
    navMock.mockReturnValue([{ badgeQuery: 'approvals:assigned' }]);
    fetchMock().mockResolvedValue(
      jsonResponse({ success: true, data: { total: 3 } }),
    );

    const { result } = renderHook(() => useAttentionBadges('approver' as WorkspaceId));

    await waitFor(() => expect(result.current['approvals:assigned']).toBe(3));
    expect(fetchMock()).toHaveBeenCalledWith('/api/approvals/attention', expect.anything());
  });

  it('never fetches badge queries that have no endpoint entry', async () => {
    const { useAttentionBadges, navMock } = await loadHook();
    navMock.mockReturnValue([{ badgeQuery: 'some:not-wired' }]);

    renderHook(() => useAttentionBadges('approver' as WorkspaceId));
    // Allow any accidental fetch to surface, then assert none happened.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it('keeps the previous count when a background refresh fails', async () => {
    const { useAttentionBadges, navMock } = await loadHook();
    navMock.mockReturnValue([{ badgeQuery: 'approvals:assigned' }]);
    fetchMock().mockResolvedValue(jsonResponse({ success: true, data: { total: 4 } }));

    const first = renderHook(() => useAttentionBadges('approver' as WorkspaceId));
    await waitFor(() => expect(first.result.current['approvals:assigned']).toBe(4));
    first.unmount();

    // Remount the same workspace with the endpoint now failing.
    fetchMock().mockResolvedValue(jsonResponse({ error: 'boom' }, false));
    const second = renderHook(() => useAttentionBadges('approver' as WorkspaceId));

    // The cached value restores instantly, then the failed refresh keeps it.
    expect(second.result.current['approvals:assigned']).toBe(4);
    await waitFor(() => expect(fetchMock()).toHaveBeenCalled());
    expect(second.result.current['approvals:assigned']).toBe(4);
  });

  it('restores the cached counts instantly when switching back to a workspace', async () => {
    const { useAttentionBadges, navMock } = await loadHook();
    navMock.mockImplementation((ws: string) =>
      ws === 'approver'
        ? [{ badgeQuery: 'approvals:assigned' }]
        : [{ badgeQuery: 'trips:assigned-attention' }],
    );
    const counts: Record<string, number> = {
      '/api/approvals/attention': 4,
      '/api/trips/attention': 2,
    };
    fetchMock().mockImplementation(
      (url: RequestInfo | URL) =>
        Promise.resolve(
          jsonResponse({ success: true, data: { total: counts[String(url)] ?? 0 } }),
        ) as Promise<Response>,
    );

    const { result, rerender } = renderHook(
      ({ ws }: { ws: WorkspaceId }) => useAttentionBadges(ws),
      { initialProps: { ws: 'approver' as WorkspaceId } },
    );

    await waitFor(() => expect(result.current['approvals:assigned']).toBe(4));

    act(() => rerender({ ws: 'driver' as WorkspaceId }));
    await waitFor(() => expect(result.current['trips:assigned-attention']).toBe(2));

    act(() => rerender({ ws: 'approver' as WorkspaceId }));
    // Cached, no flash of the previous workspace's badges.
    expect(result.current['approvals:assigned']).toBe(4);
    expect(result.current['trips:assigned-attention']).toBeUndefined();
    // Let the background refresh for the restored workspace settle inside act
    // so its state update isn't flagged as unwrapped.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(result.current['approvals:assigned']).toBe(4);
  });
});
