/**
 * Full National Approval Chain — End-to-End Test
 *
 * Proves the national-only separation boundary with a real operational
 * allocation:
 * requester → supervisor → transport review → National Vehicle Release →
 * National Trip Authorisation → assigned driver acknowledgement.
 *
 * Regional release/authoriser accounts are explicitly denied at the national
 * stages. The fixture owns its vehicle/allocation/trip and removes all created
 * records after the test.
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
  regionalRelease: 'release.officer@kavangoeast.test',
  regionalAuthoriser: 'regional.authoriser@kavangoeast.test',
  nationalRelease: 'national.release@kavangoeast.test',
  nationalAuthoriser: 'national.authoriser@kavangoeast.test',
  driver: 'driver@kavangoeast.test',
} as const;

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  expect(res.status(), `login ${email}: ${await res.text()}`).toBe(200);
  return api;
}

test.describe('Full national approval chain', () => {
  test.setTimeout(300_000);

  let requestId: string | undefined;
  let workflowInstanceId: string | undefined;
  let vehicleId: string | undefined;
  let allocationId: string | undefined;
  let tripId: string | undefined;

  test('national release and authorisation cannot be substituted by regional officers', async () => {
    const requester = await login(ACCOUNTS.requester);
    const supervisor = await login(ACCOUNTS.supervisor);
    const transport = await login(ACCOUNTS.transport);
    const regionalRelease = await login(ACCOUNTS.regionalRelease);
    const regionalAuthoriser = await login(ACCOUNTS.regionalAuthoriser);
    const nationalRelease = await login(ACCOUNTS.nationalRelease);
    const nationalAuthoriser = await login(ACCOUNTS.nationalAuthoriser);
    const driver = await login(ACCOUNTS.driver);

    // Keep this fixture far away from the shorter regional-chain windows so
    // the dedicated seeded driver does not trip overlap validation in parallel
    // or sequential suites.
    const start = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);

    const createRes = await requester.post('/api/transport-requests', {
      headers: { 'idempotency-key': crypto.randomUUID() },
      data: {
        purpose: 'E2E national approval boundary verification',
        scope: 'national',
        activities: [
          {
            title: 'National approval boundary verification',
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            estimatedKilometres: 250,
          },
        ],
        routes: [
          {
            originName: 'Rundu, Kavango East',
            destinationName: 'Windhoek, Khomas',
            estimatedKm: 715,
            originPlaceId: 'ChIJ-e2e-national-rundu',
            destinationPlaceId: 'ChIJ-e2e-national-windhoek',
            originCoordinates: { lat: -17.9333, lng: 19.7667 },
            destinationCoordinates: { lat: -22.5609, lng: 17.0658 },
          },
        ],
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(200);
    const created = (await createRes.json()).request as {
      id: string;
      workflowInstanceId: string;
      reference: string;
    };
    requestId = created.id;
    workflowInstanceId = created.workflowInstanceId;
    expect(workflowInstanceId).toBeTruthy();

    const supervisorRes = await supervisor.post(`/api/approvals/${workflowInstanceId}/action`, {
      data: { actionType: 'approved', comment: 'National chain supervisor approval' },
    });
    expect(supervisorRes.status(), await supervisorRes.text()).toBe(200);

    const createVehicleRes = await transport.post('/api/fleet', {
      headers: { 'idempotency-key': crypto.randomUUID() },
      data: {
        licenceNumber: `E2E-NAT-${Date.now()}`,
        make: 'Toyota',
        model: 'Land Cruiser',
        manufactureYear: 2025,
        colour: 'White',
        fuelType: 'diesel',
        transmission: 'manual',
        currentOdometer: 100,
        status: 'available',
        seatedCapacity: 7,
      },
    });
    expect(createVehicleRes.status(), await createVehicleRes.text()).toBe(201);
    vehicleId = ((await createVehicleRes.json()).vehicle as { id: string }).id;

    const allocationRes = await transport.post('/api/allocations', {
      data: {
        requestId,
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

    const driverProfileRes = await driver.get('/api/users/profile');
    expect(driverProfileRes.status(), await driverProfileRes.text()).toBe(200);
    const driverProfileBody = await driverProfileRes.json();
    const driverProfile = driverProfileBody.data || driverProfileBody;
    const driverEmployeeId = driverProfile.employee?.id || driverProfile.profile?.employeeId;
    expect(driverEmployeeId, 'driver employee id resolved').toBeTruthy();

    const assignRes = await transport.patch(`/api/allocations/${allocationId}/driver`, {
      data: { driverEmployeeId },
    });
    expect(assignRes.status(), await assignRes.text()).toBe(200);

    const transportRes = await transport.post(`/api/approvals/${workflowInstanceId}/action`, {
      data: { actionType: 'approved', comment: 'National chain transport review' },
    });
    expect(transportRes.status(), await transportRes.text()).toBe(200);

    // A regional release officer must not be able to satisfy the national
    // release stage even though both actions are semantically "release".
    const wrongRelease = await regionalRelease.post(`/api/approvals/${workflowInstanceId}/action`, {
      data: { actionType: 'approved', comment: 'Regional release must not satisfy national release' },
    });
    expect([403, 404]).toContain(wrongRelease.status());

    const releaseRes = await nationalRelease.post(`/api/approvals/${workflowInstanceId}/action`, {
      data: { actionType: 'approved', comment: 'National vehicle release' },
    });
    expect(releaseRes.status(), await releaseRes.text()).toBe(200);

    // The same distinction must hold for final authorisation.
    const wrongAuthoriser = await regionalAuthoriser.post(`/api/approvals/${workflowInstanceId}/action`, {
      data: { actionType: 'approved', comment: 'Regional authoriser must not satisfy national authorisation' },
    });
    expect([403, 404]).toContain(wrongAuthoriser.status());

    const authoriseRes = await nationalAuthoriser.post(`/api/approvals/${workflowInstanceId}/action`, {
      data: { actionType: 'approved', comment: 'National final authorisation' },
    });
    expect(authoriseRes.status(), await authoriseRes.text()).toBe(200);

    expect(tripId).toBeTruthy();
    const acknowledgementRes = await driver.post(`/api/trips/${tripId}/acknowledge`, {
      data: {
        vehicleConfirmed: true,
        authorityConfirmed: true,
        routeUnderstood: true,
        passengersUnderstood: true,
        licenceValidConfirmed: true,
        responsibilityAccepted: true,
        conditionsReviewed: true,
        signature: 'E2E national driver acknowledgement',
        comment: 'E2E national chain acknowledgement',
      },
    });
    expect(acknowledgementRes.status(), await acknowledgementRes.text()).toBe(200);

    await Promise.all([
      requester.dispose(),
      supervisor.dispose(),
      transport.dispose(),
      regionalRelease.dispose(),
      regionalAuthoriser.dispose(),
      nationalRelease.dispose(),
      nationalAuthoriser.dispose(),
      driver.dispose(),
    ]);
  });

  test.afterAll(async () => {
    if (!requestId) return;
    const db = getDb();

    let authorityIds: string[] = [];
    if (allocationId) {
      const authorityRows = await db
        .select({ id: tripAuthorities.id })
        .from(tripAuthorities)
        .where(eq(tripAuthorities.allocationId, allocationId));
      authorityIds = authorityRows.map((row) => row.id);
    }
    if (authorityIds.length > 0) {
      await db.delete(tripAuthorityVersions).where(inArray(tripAuthorityVersions.authorityId, authorityIds));
      await db.delete(tripAuthorityPassengers).where(inArray(tripAuthorityPassengers.authorityId, authorityIds));
      await db.delete(tripAuthorisedDrivers).where(inArray(tripAuthorisedDrivers.authorityId, authorityIds));
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
      await db.delete(vehicleOdometerEvents).where(eq(vehicleOdometerEvents.vehicleId, vehicleId));
      await db.delete(vehicleStatusEvents).where(eq(vehicleStatusEvents.vehicleId, vehicleId));
      await db.delete(vehicleDefects).where(eq(vehicleDefects.vehicleId, vehicleId));
    }

    const entityIds = [requestId, tripId, allocationId, vehicleId, workflowInstanceId].filter(
      (id): id is string => Boolean(id),
    );
    if (entityIds.length > 0) {
      await db.delete(generatedDocuments).where(inArray(generatedDocuments.entityId, entityIds));
      await db.delete(notifications).where(inArray(notifications.entityId, entityIds));
    }

    await db.delete(transportRequests).where(eq(transportRequests.id, requestId));
    if (vehicleId) await db.delete(vehicles).where(eq(vehicles.id, vehicleId));
  });
});
