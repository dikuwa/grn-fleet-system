import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from '@playwright/test';
import { and, desc, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { externalDriverLicences, externalParties } from '@/db/schema/external-parties';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { transportRequests } from '@/db/schema/requests';
import {
  inspectionTemplateItems,
  inspectionTemplates,
  tripAuthorities,
  trips,
  vehicleAllocations,
} from '@/db/schema/trips';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const response = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  expect(response.status(), `login ${email}: ${await response.text()}`).toBe(200);
  return api;
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
    .select({ label: inspectionTemplateItems.label, requiresPhoto: inspectionTemplateItems.requiresPhoto })
    .from(inspectionTemplateItems)
    .where(eq(inspectionTemplateItems.templateId, template.id))
    .orderBy(inspectionTemplateItems.sortOrder);
  expect(items.length, `${type} checklist`).toBeGreaterThan(0);
  return {
    checklist: items.map((item) => ({ label: item.label, result: 'pass', comment: null })),
    photoKeys: items
      .filter((item) => item.requiresPhoto)
      .map((_item, index) => `e2e/external-${type}-${Date.now()}-${index}.jpg`),
  };
}

async function inspect(
  api: APIRequestContext,
  type: 'departure' | 'return',
  tripId: string,
  vehicleId: string,
  odometerReading: number,
) {
  const evidence = await liveChecklist(type);
  return api.post('/api/inspections', {
    data: {
      vehicleId,
      tripId,
      type,
      odometerReading,
      fuelLevel: type === 'departure' ? 'full' : 'half',
      inspectorAcknowledged: true,
      driverAcknowledged: true,
      checklist: evidence.checklist,
      photoKeys: evidence.photoKeys,
      notes: `Production closure external-driver ${type} inspection`,
    },
  });
}

test('verified external driver can be accepted, issued, departed, returned, inspected and closed without becoming staff', async () => {
  test.setTimeout(600_000);

  const transport = await login('transport.admin@kavangoeast.test');
  const inspector = await login('inspector@kavangoeast.test');
  const db = getDb();

  const [sponsor] = await db
    .select({ id: employees.id, userId: employees.userId })
    .from(employees)
    .where(
      and(
        eq(employees.tenantId, TENANT_ID as never),
        eq(employees.email, 'requester@kavangoeast.test'),
      ),
    )
    .limit(1);
  expect(sponsor?.id).toBeTruthy();

  const [transportEmployee] = await db
    .select({ userId: employees.userId })
    .from(employees)
    .where(
      and(
        eq(employees.tenantId, TENANT_ID as never),
        eq(employees.email, 'transport.admin@kavangoeast.test'),
      ),
    )
    .limit(1);
  expect(transportEmployee?.userId).toBeTruthy();

  const run = crypto.randomUUID();
  const externalPartyId = crypto.randomUUID();
  const externalLicenceId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const startAt = new Date(Date.now() - 30 * 60_000);
  const endAt = new Date(Date.now() + 8 * 60 * 60_000);

  const candidateVehicles = await db
    .select({
      id: vehicles.id,
      currentOdometer: vehicles.currentOdometer,
      status: vehicles.status,
    })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.tenantId, TENANT_ID as never),
        eq(vehicles.status, 'available'),
        eq(vehicles.professionalAuthorisationRequired, false),
        isNull(vehicles.requiredLicenceClass),
      ),
    );
  const candidateIds = candidateVehicles.map((row) => row.id);
  const conflicts = candidateIds.length
    ? await db
        .select({ vehicleId: vehicleAllocations.vehicleId })
        .from(vehicleAllocations)
        .where(
          and(
            inArray(vehicleAllocations.vehicleId, candidateIds),
            inArray(vehicleAllocations.state, ['provisional', 'confirmed', 'issued']),
            lt(vehicleAllocations.startAt, endAt),
            gt(vehicleAllocations.endAt, startAt),
          ),
        )
    : [];
  const conflictingVehicleIds = new Set(conflicts.map((row) => row.vehicleId));
  const vehicle = candidateVehicles.find((row) => !conflictingVehicleIds.has(row.id));
  if (!vehicle) {
    test.skip(true, 'No conflict-free available non-professional vehicle with unrestricted licence class');
    return;
  }

  await db.insert(externalParties).values({
    id: externalPartyId,
    tenantId: TENANT_ID as never,
    firstName: 'External',
    lastName: `Closure-${run.slice(0, 6)}`,
    organisationName: 'Production Closure Contractor',
    organisationType: 'contractor',
    email: `external-${run.slice(0, 8)}@example.test`,
    phone: '+264811234567',
    status: 'active',
    createdByUserId: transportEmployee.userId as string,
  });

  await db.insert(externalDriverLicences).values({
    id: externalLicenceId,
    tenantId: TENANT_ID as never,
    externalPartyId,
    version: 1,
    licenceNumber: `EXT-${run.slice(0, 10)}`,
    licenceClass: 'B',
    issueDate: '2025-01-01',
    expiryDate: '2031-12-31',
    frontImageKey: `tenant/${TENANT_ID}/external-driver-licences/${externalPartyId}/front.jpg`,
    backImageKey: `tenant/${TENANT_ID}/external-driver-licences/${externalPartyId}/back.jpg`,
    verificationStatus: 'verified',
    verifiedByUserId: transportEmployee.userId as string,
    verifiedAt: new Date(),
  });

  await db.insert(transportRequests).values({
    id: requestId,
    tenantId: TENANT_ID as never,
    reference: `E2E-EXT-${run.slice(0, 8)}`,
    scope: 'regional',
    status: 'transport_review',
    requesterType: 'external',
    requesterEmployeeId: sponsor.id,
    externalRequesterId: externalPartyId,
    requesterUserId: sponsor.userId,
    requestSource: 'external_public_link',
    requestChannel: 'public',
    submissionMethod: 'secure_external_link',
    purpose: 'Production closure full external-driver lifecycle',
    submittedAt: new Date(),
  });

  const allocation = await transport.post('/api/allocations/external', {
    data: {
      requestId,
      vehicleId: vehicle.id,
      externalDriverPartyId: externalPartyId,
      startDate: startAt.toISOString(),
      endDate: endAt.toISOString(),
      notes: 'Production closure verified external driver assignment',
    },
  });
  expect(allocation.status(), await allocation.text()).toBe(201);
  const allocationBody = await allocation.json();
  const allocationId = allocationBody.allocation.id as string;
  const tripId = allocationBody.trip.id as string;
  const assignmentId = allocationBody.externalDriverAssignment.id as string;
  expect(allocationBody.acceptanceRequired).toBe(true);
  expect(allocationBody.externalDriverAssignment.state).toBe('pending_acceptance');

  const acceptAssignment = await transport.patch(
    `/api/allocations/external/${assignmentId}/decision`,
    {
      data: {
        action: 'accept',
        acceptanceMethod: 'in_person',
        note: 'External driver reviewed the operational assignment in person.',
      },
    },
  );
  expect(acceptAssignment.status(), await acceptAssignment.text()).toBe(200);

  const [acceptedAssignment] = await db
    .select({ state: externalDriverAssignments.state, acceptedAt: externalDriverAssignments.acceptedAt })
    .from(externalDriverAssignments)
    .where(eq(externalDriverAssignments.id, assignmentId))
    .limit(1);
  expect(acceptedAssignment.state).toBe('accepted');
  expect(acceptedAssignment.acceptedAt).toBeTruthy();

  await db
    .update(transportRequests)
    .set({ status: 'authorised', updatedAt: new Date() })
    .where(eq(transportRequests.id, requestId));

  const [authority] = await db
    .insert(tripAuthorities)
    .values({
      tenantId: TENANT_ID as never,
      tripId,
      requestId,
      allocationId,
      authorityNumber: `TA-EXT-${run.slice(0, 8)}`,
      status: 'awaiting_pre_trip_inspection',
      version: 1,
      documentVersion: 1,
      validFrom: new Date(Date.now() - 60 * 60_000),
      validUntil: endAt,
      purpose: 'Production closure full external-driver lifecycle',
      beginningOdometer: vehicle.currentOdometer,
      acceptedAt: acceptedAssignment.acceptedAt,
      acceptanceData: {
        source: 'external_assignment_acceptance',
        externalDriverAssignmentId: assignmentId,
        acceptanceMethod: 'in_person',
      },
      authorisedAt: new Date(),
      authorisedByUserId: transportEmployee.userId as string,
    })
    .returning({ id: tripAuthorities.id });

  const departure = await inspect(
    inspector,
    'departure',
    tripId,
    vehicle.id,
    vehicle.currentOdometer,
  );
  expect(departure.status(), await departure.text()).toBe(200);
  const departureBody = await departure.json();
  expect(departureBody.status).toBe('completed');
  expect(departureBody.overallPass).toBe(true);

  const [authorityAfterInspection] = await db
    .select({ status: tripAuthorities.status, documentVersion: tripAuthorities.documentVersion })
    .from(tripAuthorities)
    .where(eq(tripAuthorities.id, authority.id))
    .limit(1);
  expect(authorityAfterInspection.status).toBe('ready_for_departure');

  const [latestDocument] = await db
    .select({ id: generatedDocuments.id })
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

  const snapshotData = {
    renderData: { documentVersion: authorityAfterInspection.documentVersion },
    source: 'production_closure_external_driver',
  };
  if (latestDocument) {
    await db
      .update(generatedDocuments)
      .set({ status: 'issued', snapshotData, updatedAt: new Date() })
      .where(eq(generatedDocuments.id, latestDocument.id));
  } else {
    await db.insert(generatedDocuments).values({
      tenantId: TENANT_ID as never,
      documentType: 'trip_authority',
      documentVersion: 1,
      entityType: 'vehicle_allocation',
      entityId: allocationId,
      snapshotData,
      status: 'issued',
      generatedByUserId: transportEmployee.userId as string,
    });
  }

  const issueOdometer = vehicle.currentOdometer;
  const issue = await transport.post(`/api/trips/${tripId}/external-issue`, {
    data: { issueOdometer, keysIssued: true, fuelCardIssued: true },
  });
  expect(issue.status(), await issue.text()).toBe(200);

  const start = await transport.post(`/api/trips/${tripId}/external-start`, {
    data: {
      beginningOdometer: issueOdometer,
      passengersConfirmed: true,
      fuelLevel: 'full',
    },
  });
  expect(start.status(), await start.text()).toBe(200);

  const endingOdometer = issueOdometer + 75;
  const returned = await transport.post(`/api/trips/${tripId}/external-return`, {
    data: {
      endingOdometer,
      fuelLevel: 'half',
      returnLocation: 'Rundu fleet yard',
      incidentDeclared: false,
      outstandingReceiptsDeclared: false,
      comments: 'External trip returned without incident.',
    },
  });
  expect(returned.status(), await returned.text()).toBe(200);

  const returnInspection = await inspect(inspector, 'return', tripId, vehicle.id, endingOdometer);
  expect(returnInspection.status(), await returnInspection.text()).toBe(200);
  const returnBody = await returnInspection.json();
  expect(returnBody.status).toBe('completed');
  expect(returnBody.overallPass).toBe(true);

  const close = await transport.post(`/api/trips/${tripId}/close`, {
    data: {
      decision: 'closed',
      reviewNotes: 'Production closure: verified external driver returned cleanly.',
    },
  });
  expect(close.status(), await close.text()).toBe(200);

  const [[savedRequest], [savedTrip], [savedAllocation], [savedAssignment], [savedVehicle]] =
    await Promise.all([
      db
        .select({ status: transportRequests.status })
        .from(transportRequests)
        .where(eq(transportRequests.id, requestId))
        .limit(1),
      db.select({ status: trips.status }).from(trips).where(eq(trips.id, tripId)).limit(1),
      db
        .select({ state: vehicleAllocations.state })
        .from(vehicleAllocations)
        .where(eq(vehicleAllocations.id, allocationId))
        .limit(1),
      db
        .select({ state: externalDriverAssignments.state })
        .from(externalDriverAssignments)
        .where(eq(externalDriverAssignments.id, assignmentId))
        .limit(1),
      db
        .select({ status: vehicles.status, currentOdometer: vehicles.currentOdometer })
        .from(vehicles)
        .where(eq(vehicles.id, vehicle.id))
        .limit(1),
    ]);

  expect(savedRequest.status).toBe('closed');
  expect(savedTrip.status).toBe('closed');
  expect(savedAllocation.state).toBe('released');
  expect(savedAssignment.state).toBe('completed');
  expect(savedVehicle.status).toBe('available');
  expect(savedVehicle.currentOdometer).toBeGreaterThanOrEqual(endingOdometer);

  const accidentalStaff = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.email, `external-${run.slice(0, 8)}@example.test`));
  expect(accidentalStaff).toHaveLength(0);

  await Promise.all([transport.dispose(), inspector.dispose()]);
});
