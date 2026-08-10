import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from '@playwright/test';
import { getDb } from '@/db';
import { transportRequests, vehicleAllocations, workflowInstances } from '@/db/schema';
import { and, eq, gt, inArray, lt } from 'drizzle-orm';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

test.describe.serial('Driver acknowledgment queue', () => {
  // The workflow drives through four approvals plus allocation before the
  // driver step; remote Neon and stateful actions need headroom.
  test.setTimeout(420_000);

  test('acknowledge step is driver-scoped: hidden from approver queues, only the allocated driver can act', async ({
    browser,
  }) => {
    const requester = await login('requester@kavangoeast.test');
    const supervisor = await login('supervisor@kavangoeast.test');
    const transport = await login('transport.admin@kavangoeast.test');
    const release = await login('release.officer@kavangoeast.test');
    const authoriser = await login('regional.authoriser@kavangoeast.test');
    const driver = await login('driver@kavangoeast.test');

    // 1. Create a regional request and approve the supervisor step.
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
    const requestResponse = await requester.post('/api/transport-requests', {
      headers: { 'idempotency-key': crypto.randomUUID() },
      data: {
        purpose: 'Driver acknowledgment queue E2E field visit',
        scope: 'regional',
        activities: [
          {
            title: 'Field visit',
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            estimatedKilometres: 150,
          },
        ],
      },
    });
    expect(requestResponse.status(), await requestResponse.text()).toBe(200);
    const created = await requestResponse.json();
    const requestId = created.request.id as string;
    const workflowId = created.request.workflowInstanceId as string;
    const reference = created.request.reference as string;
    expect(workflowId).toBeTruthy();
    expect(reference).toMatch(/^GRN\/TR\//);
    await approve(supervisor, workflowId);

    // 2. Allocate an available vehicle and assign the seed driver KERC008
    //    (the account driver@kavangoeast.test) so the acknowledge step has a
    //    concrete allocated driver to be scoped to.
    const fleetResponse = await transport.get('/api/fleet?limit=100');
    const fleetBody = await fleetResponse.json();
    const fleetRows = fleetBody.rows || fleetBody.data || fleetBody;
    const vehicle = fleetRows.find((row: { status: string }) => row.status === 'available');
    test.skip(!vehicle, 'No available vehicle in seed for driver acknowledgment E2E');
    const vehicleId = vehicle.id as string;

    const db = getDb();
    // Retry safety: a previous attempt of this serial spec (or an earlier
    // spec in the same run) may have left an active allocation overlapping
    // this window.  Cancel such leftovers so the allocation does not 409.
    await db
      .update(vehicleAllocations)
      .set({ state: 'cancelled' })
      .where(
        and(
          eq(vehicleAllocations.vehicleId, vehicleId),
          inArray(vehicleAllocations.state, ['provisional', 'confirmed', 'issued']),
          lt(vehicleAllocations.startAt, end),
          gt(vehicleAllocations.endAt, start),
        ),
      );

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

    const driversResponse = await transport.get('/api/drivers');
    const driverRows = (await driversResponse.json()).data;
    const driverEmployeeId = driverRows.find(
      (row: { employeeNumber: string }) => row.employeeNumber === 'KERC008',
    ).id as string;
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

    // 3. Approve steps 2-4 (transport review, release, authorisation) so the
    //    workflow lands on the driver acknowledgment step.
    await approve(transport, workflowId);
    await approve(release, workflowId);
    await approve(authoriser, workflowId);

    // 4. The request is now pending driver acknowledgment.
    const [atAcknowledge] = await db
      .select()
      .from(transportRequests)
      .where(eq(transportRequests.id, requestId))
      .limit(1);
    expect(atAcknowledge.status).toBe('driver_acknowledgement_pending');

    // 5. Queue separation: the transport admin can open the approvals queue
    //    but does NOT hold DRIVER_LOG_CREATE, so the acknowledge step must
    //    not appear there.  Assert the page rendered first so a broken page
    //    cannot vacuously satisfy the negative control.
    const transportStorage = await transport.storageState();
    const queueContext = await browser.newContext({ storageState: transportStorage });
    const queuePage = await queueContext.newPage();
    await queuePage.goto('/dashboard/approvals', { waitUntil: 'load' });
    await expect(queuePage.getByRole('heading', { name: 'Assigned Approvals' })).toBeVisible();
    await expect(queuePage.locator('a').filter({ hasText: reference })).toHaveCount(0);
    await queueContext.close();

    // 6. Action-gate negative: the transport admin is blocked from acting on
    //    the driver step even though the approvals route admits them.  The
    //    generic endpoint is disabled for every actor because the canonical
    //    Trip Console route performs the operational acknowledgement checks.
    const blocked = await transport.post(`/api/approvals/${workflowId}/action`, {
      data: { actionType: 'approved' },
    });
    expect(blocked.status()).toBe(409);
    expect(await blocked.text()).toContain('Driver Console');

    // 7. The driver's own queue surface — the Driver Console — lists the trip
    //    awaiting acknowledgment.  This implicitly relies on the trip still
    //    having status `pending` at the acknowledge step (nothing between
    //    allocation and acknowledgment mutates the trip status), which keeps
    //    it inside the console's Active Trips filter.
    const driverStorage = await driver.storageState();
    const consoleContext = await browser.newContext({ storageState: driverStorage });
    const consolePage = await consoleContext.newPage();
    await consolePage.goto('/dashboard/driver-mobile', { waitUntil: 'load' });
    await expect(
      consolePage.locator('a').filter({ hasText: reference }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await consoleContext.close();

    // 8. Positive: the allocated driver completes the acknowledgment; the
    //    workflow finishes and the request is authorised.
    const acknowledged = await driver.post(`/api/trips/${tripId}/acknowledge`, {
      data: {
        vehicleConfirmed: true,
        authorityConfirmed: true,
        routeUnderstood: true,
        passengersUnderstood: true,
        licenceValidConfirmed: true,
        responsibilityAccepted: true,
        conditionsReviewed: true,
        signature: 'Driver queue E2E acknowledgement',
      },
    });
    expect(acknowledged.status(), await acknowledged.text()).toBe(200);

    const [after] = await db
      .select()
      .from(transportRequests)
      .where(eq(transportRequests.id, requestId))
      .limit(1);
    const [instance] = await db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, workflowId))
      .limit(1);
    expect(after.status).toBe('authorised');
    expect(instance.status).toBe('completed');

    await Promise.all(
      [requester, supervisor, transport, release, authoriser, driver].map((api) => api.dispose()),
    );
  });
});

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
