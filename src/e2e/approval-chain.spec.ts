/**
 * Full Approval Chain — End-to-End Test
 *
 * Walks a regional transport request through every workflow step to its
 * terminal state, using the exact role sequence defined in TEST-CREDENTIALS:
 *
 *   requester (creates) → supervisor (approve) → transport-admin
 *   (review + allocate + assign driver) → release-officer (release) →
 *   regional-authoriser (authorise) → driver (acknowledge).
 *
 * The workflow definition used by the minimal seed is:
 *   supervisor_approve → transport_review → release → authorise →
 *   acknowledge.  When the final step completes the workflow engine marks
 *   the request status 'authorised'.
 *
 * The test is self-contained: it creates its own vehicle (unique licence
 * plate) so it never depends on seed fixtures or collides with other specs,
 * and `test.afterAll` deletes every row the chain created — request,
 * workflow instance/actions, vehicle, allocation, trip, authority (with its
 * children) and the notifications they triggered — in FK-safe order so the
 * development database is left exactly as it was found.
 */
import { expect, request as playwrightRequest, test } from '@playwright/test';
import { getDb } from '@/db';
import {
  generatedDocuments,
  notifications,
  transportRequests,
  tripAmendments,
  tripAuthorisedDrivers,
  tripAuthorities,
  tripAuthorityPassengers,
  tripAuthorityVersions,
  tripClosures,
  tripExpenses,
  tripIncidents,
  tripIssues,
  tripLogEntries,
  tripProgressEntries,
  trips,
  vehicleAllocations,
  vehicleDefects,
  vehicleOdometerEvents,
  vehicleStatusEvents,
  vehicles,
  workflowActions,
  workflowInstances,
} from '@/db/schema';
import { eq, inArray } from 'drizzle-orm';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

const ACCOUNTS = {
  requester: 'requester@kavangoeast.test',
  supervisor: 'supervisor@kavangoeast.test',
  transport: 'transport.admin@kavangoeast.test',
  release: 'release.officer@kavangoeast.test',
  authoriser: 'regional.authoriser@kavangoeast.test',
  driver: 'driver@kavangoeast.test',
} as const;

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  expect(res.status(), `login ${email}: ${await res.text()}`).toBe(200);
  return api;
}

test.describe('Full regional approval chain', () => {
  test.setTimeout(300_000);

  let requestId: string | undefined;
  let workflowInstanceId: string | undefined;
  let vehicleId: string | undefined;
  let allocationId: string | undefined;
  let tripId: string | undefined;

  test('request -> approve -> allocate -> review -> release -> authorise -> driver ack', async ({
    browser,
  }) => {
    const requester = await login(ACCOUNTS.requester);
    const supervisor = await login(ACCOUNTS.supervisor);
    const transport = await login(ACCOUNTS.transport);
    const release = await login(ACCOUNTS.release);
    const authoriser = await login(ACCOUNTS.authoriser);
    const driver = await login(ACCOUNTS.driver);

    // Use a window 7-9h in the future: route-flow owns +4h..+6h and
    // role-lifecycle-smoke owns -1h..+2h for the dedicated driver, and the
    // driver-overlap check rejects any second assignment in an overlapping
    // period. A 7-9h window is clear of both, keeping parallel runs stable.
    const start = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 9 * 60 * 60 * 1000);

    // ── 1. Requester creates a regional transport request ────────────────
    const createRes = await requester.post('/api/transport-requests', {
      headers: { 'idempotency-key': crypto.randomUUID() },
      data: {
        purpose: 'E2E full approval chain verification',
        scope: 'regional',
        activities: [
          {
            title: 'Approval chain verification',
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            estimatedKilometres: 120,
          },
        ],
        routes: [
          {
            originName: 'Rundu, Kavango East',
            destinationName: 'Mukwe, Kavango East',
            estimatedKm: 120,
            originPlaceId: 'ChIJ-e2e-chain-rundu',
            destinationPlaceId: 'ChIJ-e2e-chain-mukwe',
            originCoordinates: { lat: -17.9333, lng: 19.7667 },
            destinationCoordinates: { lat: -18.0456, lng: 21.4281 },
          },
        ],
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(200);
    const requestData = (await createRes.json()).request as {
      id: string;
      workflowInstanceId: string;
      reference: string;
    };
    expect(requestData.workflowInstanceId).toBeTruthy();
    requestId = requestData.id;
    workflowInstanceId = requestData.workflowInstanceId;

    // ── 2. Supervisor approves ───────────────────────────────────────────
    const supApprove = await supervisor.post(
      `/api/approvals/${requestData.workflowInstanceId}/action`,
      { data: { actionType: 'approved', comment: 'E2E chain: supervisor approval' } },
    );
    expect(supApprove.status(), await supApprove.text()).toBe(200);

    // ── 3. Transport-admin allocates a fresh vehicle + assigns driver ────
    const createVehicleRes = await transport.post('/api/fleet', {
      headers: { 'idempotency-key': crypto.randomUUID() },
      data: {
        licenceNumber: `E2E-AC-${Date.now()}`,
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
    const createdVehicle = (await createVehicleRes.json()).vehicle as { id: string };
    vehicleId = createdVehicle.id;

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
    allocationId = allocationData.allocation.id as string;
    tripId = allocationData.trip.id as string;
    expect(allocationId).toBeTruthy();
    expect(tripId).toBeTruthy();

    const profileRes = await driver.get('/api/users/profile');
    const profileBody = await profileRes.json();
    const profileData = profileBody.data || profileBody;
    const driverEmpId = profileData.employee?.id || profileData.profile?.employeeId;
    expect(driverEmpId, 'driver employee id resolved').toBeTruthy();

    const assignRes = await transport.patch(`/api/allocations/${allocationId}/driver`, {
      data: { driverEmployeeId: driverEmpId },
    });
    expect(assignRes.status(), await assignRes.text()).toBe(200);

    // ── 4. Transport review → release → authorise → driver acknowledge ───
    for (const [api, label] of [
      [transport, 'transport review'],
      [release, 'release'],
      [authoriser, 'authorise'],
      [driver, 'driver ack'],
    ] as const) {
      const res = await api.post(`/api/approvals/${requestData.workflowInstanceId}/action`, {
        data: { actionType: 'approved', comment: `E2E chain: ${label}` },
      });
      expect(res.status(), `${label}: ${await res.text()}`).toBe(200);
    }

    // ── 5. Request detail page shows the terminal status 'Authorised' ─────
    // Reuse the transport-admin API session we already hold.
    const context = await browser.newContext({ storageState: await transport.storageState() });
    const page = await context.newPage();

    await page.goto(`/dashboard/requests/${requestData.id}`, {
      waitUntil: 'load',
      timeout: 60_000,
    });
    await expect(page.locator('h1:has-text("GRN/TR/")').first()).toBeVisible({ timeout: 20_000 });
    // Exact match: the detail page also renders an "Authorised Kilometres"
    // field label, so a substring match could hit the wrong element.
    await expect(page.getByText('Authorised', { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });

    await context.close();
    await Promise.all(
      [requester, supervisor, transport, release, authoriser, driver].map((a) => a.dispose()),
    );
  });

  /**
   * Deletes every row this chain created, children before parents, matching
   * the FK graph in src/db/schema (verified against the data-reset registry
   * in src/lib/data-reset/config.ts). Guards on each captured id mean a
   * mid-chain failure still leaves the database clean.
   */
  test.afterAll(async () => {
    if (!requestId) return;

    const db = getDb();

    // Trip-authority children (authorities may carry versions, passengers,
    // authorised drivers and amendments) — resolve via the allocation.
    let authorityIds: string[] = [];
    if (allocationId) {
      const authorityRows = await db
        .select({ id: tripAuthorities.id })
        .from(tripAuthorities)
        .where(eq(tripAuthorities.allocationId, allocationId));
      authorityIds = authorityRows.map((row) => row.id);
    }
    if (authorityIds.length > 0) {
      await db
        .delete(tripAuthorityVersions)
        .where(inArray(tripAuthorityVersions.authorityId, authorityIds));
      await db
        .delete(tripAuthorityPassengers)
        .where(inArray(tripAuthorityPassengers.authorityId, authorityIds));
      await db
        .delete(tripAuthorisedDrivers)
        .where(inArray(tripAuthorisedDrivers.authorityId, authorityIds));
      await db.delete(tripAmendments).where(inArray(tripAmendments.authorityId, authorityIds));
      await db.delete(tripAuthorities).where(inArray(tripAuthorities.id, authorityIds));
    }

    if (allocationId) {
      await db.delete(tripIssues).where(eq(tripIssues.allocationId, allocationId));
    }

    if (tripId) {
      await db.delete(tripProgressEntries).where(eq(tripProgressEntries.tripId, tripId));
      await db.delete(tripLogEntries).where(eq(tripLogEntries.tripId, tripId));
      await db.delete(tripClosures).where(eq(tripClosures.tripId, tripId));
      await db.delete(tripExpenses).where(eq(tripExpenses.tripId, tripId));
      await db.delete(tripIncidents).where(eq(tripIncidents.tripId, tripId));
      // Trips reference request_id + allocation_id + vehicle_id without
      // cascade, so the trip row must go before all three parents.
      await db.delete(trips).where(eq(trips.id, tripId));
    }

    if (allocationId) {
      await db.delete(vehicleAllocations).where(eq(vehicleAllocations.id, allocationId));
    }

    if (workflowInstanceId) {
      await db.delete(workflowActions).where(eq(workflowActions.instanceId, workflowInstanceId));
      await db.delete(workflowInstances).where(eq(workflowInstances.id, workflowInstanceId));
    }

    if (vehicleId) {
      // Vehicles are referenced without cascade by allocations/trips/inspections/
      // fuel, so they are deleted last — after everything above.
      await db.delete(vehicleOdometerEvents).where(eq(vehicleOdometerEvents.vehicleId, vehicleId));
      await db.delete(vehicleStatusEvents).where(eq(vehicleStatusEvents.vehicleId, vehicleId));
      await db.delete(vehicleDefects).where(eq(vehicleDefects.vehicleId, vehicleId));
    }

    // Generated documents (share links + access events cascade off them) and
    // notifications carry no FK back to the entities they reference, so they
    // must be removed explicitly to avoid orphaned rows.
    const entityIds = [requestId, tripId, allocationId, vehicleId, workflowInstanceId].filter(
      (id): id is string => Boolean(id),
    );
    if (entityIds.length > 0) {
      await db.delete(generatedDocuments).where(inArray(generatedDocuments.entityId, entityIds));
      await db.delete(notifications).where(inArray(notifications.entityId, entityIds));
    }

    await db.delete(transportRequests).where(eq(transportRequests.id, requestId));

    if (vehicleId) {
      await db.delete(vehicles).where(eq(vehicles.id, vehicleId));
    }
  });
});
