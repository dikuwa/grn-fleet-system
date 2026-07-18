/**
 * Platform Admin API — Unit Tests
 *
 * Tests the route handler logic for:
 * - /api/platform/tenants (GET list, POST create)
 * - /api/platform/tenants/[id] (GET detail, PATCH update)
 * - /api/trip-logs (GET list, POST create)
 *
 * These tests mock the database and auth helpers to verify:
 * - Permission enforcement
 * - Input validation
 * - Response shapes
 * - Tenant scoping
 *
 * Run with: `pnpm test`
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock DB that supports Drizzle-style chaining.
 *
 * All chainable methods return the mockDb itself.
 * The mockDb is then-able: `await mockDb` resolves to the
 * next queued result (pushed via `pushResult()` in order).
 */
function createMockDb() {
  const queue: unknown[][] = [];

  const methods = [
    'select', 'from', 'where', 'limit', 'offset', 'orderBy',
    'groupBy', 'leftJoin', 'innerJoin', 'values', 'returning',
    'insert', 'update', 'set', 'onConflictDoNothing',
  ] as const;

  // Build the MockDb type from method names
  type MockDb = Record<(typeof methods)[number], ReturnType<typeof vi.fn>> & {
    then: (onfulfilled: (v: unknown) => void) => void;
    pushResult: (data: unknown[]) => void;
  };

  const db = {} as MockDb;

  for (const method of methods) {
    (db as Record<string, ReturnType<typeof vi.fn>>)[method] = vi.fn(() => db);
  }

  db.then = (resolve: (v: unknown) => void) => {
    resolve(queue.shift() || []);
  };

  db.pushResult = (data: unknown[]) => {
    queue.push(data);
  };

  return db;
}

/** Shortcut: create a NextResponse 403 */
function mockForbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/** Build an AuthResult error response */
function authError(status: number, message: string) {
  return { ok: false as const, error: NextResponse.json({ error: message }, { status }) };
}

// Mock the DB module
vi.mock('@/db', () => ({
  getDb: vi.fn(),
}));

// Mock auth helpers (must return things that pass instanceof NextResponse)
vi.mock('@/lib/auth-helpers', () => ({
  requireRequestAuth: vi.fn(),
  requirePermission: vi.fn(),
  requireAnyPermission: vi.fn(),
  forbiddenResponse: vi.fn(() => NextResponse.json({ error: 'Forbidden' }, { status: 403 })),
  unauthorizedResponse: vi.fn(() => NextResponse.json({ error: 'Unauthorized' }, { status: 401 })),
}));

// Mock permissions
vi.mock('@/lib/permissions', () => ({
  Permissions: {
    PLATFORM_ADMIN: 'platform:admin',
    TENANT_MANAGE: 'tenant:manage',
    DRIVER_LOG_CREATE: 'driver:log-create',
    TRIP_MANAGE: 'trip:manage',
  },
}));

const MOCK_SESSION = {
  ok: true as const,
  session: {
    user: { id: 'admin-user', email: 'admin@test.gov.na', name: 'Admin', image: null },
    tenantId: 'platform-tenant',
    tenantSlug: 'platform',
  },
};

// ---------------------------------------------------------------------------
// Tests — Platform Tenant List & Create
// ---------------------------------------------------------------------------

describe('Platform Tenants API — GET /api/platform/tenants', () => {
  let route: { GET: (req: Request) => Promise<Response> };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Dynamic import so mocks are in place
    const mod = await import('@/app/api/platform/tenants/route');
    route = mod as { GET: (req: Request) => Promise<Response> };
  });

  it('returns 401 when not authenticated', async () => {
    const { requireRequestAuth } = await import('@/lib/auth-helpers');
    vi.mocked(requireRequestAuth).mockResolvedValue(authError(401, 'Authentication required'));

    const req = { url: 'http://localhost:3000/api/platform/tenants?limit=25&page=1', method: 'GET' };
    const res = await route.GET(req as unknown as Request);
    expect(res.status).toBe(401);
  });

  it('returns 403 without PLATFORM_ADMIN or TENANT_MANAGE', async () => {
    const { requireRequestAuth, requireAnyPermission } = await import('@/lib/auth-helpers');
    vi.mocked(requireRequestAuth).mockResolvedValue(MOCK_SESSION as never);
    vi.mocked(requireAnyPermission).mockResolvedValue(mockForbidden() as never);

    const req = { url: 'http://localhost:3000/api/platform/tenants?limit=25&page=1', method: 'GET' };
    const res = await route.GET(req as unknown as Request);
    expect(res.status).toBe(403);
  });

  it('returns paginated tenants with member counts', async () => {
    const { requireRequestAuth, requireAnyPermission } = await import('@/lib/auth-helpers');
    const { getDb } = await import('@/db');
    vi.mocked(requireRequestAuth).mockResolvedValue(MOCK_SESSION as never);
    vi.mocked(requireAnyPermission).mockResolvedValue(true as never);

    const mockDb = createMockDb();
    // Count query
    mockDb.pushResult([{ count: 2 }]);
    // List query with leftJoin
    mockDb.pushResult([
      { id: '1', name: 'Tenant A', code: 'TA', slug: 'tenant-a', type: 'regional_council', status: 'active', timezone: 'Africa/Windhoek', createdAt: new Date(), updatedAt: new Date(), contactEmail: null, contactPhone: null },
      { id: '2', name: 'Tenant B', code: 'TB', slug: 'tenant-b', type: 'ministry', status: 'active', timezone: 'Africa/Windhoek', createdAt: new Date(), updatedAt: new Date(), contactEmail: null, contactPhone: null },
    ]);
    // Member counts
    mockDb.pushResult([
      { tenantId: '1', count: 5 },
      { tenantId: '2', count: 3 },
    ]);

    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const req = { url: 'http://localhost:3000/api/platform/tenants?limit=25&page=1', method: 'GET' };
    const res = await route.GET(req as unknown as Request);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.tenants).toHaveLength(2);
    expect(json.data.tenants[0].memberCount).toBe(5);
    expect(json.data.tenants[1].memberCount).toBe(3);
    expect(json.data.total).toBe(2);
  });

  it('filters by search query', async () => {
    const { requireRequestAuth, requireAnyPermission } = await import('@/lib/auth-helpers');
    const { getDb } = await import('@/db');
    vi.mocked(requireRequestAuth).mockResolvedValue(MOCK_SESSION as never);
    vi.mocked(requireAnyPermission).mockResolvedValue(true as never);

    const mockDb = createMockDb();
    mockDb.pushResult([{ count: 1 }]);
    mockDb.pushResult([
      { id: '1', name: 'Kavango East', code: 'KERC', slug: 'kavango-east', type: 'regional_council', status: 'active', timezone: 'Africa/Windhoek', createdAt: new Date(), updatedAt: new Date(), contactEmail: null, contactPhone: null },
    ]);
    mockDb.pushResult([{ tenantId: '1', count: 10 }]);

    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const req = { url: 'http://localhost:3000/api/platform/tenants?q=Kavango&limit=25&page=1', method: 'GET' };
    const res = await route.GET(req as unknown as Request);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.tenants).toHaveLength(1);
    expect(json.data.tenants[0].name).toBe('Kavango East');
  });
});

describe('Platform Tenants API — POST /api/platform/tenants', () => {
  let route: { POST: (req: Request) => Promise<Response> };

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/app/api/platform/tenants/route');
    route = mod as { POST: (req: Request) => Promise<Response> };
  });

  it('returns 401 when not authenticated', async () => {
    const { requireRequestAuth } = await import('@/lib/auth-helpers');
    vi.mocked(requireRequestAuth).mockResolvedValue(authError(401, 'Authentication required'));

    const req = {
      url: 'http://localhost:3000/api/platform/tenants',
      method: 'POST',
      json: async () => ({}),
    };
    const res = await route.POST(req as unknown as Request);
    expect(res.status).toBe(401);
  });

  it('returns 403 without TENANT_MANAGE permission', async () => {
    const { requireRequestAuth, requirePermission } = await import('@/lib/auth-helpers');
    vi.mocked(requireRequestAuth).mockResolvedValue(MOCK_SESSION as never);
    vi.mocked(requirePermission).mockResolvedValue(mockForbidden() as never);

    const req = {
      url: 'http://localhost:3000/api/platform/tenants',
      method: 'POST',
      json: async () => ({ name: 'Test', code: 'TEST', slug: 'test' }),
    };
    const res = await route.POST(req as unknown as Request);
    expect(res.status).toBe(403);
  });

  it('validates required fields', async () => {
    const { requireRequestAuth, requirePermission } = await import('@/lib/auth-helpers');
    vi.mocked(requireRequestAuth).mockResolvedValue(MOCK_SESSION as never);
    vi.mocked(requirePermission).mockResolvedValue(true as never);

    // Missing name
    const req1 = {
      url: 'http://localhost:3000/api/platform/tenants',
      method: 'POST',
      json: async () => ({ code: 'TEST', slug: 'test' }),
    };
    const res1 = await route.POST(req1 as unknown as Request);
    expect(res1.status).toBe(400);

    // Missing code
    const req2 = {
      url: 'http://localhost:3000/api/platform/tenants',
      method: 'POST',
      json: async () => ({ name: 'Test', slug: 'test' }),
    };
    const res2 = await route.POST(req2 as unknown as Request);
    expect(res2.status).toBe(400);

    // Missing slug
    const req3 = {
      url: 'http://localhost:3000/api/platform/tenants',
      method: 'POST',
      json: async () => ({ name: 'Test', code: 'TEST' }),
    };
    const res3 = await route.POST(req3 as unknown as Request);
    expect(res3.status).toBe(400);
  });

  it('creates a tenant successfully with default branding', async () => {
    const { requireRequestAuth, requirePermission } = await import('@/lib/auth-helpers');
    const { getDb } = await import('@/db');
    vi.mocked(requireRequestAuth).mockResolvedValue(MOCK_SESSION as never);
    vi.mocked(requirePermission).mockResolvedValue(true as never);

    const mockDb = createMockDb();
    // Check for existing tenant — none found
    mockDb.pushResult([]);
    // Insert returning
    mockDb.pushResult([{ id: 'new-tenant', name: 'Test Tenant', code: 'TEST', slug: 'test', type: 'regional_council', status: 'active', timezone: 'Africa/Windhoek', locale: 'en-NA', createdAt: new Date(), updatedAt: new Date() }]);

    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const req = {
      url: 'http://localhost:3000/api/platform/tenants',
      method: 'POST',
      json: async () => ({ name: 'Test Tenant', code: 'TEST', slug: 'test-tenant', type: 'regional_council' }),
    };
    const res = await route.POST(req as unknown as Request);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.name).toBe('Test Tenant');

    // Verify branding was created
    expect(mockDb.insert).toHaveBeenCalledTimes(2); // tenant + branding
  });

  it('rejects duplicate code or slug', async () => {
    const { requireRequestAuth, requirePermission } = await import('@/lib/auth-helpers');
    const { getDb } = await import('@/db');
    vi.mocked(requireRequestAuth).mockResolvedValue(MOCK_SESSION as never);
    vi.mocked(requirePermission).mockResolvedValue(true as never);

    const mockDb = createMockDb();
    // Existing tenant found with same code
    mockDb.pushResult([{ id: 'existing', code: 'TEST', slug: 'other' }]);

    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const req = {
      url: 'http://localhost:3000/api/platform/tenants',
      method: 'POST',
      json: async () => ({ name: 'Dup Tenant', code: 'TEST', slug: 'test-dup' }),
    };
    const res = await route.POST(req as unknown as Request);
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Tests — Platform Tenant Detail
// ---------------------------------------------------------------------------

describe('Platform Tenants API — GET /api/platform/tenants/[id]', () => {
  let route: { GET: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> };

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/app/api/platform/tenants/[id]/route');
    route = mod as { GET: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> };
  });

  it('returns 404 for non-existent tenant', async () => {
    const { requireRequestAuth, requireAnyPermission } = await import('@/lib/auth-helpers');
    const { getDb } = await import('@/db');
    vi.mocked(requireRequestAuth).mockResolvedValue(MOCK_SESSION as never);
    vi.mocked(requireAnyPermission).mockResolvedValue(true as never);

    const mockDb = createMockDb();
    // Tenant not found
    mockDb.pushResult([]);

    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const req = { url: 'http://localhost:3000/api/platform/tenants/nonexistent', method: 'GET' };
    const res = await route.GET(req as unknown as Request, { params: Promise.resolve({ id: 'nonexistent' }) });
    expect(res.status).toBe(404);
  });

  it('returns tenant detail with branding and stats', async () => {
    const { requireRequestAuth, requireAnyPermission } = await import('@/lib/auth-helpers');
    const { getDb } = await import('@/db');
    vi.mocked(requireRequestAuth).mockResolvedValue(MOCK_SESSION as never);
    vi.mocked(requireAnyPermission).mockResolvedValue(true as never);

    const mockDb = createMockDb();
    const tenant = { id: 't1', name: 'Test Tenant', code: 'TT', slug: 'test', type: 'regional_council', status: 'active', timezone: 'Africa/Windhoek', locale: 'en-NA', metadata: {}, createdAt: new Date(), updatedAt: new Date() };
    const branding = { id: 'b1', tenantId: 't1', logoUrl: null, primaryColor: '#1F4E8C', accentColor: '#0F766E', contactEmail: 'admin@test.gov.na', contactPhone: '+264 61 123 456', address: 'Windhoek', senderName: 'Test Tenant Transport', senderEmail: 'transport@test.gov.na' };

    // Tenant query
    mockDb.pushResult([tenant]);
    // Branding query
    mockDb.pushResult([branding]);
    // Member count
    mockDb.pushResult([{ count: 7 }]);

    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const req = { url: 'http://localhost:3000/api/platform/tenants/t1', method: 'GET' };
    const res = await route.GET(req as unknown as Request, { params: Promise.resolve({ id: 't1' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.name).toBe('Test Tenant');
    expect(json.data.branding.contactEmail).toBe('admin@test.gov.na');
    expect(json.data.stats.memberCount).toBe(7);
  });
});

describe('Platform Tenants API — PATCH /api/platform/tenants/[id]', () => {
  let route: { PATCH: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> };

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/app/api/platform/tenants/[id]/route');
    route = mod as { PATCH: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> };
  });

  it('updates tenant general fields', async () => {
    const { requireRequestAuth, requirePermission } = await import('@/lib/auth-helpers');
    const { getDb } = await import('@/db');
    vi.mocked(requireRequestAuth).mockResolvedValue(MOCK_SESSION as never);
    vi.mocked(requirePermission).mockResolvedValue(true as never);

    const mockDb = createMockDb();
    const existingTenant = { id: 't1', name: 'Old Name', code: 'OT', slug: 'old', type: 'regional_council', status: 'active', timezone: 'Africa/Windhoek', locale: 'en-NA', metadata: {}, createdAt: new Date(), updatedAt: new Date() };
    const updatedTenant = { ...existingTenant, name: 'New Name', status: 'suspended', updatedAt: new Date() };

    // Find existing
    mockDb.pushResult([existingTenant]);
    // Update query
    mockDb.pushResult([]);
    // Fetch updated tenant (PATCH re-fetches after update)
    mockDb.pushResult([updatedTenant]);

    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const req = {
      url: 'http://localhost:3000/api/platform/tenants/t1',
      method: 'PATCH',
      json: async () => ({ name: 'New Name', status: 'suspended' }),
    };
    const res = await route.PATCH(req as unknown as Request, { params: Promise.resolve({ id: 't1' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.name).toBe('New Name');
  });

  it('updates tenant branding fields', async () => {
    const { requireRequestAuth, requirePermission } = await import('@/lib/auth-helpers');
    const { getDb } = await import('@/db');
    vi.mocked(requireRequestAuth).mockResolvedValue(MOCK_SESSION as never);
    vi.mocked(requirePermission).mockResolvedValue(true as never);

    const mockDb = createMockDb();
    const existingTenant = { id: 't1', name: 'Test', code: 'TT', slug: 'test', type: 'regional_council', status: 'active', timezone: 'Africa/Windhoek', locale: 'en-NA', metadata: {}, createdAt: new Date(), updatedAt: new Date() };
    const existingBranding = { id: 'b1', tenantId: 't1', primaryColor: '#1F4E8C' };

    // Find existing tenant
    mockDb.pushResult([existingTenant]);
    // Find existing branding
    mockDb.pushResult([existingBranding]);
    // Fetch updated tenant
    mockDb.pushResult([existingTenant]);

    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const req = {
      url: 'http://localhost:3000/api/platform/tenants/t1',
      method: 'PATCH',
      json: async () => ({ contactEmail: 'new@test.gov.na', primaryColor: '#FF0000' }),
    };
    const res = await route.PATCH(req as unknown as Request, { params: Promise.resolve({ id: 't1' }) });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Tests — Trip Logs API
// ---------------------------------------------------------------------------

describe('Trip Logs API — GET /api/trip-logs', () => {
  let route: { GET: (req: Request) => Promise<Response> };

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/app/api/trip-logs/route');
    route = mod as { GET: (req: Request) => Promise<Response> };
  });

  it('returns 401 when not authenticated', async () => {
    const { requireRequestAuth } = await import('@/lib/auth-helpers');
    vi.mocked(requireRequestAuth).mockResolvedValue(authError(401, 'Authentication required'));

    const req = { url: 'http://localhost:3000/api/trip-logs', method: 'GET' };
    const res = await route.GET(req as unknown as Request);
    expect(res.status).toBe(401);
  });

  it('returns log entries for authenticated user', async () => {
    const { requireRequestAuth } = await import('@/lib/auth-helpers');
    const { getDb } = await import('@/db');
    vi.mocked(requireRequestAuth).mockResolvedValue(MOCK_SESSION as never);

    const mockDb = createMockDb();
    mockDb.pushResult([
      { id: 'log-1', tripId: 'trip-1', logDate: new Date(), odometerOut: 1000, odometerIn: 1050, departureTime: new Date(), arrivalTime: new Date(), origin: 'Rundu', destination: 'Divundu', distanceKm: 50, remarks: null, isSynced: true, syncState: 'synced', createdAt: new Date(), licenceNumber: 'GRN-001', make: 'Toyota', model: 'Hilux' },
    ]);

    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const req = { url: 'http://localhost:3000/api/trip-logs?limit=50', method: 'GET' };
    const res = await route.GET(req as unknown as Request);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].origin).toBe('Rundu');
  });
});

describe('Trip Logs API — POST /api/trip-logs', () => {
  let route: { POST: (req: Request) => Promise<Response> };

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/app/api/trip-logs/route');
    route = mod as { POST: (req: Request) => Promise<Response> };
  });

  it('returns 403 without DRIVER_LOG_CREATE or TRIP_MANAGE', async () => {
    const { requireRequestAuth, requirePermission } = await import('@/lib/auth-helpers');
    vi.mocked(requireRequestAuth).mockResolvedValue(MOCK_SESSION as never);
    // Both permission checks return 403
    vi.mocked(requirePermission).mockResolvedValue(mockForbidden() as never);

    const req = {
      url: 'http://localhost:3000/api/trip-logs',
      method: 'POST',
      json: async () => ({ tripId: 'trip-1', logDate: '2026-07-15' }),
    };
    const res = await route.POST(req as unknown as Request);
    expect(res.status).toBe(403);
  });

  it('validates required tripId and logDate', async () => {
    const { requireRequestAuth, requirePermission } = await import('@/lib/auth-helpers');
    vi.mocked(requireRequestAuth).mockResolvedValue(MOCK_SESSION as never);
    vi.mocked(requirePermission).mockResolvedValue(true as never);

    // Missing tripId
    const req1 = {
      url: 'http://localhost:3000/api/trip-logs',
      method: 'POST',
      json: async () => ({ logDate: '2026-07-15' }),
    };
    const res1 = await route.POST(req1 as unknown as Request);
    expect(res1.status).toBe(400);

    // Missing logDate
    const req2 = {
      url: 'http://localhost:3000/api/trip-logs',
      method: 'POST',
      json: async () => ({ tripId: 'trip-1' }),
    };
    const res2 = await route.POST(req2 as unknown as Request);
    expect(res2.status).toBe(400);
  });

  it('creates log entry successfully', async () => {
    const { requireRequestAuth, requirePermission } = await import('@/lib/auth-helpers');
    const { getDb } = await import('@/db');
    vi.mocked(requireRequestAuth).mockResolvedValue(MOCK_SESSION as never);
    vi.mocked(requirePermission).mockResolvedValue(true as never);

    const mockDb = createMockDb();
    const trip = { id: 'trip-1', tenantId: 'platform-tenant' };
    const newEntry = { id: 'log-new', tripId: 'trip-1', logDate: new Date('2026-07-15'), odometerOut: 1000, odometerIn: null, origin: 'Rundu', destination: 'Divundu', distanceKm: null, remarks: null, isSynced: true, syncState: 'synced', createdAt: new Date() };

    // Trip lookup
    mockDb.pushResult([trip]);
    // Insert returning
    mockDb.pushResult([newEntry]);

    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const req = {
      url: 'http://localhost:3000/api/trip-logs',
      method: 'POST',
      json: async () => ({ tripId: 'trip-1', logDate: '2026-07-15', odometerOut: 1000, origin: 'Rundu', destination: 'Divundu' }),
    };
    const res = await route.POST(req as unknown as Request);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.origin).toBe('Rundu');
  });

  it('rejects cross-tenant trip access', async () => {
    const { requireRequestAuth, requirePermission } = await import('@/lib/auth-helpers');
    const { getDb } = await import('@/db');
    vi.mocked(requireRequestAuth).mockResolvedValue(MOCK_SESSION as never);
    vi.mocked(requirePermission).mockResolvedValue(true as never);

    const mockDb = createMockDb();
    const trip = { id: 'trip-1', tenantId: 'other-tenant' }; // Wrong tenant

    mockDb.pushResult([trip]);

    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const req = {
      url: 'http://localhost:3000/api/trip-logs',
      method: 'POST',
      json: async () => ({ tripId: 'trip-1', logDate: '2026-07-15' }),
    };
    const res = await route.POST(req as unknown as Request);
    expect(res.status).toBe(403);

    const json = await res.json();
    expect(json.error).toContain('not belong');
  });
});
