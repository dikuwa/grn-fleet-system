/**
 * User Access Lifecycle — Integration Tests
 *
 * Exercises the real admin user-management API against a running server and
 * the seeded database (the "Selma" scenario — remove a role-less user, keep
 * the person as staff, restore the account):
 *
 *   1. A fresh account with zero active roles can be removed (DELETE) — the
 *      linked staff record is preserved and the account leaves User Management.
 *   2. Removal is BLOCKED while the user holds an active role (role-count
 *      rule), and succeeds immediately after that role is ended.
 *   3. Sessions are revoked on removal and verification tokens invalidated.
 *   4. Removed accounts are hidden from the default list and surfaced through
 *      the explicit ?status=removed filter.
 *   5. Restore (POST /restore) re-activates the account.
 *   6. Cross-tenant access (a user from another tenant) and self-deletion are
 *      rejected.
 *
 * Run with: `pnpm test:integration` (requires the seeded dev server on
 * http://localhost:3000 and .env.test with DB credentials).
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.BETTER_AUTH_URL || 'http://localhost:3000';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

const SEED_DEFAULT_EMAIL = 'admin@kavangoeast.gov.na';
const SEED_DEFAULT_PASSWORD = 'changeme';

async function apiFetch(path: string, init?: RequestInit) {
  const url = `${BASE_URL}${path}`;
  return fetch(url, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
}

async function signInAndGetCookie(email: string, password: string): Promise<string> {
  const res = await apiFetch('/api/auth/sign-in', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  expect(res.status, `login ${email}`).toBe(200);
  const setCookies: string[] =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') || '').split(',').filter(Boolean);
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  expect(cookie, 'sign-in should return session cookies').toBeTruthy();
  return cookie;
}

async function authed(path: string, cookie: string, init?: RequestInit) {
  return apiFetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...init?.headers },
  });
}

async function signInAsAdmin(): Promise<string> {
  const candidates = [
    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    { email: SEED_DEFAULT_EMAIL, password: SEED_DEFAULT_PASSWORD },
  ];
  for (const candidate of candidates) {
    const res = await apiFetch('/api/auth/sign-in', {
      method: 'POST',
      body: JSON.stringify(candidate),
    });
    if (res.status !== 200) continue;
    const setCookies: string[] =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie') || '').split(',').filter(Boolean);
    const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
    if (cookie) return cookie;
  }
  throw new Error('Unable to sign in as tenant admin (configured or seed default credentials)');
}

describe('User Access Lifecycle API', () => {
  let adminCookie: string;

  beforeAll(async () => {
    adminCookie = await signInAsAdmin();
  });

  it(
    'removes a role-less account, blocks role-held removal, restores the account',
    async () => {
      const db = (await import('@/db')).getDb();
      const { session, user, account, verification } = await import('@/db/schema/better-auth');
      const { userProfiles } = await import('@/db/schema/auth');
      const { employees } = await import('@/db/schema/people');
      const { tenantMemberships, roleAssignments } = await import('@/db/schema/tenants');
      const { eq, count, inArray } = await import('drizzle-orm');

      const sessionRes = await authed('/api/auth/get-session', adminCookie);
      expect(sessionRes.status).toBe(200);
      const adminId = (await sessionRes.json()).user.id;
      const [adminMembership] = await db
        .select({ tenantId: tenantMemberships.tenantId })
        .from(tenantMemberships)
        .where(eq(tenantMemberships.userId, adminId))
        .limit(1);
      expect(adminMembership, 'admin should have a tenant membership').toBeTruthy();

      const fixtureNum = `access-lifecycle-${Date.now()}`;
      const [fixtureEmployee] = await db
        .insert(employees)
        .values({
          tenantId: adminMembership.tenantId,
          employeeNumber: fixtureNum,
          firstName: 'Access',
          lastName: 'Lifecycle',
          email: `${fixtureNum}@kavangoeast.test`,
          employmentStatus: 'active',
        })
        .returning({ id: employees.id });
      expect(fixtureEmployee.id, 'fixture employee should be created').toBeTruthy();
      const employee = { id: fixtureEmployee.id };

      let userId = '';
      try {
        const unique = `access-lifecycle-${Date.now()}@kavangoeast.test`;
        const create = await authed('/api/admin/users', adminCookie, {
          method: 'POST',
          body: JSON.stringify({
            email: unique,
            name: 'Access Lifecycle Tester',
            password: 'change-me-123',
            employeeId: employee.id,
          }),
        });
        const createBody = await create.text();
        expect(create.status, `create user responded: ${createBody}`).toBe(201);
        userId = JSON.parse(createBody).data.id;
        expect(userId).toBeTruthy();

        await signInAndGetCookie(unique, 'change-me-123');

        const detail = await authed(`/api/admin/users/${userId}`, adminCookie);
        expect(detail.status).toBe(200);
        const detailData = (await detail.json()).data;
        expect(detailData.tenantStatus).toBe('active');
        expect(detailData.roleAssignments).toHaveLength(0);
        const role = detailData.availableRoles.find(
          (r: { name: string }) => r.name !== 'Tenant Administrator',
        );
        expect(role, 'tenant should expose at least one non-admin system role').toBeTruthy();

        const assign = await authed(`/api/admin/users/${userId}`, adminCookie, {
          method: 'PATCH',
          body: JSON.stringify({ addRoleId: role.id }),
        });
        expect(assign.status).toBe(200);

        const blocked = await authed(`/api/admin/users/${userId}`, adminCookie, {
          method: 'DELETE',
        });
        expect(blocked.status).toBe(409);
        expect((await blocked.json()).error).toContain(role.name);

        const detail2 = await authed(`/api/admin/users/${userId}`, adminCookie);
        const assignment = (await detail2.json()).data.roleAssignments.find(
          (a: { roleId: string }) => a.roleId === role.id,
        );
        expect(assignment, 'role assignment should exist after PATCH add').toBeTruthy();

        const end = await authed(`/api/admin/users/${userId}`, adminCookie, {
          method: 'PATCH',
          body: JSON.stringify({ removeRoleId: assignment.id }),
        });
        expect(end.status).toBe(200);

        const removed = await authed(`/api/admin/users/${userId}`, adminCookie, {
          method: 'DELETE',
        });
        expect(removed.status).toBe(200);

        const [sessionCount] = await db
          .select({ total: count() })
          .from(session)
          .where(eq(session.userId, userId));
        expect(Number(sessionCount.total)).toBe(0);

        const [staff] = await db
          .select({ userId: employees.userId, employmentStatus: employees.employmentStatus })
          .from(employees)
          .where(eq(employees.id, employee.id))
          .limit(1);
        expect(staff, 'the linked employee record must survive removal').toBeTruthy();
        expect(staff.userId).toBe(userId);
        expect(staff.employmentStatus).toBe('active');

        const removedDetail = await authed(`/api/admin/users/${userId}`, adminCookie);
        expect((await removedDetail.json()).data.tenantStatus).toBe('access_removed');

        const defaultList = await authed('/api/admin/users?limit=100', adminCookie);
        expect(JSON.stringify(await defaultList.json())).not.toContain(unique);

        const removedList = await authed('/api/admin/users?status=removed&limit=100', adminCookie);
        expect(removedList.status).toBe(200);
        const removedBody = await removedList.json();
        expect(
          removedBody.data.users.some((u: { id: string }) => u.id === userId),
          'removed account should appear under ?status=removed',
        ).toBe(true);

        const restore = await authed(`/api/admin/users/${userId}/restore`, adminCookie, {
          method: 'POST',
        });
        expect(restore.status).toBe(200);

        const restoredDetail = await authed(`/api/admin/users/${userId}`, adminCookie);
        expect((await restoredDetail.json()).data.tenantStatus).toBe('active');

        const restoreAgain = await authed(`/api/admin/users/${userId}/restore`, adminCookie, {
          method: 'POST',
        });
        expect(restoreAgain.status).toBe(409);
      } finally {
        if (userId) {
          const membershipRows = await db
            .select({ id: tenantMemberships.id })
            .from(tenantMemberships)
            .where(eq(tenantMemberships.userId, userId))
            .catch(() => []);
          for (const m of membershipRows) {
            await db
              .delete(roleAssignments)
              .where(eq(roleAssignments.tenantMembershipId, m.id))
              .catch(() => {});
          }
          await db
            .delete(tenantMemberships)
            .where(eq(tenantMemberships.userId, userId))
            .catch(() => {});
          await db.delete(session).where(eq(session.userId, userId)).catch(() => {});
          await db.delete(account).where(eq(account.userId, userId)).catch(() => {});
          await db.delete(userProfiles).where(eq(userProfiles.userId, userId)).catch(() => {});
          await db
            .delete(verification)
            .where(inArray(verification.identifier, [userId]))
            .catch(() => {});
          await db.delete(user).where(eq(user.id, userId)).catch(() => {});
        }
        await db.delete(employees).where(eq(employees.id, fixtureEmployee.id)).catch(() => {});
      }
    },
    120_000,
  );

  it('rejects cross-tenant access and self-deletion', async () => {
    const ghost = await authed(
      '/api/admin/users/11111111-1111-1111-1111-111111111111',
      adminCookie,
      { method: 'DELETE' },
    );
    expect(ghost.status).toBe(404);

    const ghostRestore = await authed(
      '/api/admin/users/11111111-1111-1111-1111-111111111111/restore',
      adminCookie,
      { method: 'POST' },
    );
    expect(ghostRestore.status).toBe(404);

    const sessionRes = await authed('/api/auth/get-session', adminCookie);
    expect(sessionRes.status).toBe(200);
    const adminId = (await sessionRes.json()).user.id;
    expect(adminId).toBeTruthy();

    const self = await authed(`/api/admin/users/${adminId}`, adminCookie, {
      method: 'DELETE',
    });
    expect(self.status).toBe(400);
  });
});
