import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from '@playwright/test';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { transportRequests } from '@/db/schema/requests';
import {
  inspectionTemplateItems,
  inspectionTemplates,
  tripAmendments,
  tripAuthorities,
  trips,
  vehicleAllocations,
  vehicleInspections,
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

async function employee(email: string) {
  const db = getDb();
  const [row] = await db
    .select({ id: employees.id, userId: employees.userId })
    .from(employees)
    .where(and(eq(employees.tenantId, TENANT_ID as never), eq(employees.email, email)))
    .limit(1);
  expect(row?.id, `employee fixture ${email}`).toBeTruthy();
  expect(row?.userId, `employee user fixture ${email}`).toBeTruthy();
  return row!;
}

async function passedDepartureChecklist() {
  const db = getDb();
  const [template] = await db
    .select({ id: inspectionTemplates.id, version: inspectionTemplates.version })
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
  expect(template, 'active departure inspection template').toBeTruthy();

  const items = await db
    .select({
      label: inspectionTemplateItems.label,
      requiresPhoto: inspectionTemplateItems.requiresPhoto,
    })
    .from(inspectionTemplateItems)
    .where(eq(inspectionTemplateItems.templateId, template.id))
    .orderBy(inspectionTemplateItems.sortOrder);
  expect(items.length).toBeGreaterThan(0);

  return {
    checklist: items.map((item) => ({ label: item.label, result: 'pass', comment: null })),
    photoKeys: items
      .filter((item) => item.requiresPhoto)
      .map((_item, index) => `tenant/${TENANT_ID}/inspections/revised-authority-${Date.now()}-${index}.jpg`),
  };
}

async function submitDepartureInspection(
  api: APIRequestContext,
  tripId: string,
  vehicleId: string,
  odometerReading: number,
) {
  const evidence = await passedDepartureChecklist();
  return api.post('/api/inspections', {
    data: {
      vehicleId,
      tripId,
      type: 'departure',
      odometerReading,
      fuelLevel: 'full',
      checklist: evidence.checklist,
      photoKeys: evidence.photoKeys,
      notes: 'Production-closure revised-authority inspection',
      inspectorAcknowledged: true,
      driverAcknowledged: true,
    },
  });
}

test('a newer material authority amendment invalidates old acceptance until the assigned driver re-acknowledges', async () => {
  test.setTimeout(300_000);

  const requester = await employee('requester@kavangoeast.test');
  const driverEmployee = await employee('driver@kavangoeast.test');
  const transportEmployee = await employee('transport.admin@kavangoeast.test');
  const driver = await login('driver@kavangoeast.test');
  const transport = await login('transport.admin@kavangoeast.test');
  const db = getDb();

  const [vehicle] = await db
    .select({ id: vehicles.id, currentOdometer: vehicles.currentOdometer })
    .from(vehicles)
    .where(and(eq(vehicles.tenantId, TENANT_ID as never), eq(vehicles.status, 'available')))
    .limit(1);
  test.skip(!vehicle, 'No available vehicle exists for revised-authority closure E2E');

  const run = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const allocationId = crypto.randomUUID();
  const tripId = crypto.randomUUID();
  const authorityId = crypto.randomUUID();
  const acceptedAt = new Date(Date.now() - 5 * 60_000);
  const amendmentAt = new Date(Date.now() - 60_000);
  const startAt = new Date(Date.now() + 24 * 60 * 60_000);
  const endAt = new Date(startAt.getTime() + 4 * 60 * 60_000);

  try {
    await db.insert(transportRequests).values({
      id: requestId,
      tenantId: TENANT_ID as never,
      reference: `E2E-REV-${run.slice(0, 8)}`,
      scope: 'regional',
      status: 'transport_review',
      requesterEmployeeId: requester.id,
      requesterUserId: requester.userId,
      purpose: 'Production closure revised authority acceptance',
      totalAuthorisedKilometres: 80,
      submittedAt: new Date(),
    });

    await db.insert(vehicleAllocations).values({
      id: allocationId,
      requestId,
      vehicleId: vehicle.id,
      driverEmployeeId: driverEmployee.id,
      startAt,
      endAt,
      state: 'confirmed',
      allocatedByUserId: transportEmployee.userId as string,
      version: 2,
    });

    // The fixture needs an authorised request for the revised-authority lifecycle,
    // but allocation creation itself must occur while the request is legitimately
    // allocatable. This mirrors the real Transport Review -> authorisation sequence
    // instead of bypassing the database allocation integrity guard.
    await db
      .update(transportRequests)
      .set({ status: 'authorised' })
      .where(
        and(
          eq(transportRequests.id, requestId),
          eq(transportRequests.tenantId, TENANT_ID as never),
        ),
      );

    await db.insert(trips).values({
      id: tripId,
      tenantId: TENANT_ID as never,
      requestId,
      allocationId,
      vehicleId: vehicle.id,
      status: 'pending',
      driverAcknowledgedAt: acceptedAt,
      driverAcknowledgedByEmployeeId: driverEmployee.id,
      version: 2,
    });

    await db.insert(tripAuthorities).values({
      id: authorityId,
      tenantId: TENANT_ID as never,
      tripId,
      requestId,
      allocationId,
      authorityNumber: `TA-E2E-REV-${run.slice(0, 8)}`,
      status: 'driver_accepted',
      version: 2,
      documentVersion: 2,
      validFrom: startAt,
      validUntil: endAt,
      purpose: 'Production closure revised authority acceptance',
      acceptedAt,
      acceptedByEmployeeId: driverEmployee.id,
      acceptanceData: { source: 'fixture_previous_acceptance' },
    });

    const [amendment] = await db
      .insert(tripAmendments)
      .values({
        authorityId,
        amendmentType: 'vehicle_replacement',
        originalValue: { vehicleId: 'previous-vehicle' },
        newValue: { vehicleId: vehicle.id },
        reason: 'Production closure: replacement vehicle became the current authority vehicle',
        status: 'approved',
        requestedByUserId: transportEmployee.userId as string,
        approvedByUserId: transportEmployee.userId as string,
        approvedAt: amendmentAt,
        version: 2,
        createdAt: amendmentAt,
      })
      .returning({ id: tripAmendments.id });

    const readinessBefore = await driver.get(`/api/trips/${tripId}/readiness`);
    expect(readinessBefore.status(), await readinessBefore.text()).toBe(200);
    const before = await readinessBefore.json();
    expect(before.amendmentAcceptance?.amendmentId).toBe(amendment.id);
    const amendmentGate = before.gates.find(
      (gate: { key: string }) => gate.key === 'authority_amendment_acknowledged',
    );
    expect(amendmentGate?.status).toBe('pending');
    expect(before.driver.accepted).toBe(false);

    // A newer material authority must block an official departure inspection
    // even if an older driver acceptance timestamp exists.
    const inspectionBefore = await submitDepartureInspection(
      transport,
      tripId,
      vehicle.id,
      (vehicle.currentOdometer ?? 0) + 5,
    );
    expect(inspectionBefore.status(), await inspectionBefore.text()).toBe(409);

    const pending = await driver.get(`/api/trips/${tripId}/amendment-acceptance`);
    expect(pending.status(), await pending.text()).toBe(200);
    const pendingBody = await pending.json();
    expect(pendingBody.pending).toBe(true);
    expect(pendingBody.canSelfAcknowledge).toBe(true);
    expect(pendingBody.amendment?.id).toBe(amendment.id);

    const accepted = await driver.post(`/api/trips/${tripId}/amendment-acceptance`, {
      data: { note: 'I reviewed the revised authority and confirm the current vehicle.' },
    });
    expect(accepted.status(), await accepted.text()).toBe(200);
    const acceptedBody = await accepted.json();
    expect(acceptedBody.amendmentId).toBe(amendment.id);
    expect(acceptedBody.driverKind).toBe('internal');
    expect(acceptedBody.nextStage).toBe('awaiting_pre_trip_inspection');

    const readinessAfter = await driver.get(`/api/trips/${tripId}/readiness`);
    expect(readinessAfter.status(), await readinessAfter.text()).toBe(200);
    const after = await readinessAfter.json();
    expect(after.amendmentAcceptance).toBeNull();
    expect(after.driver.accepted).toBe(true);
    expect(
      after.gates.some((gate: { key: string }) => gate.key === 'authority_amendment_acknowledged'),
    ).toBe(false);

    const inspectionAfter = await submitDepartureInspection(
      transport,
      tripId,
      vehicle.id,
      (vehicle.currentOdometer ?? 0) + 10,
    );
    expect(inspectionAfter.status(), await inspectionAfter.text()).toBe(200);
    const inspectionBody = await inspectionAfter.json();
    expect(inspectionBody.status).toBe('completed');
    expect(inspectionBody.overallPass).toBe(true);

    const [authorityAfter] = await db
      .select({
        acceptedAt: tripAuthorities.acceptedAt,
        acceptedByEmployeeId: tripAuthorities.acceptedByEmployeeId,
        status: tripAuthorities.status,
      })
      .from(tripAuthorities)
      .where(eq(tripAuthorities.id, authorityId))
      .limit(1);
    expect(authorityAfter.acceptedAt?.getTime()).toBeGreaterThan(amendmentAt.getTime());
    expect(authorityAfter.acceptedByEmployeeId).toBe(driverEmployee.id);
    expect(authorityAfter.status).toBe('ready_for_departure');
  } finally {
    await db.delete(vehicleInspections).where(eq(vehicleInspections.tripId, tripId)).catch(() => undefined);
    await db.delete(tripAmendments).where(eq(tripAmendments.authorityId, authorityId)).catch(() => undefined);
    await db.delete(tripAuthorities).where(eq(tripAuthorities.id, authorityId)).catch(() => undefined);
    await db.delete(trips).where(eq(trips.id, tripId)).catch(() => undefined);
    await db.delete(vehicleAllocations).where(eq(vehicleAllocations.id, allocationId)).catch(() => undefined);
    await db.delete(transportRequests).where(eq(transportRequests.id, requestId)).catch(() => undefined);
    await Promise.all([driver.dispose(), transport.dispose()]);
  }
});
