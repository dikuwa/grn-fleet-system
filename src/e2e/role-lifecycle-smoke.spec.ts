/**
 * Role Lifecycle Smoke
 *
 * Deterministic API-based lifecycle covering the key operational identities in
 * sequence without mutating fixed personas or depending on leftover seed state.
 *
 * Roles exercised: requester → supervisor → transport → release → regional
 * authoriser → driver → inspector → auditor.
 */

import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from '@playwright/test';
import { and, desc, eq, gt, inArray, lt } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import {
  inspectionTemplateItems,
  inspectionTemplates,
  vehicleAllocations,
} from '@/db/schema/trips';
import { uploadInspectionEvidence } from '@/e2e/helpers/inspection-evidence';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  expect(res.status(), `login ${email}: ${await res.text()}`).toBe(200);
  return api;
}

async function approve(api: APIRequestContext, workflowId: string, label: string) {
  const response = await api.post(`/api/approvals/${workflowId}/action`, {
    data: {
      actionType: 'approved',
      comment: `Role lifecycle smoke: ${label}; operational handover verified.`,
    },
  });
  expect(response.status(), `${label}: ${await response.text()}`).toBe(200);
}

async function liveInspectionEvidence(
  api: APIRequestContext,
  type: 'departure' | 'return',
) {
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

  expect(template, `active ${type} inspection template`).toBeTruthy();

  const items = await db
    .select({
      label: inspectionTemplateItems.label,
      requiresPhoto: inspectionTemplateItems.requiresPhoto,
    })
    .from(inspectionTemplateItems)
    .where(eq(inspectionTemplateItems.templateId, template.id))
    .orderBy(inspectionTemplateItems.sortOrder);

  expect(items.length, `${type} inspection checklist items`).toBeGreaterThan(0);

  const photoKeys = await Promise.all(
    items
      .filter((item) => item.requiresPhoto)
      .map((_item, index) => uploadInspectionEvidence(api, `role-lifecycle-${type}-${index}`)),
  );

  return {
    checklist: items.map((item) => ({
      label: item.label,
      result: 'pass' as const,
      comment: null,
    })),
    photoKeys,
  };
}

test.describe('Role lifecycle smoke', () => {
  test.setTimeout(600_000);

  test('complete request-to-trip lifecycle exercises every key role', async () => {
    const requester = await login('requester@kavangoeast.test');
    const supervisor = await login('supervisor@kavangoeast.test');
    const transport = await login('transport.admin@kavangoeast.test');
    const release = await login('release.officer@kavangoeast.test');
    const authoriser = await login('regional.authoriser@kavangoeast.test');
    const driver = await login('driver@kavangoeast.test');
    const inspector = await login('inspector@kavangoeast.test');
    const auditor = await login('auditor@kavangoeast.test');
    const db = getDb();

    const now = Date.now();
    const start = new Date(now - 5 * 60_000);
    const end = new Date(now + 4 * 60 * 60_000);

    const createRes = await requester.post('/api/transport-requests', {
      headers: { 'idempotency-key': crypto.randomUUID() },
      data: {
        purpose: 'E2E role lifecycle smoke — district coordination meeting',
        scope: 'regional',
        activities: [
          {
            title: 'District coordination meeting',
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            estimatedKilometres: 120,
          },
        ],
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(200);

    const requestData = (await createRes.json()).request as {
      id: string;
      workflowInstanceId: string;
    };
    expect(requestData.workflowInstanceId).toBeTruthy();

    await approve(supervisor, requestData.workflowInstanceId, 'supervisor approval');

    const fleetResponse = await transport.get('/api/fleet?limit=100');
    expect(fleetResponse.status(), await fleetResponse.text()).toBe(200);
    const fleetBody = await fleetResponse.json();
    const fleetRows = fleetBody.rows || fleetBody.data || fleetBody;
    const vehicle = fleetRows.find((row: { status: string }) => row.status === 'available') as
      | { id: string; currentOdometer: number }
      | undefined;
    expect(vehicle, 'seeded available vehicle').toBeTruthy();

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
          eq(vehicleAllocations.vehicleId, vehicle!.id),
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

    const allocationRes = await transport.post('/api/allocations', {
      data: {
        requestId: requestData.id,
        vehicleId: vehicle!.id,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      },
    });
    expect(allocationRes.status(), await allocationRes.text()).toBe(200);

    const allocationData = await allocationRes.json();
    const allocationId = allocationData.allocation.id as string;
    const tripId = allocationData.trip.id as string;
    expect(tripId).toBeTruthy();

    const assignRes = await transport.patch(`/api/allocations/${allocationId}/driver`, {
      data: { driverEmployeeId },
    });
    expect(assignRes.status(), await assignRes.text()).toBe(200);

    await approve(transport, requestData.workflowInstanceId, 'transport review');
    await approve(release, requestData.workflowInstanceId, 'regional release');
    await approve(authoriser, requestData.workflowInstanceId, 'regional authorisation');

    const acknowledge = await driver.post(`/api/trips/${tripId}/acknowledge`, {
      data: {
        vehicleConfirmed: true,
        authorityConfirmed: true,
        routeUnderstood: true,
        passengersUnderstood: true,
        licenceValidConfirmed: true,
        responsibilityAccepted: true,
        conditionsReviewed: true,
        signature: 'e2e-role-lifecycle-driver-confirmed',
        comment: 'Role lifecycle smoke driver acceptance.',
      },
    });
    expect(acknowledge.status(), await acknowledge.text()).toBe(200);

    const departureEvidence = await liveInspectionEvidence(inspector, 'departure');
    const departure = await inspector.post('/api/inspections', {
      data: {
        vehicleId: vehicle!.id,
        tripId,
        type: 'departure',
        odometerReading: vehicle!.currentOdometer,
        fuelLevel: 'full',
        inspectorAcknowledged: true,
        driverAcknowledged: true,
        photoKeys: departureEvidence.photoKeys,
        checklist: departureEvidence.checklist,
        notes: 'Role lifecycle smoke departure inspection — all clear.',
      },
    });
    expect(departure.status(), await departure.text()).toBe(200);

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

    const formalIssue = await transport.post(
      `/api/documents/${authorityDocument!.id}/action`,
      { data: { action: 'issue' } },
    );
    expect(formalIssue.status(), await formalIssue.text()).toBe(200);

    const issueRes = await transport.post(`/api/trips/${tripId}/issue`, {
      data: {
        keysIssued: true,
        fuelCardIssued: true,
        issueOdometer: vehicle!.currentOdometer,
      },
    });
    expect(issueRes.status(), await issueRes.text()).toBe(200);

    const startRes = await driver.post(`/api/trips/${tripId}/start`, {
      data: {
        beginningOdometer: vehicle!.currentOdometer,
        passengersConfirmed: true,
        fuelLevel: 'full',
      },
    });
    expect(startRes.status(), await startRes.text()).toBe(200);

    const returnRes = await driver.post(`/api/trips/${tripId}/return`, {
      data: {
        endingOdometer: vehicle!.currentOdometer + 65,
        fuelLevel: 'half',
        returnLocation: 'Rundu fleet yard',
        incidentDeclared: false,
        outstandingReceiptsDeclared: false,
      },
    });
    expect(returnRes.status(), await returnRes.text()).toBe(200);

    const returnEvidence = await liveInspectionEvidence(inspector, 'return');
    const returnInspection = await inspector.post('/api/inspections', {
      data: {
        vehicleId: vehicle!.id,
        tripId,
        type: 'return',
        odometerReading: vehicle!.currentOdometer + 65,
        fuelLevel: 'half',
        inspectorAcknowledged: true,
        driverAcknowledged: true,
        photoKeys: returnEvidence.photoKeys,
        checklist: returnEvidence.checklist,
        notes: 'Role lifecycle smoke return inspection — all clear.',
      },
    });
    expect(returnInspection.status(), await returnInspection.text()).toBe(200);

    const closeRes = await transport.post(`/api/trips/${tripId}/close`, {
      data: {
        decision: 'closed',
        reviewNotes: 'Role lifecycle smoke completed successfully.',
      },
    });
    expect(closeRes.status(), await closeRes.text()).toBe(200);

    const auditRes = await auditor.get('/api/audit?limit=10');
    expect(auditRes.status(), await auditRes.text()).toBe(200);

    await Promise.all(
      [requester, supervisor, transport, release, authoriser, driver, inspector, auditor].map((api) =>
        api.dispose(),
      ),
    );
  });
});
