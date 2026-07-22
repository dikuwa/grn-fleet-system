/**
 * Trip Return Due Lifecycle — End-to-End Test
 *
 * Covers the complete return_due flow:
 *   1. Sign in as admin
 *   2. Create trip via API (or reuse existing)
 *   3. Mark trip as return_due via the check-return-due API
 *   4. Mark trip as returned (return_inspection)
 *   5. Complete return inspection
 *   6. Close the trip
 *   7. UI smoke test: verify closure review page
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

test.describe('Trip Return Due Lifecycle', () => {
  let vehicleId: string;
  let allocationId: string;
  let requestId: string;
  let tripId: string;

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('1. creates a transport request and completes approval workflow', async ({ page }) => {
    // Create a transport request
    const reqRes = await page.request.post(`${BASE}/api/transport-requests`, {
      data: {
        purpose: 'E2E Return Due Test',
        department: 'Transport',
        scope: 'regional',
        activities: [
          {
            title: 'Return due E2E test activity',
            startDate: new Date(Date.now() - 86400000 * 2).toISOString(),
            endDate: new Date(Date.now() - 86400000).toISOString(),
            estimatedKilometres: 100,
          },
        ],
      },
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(reqRes.status()).toBe(200);
    const reqBody = await reqRes.json();
    expect(reqBody.request).toBeDefined();
    requestId = reqBody.request.id;
    const instanceId = reqBody.request.workflowInstanceId;
    expect(instanceId).toBeTruthy();

    // Complete all 5 approval steps
    for (const step of ['approved', 'approved', 'approved', 'approved', 'approved']) {
      const result = await page.request.post(
        `${BASE}/api/approvals/${instanceId}/action`,
        {
          data: { actionType: step, comment: 'E2E return due test' },
          headers: { cookie: await getCookieHeader(page) },
        },
      );
      expect(result.status()).toBe(200);
    }
  });

  test('2. finds an available vehicle and creates allocation', async ({ page }) => {
    test.skip(!requestId, 'No request created');

    // Find available vehicle
    const fleetRes = await page.request.get(`${BASE}/api/fleet`, {
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(fleetRes.status()).toBe(200);
    const fleetBody = await fleetRes.json().catch(() => ({}));
    const vehicles = fleetBody?.data || fleetBody?.vehicles || fleetBody || [];
    const available = Array.isArray(vehicles)
      ? vehicles.find((v: { status?: string }) => v.status === 'active' || !v.status)
      : null;
    test.skip(!available, 'No available vehicle found');
    vehicleId = available.id;

    // Create allocation
    const allocRes = await page.request.post(`${BASE}/api/allocations`, {
      data: {
        requestId,
        vehicleId,
        startAt: new Date(Date.now() - 86400000 * 3).toISOString(),
        endAt: new Date(Date.now() - 86400000).toISOString(), // Ended yesterday
      },
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(allocRes.status()).toBeGreaterThanOrEqual(200);
    expect(allocRes.status()).toBeLessThan(400);
    const allocBody = await allocRes.json().catch(() => ({}));
    allocationId = allocBody?.allocation?.id || allocBody?.data?.id || allocBody?.id;
    expect(allocationId).toBeTruthy();
  });

  test('3. creates trip from allocation', async ({ page }) => {
    test.skip(!requestId || !allocationId || !vehicleId, 'Missing prerequisites');

    const tripRes = await page.request.post(`${BASE}/api/trips`, {
      data: { allocationId, vehicleId, requestId },
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(tripRes.status()).toBeGreaterThanOrEqual(200);
    expect(tripRes.status()).toBeLessThan(400);
    const tripBody = await tripRes.json().catch(() => ({}));
    tripId = tripBody?.trip?.id || tripBody?.data?.id || tripBody?.id;
    expect(tripId).toBeTruthy();
  });

  test('4. starts the trip (in_progress) via departure inspection', async ({ page }) => {
    test.skip(!tripId || !vehicleId, 'No trip or vehicle');

    const inspRes = await page.request.post(`${BASE}/api/inspections`, {
      data: {
        vehicleId,
        tripId,
        type: 'departure',
        odometerReading: 10000,
        fuelLevel: 'full',
        notes: 'E2E return due departure inspection',
      },
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(inspRes.status()).toBe(200);
  });

  test('5. detects overdue trip and returns return_due status', async ({ page }) => {
    test.skip(!tripId, 'No trip created');

    // Call the check-return-due API
    const checkRes = await page.request.post(`${BASE}/api/trips/check-return-due`, {
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(checkRes.status()).toBe(200);
    const checkBody = await checkRes.json().catch(() => ({}));
    expect(checkBody.overdueCount).toBeGreaterThanOrEqual(1);

    // Verify trip status is now return_due
    const tripRes = await page.request.get(`${BASE}/api/trips/${tripId}`, {
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(tripRes.status()).toBe(200);
    const tripBody = await tripRes.json().catch(() => ({}));
    expect(tripBody.trip.status).toBe('return_due');
  });

  test('6. marks trip as returned and completes return inspection', async ({ page }) => {
    test.skip(!tripId, 'No trip created');
    test.skip(!vehicleId, 'No vehicle');

    // Mark as returned (transitions to return_inspection)
    const returnRes = await page.request.post(`${BASE}/api/trips/${tripId}/return`, {
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(returnRes.status()).toBe(200);

    // Complete the return inspection
    const inspRes = await page.request.post(`${BASE}/api/inspections`, {
      data: {
        vehicleId,
        tripId,
        type: 'return',
        odometerReading: 10200,
        fuelLevel: 'three_quarters',
        notes: 'E2E return due return inspection',
      },
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(inspRes.status()).toBe(200);
    const inspBody = await inspRes.json().catch(() => ({}));

    // Trip should be closed (auto-closed because no checklist items means no fails — useAutoClose = true)
    // or in closure_review if auto-close didn't trigger
    expect(['closure_review', 'closed']).toContain(inspBody.trip.status);
    expect(inspBody.trip.returnedAt).toBeTruthy();
  });

  test('7. closes the completed trip', async ({ page }) => {
    test.skip(!tripId, 'No trip created');

    const closeRes = await page.request.post(`${BASE}/api/trips/${tripId}/close`, {
      data: {
        decision: 'closed',
        actualKilometres: 200,
        totalFuelLitres: 30,
        totalFuelCost: 600,
        reviewNotes: 'E2E return due trip closed successfully',
      },
      headers: { cookie: await getCookieHeader(page) },
    });
    // Trip may already be closed by auto-close from the return inspection
    expect([200, 409]).toContain(closeRes.status());
    if (closeRes.status() === 200) {
      const closeBody = await closeRes.json().catch(() => ({}));
      expect(closeBody.trip.status).toBe('closed');
    }
  });

  test('8. closure review page loads correctly after lifecycle', async ({ page }) => {
    await page.goto('/dashboard/trips/closure-review', { waitUntil: 'load', timeout: 60000 });
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Closure Review').first()).toBeVisible({ timeout: 10000 });
  });
});
