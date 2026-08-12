import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from '@playwright/test';
import { getDb } from '@/db';
import {
  inspectionTemplateItems,
  inspectionTemplates,
  tripAuthorities,
  trips,
  vehicleAllocations,
  vehicleInspections,
} from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Physical Trip Authority number reservation + departure inspection E2E.
 *
 * PR #30 introduced a reservation/provisioning flow: the Transport Officer can
 * enter the number from a physical paper authority while preparing the
 * allocation. The number is reserved on the transport request (tenant-scoped
 * unique), staged in the request snapshot, and applied by
 * `provisionTripAuthority` at final authorisation. Transport Administrators
 * also gained `inspection:perform`.
 *
 * This spec drives the real HTTP workflow and verifies:
 *
 *   1. A physical number entered at allocation is reserved and survives final
 *      authorisation (the provisioned authority carries it, source `manual`,
 *      attributed to the provisioning authoriser).
 *   2. The transport officer's identity is recorded on the request
 *      (`physicalTripAuthorityNumberSetByUserId`).
 *   3. Users without ALLOCATION_MANAGE are denied server-side (403).
 *   4. A duplicate physical number reservation is rejected with a 409 and the
 *      request is left untouched.
 *   5. A blank physical number auto-generates the system TA number.
 *   6. The Transport Administrator can perform the departure inspection after
 *      driver acknowledgement (authority -> ready_for_departure).
 *   7. An uncompleted or failed departure inspection still blocks vehicle issue.
 *
 * Fixture note: the reservation route (`/api/trips/create-from-allocation`)
 * requires a confirmed allocation without an existing trip. The atomic
 * allocation endpoint always creates both, so the spec inserts the confirmed
 * allocation directly (the same fixture technique the seed scripts use) and
 * mirrors the request status (`vehicle_allocated`) that the allocation
 * endpoint would leave behind, then continues through the real workflow.
 */
test.describe.serial('Physical Trip Authority reservation and departure inspection', () => {
  // Several full regional workflows against remote Neon need headroom.
  test.setTimeout(900_000);

  test('reservation survives authorisation; duplicates and unprivileged users are rejected', async () => {
    const requester = await login('requester@kavangoeast.test');
    const supervisor = await login('supervisor@kavangoeast.test');
    const transport = await login('transport.admin@kavangoeast.test');
    const release = await login('release.officer@kavangoeast.test');
    const authoriser = await login('regional.authoriser@kavangoeast.test');

    const run = Date.now().toString(36).toUpperCase();
    const vehiclesList = await pickAvailableVehicles(transport, 2);
    test.skip(!vehiclesList.length, 'No available vehicle in seed for reservation E2E');

    const driverEmployeeId = await seededDriverEmployeeId(transport);
    const transportUserId = await employeeUserId('transport.admin@kavangoeast.test');
    const authoriserUserId = await employeeUserId('regional.authoriser@kavangoeast.test');

    // ---- Reservation: physical number entered during allocation ----
    const tripA = await createReservedTrip({
      api: requester,
      approvers: { supervisor, transport, release, authoriser },
      purpose: `Physical authority reservation E2E A ${run}`,
      vehicleId: vehiclesList[0].id,
      driverEmployeeId,
      allocatedByUserId: transportUserId,
      manualAuthorityNumber: `PHY-E2E-${run}`,
    });

    // 1. The number is reserved on the transport request by the transport
    //    officer who prepared the allocation.
    const db = getDb();
    const [requestA] = await db
      .select({
        physicalTripAuthorityNumber: transportRequests.physicalTripAuthorityNumber,
        setByUserId: transportRequests.physicalTripAuthorityNumberSetByUserId,
      })
      .from(transportRequests)
      .where(eq(transportRequests.id, tripA.requestId))
      .limit(1);
    expect(requestA.physicalTripAuthorityNumber).toBe(`PHY-E2E-${run}`);
    expect(requestA.setByUserId).toBe(transportUserId);

    // 1b. The final authority carries the manual number with source `manual`.
    //     The override actor is the provisioning authoriser (the durable
    //     workflow evidence for who applied the number at authorisation).
    const authorityA = await findAuthority(db, tripA.tripId);
    expect(authorityA.authorityNumber).toBe(`PHY-E2E-${run}`);
    expect(authorityA.authorityNumberSource).toBe('manual');
    expect(authorityA.manualNumberOverrideByUserId).toBe(authoriserUserId);
    expect(authorityA.manualNumberOverrideReason).toContain('Physical Trip Authority number');

    // 3. Guard: a user without ALLOCATION_MANAGE is denied the reservation route.
    const blocked = await requester.post('/api/trips/create-from-allocation', {
      data: { allocationId: tripA.allocationId, manualAuthorityNumber: 'PHY-BLOCKED-001' },
    });
    expect(blocked.status()).toBe(403);

    // 2. Duplicate reservation for the same tenant is rejected with a 409.
    //    tripA has already been provisioned, so its issued authority carries the
    //    manual number and the route's issued-authority duplicate query fires
    //    first. The reserved-request index is the concurrency backstop for the
    //    window before provisioning; both paths return the same 409. The fresh
    //    confirmed allocation has never been given a trip, so the "trip already
    //    exists" guard is what does NOT fire — the duplicate-number 409 is.
    const duplicate = await prepareAllocationWithoutTrip({
      api: requester,
      approvers: { supervisor, transport },
      purpose: `Physical authority reservation E2E duplicate ${run}`,
      vehicleId: vehiclesList[1] ? vehiclesList[1].id : vehiclesList[0].id,
      driverEmployeeId,
      allocatedByUserId: transportUserId,
      startOffsetMs: 6 * 24 * 60 * 60 * 1000,
    });

    const duplicateReservation = await transport.post('/api/trips/create-from-allocation', {
      data: {
        allocationId: duplicate.allocationId,
        manualAuthorityNumber: `PHY-E2E-${run}`,
      },
    });
    expect(duplicateReservation.status(), await duplicateReservation.text()).toBe(409);
    expect(await duplicateReservation.text()).toContain('already reserved or in use');

    // The rejected duplicate must not have changed the staged request snapshot.
    const [requestB] = await db
      .select({ physicalTripAuthorityNumber: transportRequests.physicalTripAuthorityNumber })
      .from(transportRequests)
      .where(eq(transportRequests.id, duplicate.requestId))
      .limit(1);
    expect(requestB.physicalTripAuthorityNumber).toBeNull();

    // Clean up the rejected allocation so it does not linger as a confirmed,
    // trip-less record in the tenant until the next seed's stale-cleanup pass.
    await db
      .update(vehicleAllocations)
      .set({ state: 'cancelled' })
      .where(eq(vehicleAllocations.id, duplicate.allocationId));

    await Promise.all(
      [requester, supervisor, transport, release, authoriser].map((api) => api.dispose()),
    );
  });

  test('blank physical number auto-generates and inspection gates vehicle issue', async () => {
    const requester = await login('requester@kavangoeast.test');
    const supervisor = await login('supervisor@kavangoeast.test');
    const transport = await login('transport.admin@kavangoeast.test');
    const release = await login('release.officer@kavangoeast.test');
    const authoriser = await login('regional.authoriser@kavangoeast.test');
    const driver = await login('driver@kavangoeast.test');

    const run = Date.now().toString(36).toUpperCase();
    const vehiclesList = await pickAvailableVehicles(transport, 1);
    test.skip(!vehiclesList.length, 'No available vehicle in seed for inspection E2E');

    const driverEmployeeId = await seededDriverEmployeeId(transport);
    const transportUserId = await employeeUserId('transport.admin@kavangoeast.test');

    // ---- Blank physical number -> automatic system number at authorisation ----
    const trip = await createReservedTrip({
      api: requester,
      approvers: { supervisor, transport, release, authoriser },
      purpose: `Physical authority blank E2E ${run}`,
      vehicleId: vehiclesList[0].id,
      driverEmployeeId,
      allocatedByUserId: transportUserId,
      manualAuthorityNumber: null,
      startOffsetMs: 2 * 24 * 60 * 60 * 1000,
    });

    const db = getDb();
    const authority = await findAuthority(db, trip.tripId);
    expect(authority.authorityNumber, 'auto-generated TA number').toMatch(
      /^TA-\d{4}-[A-Z0-9]+-\d{6}$/,
    );
    expect(authority.authorityNumberSource).toBe('automatic');
    expect(authority.manualNumberOverrideByUserId).toBeNull();

    // ---- Driver acknowledgement ----
    const acknowledged = await driver.post(`/api/trips/${trip.tripId}/acknowledge`, {
      data: {
        vehicleConfirmed: true,
        authorityConfirmed: true,
        routeUnderstood: true,
        passengersUnderstood: true,
        licenceValidConfirmed: true,
        responsibilityAccepted: true,
        conditionsReviewed: true,
        signature: 'Physical authority reservation E2E acknowledgement',
        comment: 'E2E driver acknowledgement before departure inspection',
      },
    });
    expect(acknowledged.status(), await acknowledged.text()).toBe(200);

    // 7a. Uncompleted inspection still blocks vehicle issue.
    const [authorityBefore] = await db
      .select({ status: tripAuthorities.status })
      .from(tripAuthorities)
      .where(eq(tripAuthorities.tripId, trip.tripId))
      .limit(1);
    expect(authorityBefore.status).toBe('driver_accepted');

    const issueBeforeInspection = await transport.post(`/api/trips/${trip.tripId}/issue`, {
      data: { issueOdometer: 0, keysIssued: true },
    });
    expect(issueBeforeInspection.status()).toBe(409);

    // 6. Transport Administrator performs the departure inspection.
    const [vehicle] = await db
      .select({ currentOdometer: vehicles.currentOdometer })
      .from(vehicles)
      .where(eq(vehicles.id, trip.vehicleId))
      .limit(1);
    const inspection = await submitDepartureInspection({
      api: transport,
      tripId: trip.tripId,
      vehicleId: trip.vehicleId,
      odometerReading: (vehicle?.currentOdometer ?? 100) + 10,
      failCriticalItem: false,
    });
    expect(inspection.overallPass).toBe(true);
    expect(inspection.status).toBe('completed');

    const [authorityAfter] = await db
      .select({ status: tripAuthorities.status })
      .from(tripAuthorities)
      .where(eq(tripAuthorities.tripId, trip.tripId))
      .limit(1);
    expect(authorityAfter.status).toBe('ready_for_departure');

    // 7c. With a passed inspection, physical issue succeeds.
    const [inspectionRow] = await db
      .select({ odometerReading: vehicleInspections.odometerReading })
      .from(vehicleInspections)
      .where(eq(vehicleInspections.tripId, trip.tripId))
      .limit(1);
    const issue = await transport.post(`/api/trips/${trip.tripId}/issue`, {
      data: { issueOdometer: inspectionRow.odometerReading, keysIssued: true, fuelCardIssued: true },
    });
    expect(issue.status(), await issue.text()).toBe(200);

    await Promise.all(
      [requester, supervisor, transport, release, authoriser, driver].map((api) =>
        api.dispose(),
      ),
    );
  });

  test('failed departure inspection still blocks vehicle issue', async () => {
    const requester = await login('requester@kavangoeast.test');
    const supervisor = await login('supervisor@kavangoeast.test');
    const transport = await login('transport.admin@kavangoeast.test');
    const release = await login('release.officer@kavangoeast.test');
    const authoriser = await login('regional.authoriser@kavangoeast.test');
    const driver = await login('driver@kavangoeast.test');

    const run = Date.now().toString(36).toUpperCase();
    const vehiclesList = await pickAvailableVehicles(transport, 1);
    test.skip(!vehiclesList.length, 'No available vehicle in seed for failed-inspection E2E');

    const driverEmployeeId = await seededDriverEmployeeId(transport);
    const transportUserId = await employeeUserId('transport.admin@kavangoeast.test');

    const trip = await createReservedTrip({
      api: requester,
      approvers: { supervisor, transport, release, authoriser },
      purpose: `Physical authority failed inspection E2E ${run}`,
      vehicleId: vehiclesList[0].id,
      driverEmployeeId,
      allocatedByUserId: transportUserId,
      manualAuthorityNumber: null,
      startOffsetMs: 3 * 24 * 60 * 60 * 1000,
    });

    const db = getDb();
    const acknowledged = await driver.post(`/api/trips/${trip.tripId}/acknowledge`, {
      data: {
        vehicleConfirmed: true,
        authorityConfirmed: true,
        routeUnderstood: true,
        passengersUnderstood: true,
        licenceValidConfirmed: true,
        responsibilityAccepted: true,
        conditionsReviewed: true,
        signature: 'Physical authority failed-inspection E2E acknowledgement',
        comment: 'E2E driver acknowledgement before failed inspection',
      },
    });
    expect(acknowledged.status(), await acknowledged.text()).toBe(200);

    const [vehicle] = await db
      .select({ currentOdometer: vehicles.currentOdometer })
      .from(vehicles)
      .where(eq(vehicles.id, trip.vehicleId))
      .limit(1);

    // 7b. A failed inspection (critical item) blocks issue: the authority is
    //     not moved to ready_for_departure and the vehicle goes to maintenance.
    const failedInspection = await submitDepartureInspection({
      api: transport,
      tripId: trip.tripId,
      vehicleId: trip.vehicleId,
      odometerReading: (vehicle?.currentOdometer ?? 100) + 20,
      failCriticalItem: true,
    });
    expect(failedInspection.overallPass).toBe(false);
    expect(failedInspection.status).toBe('failed');

    const [authorityAfter] = await db
      .select({ status: tripAuthorities.status })
      .from(tripAuthorities)
      .where(eq(tripAuthorities.tripId, trip.tripId))
      .limit(1);
    expect(authorityAfter.status).not.toBe('ready_for_departure');

    const [vehicleAfter] = await db
      .select({ status: vehicles.status })
      .from(vehicles)
      .where(eq(vehicles.id, trip.vehicleId))
      .limit(1);
    expect(vehicleAfter.status).toBe('maintenance');

    const issue = await transport.post(`/api/trips/${trip.tripId}/issue`, {
      data: { issueOdometer: 0, keysIssued: true },
    });
    expect(issue.status()).toBe(409);

    await Promise.all(
      [requester, supervisor, transport, release, authoriser, driver].map((api) =>
        api.dispose(),
      ),
    );
  });
});

type Approvers = {
  supervisor: APIRequestContext;
  transport: APIRequestContext;
  release: APIRequestContext;
  authoriser: APIRequestContext;
};

/**
 * Full regional workflow with a manually reserved physical Trip Authority
 * number: request -> supervisor -> confirmed allocation (direct insert, no
 * trip) -> reservation -> transport review -> release -> authorisation.
 */
async function createReservedTrip(input: {
  api: APIRequestContext;
  approvers: Approvers;
  purpose: string;
  vehicleId: string;
  driverEmployeeId: string;
  allocatedByUserId: string;
  manualAuthorityNumber: string | null;
  startOffsetMs?: number;
}) {
  const { api, approvers, purpose, vehicleId, driverEmployeeId, allocatedByUserId } = input;
  const startOffsetMs = input.startOffsetMs ?? 24 * 60 * 60 * 1000;
  const db = getDb();

  const start = new Date(Date.now() + startOffsetMs);
  const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);

  const requestResponse = await api.post('/api/transport-requests', {
    headers: { 'idempotency-key': crypto.randomUUID() },
    data: {
      purpose,
      scope: 'regional',
      activities: [
        {
          title: 'Official field visit',
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          estimatedKilometres: 180,
        },
      ],
    },
  });
  expect(requestResponse.status(), await requestResponse.text()).toBe(200);
  const created = await requestResponse.json();
  const requestId = created.request.id as string;
  const workflowId = created.request.workflowInstanceId as string;
  expect(workflowId).toBeTruthy();

  await approve(approvers.supervisor, workflowId);

  // The reservation route needs a confirmed allocation WITHOUT an existing
  // trip, and a request status it accepts. Mirror the state the atomic
  // allocation endpoint would leave behind, then insert the confirmed
  // allocation directly (the same fixture technique the seed scripts use).
  await cancelLeftoverAllocations(vehicleId);
  const allocationId = crypto.randomUUID();
  await db.update(transportRequests)
    .set({ status: 'vehicle_allocated', updatedAt: new Date() })
    .where(eq(transportRequests.id, requestId));
  await db.insert(vehicleAllocations).values({
    id: allocationId,
    requestId,
    vehicleId,
    driverEmployeeId,
    startAt: start,
    endAt: end,
    state: 'confirmed',
    allocatedByUserId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const reservation = await approvers.transport.post('/api/trips/create-from-allocation', {
    data: {
      allocationId,
      manualAuthorityNumber: input.manualAuthorityNumber ?? undefined,
    },
  });
  expect(reservation.status(), await reservation.text()).toBe(200);
  const reservationBody = await reservation.json();
  const tripId = reservationBody.trip.id as string;
  expect(tripId).toBeTruthy();
  expect(reservationBody.authorityNumberMode).toBe(
    input.manualAuthorityNumber ? 'manual' : 'automatic',
  );

  // Transport Review -> Release -> Authorisation provisions the authority.
  await approve(approvers.transport, workflowId);
  await approve(approvers.release, workflowId);
  await approve(approvers.authoriser, workflowId);

  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.tenantId, TENANT_ID as never)))
    .limit(1);
  expect(trip, 'trip created by reservation route').toBeTruthy();

  return { requestId, allocationId, tripId, vehicleId };
}

/**
 * Request + supervisor approval + confirmed allocation WITHOUT a trip. Used by
 * the duplicate-reservation test so the tenant+number uniqueness check (not the
 * "trip already exists" guard) is what the route reports.
 */
async function prepareAllocationWithoutTrip(input: {
  api: APIRequestContext;
  approvers: Pick<Approvers, 'supervisor' | 'transport'>;
  purpose: string;
  vehicleId: string;
  driverEmployeeId: string;
  allocatedByUserId: string;
  startOffsetMs: number;
}) {
  const { api, approvers, purpose, vehicleId, driverEmployeeId, allocatedByUserId } = input;
  const db = getDb();

  const start = new Date(Date.now() + input.startOffsetMs);
  const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);

  const requestResponse = await api.post('/api/transport-requests', {
    headers: { 'idempotency-key': crypto.randomUUID() },
    data: {
      purpose,
      scope: 'regional',
      activities: [
        {
          title: 'Official field visit',
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

  await approve(approvers.supervisor, workflowId);

  await cancelLeftoverAllocations(vehicleId);
  const allocationId = crypto.randomUUID();
  await db.update(transportRequests)
    .set({ status: 'vehicle_allocated', updatedAt: new Date() })
    .where(eq(transportRequests.id, requestId));
  await db.insert(vehicleAllocations).values({
    id: allocationId,
    requestId,
    vehicleId,
    driverEmployeeId,
    startAt: start,
    endAt: end,
    state: 'confirmed',
    allocatedByUserId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return { requestId, allocationId };
}

/**
 * Submit a departure inspection using the live server-owned template so the
 * checklist always matches whatever the tenant actually configures. The
 * critical item to fail is chosen from the template itself, never hardcoded.
 */
async function submitDepartureInspection(input: {
  api: APIRequestContext;
  tripId: string;
  vehicleId: string;
  odometerReading: number;
  failCriticalItem: boolean;
}) {
  const { api, tripId, vehicleId, odometerReading, failCriticalItem } = input;
  const db = getDb();

  const [template] = await db
    .select({ id: inspectionTemplates.id })
    .from(inspectionTemplates)
    .where(
      and(
        eq(inspectionTemplates.tenantId, TENANT_ID as never),
        eq(inspectionTemplates.type, 'departure'),
        eq(inspectionTemplates.isActive, true),
      ),
    )
    .orderBy(desc(inspectionTemplates.version))
    .limit(1);
  expect(template, 'active departure template exists').toBeTruthy();

  const templateItems = await db
    .select()
    .from(inspectionTemplateItems)
    .where(eq(inspectionTemplateItems.templateId, template.id))
    .orderBy(inspectionTemplateItems.sortOrder);
  expect(templateItems.length, 'departure template has checklist items').toBeGreaterThan(0);

  const criticalItem = templateItems.find(
    (item: { isCritical?: boolean | null }) => item.isCritical,
  );
  expect(criticalItem, 'departure template has a critical item').toBeTruthy();
  const criticalItemLabel = criticalItem!.label;

  const checklist = templateItems.map((item: { label: string }) => {
    const isFailedItem = failCriticalItem && item.label === criticalItemLabel;
    return {
      label: item.label,
      result: isFailedItem ? 'fail' : 'pass',
      comment: isFailedItem ? 'E2E: critical item failed to prove the issue gate' : null,
    };
  });
  const photoKeys = templateItems
    .filter((item: { requiresPhoto?: boolean | null }) => item.requiresPhoto)
    .map(
      (_item: unknown, index: number) =>
        `tenant/${TENANT_ID}/inspections/e2e-${tripId.slice(0, 8)}-${index}.jpg`,
    );

  const response = await api.post('/api/inspections', {
    data: {
      vehicleId,
      tripId,
      type: 'departure',
      odometerReading,
      fuelLevel: 'full',
      checklist,
      photoKeys,
      notes: 'E2E departure inspection',
      inspectorAcknowledged: true,
      driverAcknowledged: true,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

async function findAuthority(db: ReturnType<typeof getDb>, tripId: string) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const [row] = await db
      .select()
      .from(tripAuthorities)
      .where(eq(tripAuthorities.tripId, tripId))
      .limit(1);
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Trip Authority not found for trip ${tripId}`);
}

async function seededDriverEmployeeId(transport: APIRequestContext) {
  const driversResponse = await transport.get('/api/drivers');
  const driverRows = (await driversResponse.json()).data;
  const driverEmployeeId = driverRows.find(
    (row: { employeeNumber: string }) => row.employeeNumber === 'KERC008',
  )?.id as string;
  expect(driverEmployeeId, 'seeded driver KERC008 found').toBeTruthy();
  return driverEmployeeId;
}

async function employeeUserId(email: string) {
  const db = getDb();
  const [row] = await db
    .select({ userId: employees.userId })
    .from(employees)
    .where(eq(employees.email, email))
    .limit(1);
  expect(row?.userId, `employee user for ${email}`).toBeTruthy();
  return row!.userId as string;
}

async function pickAvailableVehicles(transport: APIRequestContext, count: number) {
  const fleetResponse = await transport.get('/api/fleet?limit=100');
  const fleetBody = await fleetResponse.json();
  const fleetRows = fleetBody.rows || fleetBody.data || fleetBody;
  const available = fleetRows.filter((row: { status: string }) => row.status === 'available');
  return available.slice(0, count) as { id: string }[];
}

async function cancelLeftoverAllocations(vehicleId: string) {
  const db = getDb();
  const horizon = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
  await db
    .update(vehicleAllocations)
    .set({ state: 'cancelled' })
    .where(
      and(
        eq(vehicleAllocations.vehicleId, vehicleId),
        inArray(vehicleAllocations.state, ['provisional', 'confirmed', 'issued']),
        lt(vehicleAllocations.startAt, horizon),
      ),
    );
}

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  let lastStatus = 0;
  let lastBody = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
    lastStatus = response.status();
    lastBody = await response.text();
    if (lastStatus === 200) return api;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect(lastStatus, lastBody).toBe(200);
  return api;
}

async function approve(api: APIRequestContext, workflowId: string) {
  const response = await api.post(`/api/approvals/${workflowId}/action`, {
    data: { actionType: 'approved' },
  });
  expect(response.status(), await response.text()).toBe(200);
}
