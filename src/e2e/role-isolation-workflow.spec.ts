import { test, expect, request as playwrightRequest, type APIRequestContext, type Browser } from '@playwright/test';
import { getDb } from '@/db';
import { auditEvents, notifications, transportRequests, trips, vehicles, vehicleDefects } from '@/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { DEPARTURE_INSPECTION_ITEMS, RETURN_INSPECTION_ITEMS } from '@/lib/inspection-checklists';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

const accounts = {
  tenantAdmin: 'admin@kavangoeast.gov.na',
  transport: 'transport.admin@kavangoeast.test',
  requester: 'requester@kavangoeast.test',
  supervisor: 'supervisor@kavangoeast.test',
  release: 'release.officer@kavangoeast.test',
  authoriser: 'regional.authoriser@kavangoeast.test',
  nationalRelease: 'national.release@kavangoeast.test',
  nationalAuthoriser: 'national.authoriser@kavangoeast.test',
  driver: 'driver@kavangoeast.test',
  inspector: 'inspector@kavangoeast.test',
  maintenance: 'maintenance@kavangoeast.test',
  auditor: 'auditor@kavangoeast.test',
} as const;

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const response = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  expect(response.status(), `login ${email}`).toBe(200);
  return api;
}

async function approve(api: APIRequestContext, workflowId: string, actionType = 'approved', comment?: string) {
  const response = await api.post(`/api/approvals/${workflowId}/action`, { data: { actionType, comment } });
  expect(response.status(), await response.text()).toBe(200);
}

async function openAs(browser: Browser, email: string, path: string, viewport = { width: 1280, height: 800 }) {
  const api = await login(email);
  const storageState = await api.storageState();
  const context = await browser.newContext({ storageState, viewport });
  const page = await context.newPage();
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  return { api, context, page };
}

test.describe.serial('Approved multi-role workflow and isolation', () => {
  test.setTimeout(300_000);
  test('every operational account logs in and receives role-scoped API access', async ({ browser }) => {
    for (const email of Object.values(accounts)) {
      const api = await login(email);
      const session = await api.get('/api/auth/get-session');
      expect(session.status(), email).toBe(200);
      const payload = await session.json();
      expect(payload.user?.email).toBe(email);
      await api.dispose();
    }

    const requester = await login(accounts.requester);
    expect((await requester.get('/api/regions')).status()).toBe(403);
    expect((await requester.get('/api/admin/users')).status()).toBe(403);
    await requester.dispose();

    const admin = await login(accounts.tenantAdmin);
    const regionResponse = await admin.get('/api/regions');
    expect(regionResponse.status()).toBe(200);
    const fleet = await admin.get('/api/fleet?limit=100');
    expect(fleet.status()).toBe(200);
    expect(JSON.stringify(await fleet.json())).not.toContain('ZRC-ISOLATION-001');
    await admin.dispose();

    const requesterUi = await openAs(browser, accounts.requester, '/dashboard', { width: 390, height: 844 });
    await expect(requesterUi.page).toHaveURL(/\/dashboard/);
    await expect(requesterUi.page.locator('a[href="/dashboard/admin/users"]')).toHaveCount(0);
    await requesterUi.page.screenshot({ path: 'docs/screenshots/requester-mobile.png', fullPage: true });
    await requesterUi.context.close();
    await requesterUi.api.dispose();
  });

  test('regional request executes through separate users and persists evidence', async ({ browser }) => {
    const requester = await login(accounts.requester);
    const supervisor = await login(accounts.supervisor);
    const transport = await login(accounts.transport);
    const release = await login(accounts.release);
    const authoriser = await login(accounts.authoriser);
    const driver = await login(accounts.driver);
    const inspector = await login(accounts.inspector);
    const maintenance = await login(accounts.maintenance);
    const auditor = await login(accounts.auditor);
    const clientSubmissionId = crypto.randomUUID();
    const offsetHours = 24 + (parseInt(clientSubmissionId.slice(0, 6), 16) % 4_000);
    const start = new Date(Date.now() + offsetHours * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

    const requestResponse = await requester.post('/api/transport-requests', {
      headers: { 'idempotency-key': clientSubmissionId },
      data: { purpose: 'Multi-role E2E regional field visit', scope: 'regional', activities: [{ title: 'Field visit', startDate: start.toISOString(), endDate: end.toISOString(), estimatedKilometres: 180 }] },
    });
    expect(requestResponse.status(), await requestResponse.text()).toBe(200);
    const created = await requestResponse.json();
    const requestId = created.request.id as string;
    const workflowId = created.request.workflowInstanceId as string;
    expect(workflowId).toBeTruthy();

    const duplicate = await requester.post('/api/transport-requests', { headers: { 'idempotency-key': clientSubmissionId }, data: { purpose: 'duplicate', scope: 'regional' } });
    expect(duplicate.status()).toBe(200);
    expect((await duplicate.json()).duplicate).toBe(true);

    const supervisorNotifications = await supervisor.get('/api/notifications');
    expect(JSON.stringify(await supervisorNotifications.json())).toContain(workflowId);
    await approve(supervisor, workflowId);

    const fleetResponse = await transport.get('/api/fleet?limit=100');
    const fleetBody = await fleetResponse.json();
    const fleetRows = fleetBody.rows || fleetBody.data || fleetBody;
    const availableVehicles = fleetRows.filter((vehicle: { status: string }) => vehicle.status === 'available');
    expect(availableVehicles.length).toBeGreaterThanOrEqual(1);
    const vehicleId = availableVehicles[0].id as string;

    const allocationResponse = await transport.post('/api/allocations', { data: { requestId, vehicleId, startDate: start.toISOString(), endDate: end.toISOString() } });
    expect(allocationResponse.status(), await allocationResponse.text()).toBe(200);
    const allocationBody = await allocationResponse.json();
    const allocationId = allocationBody.allocation.id as string;
    const tripId = allocationBody.trip.id as string;

    const driversResponse = await transport.get('/api/drivers');
    expect(driversResponse.status()).toBe(200);
    const driverRows = (await driversResponse.json()).data;
    const driverEmployeeId = driverRows.find((row: { employeeNumber: string }) => row.employeeNumber === 'KERC008').id as string;
    const driverAssignment = await transport.patch(`/api/allocations/${allocationId}/driver`, { data: { driverEmployeeId } });
    expect(driverAssignment.status(), await driverAssignment.text()).toBe(200);

    await approve(transport, workflowId);
    await approve(release, workflowId);
    await approve(authoriser, workflowId);
    await approve(driver, workflowId);

    const departure = await inspector.post('/api/inspections', { data: {
      vehicleId, tripId, type: 'departure', odometerReading: availableVehicles[0].currentOdometer,
      fuelLevel: 'full', inspectorAcknowledged: true, driverAcknowledged: true,
      photoKeys: ['e2e/departure-1.jpg', 'e2e/departure-2.jpg', 'e2e/departure-3.jpg'],
      checklist: DEPARTURE_INSPECTION_ITEMS.map((item) => ({ label: item.label, result: 'pass', comment: null })),
    } });
    expect(departure.status(), await departure.text()).toBe(200);

    const issue = await transport.post(`/api/trips/${tripId}/issue`, { data: { keysIssued: true, fuelCardIssued: true, issueOdometer: availableVehicles[0].currentOdometer } });
    expect(issue.status(), await issue.text()).toBe(200);
    const startTrip = await driver.post(`/api/trips/${tripId}/start`);
    expect(startTrip.status(), await startTrip.text()).toBe(200);

    const fuelSyncId = crypto.randomUUID();
    const fuel = await driver.post('/api/fuel', { data: { tripId, vehicleId, clientSyncId: fuelSyncId, fuelType: 'diesel', litres: 35, amount: 720, paymentMethod: 'fuel_card', odometerReading: availableVehicles[0].currentOdometer + 60 } });
    expect(fuel.status(), await fuel.text()).toBe(200);
    const duplicateFuel = await driver.post('/api/fuel', { data: { tripId, vehicleId, clientSyncId: fuelSyncId, fuelType: 'diesel', litres: 35, amount: 720, paymentMethod: 'fuel_card' } });
    expect((await duplicateFuel.json()).idempotent).toBe(true);

    const logSyncId = crypto.randomUUID();
    const tripLog = await driver.post('/api/trip-logs', { data: { tripId, clientSyncId: logSyncId, logDate: new Date().toISOString().slice(0, 10), odometerOut: availableVehicles[0].currentOdometer, odometerIn: availableVehicles[0].currentOdometer + 60, origin: 'Rundu', destination: 'Divundu', distanceKm: 60 } });
    expect(tripLog.status(), await tripLog.text()).toBe(201);
    const duplicateLog = await driver.post('/api/trip-logs', { data: { tripId, clientSyncId: logSyncId, logDate: new Date().toISOString().slice(0, 10) } });
    expect((await duplicateLog.json()).idempotent).toBe(true);

    const returned = await driver.post(`/api/trips/${tripId}/return`);
    expect(returned.status(), await returned.text()).toBe(200);
    const returnChecklist = RETURN_INSPECTION_ITEMS.map((item, index) => ({ label: item.label, result: index === 1 ? 'fail' : 'pass', comment: index === 1 ? 'Critical windshield damage found' : null }));
    const returnInspection = await inspector.post('/api/inspections', { data: {
      vehicleId, tripId, type: 'return', odometerReading: availableVehicles[0].currentOdometer + 60,
      fuelLevel: 'half', inspectorAcknowledged: true, driverAcknowledged: true,
      photoKeys: ['e2e/return-1.jpg', 'e2e/return-2.jpg', 'e2e/return-3.jpg'], checklist: returnChecklist,
    } });
    expect(returnInspection.status(), await returnInspection.text()).toBe(200);
    expect((await returnInspection.json()).status).toBe('failed');

    expect((await maintenance.get('/dashboard/maintenance')).status()).toBe(200);
    const close = await transport.post(`/api/trips/${tripId}/close`, { data: { decision: 'follow_up', reviewNotes: 'Closed operationally; blocking defect retained for maintenance.' } });
    expect(close.status(), await close.text()).toBe(200);
    expect((await auditor.get('/api/audit?limit=100')).status()).toBe(200);

    const db = getDb();
    const [savedRequest] = await db.select().from(transportRequests).where(eq(transportRequests.id, requestId)).limit(1);
    const [savedTrip] = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
    const [savedVehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
    const [blockingDefect] = await db.select().from(vehicleDefects).where(and(eq(vehicleDefects.vehicleId, vehicleId), eq(vehicleDefects.isBlocking, true), isNull(vehicleDefects.resolvedAt))).limit(1);
    const requestAudits = await db.select().from(auditEvents).where(eq(auditEvents.tenantId, savedRequest.tenantId));
    const workflowNotifications = await db.select().from(notifications).where(eq(notifications.entityId, workflowId));
    expect(savedRequest.status).toBe('closed');
    expect(savedTrip.status).toBe('closed');
    expect(savedVehicle.status).toBe('maintenance');
    expect(blockingDefect).toBeTruthy();
    expect(requestAudits.some((event) => event.entityId === tripId && event.eventType === 'trip_closed')).toBe(true);
    expect(workflowNotifications.length).toBeGreaterThan(0);

    const maintenanceUi = await openAs(browser, accounts.maintenance, '/dashboard/maintenance');
    await expect(maintenanceUi.page).toHaveURL(/\/dashboard\/maintenance/);
    await maintenanceUi.page.screenshot({ path: 'docs/screenshots/maintenance-escalation.png', fullPage: true });
    await maintenanceUi.context.close();
    await maintenanceUi.api.dispose();
    const auditUi = await openAs(browser, accounts.auditor, '/dashboard/audit');
    await expect(auditUi.page).toHaveURL(/\/dashboard\/audit/);
    await auditUi.page.screenshot({ path: 'docs/screenshots/audit-history.png', fullPage: true });
    await auditUi.context.close();
    await auditUi.api.dispose();

    await Promise.all([requester, supervisor, transport, release, authoriser, driver, inspector, maintenance, auditor].map((api) => api.dispose()));
  });

  test('rejection, resubmission, cancellation, and national routing use the assigned people', async () => {
    const requester = await login(accounts.requester);
    const supervisor = await login(accounts.supervisor);
    const transport = await login(accounts.transport);
    const nationalRelease = await login(accounts.nationalRelease);
    const nationalAuthoriser = await login(accounts.nationalAuthoriser);
    const driver = await login(accounts.driver);
    const uniqueOffset = parseInt(crypto.randomUUID().slice(0, 6), 16) % 2_000;
    const start = new Date(Date.now() + (6_000 + uniqueOffset) * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

    const createRequest = async (scope: 'regional' | 'national', purpose: string) => {
      const response = await requester.post('/api/transport-requests', {
        headers: { 'idempotency-key': crypto.randomUUID() },
        data: { purpose, scope, activities: [{ title: purpose, startDate: start.toISOString(), endDate: end.toISOString(), estimatedKilometres: 240 }] },
      });
      expect(response.status(), await response.text()).toBe(200);
      return (await response.json()).request as { id: string; workflowInstanceId: string };
    };

    const rejected = await createRequest('regional', 'E2E rejection and resubmission');
    await approve(supervisor, rejected.workflowInstanceId, 'rejected', 'Clarify the operational justification.');
    const resubmission = await requester.post(`/api/requests/${rejected.id}/resubmit`, { data: { reason: 'Justification and passenger details corrected.' } });
    expect(resubmission.status(), await resubmission.text()).toBe(200);
    expect((await resubmission.json()).workflowInstanceId).toBeTruthy();

    const cancellable = await createRequest('regional', 'E2E requester cancellation');
    const cancellation = await requester.patch(`/api/requests/${cancellable.id}/cancel`, { data: { reason: 'Journey no longer required.' } });
    expect(cancellation.status(), await cancellation.text()).toBe(200);

    const national = await createRequest('national', 'E2E national approval route');
    await approve(supervisor, national.workflowInstanceId);
    const fleetResponse = await transport.get('/api/fleet?limit=100');
    const fleetBody = await fleetResponse.json();
    const available = (fleetBody.rows || fleetBody.data || fleetBody).find((vehicle: { status: string }) => vehicle.status === 'available');
    test.skip(!available, 'No available vehicles after prior test consumed them');
    const allocationResponse = await transport.post('/api/allocations', { data: { requestId: national.id, vehicleId: available.id, startDate: start.toISOString(), endDate: end.toISOString() } });
    expect(allocationResponse.status(), await allocationResponse.text()).toBe(200);
    const allocationId = (await allocationResponse.json()).allocation.id as string;
    const driversResponse = await transport.get('/api/drivers');
    const driverRows = (await driversResponse.json()).data;
    const driverEmployeeId = driverRows.find((row: { employeeNumber: string }) => row.employeeNumber === 'KERC008').id as string;
    const driverAssignment = await transport.patch(`/api/allocations/${allocationId}/driver`, { data: { driverEmployeeId } });
    expect(driverAssignment.status(), await driverAssignment.text()).toBe(200);
    await approve(transport, national.workflowInstanceId);
    await approve(nationalRelease, national.workflowInstanceId);
    await approve(nationalAuthoriser, national.workflowInstanceId);
    await approve(driver, national.workflowInstanceId);

    const db = getDb();
    const [cancelledRequest] = await db.select().from(transportRequests).where(eq(transportRequests.id, cancellable.id)).limit(1);
    const [nationalRequest] = await db.select().from(transportRequests).where(eq(transportRequests.id, national.id)).limit(1);
    const [cancelAudit] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, cancellable.id), eq(auditEvents.eventType, 'request_cancelled'))).limit(1);
    expect(cancelledRequest.status).toBe('cancelled');
    expect(cancelAudit).toBeTruthy();
    expect(nationalRequest.status).toBe('authorised');
    await Promise.all([requester, supervisor, transport, nationalRelease, nationalAuthoriser, driver].map((api) => api.dispose()));
  });
});
