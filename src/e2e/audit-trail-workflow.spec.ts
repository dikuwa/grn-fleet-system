/**
 * Audit Trail Workflow — End-to-End Test
 *
 * Verifies that key actions produce audit events visible via the audit API:
 *   1. Fuel transaction → audit event: fuel_created
 *   2. Maintenance event → audit event: maintenance_created
 *   3. Region CRUD → audit events: region_created, region_updated, region_deleted
 *   4. Cancelled transport request → audit event: request_cancelled
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function signIn(page: Page) {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na';
  const password = process.env.SEED_ADMIN_PASSWORD || 'changeme';

  const res = await page.request.post(`${BASE}/api/auth/sign-in`, {
    data: { email, password },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  const token = body.token || body.session?.token;
  expect(token).toBeDefined();

  await page.context().addCookies([
    {
      name: 'better-auth.session_token',
      value: token,
      domain: new URL(BASE).hostname,
      path: '/',
      httpOnly: false,
      sameSite: 'Lax',
    },
  ]);

  return { token, user: body.user || body.session?.user };
}

async function getCookieHeader(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const token = cookies.find((c) => c.name === 'better-auth.session_token')?.value ?? '';
  return `better-auth.session_token=${token}`;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('Audit Trail Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  // -----------------------------------------------------------------------
  // Fuel transaction → fuel_created audit event
  // -----------------------------------------------------------------------

  test('1. fuel transaction creates fuel_created audit event', async ({ page }) => {
    // Get a vehicle from the fleet
    const fleetRes = await page.request.get(`${BASE}/api/fleet`, {
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(fleetRes.status()).toBe(200);
    const fleetBody = await fleetRes.json().catch(() => ({}));
    const vehicles = fleetBody?.data || fleetBody?.vehicles || fleetBody || [];
    const vehicle = Array.isArray(vehicles)
      ? vehicles.find((v: { status?: string }) => v.status === 'active' || v.status === 'available' || !v.status)
      : null;
    test.skip(!vehicle, 'No vehicle found for fuel audit test');

    // Create a fuel transaction
    const fuelRes = await page.request.post(`${BASE}/api/fuel`, {
      data: {
        vehicleId: vehicle.id,
        fuelType: 'diesel',
        litres: 45.5,
        amount: 780.00,
        paymentMethod: 'fuel_card',
        stationName: 'Total Energies Rundu',
        transactionAt: new Date().toISOString(),
      },
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(fuelRes.status()).toBe(200);

    // Query the audit API for the fuel_created event
    const auditRes = await page.request.get(`${BASE}/api/audit?eventType=fuel_created&limit=10`, {
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(auditRes.status()).toBe(200);
    const auditBody = await auditRes.json();
    expect(auditBody.success).toBe(true);

    const events = auditBody.data?.events || [];
    const fuelEvent = events.length > 0 ? events[0] : null;
    expect(fuelEvent).toBeTruthy();
    expect(fuelEvent.eventType).toBe('fuel_created');
    expect(fuelEvent.action).toBe('create');
    expect(fuelEvent.entityType).toBe('fuel_transaction');

    // Summary should contain litres, fuel type, and station
    expect(fuelEvent.summary).toContain('45.5');
    expect(fuelEvent.summary).toContain('diesel');
  });

  // -----------------------------------------------------------------------
  // Maintenance event → maintenance_created audit event
  // -----------------------------------------------------------------------

  test('2. maintenance event creates maintenance_created audit event', async ({ page }) => {
    // Get a vehicle
    const fleetRes = await page.request.get(`${BASE}/api/fleet`, {
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(fleetRes.status()).toBe(200);
    const fleetBody = await fleetRes.json().catch(() => ({}));
    const vehicles = fleetBody?.data || fleetBody?.vehicles || fleetBody || [];
    const vehicle = Array.isArray(vehicles) ? vehicles[0] : null;
    test.skip(!vehicle, 'No vehicle found for maintenance audit test');

    // Create a maintenance event
    const maintRes = await page.request.post(`${BASE}/api/maintenance`, {
      data: {
        vehicleId: vehicle.id,
        serviceDate: new Date().toISOString().split('T')[0],
        serviceType: 'scheduled',
        description: 'E2E audit test — scheduled service',
        cost: 1200.00,
        vendorName: 'Rundu Gvt Garage',
      },
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(maintRes.status()).toBe(201);

    // Query audit for maintenance_created
    const auditRes = await page.request.get(`${BASE}/api/audit?eventType=maintenance_created&limit=10`, {
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(auditRes.status()).toBe(200);
    const auditBody = await auditRes.json();

    const events = auditBody.data?.events || [];
    const maintEvent = events.length > 0 ? events[0] : null;
    expect(maintEvent).toBeTruthy();
    expect(maintEvent.eventType).toBe('maintenance_created');
    expect(maintEvent.action).toBe('create');
    expect(maintEvent.entityType).toBe('maintenance_event');
    expect(maintEvent.summary).toContain('scheduled');
  });

  // -----------------------------------------------------------------------
  // Region CRUD → region_created, region_updated, region_deleted audit events
  // -----------------------------------------------------------------------

  test('3. region CRUD produces audit events for create, update, and delete', async ({ page }) => {
    const uniqueCode = `E2E-${Date.now()}`;
    const uniqueName = `E2E Test Region ${Date.now()}`;

    // CREATE: Create a region
    const createRes = await page.request.post(`${BASE}/api/regions`, {
      data: {
        name: uniqueName,
        code: uniqueCode,
        description: 'E2E audit test region',
      },
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(createRes.status()).toBe(201);
    const createBody = await createRes.json();
    const regionId = createBody.region?.id;
    expect(regionId).toBeTruthy();

    // Verify region_created audit event
    const createdAudit = await page.request.get(`${BASE}/api/audit?eventType=region_created&limit=10`, {
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(createdAudit.status()).toBe(200);
    const createdBody = await createdAudit.json();
    const createdEvents = createdBody.data?.events || [];
    const createEvent = createdEvents.find((e: { summary?: string }) => e.summary?.includes(uniqueCode));
    expect(createEvent).toBeTruthy();
    expect(createEvent.eventType).toBe('region_created');
    expect(createEvent.action).toBe('create');
    expect(createEvent.entityType).toBe('region');

    // UPDATE: Update the region name
    const updateRes = await page.request.patch(`${BASE}/api/regions`, {
      data: {
        id: regionId,
        name: `${uniqueName} (Updated)`,
      },
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(updateRes.status()).toBe(200);

    // Verify region_updated audit event
    const updatedAudit = await page.request.get(`${BASE}/api/audit?eventType=region_updated&limit=10`, {
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(updatedAudit.status()).toBe(200);
    const updatedBody = await updatedAudit.json();
    const updatedEvents = updatedBody.data?.events || [];
    const updateEvent = updatedEvents.find((e: { summary?: string }) => e.summary?.includes(uniqueName));
    expect(updateEvent).toBeTruthy();
    expect(updateEvent.eventType).toBe('region_updated');
    expect(updateEvent.action).toBe('update');

    // DELETE: Delete the region
    const deleteRes = await page.request.delete(`${BASE}/api/regions?id=${regionId}`, {
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(deleteRes.status()).toBe(200);

    // Verify region_deleted audit event
    const deletedAudit = await page.request.get(`${BASE}/api/audit?eventType=region_deleted&limit=10`, {
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(deletedAudit.status()).toBe(200);
    const deletedBody = await deletedAudit.json();
    const deletedEvents = deletedBody.data?.events || [];
    const deleteEvent = deletedEvents.find((e: { summary?: string }) => e.summary?.includes(regionId));
    expect(deleteEvent).toBeTruthy();
    expect(deleteEvent.eventType).toBe('region_deleted');
    expect(deleteEvent.action).toBe('delete');
  });

  // -----------------------------------------------------------------------
  // Request cancellation → request_cancelled audit event
  // -----------------------------------------------------------------------

  test('4. transport request cancellation produces request_cancelled audit event', async ({ page }) => {
    // Get an existing transport request that can be cancelled
    const requestsRes = await page.request.get(`${BASE}/api/transport-requests?limit=20`, {
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(requestsRes.status()).toBe(200);
    const requestsBody = await requestsRes.json().catch(() => ({}));
    const allRequests = requestsBody?.data || requestsBody?.requests || requestsBody || [];
    const cancellable = Array.isArray(allRequests)
      ? allRequests.find((r: { status: string }) =>
          !['closed', 'cancelled', 'in_progress', 'vehicle_issued'].includes(r.status)
        )
      : null;

    test.skip(!cancellable, 'No cancellable transport request found');

    // Cancel it
    const cancelRes = await page.request.patch(`${BASE}/api/requests/${cancellable.id}/cancel`, {
      data: { reason: 'E2E audit test cancellation' },
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(cancelRes.status()).toBe(200);

    // Verify request_cancelled audit event
    const auditRes = await page.request.get(`${BASE}/api/audit?eventType=request_cancelled&limit=10`, {
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(auditRes.status()).toBe(200);
    const auditBody = await auditRes.json();
    const events = auditBody.data?.events || [];
    const cancelEvent = events.length > 0 ? events[0] : null;
    expect(cancelEvent).toBeTruthy();
    expect(cancelEvent.eventType).toBe('request_cancelled');
    expect(cancelEvent.action).toBe('cancel');
    expect(cancelEvent.entityType).toBe('transport_request');
  });

  // -----------------------------------------------------------------------
  // Audit log page renders events
  // -----------------------------------------------------------------------

  test('5. audit log page displays events and hash chain panel', async ({ page }) => {
    await page.goto('/dashboard/audit', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    // The page should have an "Audit Log" heading
    await expect(page.locator('h1:has-text("Audit")').first()).toBeVisible({ timeout: 15000 });

    // Event type filter buttons should be visible
    const filterButtons = page.locator('button').filter({ hasText: /Requests|Approvals|Trips|Fuel/ });
    const filterCount = await filterButtons.count();
    expect(filterCount).toBeGreaterThanOrEqual(4);

    // Hash chain toggle should work
    const hashChainButton = page.locator('button:has-text("Hash Chain")');
    await expect(hashChainButton).toBeVisible({ timeout: 5000 });
    await hashChainButton.click();
    await page.waitForTimeout(500);

    // Hash chain panel should appear
    await expect(page.locator('text=Hash Chain Integrity').first()).toBeVisible({ timeout: 5000 });

    // Search input should be present
    const searchInput = page.locator('input[placeholder*="Search events"]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
  });
});
