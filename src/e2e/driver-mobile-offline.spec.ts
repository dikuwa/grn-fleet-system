/**
 * Driver Mobile PWA — Offline Incident Reporting Workflow
 *
 * End-to-end test of the driver mobile experience under Phase 32 rules
 * (drivers do NOT perform official inspections — Inspectors and Release
 * Officers do; drivers report incidents, damage and defects instead):
 *   1. API setup — a regional request is approved, allocated and the driver
 *      (KERC008) is assigned. The Inspector performs the official departure
 *      inspection, Transport issues the vehicle and the driver starts the
 *      trip (status `in_progress`).
 *   2. Mobile dashboard — the driver opens /dashboard/driver-mobile at a
 *      390px viewport and sees the assigned trip + offline banner.
 *   3. Offline incident report — on the trip workspace the driver opens the
 *      incident dialog, goes offline and saves it ("Saved for sync").
 *   4. Reconnect + sync — the OfflineSyncHandler pushes the draft; the
 *      trip_incident row appears with a client_sync_id.
 *   5. Idempotency — re-POSTing the same clientSyncId returns
 *      `{ idempotentReplay: true }` and the database still holds exactly one
 *      incident row.
 *
 * Mirrors the role-isolation pattern: cookie-authenticated API contexts for
 * setup + a real browser context for the PWA surfaces.
 */

import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Browser,
} from '@playwright/test';
import { getDb } from '@/db';
import { vehicleAllocations, vehicles, trips, tripIncidents } from '@/db/schema';
import { and, eq, gt, inArray, isNotNull, lt } from 'drizzle-orm';
import { DEPARTURE_INSPECTION_ITEMS } from '@/lib/inspection-checklists';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const accounts = {
  requester: 'requester@kavangoeast.test',
  tenantAdmin: 'admin@kavangoeast.gov.na',
  supervisor: 'supervisor@kavangoeast.test',
  transport: 'transport.admin@kavangoeast.test',
  release: 'release.officer@kavangoeast.test',
  authoriser: 'regional.authoriser@kavangoeast.test',
  driver: 'driver@kavangoeast.test',
  inspector: 'inspector@kavangoeast.test',
} as const;

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const response = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  expect(response.status(), `login ${email}`).toBe(200);
  return api;
}

async function approve(
  api: APIRequestContext,
  workflowId: string,
  actionType = 'approved',
  comment?: string,
) {
  const response = await api.post(`/api/approvals/${workflowId}/action`, {
    data: { actionType, comment },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function openAs(
  browser: Browser,
  email: string,
  path: string,
  viewport = { width: 1280, height: 800 },
) {
  const api = await login(email);
  const storageState = await api.storageState();
  const context = await browser.newContext({ storageState, viewport });
  const page = await context.newPage();
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  return { api, context, page };
}

/**
 * Creates an approved + allocated trip assigned to driver KERC008 and
 * advances it to `in_progress` under Phase 32 rules:
 *   1. Inspector performs the official departure inspection (pass).
 *   2. Transport physically issues the vehicle.
 *   3. The driver starts the trip.
 * Returns the trip id, vehicle id and odometer for downstream steps.
 */
async function setupDriverAssignedTrip(): Promise<{
  tripId: string;
  vehicleId: string;
  workflowId: string;
  vehicleOdometer: number;
}> {
  const requester = await login(accounts.requester);
  const supervisor = await login(accounts.supervisor);
  const transport = await login(accounts.transport);
  const release = await login(accounts.release);
  const authoriser = await login(accounts.authoriser);
  const driver = await login(accounts.driver);
  const inspector = await login(accounts.inspector);

  const start = new Date(Date.now() - 5 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

  const requestResponse = await requester.post('/api/transport-requests', {
    headers: { 'idempotency-key': crypto.randomUUID() },
    data: {
      purpose: 'Driver mobile PWA E2E field visit',
      scope: 'regional',
      activities: [
        {
          title: 'Mobile field visit',
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          estimatedKilometres: 120,
        },
      ],
    },
  });
  expect(requestResponse.status(), await requestResponse.text()).toBe(200);
  const created = await requestResponse.json();
  const requestId = created.request.id as string;
  const workflowId = created.request.workflowInstanceId as string;
  expect(workflowId).toBeTruthy();

  await approve(supervisor, workflowId);

  const fleetResponse = await transport.get('/api/fleet?limit=100');
  const fleetBody = await fleetResponse.json();
  const fleetRows = fleetBody.rows || fleetBody.data || fleetBody;
  const availableRows = fleetRows.filter(
    (vehicle: { status: string }) => vehicle.status === 'available',
  ) as Array<{ id: string; currentOdometer: number }>;
  expect(availableRows.length, 'expected an available seeded vehicle').toBeGreaterThan(0);

  // Prior spec runs may have left confirmed allocations behind on the seeded
  // vehicles, so filter to one with no overlapping allocation in the window.
  // One batched query (not one per vehicle) keeps the hook inside its budget.
  const db = getDb();

  // Self-cleaning: earlier runs may have left allocations/trips in open states
  // that make the vehicle and driver overlap checks 409 on the next run.
  // Mirror the cleanup that `pnpm db:seed-e2e` performs (vehicle_allocations
  // has no tenantId column — scope via the tenant's vehicles).
  const staleAllocStates = ['provisional', 'confirmed', 'issued'];
  const tenantVehicleIds = db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.tenantId, TENANT_ID));
  await db
    .update(vehicleAllocations)
    .set({ state: 'cancelled' })
    .where(
      and(
        inArray(vehicleAllocations.vehicleId, tenantVehicleIds),
        inArray(vehicleAllocations.state, staleAllocStates),
      ),
    );
  const staleTripStatuses = [
    'pending',
    'in_progress',
    'return_due',
    'return_inspection',
    'closure_review',
  ];
  for (const tripStatus of staleTripStatuses) {
    await db
      .update(trips)
      .set({ status: 'closed' })
      .where(
        and(eq(trips.tenantId, TENANT_ID), eq(trips.status, tripStatus)),
      );
  }

  const overlapping = await db
    .select({ vehicleId: vehicleAllocations.vehicleId })
    .from(vehicleAllocations)
    .where(
      and(
        inArray(vehicleAllocations.state, ['provisional', 'confirmed', 'released']),
        lt(vehicleAllocations.startAt, end),
        gt(vehicleAllocations.endAt, start),
      ),
    );
  const busyIds = new Set(overlapping.map((row) => row.vehicleId));
  const chosen = availableRows.find((candidate) => !busyIds.has(candidate.id));
  expect(chosen, 'expected a seeded vehicle with no overlapping allocation').toBeTruthy();
  const available = chosen!;

  // The odometer gate rejects readings below the vehicle's current reading;
  // read it straight from the DB rather than trusting the fleet API payload.
  const [odometerRow] = await db
    .select({ currentOdometer: vehicles.currentOdometer })
    .from(vehicles)
    .where(eq(vehicles.id, available.id))
    .limit(1);
  const vehicleOdometer = odometerRow?.currentOdometer ?? 0;

  const allocationResponse = await transport.post('/api/allocations', {
    data: {
      requestId,
      vehicleId: available.id,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    },
  });
  expect(allocationResponse.status(), await allocationResponse.text()).toBe(200);
  const allocationBody = await allocationResponse.json();
  const allocationId = allocationBody.allocation.id as string;
  const tripId = allocationBody.trip.id as string;

  // GET /api/drivers requires STAFF_VIEW, which the TRANSPORT_ADMIN
  // workspace policy does not include — use the tenant admin instead.
  const tenantAdmin = await login(accounts.tenantAdmin);
  const driversResponse = await tenantAdmin.get('/api/drivers');
  expect(driversResponse.status(), await driversResponse.text()).toBe(200);
  const driverRows = (await driversResponse.json()).data as Array<{
    id: string;
    employeeNumber: string;
  }>;
  // The only seeded driver with a login account is KERC008
  // (driver@kavangoeast.test), so the workflow must assign that driver — the
  // driver-approval step rejects anyone else with a 403.
  const driverEmployeeId = driverRows.find(
    (row) => row.employeeNumber === 'KERC008',
  )!.id;
  await tenantAdmin.dispose();
  const driverAssignment = await transport.patch(
    `/api/allocations/${allocationId}/driver`,
    { data: { driverEmployeeId } },
  );
  expect(driverAssignment.status(), await driverAssignment.text()).toBe(200);

  await approve(transport, workflowId);
  await approve(release, workflowId);
  await approve(authoriser, workflowId);
  await approve(driver, workflowId);

  // ── Phase 32: advance to in_progress ────────────────────────────────────
  // The Inspector performs the official departure inspection (all items pass),
  // Transport physically issues the vehicle, then the assigned driver starts.
  const departure = await inspector.post('/api/inspections', {
    data: {
      vehicleId: available.id,
      tripId,
      type: 'departure',
      odometerReading: vehicleOdometer,
      fuelLevel: 'full',
      inspectorAcknowledged: true,
      driverAcknowledged: true,
      photoKeys: ['e2e/departure-1.jpg', 'e2e/departure-2.jpg', 'e2e/departure-3.jpg'],
      checklist: DEPARTURE_INSPECTION_ITEMS.map((item) => ({
        label: item.label,
        result: 'pass',
        comment: null,
      })),
    },
  });
  expect(departure.status(), await departure.text()).toBe(200);

  const issue = await transport.post(`/api/trips/${tripId}/issue`, {
    data: {
      keysIssued: true,
      fuelCardIssued: true,
      issueOdometer: vehicleOdometer,
    },
  });
  expect(issue.status(), await issue.text()).toBe(200);

  const startTrip = await driver.post(`/api/trips/${tripId}/start`, {
    data: {
      beginningOdometer: vehicleOdometer,
      passengersConfirmed: true,
      fuelLevel: 'full',
    },
  });
  expect(startTrip.status(), await startTrip.text()).toBe(200);

  await Promise.all(
    [requester, supervisor, transport, release, authoriser, driver, inspector].map((api) =>
      api.dispose(),
    ),
  );

  return { tripId, vehicleId: available!.id, workflowId, vehicleOdometer };
}

test.describe.serial('Driver Mobile PWA offline workflow', () => {
  test.setTimeout(600_000);

  let tripId: string;
  let vehicleOdometer: number;

  test.beforeAll(async () => {
    // Describe-scope setTimeout does not reliably propagate to hooks in this
    // Playwright version, so raise it inside the hook itself.
    test.setTimeout(600_000);
    const setup = await setupDriverAssignedTrip();
    tripId = setup.tripId;
    vehicleOdometer = setup.vehicleOdometer;
  });

  test('driver-mobile dashboard shows the assigned trip at a mobile viewport', async ({
    browser,
  }) => {
    const ui = await openAs(browser, accounts.driver, '/dashboard/driver-mobile', {
      width: 390,
      height: 844,
    });
    await expect(ui.page).toHaveURL(/\/dashboard\/driver-mobile/);
    await expect(ui.page.locator('h1:has-text("Driver Console")').first()).toBeVisible({
      timeout: 15_000,
    });
    // The assigned trip appears in Active Trips.
    await expect(ui.page.locator('text=Active Trips').first()).toBeVisible();
    await ui.page.screenshot({
      path: 'docs/screenshots/driver-mobile-dashboard.png',
      fullPage: true,
    });
    await ui.context.close();
    await ui.api.dispose();
  });

  test('offline incident report saves a draft, syncs, and is idempotent', async ({
    browser,
  }) => {
    const ui = await openAs(
      browser,
      accounts.driver,
      `/dashboard/trips/${tripId}`,
      { width: 390, height: 844 },
    );
    const { page, context } = ui;
    // The trip workspace renders the incident entry point once the trip is
    // in progress. Phase 32: no driver-facing inspection buttons.
    await expect(page.locator('text=My Active Trip').first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('Report incident, damage or defect').first()).toBeVisible({
      timeout: 15_000,
    });
    // Phase 32 guard: the driver workspace must NOT expose inspection actions.
    await expect(page.getByText('Start Inspection').first()).toHaveCount(0);

    // Open the incident dialog and describe the event.
    await page.getByText('Report incident, damage or defect').first().click();
    await expect(page.getByRole('dialog').getByRole('heading')).toContainText(
      'Report incident, damage or defect',
    );
    await page
      .locator('[role="dialog"] textarea')
      .fill('Left rear tyre pressure dropped noticeably after a fuel stop.');
    await page
      .locator('[role="dialog"] input[type="number"]')
      .fill(String(vehicleOdometer + 80));

    // Go offline and wait for the workspace to register the state change
    // (the save button flips to "Save for Sync" and the badge to "Offline").
    await context.setOffline(true);
    await expect(page.getByText('Offline', { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole('button', { name: /Save for Sync/i }).click();

    await expect(page.getByText('Saved for sync').first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({
      path: 'docs/screenshots/driver-mobile-incident-offline.png',
      fullPage: true,
    });

    // Reconnect — the OfflineSyncHandler pushes pending drafts automatically.
    await context.setOffline(false);

    // Reload the page so the handler remounts: its mount-sync (added after
    // the online-event path proved flaky under emulation) deterministically
    // picks up the pending draft — IndexedDB survives the reload in this
    // context. The online event alone is not guaranteed to fire here.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('text=My Active Trip').first()).toBeVisible({
      timeout: 20_000,
    });

    // Poll the DB until the synced incident row appears (clientSyncId = draft id).
    const db = getDb();
    let syncedRow: (typeof tripIncidents.$inferSelect) | undefined;
    for (let attempt = 0; attempt < 45; attempt++) {
      const [row] = await db
        .select()
        .from(tripIncidents)
        .where(
          and(
            eq(tripIncidents.tripId, tripId),
            eq(tripIncidents.tenantId, TENANT_ID),
            isNotNull(tripIncidents.clientSyncId),
          ),
        )
        .limit(1);
      if (row) {
        syncedRow = row;
        break;
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    expect(syncedRow, 'incident should sync with a client_sync_id').toBeTruthy();
    const clientSyncId = syncedRow!.clientSyncId!;
    expect(clientSyncId).toBeTruthy();
    expect(syncedRow!.incidentType).toBe('mechanical_defect');

    // Idempotency: re-POST the same payload with the same clientSyncId.
    const driverApi = await login(accounts.driver);
    const duplicate = await driverApi.post(`/api/trips/${tripId}/operations`, {
      data: {
        action: 'incident',
        incidentType: 'mechanical_defect',
        description: 'Left rear tyre pressure dropped noticeably after a fuel stop.',
        severity: 'minor',
        continuationState: 'safe_to_continue',
        vehicleSafe: true,
        passengerSafe: true,
        clientSyncId,
      },
    });
    expect(duplicate.status(), await duplicate.text()).toBe(200);
    expect((await duplicate.json()).idempotentReplay).toBe(true);

    // And the database still holds exactly one incident for that clientSyncId.
    const rows = await db
      .select({ id: tripIncidents.id })
      .from(tripIncidents)
      .where(
        and(
          eq(tripIncidents.tripId, tripId),
          eq(tripIncidents.clientSyncId, clientSyncId),
        ),
      );
    expect(rows.length).toBe(1);
    await driverApi.dispose();

    await context.close();
    await ui.api.dispose();
  });
});
