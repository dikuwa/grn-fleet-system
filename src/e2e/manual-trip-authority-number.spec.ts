import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from '@playwright/test';
import { getDb } from '@/db';
import { tripAuthorities } from '@/db/schema/trips';
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { vehicleAllocations } from '@/db/schema';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

/**
 * Manual Trip Authority number E2E.
 *
 * Drives the real regional workflow end to end (request -> supervisor ->
 * allocation -> transport review -> release -> authorisation) so that an
 * official authority exists, then exercises the transport-officer number
 * surface over HTTP:
 *
 *   1. Blank issue auto-generates the system number (TA-YYYY-CODE-NNNNNN).
 *   2. The transport officer can override with a manual physical number.
 *   3. A duplicate manual number is rejected with a 409 and a human error.
 *   4. Users without the override permission are denied (403).
 */
test.describe.serial('Manual Trip Authority number', () => {
  // Two full regional workflows against remote Neon need headroom.
  test.setTimeout(560_000);

  test('manual number: auto-gen when blank, override, duplicate 409, permission guard', async () => {
    const requester = await login('requester@kavangoeast.test');
    const supervisor = await login('supervisor@kavangoeast.test');
    const transport = await login('transport.admin@kavangoeast.test');
    const release = await login('release.officer@kavangoeast.test');
    const authoriser = await login('regional.authoriser@kavangoeast.test');

    const run = Date.now().toString(36).toUpperCase();
    const vehicles = await pickAvailableVehicles(transport, 2);
    test.skip(!vehicles.length, 'No available vehicle in seed for manual authority E2E');

    // ---- Trip 1: auto-generated number, then manual override ----
    const trip1 = await driveRegionalTrip({
      api: requester,
      approvers: { supervisor, transport, release, authoriser },
      purpose: `Manual authority E2E trip 1 ${run}`,
      startOffsetMs: 24 * 60 * 60 * 1000,
      vehicleId: vehicles[0].id,
      transport,
      prepareVehicle: () => cancelLeftoverAllocations(vehicles[0].id),
    });

    const db = getDb();
    const authority1 = await findAuthority(db, trip1.tripId);

    // 1. Blank issue -> automatic system number in the canonical format.
    expect(authority1.authorityNumber, 'auto-generated TA number').toMatch(
      /^TA-\d{4}-[A-Z0-9]+-\d{6}$/,
    );
    expect(authority1.authorityNumberSource).toBe('automatic');

    // 4. Guard: a user without the override permission is denied server-side.
    const blocked = await requester.patch(`/api/trips/${trip1.tripId}/authority/number`, {
      data: { authorityNumber: 'TA-BLOCKED-001', reason: 'Should never pass the permission check' },
    });
    expect(blocked.status()).toBe(403);

    // 2. Transport officer overrides with a manual physical number.
    const manualNumber = `TA-MANUAL-E2E-${run}`;
    const override = await transport.patch(`/api/trips/${trip1.tripId}/authority/number`, {
      data: {
        authorityNumber: manualNumber,
        reason: 'Physical authority book number for the field trip',
      },
    });
    expect(override.status(), await override.text()).toBe(200);
    const overrideBody = await override.json();
    expect(overrideBody.data.authorityNumber).toBe(manualNumber.toUpperCase());
    expect(overrideBody.data.authorityNumberSource).toBe('manual_override');
    expect(overrideBody.data.manualNumberOverrideReason).toBeTruthy();

    // ---- Trip 2: duplicate manual number is rejected ----
    const trip2 = await driveRegionalTrip({
      api: requester,
      approvers: { supervisor, transport, release, authoriser },
      purpose: `Manual authority E2E trip 2 ${run}`,
      startOffsetMs: 5 * 24 * 60 * 60 * 1000,
      vehicleId: vehicles[1] ? vehicles[1].id : vehicles[0].id,
      transport,
      prepareVehicle: () =>
        cancelLeftoverAllocations(vehicles[1] ? vehicles[1].id : vehicles[0].id),
    });

    const duplicate = await transport.patch(`/api/trips/${trip2.tripId}/authority/number`, {
      data: {
        authorityNumber: manualNumber,
        reason: 'Reusing the same physical book number should be blocked',
      },
    });
    expect(duplicate.status(), await duplicate.text()).toBe(409);
    expect(await duplicate.text()).toContain('already exists');

    const [after2] = await db
      .select()
      .from(tripAuthorities)
      .where(eq(tripAuthorities.tripId, trip2.tripId))
      .limit(1);
    expect(after2.authorityNumber).not.toBe(manualNumber.toUpperCase());

    await Promise.all(
      [requester, supervisor, transport, release, authoriser].map((api) => api.dispose()),
    );
  });
});

type Approvers = {
  supervisor: APIRequestContext;
  transport: APIRequestContext;
  release: APIRequestContext;
  authoriser: APIRequestContext;
};

async function driveRegionalTrip(input: {
  api: APIRequestContext;
  approvers: Approvers;
  purpose: string;
  startOffsetMs: number;
  vehicleId: string;
  transport: APIRequestContext;
  prepareVehicle: () => Promise<void>;
}) {
  const { api, approvers, purpose, startOffsetMs, vehicleId, transport } = input;
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

  await input.prepareVehicle();
  const allocationResponse = await transport.post('/api/allocations', {
    data: {
      requestId,
      vehicleId,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    },
  });
  expect(allocationResponse.status(), await allocationResponse.text()).toBe(200);
  const allocationBody = await allocationResponse.json();
  const allocationId = allocationBody.allocation.id as string;
  const tripId = allocationBody.trip.id as string;
  expect(tripId).toBeTruthy();

  // Transport Review requires a confirmed allocation with an eligible
  // driver; assign the seeded driver KERC008 (driver@kavangoeast.test).
  const driversResponse = await transport.get('/api/drivers');
  const driverRows = (await driversResponse.json()).data;
  const driverEmployeeId = driverRows.find(
    (row: { employeeNumber: string }) => row.employeeNumber === 'KERC008',
  )?.id as string;
  expect(driverEmployeeId, 'seeded driver KERC008 found').toBeTruthy();
  // Retry safety: a previous run may have left the seed driver allocated in
  // this window; cancel leftovers so the assignment does not 409.
  await db
    .update(vehicleAllocations)
    .set({ state: 'cancelled' })
    .where(
      and(
        eq(vehicleAllocations.driverEmployeeId, driverEmployeeId),
        inArray(vehicleAllocations.state, ['provisional', 'confirmed', 'issued']),
        lt(vehicleAllocations.startAt, end),
        gt(vehicleAllocations.endAt, start),
      ),
    );
  const driverAssignment = await transport.patch(`/api/allocations/${allocationId}/driver`, {
    data: { driverEmployeeId },
  });
  expect(driverAssignment.status(), await driverAssignment.text()).toBe(200);

  await approve(approvers.transport, workflowId);
  await approve(approvers.release, workflowId);
  await approve(approvers.authoriser, workflowId);

  // The authority is provisioned during authorisation; poll briefly for the row.
  let authority: { id: string } | undefined;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const [row] = await db
      .select({ id: tripAuthorities.id })
      .from(tripAuthorities)
      .where(eq(tripAuthorities.tripId, tripId))
      .limit(1);
    if (row) {
      authority = row;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect(authority, 'authority provisioned after authorisation').toBeTruthy();

  return { tripId };
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
