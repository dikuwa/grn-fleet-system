import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { auditEvents } from '@/db/schema/audit';
import { maintenanceEvents, vehicleOdometerEvents, vehicles } from '@/db/schema/fleet';
import { currentNamibiaDate } from '@/lib/maintenance-record-validation';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const response = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  expect(response.status(), `login ${email}: ${await response.text()}`).toBe(200);
  return api;
}

async function disposeAll(...clients: APIRequestContext[]) {
  await Promise.all(clients.map((client) => client.dispose()));
}

test('maintenance history commits atomically without changing vehicle availability', async () => {
  test.setTimeout(180_000);

  const maintenance = await login('maintenance@kavangoeast.test');
  const requester = await login('requester@kavangoeast.test');
  const db = getDb();

  const deniedLookup = await requester.get('/api/maintenance/vehicles?search=GRN');
  expect(deniedLookup.status()).toBe(403);

  const malformedLookup = await maintenance.get('/api/maintenance/vehicles?id=not-a-uuid');
  expect(malformedLookup.status(), await malformedLookup.text()).toBe(200);
  expect((await malformedLookup.json()).rows).toEqual([]);

  // Scheduled maintenance must be able to start before any trip, inspection,
  // defect or previous maintenance relationship exists. Use the dedicated,
  // permission-gated tenant-fleet selector that backs the maintenance form.
  const selectorResponse = await maintenance.get('/api/maintenance/vehicles?limit=20');
  expect(selectorResponse.status(), await selectorResponse.text()).toBe(200);
  const selectorBody = await selectorResponse.json();
  const visibleVehicle = (selectorBody.rows as Array<{ id: string }> | undefined)?.[0];
  expect(visibleVehicle?.id, 'active vehicle visible to Maintenance selector').toBeTruthy();

  // The dedicated selector must not widen the general Fleet related-record scope.
  // Before this first maintenance record exists, the same unrelated vehicle stays
  // hidden from the ordinary Fleet detail endpoint.
  const generalFleetBefore = await maintenance.get(`/api/fleet/${visibleVehicle!.id}`);
  expect(generalFleetBefore.status()).toBe(404);

  const [vehicle] = await db
    .select({
      id: vehicles.id,
      status: vehicles.status,
      currentOdometer: vehicles.currentOdometer,
    })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.id, visibleVehicle!.id),
        eq(vehicles.tenantId, TENANT_ID as never),
        eq(vehicles.isActive, true),
      ),
    )
    .limit(1);

  expect(vehicle, 'maintenance-selector tenant vehicle').toBeTruthy();

  const denied = await requester.post('/api/maintenance', {
    data: {
      vehicleId: vehicle!.id,
      serviceDate: currentNamibiaDate(),
      serviceType: 'scheduled',
      description: 'Unauthorized maintenance closure probe',
    },
  });
  expect(denied.status()).toBe(403);

  const serviceOdometer = vehicle!.currentOdometer + 1;
  const description = `Maintenance closure ${crypto.randomUUID()}`;
  const created = await maintenance.post('/api/maintenance', {
    data: {
      vehicleId: vehicle!.id,
      serviceDate: currentNamibiaDate(),
      serviceOdometer,
      serviceType: 'scheduled',
      description,
      cost: '1250.50',
      vendorName: 'GRN Fleet Workshop',
      notes: 'Production-closure maintenance lifecycle verification.',
      nextServiceOdometer: serviceOdometer + 5000,
    },
  });

  expect(created.status(), await created.text()).toBe(201);
  const body = await created.json();
  const eventId = body.data.id as string;
  expect(eventId).toBeTruthy();

  const [savedEvent] = await db
    .select({
      id: maintenanceEvents.id,
      vehicleId: maintenanceEvents.vehicleId,
      serviceOdometer: maintenanceEvents.serviceOdometer,
      serviceType: maintenanceEvents.serviceType,
      description: maintenanceEvents.description,
    })
    .from(maintenanceEvents)
    .where(eq(maintenanceEvents.id, eventId))
    .limit(1);
  expect(savedEvent).toMatchObject({
    id: eventId,
    vehicleId: vehicle!.id,
    serviceOdometer,
    serviceType: 'scheduled',
    description,
  });

  const [odometerEvent] = await db
    .select({
      odometerValue: vehicleOdometerEvents.odometerValue,
      source: vehicleOdometerEvents.source,
      sourceEntityType: vehicleOdometerEvents.sourceEntityType,
      sourceEntityId: vehicleOdometerEvents.sourceEntityId,
    })
    .from(vehicleOdometerEvents)
    .where(
      and(
        eq(vehicleOdometerEvents.vehicleId, vehicle!.id),
        eq(vehicleOdometerEvents.sourceEntityId, eventId),
      ),
    )
    .limit(1);
  expect(odometerEvent).toEqual({
    odometerValue: serviceOdometer,
    source: 'maintenance',
    sourceEntityType: 'maintenance',
    sourceEntityId: eventId,
  });

  const [savedVehicle] = await db
    .select({ status: vehicles.status, currentOdometer: vehicles.currentOdometer })
    .from(vehicles)
    .where(eq(vehicles.id, vehicle!.id))
    .limit(1);
  expect(savedVehicle.currentOdometer).toBe(serviceOdometer);
  expect(savedVehicle.status).toBe(vehicle!.status);

  const [audit] = await db
    .select({
      eventType: auditEvents.eventType,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.tenantId, TENANT_ID as never),
        eq(auditEvents.entityId, eventId),
      ),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(1);
  expect(audit).toEqual({
    eventType: 'maintenance_created',
    entityType: 'maintenance_event',
    entityId: eventId,
  });

  await disposeAll(maintenance, requester);
});