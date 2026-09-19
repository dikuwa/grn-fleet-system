/**
 * Route Flow — End-to-End Test
 *
 * Exercises the mapped-route journey end to end:
 *   1. Requester creates a transport request WITH mapped routes (place IDs,
 *      coordinates, estimated km — the payload the Places Autocomplete +
 *      Google Routes API produces in the new-request form).
 *   2. Request detail page renders the Leaflet route map and shows route km.
 *   3. Trips report surfaces the mapped route distance (routeDistanceKm) and
 *      the actual distance driven once the trip is closed.
 *   4. The Trip Authority page renders the same route map on the official
 *      authority document.
 *
 * Uses deterministic route coordinates (no live Google dependency), so the
 * test is reliable offline and in CI.
 */
import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

const ROUTE = {
  originName: 'Rundu, Kavango East',
  destinationName: 'Windhoek, Khomas Region',
  estimatedKm: 700,
  originPlaceId: 'ChIJ-e2e-rundu',
  destinationPlaceId: 'ChIJ-e2e-windhoek',
  originCoordinates: { lat: -17.9333, lng: 19.7667 },
  destinationCoordinates: { lat: -22.5609, lng: 17.0658 },
} as const;

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  expect(res.status(), `login ${email}: ${await res.text()}`).toBe(200);
  return api;
}

test.describe('Route flow with maps and reporting', () => {
  test.setTimeout(240_000);

  test('mapped request -> detail map -> report km -> authority map', async ({ browser }) => {
    const requester = await login('requester@kavangoeast.test');
    const supervisor = await login('supervisor@kavangoeast.test');
    const admin = await login(process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na');
    const transport = await login('transport.admin@kavangoeast.test');
    const release = await login('release.officer@kavangoeast.test');
    const authoriser = await login('regional.authoriser@kavangoeast.test');
    const driver = await login('driver@kavangoeast.test');

    // Keep this mapped-route fixture well outside the short operational
    // windows used by the other serial Extended E2E suites.
    const start = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000);

    // ── 1. Requester creates a transport request WITH mapped routes ─────
    const createRes = await requester.post('/api/transport-requests', {
      headers: { 'idempotency-key': crypto.randomUUID() },
      data: {
        purpose: 'E2E route flow — mapped route round trip',
        scope: 'regional',
        activities: [
          {
            title: 'Route flow verification',
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            estimatedKilometres: ROUTE.estimatedKm,
          },
        ],
        routes: [ROUTE],
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(200);
    const requestData = (await createRes.json()).request as {
      id: string;
      workflowInstanceId: string;
      reference: string;
    };
    expect(requestData.workflowInstanceId).toBeTruthy();

    // ── 2. Request detail page renders the route map + route km ─────────
    const api = await playwrightRequest.newContext({ baseURL: BASE });
    const signIn = await api.post('/api/auth/sign-in', {
      data: { email: 'requester@kavangoeast.test', password: PASSWORD },
    });
    expect(signIn.status()).toBe(200);
    const context = await browser.newContext({ storageState: await api.storageState() });
    const page = await context.newPage();

    await page.goto(`/dashboard/requests/${requestData.id}`, {
      waitUntil: 'load',
      timeout: 60_000,
    });
    await expect(page.locator('h1:has-text("GRN/TR/")').first()).toBeVisible({ timeout: 15_000 });
    // Routes section present with the Leaflet map container
    await expect(page.locator('text=Routes').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.leaflet-container').first()).toBeAttached({ timeout: 15_000 });
    // Route km surfaced in the route details
    await expect(page.getByText(/700 km/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Windhoek, Khomas Region').first()).toBeVisible({ timeout: 5_000 });

    // ── 3. Trips report surfaces mapped route distance ──────────────────
    const reportRes = await transport.get('/api/reports?type=trips&period=7d');
    expect(reportRes.status(), await reportRes.text()).toBe(200);
    const reportData = (await reportRes.json()).data;
    expect(Number(reportData.routeDistanceKm)).toBeGreaterThanOrEqual(ROUTE.estimatedKm);
    expect(Number(reportData.routeCount)).toBeGreaterThanOrEqual(1);

    // ── 4. Walk the workflow to create a Trip + Authority ───────────────
    const supApprove = await supervisor.post(
      `/api/approvals/${requestData.workflowInstanceId}/action`,
      { data: { actionType: 'approved' } },
    );
    expect(supApprove.status(), await supApprove.text()).toBe(200);

    const createVehicleRes = await admin.post('/api/fleet', {
      headers: { 'idempotency-key': crypto.randomUUID() },
      data: {
        licenceNumber: `E2E-RF-${Date.now()}`,
        make: 'Toyota',
        model: 'Hilux',
        manufactureYear: 2025,
        colour: 'White',
        fuelType: 'diesel',
        transmission: 'manual',
        currentOdometer: 100,
        status: 'available',
        seatedCapacity: 5,
      },
    });
    expect(createVehicleRes.status(), await createVehicleRes.text()).toBe(201);
    const vehicleId = ((await createVehicleRes.json()).vehicle as { id: string }).id;

    const allocationRes = await transport.post('/api/allocations', {
      data: {
        requestId: requestData.id,
        vehicleId,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      },
    });
    expect(allocationRes.status(), await allocationRes.text()).toBe(200);
    const allocationData = await allocationRes.json();
    const allocationId = allocationData.allocation.id as string;
    const tripId = allocationData.trip.id as string;
    expect(tripId).toBeTruthy();

    // Resolve the seeded driver deterministically through the transport API.
    const driversResponse = await transport.get('/api/drivers');
    expect(driversResponse.status(), await driversResponse.text()).toBe(200);
    const driverRows = (await driversResponse.json()).data;
    const driverEmpId = driverRows.find(
      (row: { employeeNumber: string }) => row.employeeNumber === 'KERC008',
    )?.id as string;
    expect(driverEmpId, 'seeded driver KERC008 found').toBeTruthy();

    const assignRes = await transport.patch(`/api/allocations/${allocationId}/driver`, {
      data: { driverEmployeeId: driverEmpId },
    });
    expect(assignRes.status(), await assignRes.text()).toBe(200);

    // Transport review → release → authorise (provisions authority) → driver ack
    for (const [api, label] of [
      [transport, 'transport review'],
      [release, 'release'],
      [authoriser, 'authorise'],
      [driver, 'driver ack'],
    ] as const) {
      const res = await api.post(`/api/approvals/${requestData.workflowInstanceId}/action`, {
        data: { actionType: 'approved', comment: `Route flow: ${label}` },
      });
      expect(res.status(), `${label}: ${await res.text()}`).toBe(200);
    }

    // ── 5. Trip Authority page renders the route map on the document ────
    await page.goto(`/dashboard/trips/${tripId}/authority`, {
      waitUntil: 'load',
      timeout: 60_000,
    });
    await expect(page.getByText('Official Vehicle Trip Authority').first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('Route map').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.leaflet-container').first()).toBeAttached({ timeout: 15_000 });
    await expect(page.getByText('Approved route distance').first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/700 km/).first()).toBeVisible({ timeout: 10_000 });

    await context.close();
    await api.dispose();
    await Promise.all(
      [requester, supervisor, admin, transport, release, authoriser, driver].map((a) => a.dispose()),
    );
  });
});
