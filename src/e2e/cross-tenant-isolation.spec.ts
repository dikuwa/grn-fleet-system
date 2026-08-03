/**
 * Cross-Tenant Security Isolation — E2E Test Suite
 *
 * Proves that a user from tenant A (Kavango East) cannot read, list, or
 * mutate tenant B (Zambezi isolation fixture) records through any API.
 *
 * The isolation fixture (tenant ...0002, vehicle ZRC-ISOLATION-001) is seeded
 * by `pnpm db:seed`. For entity types the fixture does not ship (transport
 * requests, audit events, notifications), the suite inserts tenant-B rows
 * directly through getDb, then asserts tenant A cannot see or touch them.
 *
 * Mirrors the role-isolation pattern: cookie-authenticated API contexts.
 */

import {
  test,
  expect,
  request as playwrightRequest,
  type Browser,
} from '@playwright/test';
import { getDb } from '@/db';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { vehicles } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { notifications } from '@/db/schema/notifications';
import { eq } from 'drizzle-orm';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

const ISOLATION_TENANT_ID = '00000000-0000-0000-0000-000000000002';

const accounts = {
  platformAdmin: 'platform.admin@grnfleet.test',
  tenantAdmin: 'admin@kavangoeast.gov.na',
  requester: 'requester@kavangoeast.test',
  transport: 'transport.admin@kavangoeast.test',
} as const;

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const response = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  expect(response.status(), `login ${email}`).toBe(200);
  return api;
}

test.describe.serial('Cross-tenant security isolation', () => {
  test.setTimeout(300_000);

  test('tenant A fleet listing and reports never leak tenant B vehicles', async () => {
    // /api/fleet is workspace-gated to TRANSPORT_ADMIN/INSPECTOR/MAINTENANCE/
    // AUDIT — the tenant admin resolves to the TENANT_ADMIN workspace and gets
    // 403 by design. Use the transport admin (the fleet operator) instead.
    const transport = await login(accounts.transport);
    const fleet = await transport.get('/api/fleet?limit=100');
    expect(fleet.status()).toBe(200);
    expect(JSON.stringify(await fleet.json())).not.toContain('ZRC-ISOLATION-001');

    const fleetReport = await transport.get('/api/reports?type=fleet');
    expect(fleetReport.status()).toBe(200);
    expect(JSON.stringify(await fleetReport.json())).not.toContain('ZRC-ISOLATION-001');
    await transport.dispose();
  });

  test('tenant A cannot read or mutate tenant B vehicle by id', async () => {
    const db = getDb();
    const [isolationVehicle] = await db
      .select({ id: vehicles.id, licenceNumber: vehicles.licenceNumber })
      .from(vehicles)
      .where(eq(vehicles.licenceNumber, 'ZRC-ISOLATION-001'))
      .limit(1);
    test.skip(!isolationVehicle, 'Isolation vehicle not seeded — run pnpm db:seed');
    const vehicleId = isolationVehicle!.id;

    const transport = await login(accounts.transport);
    // Direct read by id → 404 (record belongs to tenant B).
    const read = await transport.get(`/api/fleet/${vehicleId}`);
    expect([403, 404]).toContain(read.status());

    // Direct mutation by id → 404.
    const mutate = await transport.patch(`/api/fleet/${vehicleId}`, {
      data: { status: 'available' },
    });
    expect([403, 404]).toContain(mutate.status());
    await transport.dispose();
  });

  test('tenant A cannot see or cancel a tenant B transport request', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const db = getDb();
    const [isolationVehicle] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.licenceNumber, 'ZRC-ISOLATION-001'))
      .limit(1);
    test.skip(!isolationVehicle, 'Isolation vehicle not seeded — run pnpm db:seed');

    // Fixture: a tenant-B employee + transport request.
    const [isolationEmployee] = await db
      .insert(employees)
      .values({
        tenantId: ISOLATION_TENANT_ID as never,
        employeeNumber: 'ZRC-ISO-001',
        firstName: 'Isolation',
        lastName: 'Employee',
      })
      .returning({ id: employees.id });
    const reference = `GRN/TR/ISO/${Date.now()}`;
    const [isolationRequest] = await db
      .insert(transportRequests)
      .values({
        tenantId: ISOLATION_TENANT_ID as never,
        reference,
        scope: 'regional',
        requesterEmployeeId: isolationEmployee.id,
        purpose: 'Cross-tenant isolation fixture request',
      })
      .returning({ id: transportRequests.id });

    try {
      // Direct action by id → 404 (tenant-scoped lookup).
      const requester = await login(accounts.requester);
      const cancel = await requester.patch(`/api/requests/${isolationRequest.id}/cancel`, {
        data: { reason: 'cross-tenant probe' },
      });
      expect([403, 404]).toContain(cancel.status());
      await requester.dispose();

      // The requests list is server-rendered (no GET list API), so assert
      // isolation through the rendered page: the tenant-B reference never
      // appears for a tenant-A user.
      const ui = await login(accounts.requester);
      const storageState = await ui.storageState();
      const context = await browser.newContext({ storageState });
      const page = await context.newPage();
      await page.goto('/dashboard/requests', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText(reference)).toHaveCount(0);
      await context.close();
      await ui.dispose();
    } finally {
      // Clean up the fixture rows.
      await db
        .delete(transportRequests)
        .where(eq(transportRequests.id, isolationRequest.id));
      await db.delete(employees).where(eq(employees.id, isolationEmployee.id));
    }
  });

  test('tenant A audit log and notifications never include tenant B events', async () => {
    const db = getDb();
    const [isolationVehicle] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.licenceNumber, 'ZRC-ISOLATION-001'))
      .limit(1);
    test.skip(!isolationVehicle, 'Isolation vehicle not seeded — run pnpm db:seed');

    // Fixture: a tenant-B audit event + a tenant-B notification.
    const [isolationAudit] = await db
      .insert(auditEvents)
      .values({
        tenantId: ISOLATION_TENANT_ID as never,
        tenantSequence: 0, // auto-assigned by trigger
        eventType: 'isolation_probe',
        actorUserId: 'zrc-probe-user',
        action: 'probe',
        entityType: 'isolation',
        summary: 'ZRC-ISOLATION-AUDIT-PROBE',
        sourceChannel: 'e2e',
      })
      .returning({ id: auditEvents.id });
    const [isolationNotification] = await db
      .insert(notifications)
      .values({
        tenantId: ISOLATION_TENANT_ID as never,
        type: 'awareness',
        title: 'ZRC-ISOLATION-NOTIFICATION-PROBE',
        audience: 'tenant_admin',
      })
      .returning({ id: notifications.id });

    try {
      const admin = await login(accounts.tenantAdmin);
      const audit = await admin.get('/api/audit?limit=100');
      expect(audit.status()).toBe(200);
      const auditBody = JSON.stringify(await audit.json());
      expect(auditBody).not.toContain('ZRC-ISOLATION-AUDIT-PROBE');
      expect(auditBody).not.toContain(isolationAudit.id);

      const notif = await admin.get('/api/notifications?limit=100');
      expect(notif.status()).toBe(200);
      const notifBody = JSON.stringify(await notif.json());
      expect(notifBody).not.toContain('ZRC-ISOLATION-NOTIFICATION-PROBE');
      expect(notifBody).not.toContain(isolationNotification.id);
      await admin.dispose();
    } finally {
      await db.delete(notifications).where(eq(notifications.id, isolationNotification.id));
      await db.delete(auditEvents).where(eq(auditEvents.id, isolationAudit.id));
    }
  });

  test('tenant users cannot reach platform administration; platform admin can', async () => {
    const requester = await login(accounts.requester);
    const tenantsProbe = await requester.get('/api/platform/tenants');
    expect([403, 404]).toContain(tenantsProbe.status());
    await requester.dispose();

    const platformAdmin = await login(accounts.platformAdmin);
    const tenants = await platformAdmin.get('/api/platform/tenants');
    expect(tenants.status()).toBe(200);
    const body = JSON.stringify(await tenants.json());
    expect(body).toContain('Kavango East Regional Council');
    expect(body).toContain('Zambezi Regional Council');
    await platformAdmin.dispose();
  });
});
