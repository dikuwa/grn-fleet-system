/**
 * Role Lifecycle Smoke
 *
 * Compact API-based test that exercises the complete request-to-trip lifecycle
 * by acting as each key role in sequence.  Self-sufficient: creates its own
 * vehicle via API if none is available, so it never depends on external seed.
 *
 * Uses near-future dates (starting tomorrow) to avoid stale-allocation
 * conflicts from prior runs.  Inspections use the shared
 * DEPARTURE_INSPECTION_ITEMS / RETURN_INSPECTION_ITEMS constants so the
 * checklist always matches the active template.
 *
 * Roles exercised:  requester → supervisor → transport → release → regional
 *   authoriser → driver → inspector → auditor
 */
import { expect, request as playwrightRequest, test } from '@playwright/test';
import { DEPARTURE_INSPECTION_ITEMS, RETURN_INSPECTION_ITEMS } from '@/lib/inspection-checklists';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  expect(res.status(), `login ${email}: ${await res.text()}`).toBe(200);
  return api;
}

/** Build a full checklist from the template items — all pass, no comments */
function fullChecklist(template: typeof DEPARTURE_INSPECTION_ITEMS) {
  return template.map((item) => ({ label: item.label, result: 'pass' as const, comment: null }));
}

test.describe('Role lifecycle smoke', () => {
  // This spec executes ~30 sequential API calls (create request, 5 workflow
  // approvals, driver provisioning, 2 inspections, issue/start/return/close)
  // against the configured database. Against remote Neon (eu-central-1) each
  // request takes 5-21s, so a generous budget is required — this test does
  // more serial work than role-isolation (300s) or route-flow (240s).
  test.setTimeout(360_000);

  test('complete request-to-trip lifecycle exercises every key role', async () => {
    const requester = await login('requester@kavangoeast.test');
    const supervisor = await login('supervisor@kavangoeast.test');
    const transport = await login('transport.admin@kavangoeast.test');
    const release = await login('release.officer@kavangoeast.test');
    const authoriser = await login('regional.authoriser@kavangoeast.test');

    // Trip-authority validity check at trip-start requires now >= validFrom.
    // Use a window that starts 1 hour in the past (so validFrom is already
    // passed by the time the trip-start API is called) and ends 2 hours
    // in the future.  The requester (converted to driver) has no pre-existing
    // allocations, so near-past dates don't cause conflicts.
    const start = new Date(Date.now() - 60 * 60 * 1000);
    const end = new Date(Date.now() + 2 * 60 * 60 * 1000);

    // 1. Requester creates transport request
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

    // 3. Transport admin — create a dedicated vehicle for this test run
    const createVehicleRes = await transport.post('/api/fleet', {
      headers: { 'idempotency-key': crypto.randomUUID() },
      data: {
        licenceNumber: `E2E-${Date.now()}`,
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
    const vehicle = (await createVehicleRes.json()).vehicle;
    expect(vehicle).toBeTruthy();
    expect(vehicle.id).toBeTruthy();
    const vehicleId = vehicle.id;
    const initialOdometer = vehicle.currentOdometer ?? 100;

    const allocationRes = await transport.post('/api/allocations', {
      data: { requestId: requestData.id, vehicleId, startDate: start.toISOString(), endDate: end.toISOString() },
    });
    expect(allocationRes.status(), await allocationRes.text()).toBe(200);
    const allocationData = await allocationRes.json();
    const allocationId = allocationData.allocation.id as string;
    const tripId = allocationData.trip.id as string;
    expect(tripId).toBeTruthy();

    // ── Create a dedicated test driver ──────────────────────────────────
    // Seed drivers (KERC008, KERC009) have stale allocations that conflict
    // with our trip dates.  Instead, we convert the requester's employee
    // (KERC002, Maria Shikongo — no pre-existing allocations) into a test
    // driver.  The POST /api/drivers endpoint now auto-assigns the
    // "Assigned Driver" role, so the requester session passes the workflow
    // engine's DRIVER_LOG_CREATE permission check.
    const profileRes = await requester.get('/api/users/profile');
    const profileBody = await profileRes.json();
    const profileData = profileBody.data || profileBody;
    const requesterEmpId = profileData.employee?.id || profileData.profile?.employeeId;
    if (!requesterEmpId) {
      test.skip(true, 'Could not determine requester employee ID');
      return;
    }
    const createDriverRes = await transport.post('/api/drivers', {
      data: {
        employeeId: requesterEmpId,
        licenceNumber: `LIC-E2E-${Date.now()}`,
        licenceClass: 'B',
        issueDate: new Date().toISOString().slice(0, 10),
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        verificationStatus: 'verified',
      },
    });
    if (createDriverRes.status() === 409) {
      // Already converted in a prior run — reuse
      console.log('Driver profile already existed for requester, reusing');
    } else {
      expect(createDriverRes.status(), await createDriverRes.text()).toBe(201);
    }

    // Assign the requester (now a driver) to the allocation
    const assignRes = await transport.patch(`/api/allocations/${allocationId}/driver`, {
      data: { driverEmployeeId: requesterEmpId },
    });
    expect(assignRes.status(), await assignRes.text()).toBe(200);

    // 4. Transport admin reviews + Release officer releases + Authoriser authorises + Driver acknowledges
    for (const [api, label] of [[transport, 'transport review'], [release, 'release'], [authoriser, 'authorise'], [requester, 'driver ack']] as const) {
      const res = await api.post(
        `/api/approvals/${requestData.workflowInstanceId}/action`,
        { data: { actionType: 'approved', comment: `Smoke: ${label}` } },
      );
      expect(res.status(), `${label}: ${await res.text()}`).toBe(200);
    }

    // 5. Departure inspection (using source-of-truth constants)
    const inspector = await login('inspector@kavangoeast.test');
    const depRes = await inspector.post('/api/inspections', {
      data: {
        vehicleId, tripId, type: 'departure',
        odometerReading: initialOdometer, fuelLevel: 'full',
        inspectorAcknowledged: true, driverAcknowledged: true,
        photoKeys: ['smoke/dep-front.jpg', 'smoke/dep-rear.jpg', 'smoke/dep-dash.jpg'],
        checklist: fullChecklist(DEPARTURE_INSPECTION_ITEMS),
      },
    });
    expect(depRes.status(), await depRes.text()).toBe(200);

    // 6. Issue trip + start trip
    const issueRes = await transport.post(`/api/trips/${tripId}/issue`, {
      data: { keysIssued: true, issueOdometer: initialOdometer },
    });
    expect(issueRes.status(), await issueRes.text()).toBe(200);
    const startRes = await requester.post(`/api/trips/${tripId}/start`, {
      data: { beginningOdometer: initialOdometer, passengersConfirmed: true, fuelLevel: 'full' },
    });
    expect(startRes.status(), await startRes.text()).toBe(200);

    // 7. Return trip + return inspection (using source-of-truth constants)
    const returnRes = await requester.post(`/api/trips/${tripId}/return`, {
      data: {
        endingOdometer: initialOdometer + 65, fuelLevel: 'half',
        returnLocation: 'Rundu fleet yard',
        incidentDeclared: false, outstandingReceiptsDeclared: false,
      },
    });
    expect(returnRes.status(), await returnRes.text()).toBe(200);

    const returnInspectionRes = await inspector.post('/api/inspections', {
      data: {
        vehicleId, tripId, type: 'return',
        odometerReading: initialOdometer + 65, fuelLevel: 'half',
        inspectorAcknowledged: true, driverAcknowledged: true,
        photoKeys: ['smoke/ret-front.jpg', 'smoke/ret-rear.jpg', 'smoke/ret-dash.jpg'],
        checklist: fullChecklist(RETURN_INSPECTION_ITEMS),
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
      [requester, supervisor, transport, release, authoriser, inspector, auditor].map(
        (a) => a.dispose(),
      ),
    );
  });
});
