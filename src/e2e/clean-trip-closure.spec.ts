import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from '@playwright/test';
import { and, desc, eq, gt, inArray, lt } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { employees } from '@/db/schema/people';
import { transportRequests } from '@/db/schema/requests';
import {
  inspectionTemplateItems,
  inspectionTemplates,
  trips,
  vehicleAllocations,
} from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const response = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  expect(response.status(), `login ${email}: ${await response.text()}`).toBe(200);
  return api;
}

async function approve(api: APIRequestContext, workflowId: string) {
  let lastResponse: Awaited<ReturnType<APIRequestContext['post']>> | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await api.post(`/api/approvals/${workflowId}/action`, {
      data: { actionType: 'approved' },
    });
    lastResponse = response;
    if (response.status() !== 409) {
      expect(response.status(), await response.text()).toBe(200);
      return;
    }
    const body = await response.text();
    if (!body.includes('changed while you were deciding')) {
      expect(response.status(), body).toBe(200);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
  }
  expect(lastResponse?.status(), lastResponse ? await lastResponse.text() : 'approval did not run').toBe(200);
}

async function liveChecklist(type: 'departure' | 'return') {
  const db = getDb();
  const [template] = await db
    .select({ id: inspectionTemplates.id })
    .from(inspectionTemplates)
    .where(
      and(
        eq(inspectionTemplates.tenantId, TENANT_ID as never),
        eq(inspectionTemplates.type, type),
        eq(inspectionTemplates.isActive, true),
      ),
    )
    .orderBy(desc(inspectionTemplates.version))
    .limit(1);
  expect(template, `active ${type} template`).toBeTruthy();
  const items = await db
    .select({
      label: inspectionTemplateItems.label,
      requiresPhoto: inspectionTemplateItems.requiresPhoto,
    })
    .from(inspectionTemplateItems)
    .where(eq(inspectionTemplateItems.templateId, template.id))
    .orderBy(inspectionTemplateItems.sortOrder);
  expect(items.length, `${type} checklist items`).toBeGreaterThan(0);
  return {
    checklist: items.map((item) => ({ label: item.label, result: 'pass', comment: null })),
    photoKeys: items
      .filter((item) => item.requiresPhoto)
      .map(
        (_item, index) =>
          `tenant/${TENANT_ID}/inspections/e2e/clean-${type}-${Date.now()}-${index}.jpg`,
      ),
  };
}

test('a clean returned trip closes atomically and restores the vehicle to available', async () => {
  test.setTimeout(600_000);

  const requester = await login('requester@kavangoeast.test');
  const supervisor = await login('supervisor@kavangoeast.test');
  const transport = await login('transport.admin@kavangoeast.test');
  const release = await login('release.officer@kavangoeast.test');
  const authoriser = await login('regional.authoriser@kavangoeast.test');
  const driver = await login('driver@kavangoeast.test');
  const inspector = await login('inspector@kavangoeast.test');
  const db = getDb();

  const offset = parseInt(crypto.randomUUID().slice(0, 6), 16) % 10_000;
  const start = new Date(Date.now() + (500 + offset) * 60 * 60_000);
  const end = new Date(start.getTime() + 4 * 60 * 60_000);

  const requestResponse = await requester.post('/api/transport-requests', {
    headers: { 'idempotency-key': crypto.randomUUID() },
    data: {
      purpose: 'Production closure clean return lifecycle',
      scope: 'regional',
      activities: [
        {
          title: 'Clean return closure verification',
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          estimatedKilometres: 120,
        },
      ],
    },
  });
  expect(requestResponse.status(), await requestResponse.text()).toBe(200);
  const requestBody = await requestResponse.json();
  const requestId = requestBody.request.id as string;
  const workflowId = requestBody.request.workflowInstanceId as string;
  expect(workflowId).toBeTruthy();

  await approve(supervisor, workflowId);

  const fleetResponse = await transport.get('/api/fleet?limit=100');
  expect(fleetResponse.status(), await fleetResponse.text()).toBe(200);
  const fleetBody = await fleetResponse.json();
  const fleetRows = fleetBody.rows || fleetBody.data || fleetBody;
  const vehicle = fleetRows.find((row: { status: string }) => row.status === 'available') as
    | { id: string; currentOdometer: number }
    | undefined;
  if (!vehicle) {
    test.skip(true, 'No available vehicle for clean closure E2E');
    return;
  }

  const driversResponse = await transport.get('/api/drivers');
  expect(driversResponse.status(), await driversResponse.text()).toBe(200);
  const driverRows = (await driversResponse.json()).data;
  const driverEmployeeId = driverRows.find(
    (row: { employeeNumber: string }) => row.employeeNumber === 'KERC008',
  )?.id as string | undefined;
  expect(driverEmployeeId, 'seeded authorised driver KERC008').toBeTruthy();

  await db
    .update(vehicleAllocations)
    .set({ state: 'cancelled' })
    .where(
      and(
        eq(vehicleAllocations.vehicleId, vehicle.id),
        inArray(vehicleAllocations.state, ['provisional', 'confirmed', 'issued']),
        lt(vehicleAllocations.startAt, end),
        gt(vehicleAllocations.endAt, start),
      ),
    );
  await db
    .update(vehicleAllocations)
    .set({ state: 'cancelled' })
    .where(
      and(
        eq(vehicleAllocations.driverEmployeeId, driverEmployeeId!),
        inArray(vehicleAllocations.state, ['provisional', 'confirmed', 'issued']),
        lt(vehicleAllocations.startAt, end),
        gt(vehicleAllocations.endAt, start),
      ),
    );

  const allocationResponse = await transport.post('/api/allocations', {
    data: {
      requestId,
      vehicleId: vehicle.id,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    },
  });
  expect(allocationResponse.status(), await allocationResponse.text()).toBe(200);
  const allocationBody = await allocationResponse.json();
  const allocationId = allocationBody.allocation.id as string;
  const tripId = allocationBody.trip.id as string;

  const assignDriver = await transport.patch(`/api/allocations/${allocationId}/driver`, {
    data: { driverEmployeeId },
  });
  expect(assignDriver.status(), await assignDriver.text()).toBe(200);

  await approve(transport, workflowId);
  await approve(release, workflowId);
  await approve(authoriser, workflowId);

  const acknowledge = await driver.post(`/api/trips/${tripId}/acknowledge`, {
    data: {
      vehicleConfirmed: true,
      authorityConfirmed: true,
      routeUnderstood: true,
      passengersUnderstood: true,
      licenceValidConfirmed: true,
      responsibilityAccepted: true,
      conditionsReviewed: true,
      signature: 'e2e-clean-closure-driver-confirmed',
      comment: 'Production closure driver acceptance.',
    },
  });
  expect(acknowledge.status(), await acknowledge.text()).toBe(200);

  const departureEvidence = await liveChecklist('departure');
  const departure = await inspector.post('/api/inspections', {
    data: {
      vehicleId: vehicle.id,
      tripId,
      type: 'departure',
      odometerReading: vehicle.currentOdometer,
      fuelLevel: 'full',
      inspectorAcknowledged: true,
      driverAcknowledged: true,
      checklist: departureEvidence.checklist,
      photoKeys: departureEvidence.photoKeys,
      notes: 'Production closure departure inspection — all clear',
    },
  });
  expect(departure.status(), await departure.text()).toBe(200);
  const departureBody = await departure.json();
  expect(departureBody.status).toBe('completed');
  expect(departureBody.overallPass).toBe(true);

  const [authorityDocument] = await db
    .select({ id: generatedDocuments.id, status: generatedDocuments.status })
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.tenantId, TENANT_ID as never),
        eq(generatedDocuments.entityType, 'vehicle_allocation'),
        eq(generatedDocuments.entityId, allocationId),
        eq(generatedDocuments.documentType, 'trip_authority'),
      ),
    )
    .orderBy(desc(generatedDocuments.documentVersion))
    .limit(1);
  expect(authorityDocument?.id, 'current Trip Authority document').toBeTruthy();
  expect(authorityDocument?.status).toBe('draft');

  const formalIssue = await transport.post(`/api/documents/${authorityDocument!.id}/action`, {
    data: { action: 'issue' },
  });
  expect(formalIssue.status(), await formalIssue.text()).toBe(200);

  const issue = await transport.post(`/api/trips/${tripId}/issue`, {
    data: {
      keysIssued: true,
      fuelCardIssued: true,
      issueOdometer: vehicle.currentOdometer,
    },
  });
  expect(issue.status(), await issue.text()).toBe(200);

  const startTrip = await driver.post(`/api/trips/${tripId}/start`, {
    data: {
      beginningOdometer: vehicle.currentOdometer,
      passengersConfirmed: true,
      fuelLevel: 'full',
    },
  });
  expect(startTrip.status(), await startTrip.text()).toBe(200);

  const endingOdometer = vehicle.currentOdometer + 60;
  const returned = await driver.post(`/api/trips/${tripId}/return`, {
    data: {
      endingOdometer,
      fuelLevel: 'half',
      returnLocation: 'Rundu fleet yard',
      incidentDeclared: false,
      outstandingReceiptsDeclared: false,
    },
  });
  expect(returned.status(), await returned.text()).toBe(200);

  const returnEvidence = await liveChecklist('return');
  const returnInspection = await inspector.post('/api/inspections', {
    data: {
      vehicleId: vehicle.id,
      tripId,
      type: 'return',
      odometerReading: endingOdometer,
      fuelLevel: 'half',
      inspectorAcknowledged: true,
      driverAcknowledged: true,
      checklist: returnEvidence.checklist,
      photoKeys: returnEvidence.photoKeys,
      notes: 'Production closure return inspection — all clear',
    },
  });
  expect(returnInspection.status(), await returnInspection.text()).toBe(200);
  const returnBody = await returnInspection.json();
  expect(returnBody.status).toBe('completed');
  expect(returnBody.overallPass).toBe(true);

  const close = await transport.post(`/api/trips/${tripId}/close`, {
    data: {
      decision: 'closed',
      reviewNotes: 'Production closure E2E: clean return, no blocking safety defect.',
    },
  });
  expect(close.status(), await close.text()).toBe(200);

  const [savedRequest] = await db
    .select({ status: transportRequests.status })
    .from(transportRequests)
    .where(eq(transportRequests.id, requestId))
    .limit(1);
  const [savedTrip] = await db
    .select({ status: trips.status, closedAt: trips.closedAt })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);
  const [savedAllocation] = await db
    .select({ state: vehicleAllocations.state })
    .from(vehicleAllocations)
    .where(eq(vehicleAllocations.id, allocationId))
    .limit(1);
  const [savedVehicle] = await db
    .select({ status: vehicles.status, currentOdometer: vehicles.currentOdometer })
    .from(vehicles)
    .where(eq(vehicles.id, vehicle.id))
    .limit(1);

  expect(savedRequest.status).toBe('closed');
  expect(savedTrip.status).toBe('closed');
  expect(savedTrip.closedAt).toBeTruthy();
  expect(savedAllocation.state).toBe('released');
  expect(savedVehicle.status).toBe('available');
  expect(savedVehicle.currentOdometer).toBeGreaterThanOrEqual(endingOdometer);

  const [driverRecord] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.id, driverEmployeeId!))
    .limit(1);
  expect(driverRecord?.id).toBe(driverEmployeeId);

  await Promise.all(
    [requester, supervisor, transport, release, authoriser, driver, inspector].map((api) =>
      api.dispose(),
    ),
  );
});
