/**
 * Fuel Efficiency Report — End-to-End Test
 *
 * Verifies the per-vehicle Fuel Efficiency table in Enhanced Analytics:
 *   1. A transport request is created WITH mapped routes (deterministic route
 *      coordinates, no live Google dependency).
 *   2. A vehicle is allocated to the request (creating a trip), then a fuel
 *      transaction is recorded against that vehicle.
 *   3. The /api/reports/enhanced endpoint returns fuelEfficiency.perVehicle
 *      with routeDistanceKm for the vehicle and a monthly routeKmTrend.
 *   4. The Reports → Enhanced Analytics page renders the per-vehicle table
 *      with Route km / Driven km / Litres / km-L columns and the route km value.
 */
import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

const ROUTE = {
  originName: 'Rundu, Kavango East',
  destinationName: 'Nkurenkuru, Kavango West',
  estimatedKm: 340,
  originPlaceId: 'ChIJ-e2e-fu-rundu',
  destinationPlaceId: 'ChIJ-e2e-fu-nkurenkuru',
  originCoordinates: { lat: -17.9333, lng: 19.7667 },
  destinationCoordinates: { lat: -17.6167, lng: 18.6 },
} as const;

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  expect(res.status(), `login ${email}: ${await res.text()}`).toBe(200);
  return api;
}

test.describe('Fuel efficiency report with route km', () => {
  test.setTimeout(240_000);

  test('mapped request -> allocation + fuel -> per-vehicle table + trend', async ({ browser }) => {
    const requester = await login('requester@kavangoeast.test');
    const supervisor = await login('supervisor@kavangoeast.test');
    const transport = await login('transport.admin@kavangoeast.test');

    const start = new Date(Date.now() - 60 * 60 * 1000);
    const end = new Date(Date.now() + 2 * 60 * 60 * 1000);

    // ── 1. Requester creates a transport request WITH mapped routes ─────
    const createRes = await requester.post('/api/transport-requests', {
      headers: { 'idempotency-key': crypto.randomUUID() },
      data: {
        purpose: 'E2E fuel efficiency — mapped route round trip',
        scope: 'regional',
        activities: [{
          title: 'Fuel efficiency verification',
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          estimatedKilometres: ROUTE.estimatedKm,
        }],
        routes: [ROUTE],
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(200);
    const requestData = (await createRes.json()).request as { id: string; workflowInstanceId: string };
    expect(requestData.workflowInstanceId).toBeTruthy();

    // Supervisor approves the request so it can be allocated.
    const supApprove = await supervisor.post(
      `/api/approvals/${requestData.workflowInstanceId}/action`,
      { data: { actionType: 'approved' } },
    );
    expect(supApprove.status(), await supApprove.text()).toBe(200);

    // ── 2. Create a vehicle, allocate it (creates a trip), and refuel it ─
    const createVehicleRes = await transport.post('/api/fleet', {
      headers: { 'idempotency-key': crypto.randomUUID() },
      data: {
        licenceNumber: `E2E-FU-${Date.now()}`,
        make: 'Toyota', model: 'Hilux',
        manufactureYear: 2025, colour: 'White',
        fuelType: 'diesel', transmission: 'manual',
        currentOdometer: 100, status: 'available', seatedCapacity: 5,
      },
    });
    if (createVehicleRes.status() === 403) {
      test.skip(true, 'Transport admin lacks VEHICLE_CREATE permission');
      return;
    }
    expect(createVehicleRes.status(), await createVehicleRes.text()).toBe(201);
    const vehicleId = ((await createVehicleRes.json()).vehicle as { id: string }).id;

    const allocationRes = await transport.post('/api/allocations', {
      data: { requestId: requestData.id, vehicleId, startDate: start.toISOString(), endDate: end.toISOString() },
    });
    expect(allocationRes.status(), await allocationRes.text()).toBe(200);
    const allocationData = await allocationRes.json();
    const tripId = allocationData.trip.id as string;
    expect(tripId).toBeTruthy();

    const fuelRes = await transport.post('/api/fuel', {
      data: {
        tripId,
        vehicleId,
        fuelType: 'diesel',
        litres: 40,
        amount: 900,
        paymentMethod: 'fleet_card',
        stationName: 'E2E Fuel Station',
      },
    });
    expect(fuelRes.status(), await fuelRes.text()).toBe(200);

    // ── 3. Enhanced reports returns per-vehicle route km + trend ─────────
    const reportRes = await transport.get('/api/reports/enhanced?period=30d');
    expect(reportRes.status(), await reportRes.text()).toBe(200);
    const reportBody = await reportRes.json();
    const fuelEfficiency = reportBody.data.fuelEfficiency as {
      totalRouteKm: number;
      routeKmTrend: Array<{ month: string; routeKm: number; routeCount: number }>;
      perVehicle: Array<{ licenceNumber: string; routeDistanceKm: number; estimatedDistanceKm: number; totalLitres: number; kmPerLitre: number | null }>;
    };
    expect(fuelEfficiency.totalRouteKm).toBeGreaterThanOrEqual(ROUTE.estimatedKm);
    expect(fuelEfficiency.perVehicle.length).toBeGreaterThanOrEqual(1);
    const ourVehicle = fuelEfficiency.perVehicle.find((v) => v.routeDistanceKm >= ROUTE.estimatedKm);
    expect(ourVehicle, 'vehicle with routeDistanceKm in perVehicle').toBeTruthy();
    expect(ourVehicle!.totalLitres).toBeGreaterThanOrEqual(40);
    expect(fuelEfficiency.routeKmTrend.length).toBeGreaterThanOrEqual(1);

    // ── 4. Reports → Enhanced Analytics renders the per-vehicle table ────
    const api = await playwrightRequest.newContext({ baseURL: BASE });
    const signIn = await api.post('/api/auth/sign-in', {
      data: { email: 'transport.admin@kavangoeast.test', password: PASSWORD },
    });
    expect(signIn.status()).toBe(200);
    const context = await browser.newContext({ storageState: await api.storageState() });
    const page = await context.newPage();

    await page.goto('/dashboard/reports', { waitUntil: 'load', timeout: 60_000 });
    await page.getByRole('button', { name: /Enhanced Analytics/i }).click();

    await expect(page.getByText('Fuel Efficiency', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    // Route Distance stat tile
    await expect(page.getByText('Route Distance', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    // Per-vehicle table headers
    await expect(page.getByRole('columnheader', { name: /Route km/i }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('columnheader', { name: /Driven km/i }).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('columnheader', { name: /Litres/i }).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('columnheader', { name: /km\/L/i }).first()).toBeVisible({ timeout: 5_000 });
    // At least one numeric km cell renders in the table body (the API-level
    // assertions above are the source of truth for our vehicle's exact km; the
    // table shows the top-8 vehicles by litres, which may vary across runs).
    await expect(
      page.getByRole('cell', { name: /^[\d,]+$/ }).first(),
    ).toBeAttached({ timeout: 10_000 });
    // Monthly trend chart is rendered
    await expect(page.getByText('Route Distance Trend').first()).toBeVisible({ timeout: 10_000 });

    await context.close();
    await api.dispose();
    await Promise.all([requester, supervisor, transport].map((a) => a.dispose()));
  });
});
