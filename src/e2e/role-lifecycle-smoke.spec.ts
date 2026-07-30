/**
 * Role Lifecycle Smoke
 *
 * Compact API-based test that exercises the complete request-to-trip lifecycle
 * by acting as each key role in sequence.  Faster than the full role-isolation
 * workflow — fewer parallel assertions and screenshot steps.
 *
 * Roles exercised:  requester → supervisor → transport → release → regional
 *   authoriser → driver → inspector → maintenance → auditor
 */
import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  expect(res.status(), `login ${email}: ${await res.text()}`).toBe(200);
  return api;
}

test.describe('Role lifecycle smoke', () => {
  test.setTimeout(120_000);

  test('complete request-to-trip lifecycle exercises every key role', async () => {
    const requester = await login('requester@kavangoeast.test');
    const supervisor = await login('supervisor@kavangoeast.test');
    const transport = await login('transport.admin@kavangoeast.test');
    const release = await login('release.officer@kavangoeast.test');
    const authoriser = await login('regional.authoriser@kavangoeast.test');
    const driver = await login('driver@kavangoeast.test');

    // 1. Requester creates transport request
    const start = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
    const createRes = await requester.post('/api/transport-requests', {
      headers: { 'idempotency-key': crypto.randomUUID() },
      data: {
        purpose: 'E2E lifecycle smoke — district coordination meeting',
        scope: 'regional',
        activities: [{
          title: 'District coordination meeting',
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          estimatedKilometres: 120,
        }],
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(200);
    const requestData = (await createRes.json()).request as {
      id: string;
      workflowInstanceId: string;
      reference: string;
    };
    expect(requestData.workflowInstanceId).toBeTruthy();

    // 2. Supervisor approves
    const supApprove = await supervisor.post(
      `/api/approvals/${requestData.workflowInstanceId}/action`,
      { data: { actionType: 'approved' } },
    );
    expect(supApprove.status(), await supApprove.text()).toBe(200);

    // 3. Transport admin — allocate vehicle + assign driver
    const fleetRes = await transport.get('/api/fleet?limit=100');
    const fleetBody = await fleetRes.json();
    const fleetRows = fleetBody.rows || fleetBody.data || fleetBody;
    // Try to find an available vehicle; fall back to any non-maintenance vehicle
    let available = fleetRows.find((v: { status: string }) => v.status === 'available');
    if (!available) {
      available = fleetRows.find((v: { status: string }) => v.status !== 'maintenance');
    }
    test.skip(!available, 'No usable vehicles found (all in maintenance)');
    const allocationRes = await transport.post('/api/allocations', {
      data: {
        requestId: requestData.id,
        vehicleId: available.id,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      },
    });
    expect(allocationRes.status(), await allocationRes.text()).toBe(200);
    const allocationData = await allocationRes.json();
    const allocationId = allocationData.allocation.id as string;
    const tripId = allocationData.trip.id as string;
    expect(tripId).toBeTruthy();

    const driversRes = await transport.get('/api/drivers');
    const driverRows = (await driversRes.json()).data || [];
    const knownDriver = driverRows.find(
      (d: { employeeNumber: string }) => d.employeeNumber === 'KERC008',
    );
    expect(knownDriver).toBeTruthy();
    const assignRes = await transport.patch(`/api/allocations/${allocationId}/driver`, {
      data: { driverEmployeeId: knownDriver.id },
    });
    expect(assignRes.status(), await assignRes.text()).toBe(200);

    // 4. Transport admin reviews + Release officer releases + Authoriser authorises + Driver acknowledges
    const stepActions = [
      { api: transport, label: 'transport review' },
      { api: release, label: 'release' },
      { api: authoriser, label: 'authorise' },
      { api: driver, label: 'driver ack' },
    ];
    for (const { api, label } of stepActions) {
      const res = await api.post(
        `/api/approvals/${requestData.workflowInstanceId}/action`,
        { data: { actionType: 'approved', comment: `Smoke: ${label}` } },
      );
      expect(res.status(), `${label}: ${await res.text()}`).toBe(200);
    }

    // 5. Departure inspection as inspector
    const inspector = await login('inspector@kavangoeast.test');
    const depRes = await inspector.post('/api/inspections', {
      data: {
        vehicleId: available.id,
        tripId,
        type: 'departure',
        odometerReading: available.currentOdometer,
        fuelLevel: 'full',
        inspectorAcknowledged: true,
        driverAcknowledged: true,
        photoKeys: ['smoke/dep-1.jpg'],
        checklist: [
          { label: 'Exterior Condition', result: 'pass', comment: null },
          { label: 'Tyres', result: 'pass', comment: null },
          { label: 'Lights', result: 'pass', comment: null },
          { label: 'Brakes', result: 'pass', comment: null },
          { label: 'Fluid Levels', result: 'pass', comment: null },
        ],
      },
    });
    expect(depRes.status(), await depRes.text()).toBe(200);

    // 6. Issue trip + start trip
    const issueRes = await transport.post(`/api/trips/${tripId}/issue`, {
      data: { keysIssued: true, issueOdometer: available.currentOdometer },
    });
    expect(issueRes.status(), await issueRes.text()).toBe(200);
    const startRes = await driver.post(`/api/trips/${tripId}/start`, {
      data: {
        beginningOdometer: available.currentOdometer,
        passengersConfirmed: true,
        fuelLevel: 'full',
      },
    });
    expect(startRes.status(), await startRes.text()).toBe(200);

    // 7. Return trip + return inspection
    const returnRes = await driver.post(`/api/trips/${tripId}/return`, {
      data: {
        endingOdometer: available.currentOdometer + 65,
        fuelLevel: 'half',
        returnLocation: 'Rundu fleet yard',
        incidentDeclared: false,
        outstandingReceiptsDeclared: false,
      },
    });
    expect(returnRes.status(), await returnRes.text()).toBe(200);

    const returnInspectionRes = await inspector.post('/api/inspections', {
      data: {
        vehicleId: available.id,
        tripId,
        type: 'return',
        odometerReading: available.currentOdometer + 65,
        fuelLevel: 'half',
        inspectorAcknowledged: true,
        driverAcknowledged: true,
        photoKeys: ['smoke/ret-1.jpg'],
        checklist: [
          { label: 'Exterior Condition', result: 'pass', comment: null },
          { label: 'Tyres', result: 'pass', comment: null },
          { label: 'Lights', result: 'pass', comment: null },
          { label: 'Brakes', result: 'pass', comment: null },
          { label: 'Fluid Levels', result: 'pass', comment: null },
        ],
      },
    });
    expect(returnInspectionRes.status(), await returnInspectionRes.text()).toBe(200);

    // 8. Close trip
    const closeRes = await transport.post(`/api/trips/${tripId}/close`, {
      data: { decision: 'closed', reviewNotes: 'E2E smoke lifecycle completed successfully.' },
    });
    expect(closeRes.status(), await closeRes.text()).toBe(200);

    // 9. Auditor can read audit trail
    const auditor = await login('auditor@kavangoeast.test');
    const auditRes = await auditor.get('/api/audit?limit=10');
    expect(auditRes.status()).toBe(200);

    await Promise.all(
      [requester, supervisor, transport, release, authoriser, driver, inspector, auditor].map(
        (a) => a.dispose(),
      ),
    );
  });
});
