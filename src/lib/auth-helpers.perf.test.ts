/**
 * Perf regression guard for auth-helper role context.
 *
 * Every dashboard page calls hasPermission / getSessionRoleNames several
 * times per render. Each call used to run its own chain of remote Neon
 * queries (membership → assignments → permissions → names), which made simple
 * pages take 6–9s to render. The fix routes all helpers through one
 * `loadRoleContext` wrapped in React.cache so the chain runs once per
 * (user, tenant) per request.
 *
 * React.cache only deduplicates inside a Next.js request scope
 * (AsyncLocalStorage), which vitest does not provide — so this test cannot
 * assert "N calls → 1 query set" behaviourally. Instead it guards the
 * structure that makes the memoization possible:
 *
 *   1. auth-helpers actually wraps its loader with React.cache, and
 *   2. the loader still resolves permissions correctly (no behaviour drift).
 *
 * The end-to-end latency guard lives in scripts/bench-pages.mjs, which times
 * real page renders against a budget against a running server.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const cacheSpy = vi.fn();

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    cache: vi.fn((fn: unknown) => {
      cacheSpy(fn);
      return actual.cache(fn as Parameters<typeof actual.cache>[0]);
    }),
  };
});

vi.mock('@/db', () => ({
  getDb: vi.fn(),
}));

function createMockDb() {
  const queue: unknown[][] = [];
  const methods = [
    'select', 'from', 'where', 'limit', 'offset', 'orderBy', 'leftJoin',
    'innerJoin', 'values', 'returning', 'insert', 'update', 'set',
  ] as const;

  const db = {} as Record<(typeof methods)[number], ReturnType<typeof vi.fn>> & {
    then: (onfulfilled: (v: unknown) => void) => void;
    pushResult: (data: unknown[]) => void;
  };

  for (const method of methods) {
    db[method] = vi.fn(() => db);
  }
  db.then = (resolve: (v: unknown) => void) => {
    resolve(queue.shift() || []);
  };
  db.pushResult = (data: unknown[]) => {
    queue.push(data);
  };
  return db;
}

const SESSION = {
  user: { id: 'user-1', email: 'u@test.gov.na', name: 'U', image: null },
  tenantId: 'tenant-1',
  tenantSlug: 'test',
};

describe('auth-helpers role context memoization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wraps the role-context loader with React.cache and still resolves permissions', async () => {
    const mod = await import('@/lib/auth-helpers');
    const { getDb } = await import('@/db');

    const mockDb = createMockDb();
    // membership
    mockDb.pushResult([{ id: 'membership-1', activeWorkspace: 'transport_admin' }]);
    // role assignments
    mockDb.pushResult([{ roleId: 'role-1', startDate: new Date('2020-01-01'), endDate: null }]);
    // roles + permissions (parallel batch)
    mockDb.pushResult([{ name: 'Transport Administrator' }]);
    mockDb.pushResult([{ permissionCode: 'staff:view' }]);

    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const allowed = await mod.hasPermission(SESSION as never, 'staff:view' as never);

    // Behavioural check — the loader still resolves permissions correctly.
    expect(allowed).toBe(true);

    // Structural check — the loader was created through React.cache, so it is
    // keyed per (user, tenant) and deduplicated inside a real request scope.
    expect(cacheSpy).toHaveBeenCalled();
    const wrappedLoaders = cacheSpy.mock.calls.map(([fn]) => fn);
    expect(wrappedLoaders.some((fn) => typeof fn === 'function' && fn.length === 2)).toBe(true);
  });
  it('rejects when the user has no active membership', async () => {
    const mod = await import('@/lib/auth-helpers');
    const { getDb } = await import('@/db');

    const mockDb = createMockDb();
    // membership lookup returns no rows → loader resolves null → no permission
    mockDb.pushResult([]);
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const allowed = await mod.hasPermission(SESSION as never, 'staff:view' as never);
    expect(allowed).toBe(false);
  });
});
