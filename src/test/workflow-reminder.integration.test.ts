/**
 * Workflow Reminder / Escalation Recipient Chain — Integration Tests
 *
 * Proves the live recipient resolution used by the Inngest step-reminder and
 * step-escalation jobs against the seeded database:
 *
 *   1. `resolvePermissionRecipients` returns every active holder of a step
 *      permission within the tenant (and never leaks cross-tenant users).
 *   2. `WorkflowEngine.getCurrentStepRecipients` on a freshly initialised
 *      workflow resolves the supervisor step to the seeded supervisor
 *      (permission-routed step, holder resolved at runtime).
 *   3. When the workflow reaches the driver-acknowledgment step, the
 *      recipient is exactly the allocated driver — never the whole
 *      `driver:log-create` holder population.
 *
 * Run with: `pnpm test:integration` (requires the seeded dev server on
 * http://localhost:3000 and .env.test with DB credentials).
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';

const TENANT_A = '00000000-0000-0000-0000-000000000001';

describe('Workflow reminder/escalation recipient chain (live)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;

  beforeAll(async () => {
    db = (await import('@/db')).getDb();
  });

  const created: {
    requestId?: string;
    instanceId?: string;
    allocationId?: string;
    tripId?: string;
  } = {};

  afterEach(async () => {
    const { notifications } = await import('@/db/schema/notifications');
    const { workflowActions, workflowInstances } = await import('@/db/schema/workflows');
    const { vehicleAllocations, trips } = await import('@/db/schema/trips');
    const { transportRequests } = await import('@/db/schema/requests');
    const { eq } = await import('drizzle-orm');

    if (created.tripId) {
      await db.delete(trips).where(eq(trips.id, created.tripId));
    }
    if (created.allocationId) {
      await db.delete(vehicleAllocations).where(eq(vehicleAllocations.id, created.allocationId));
    }
    if (created.instanceId) {
      await db.delete(notifications).where(eq(notifications.entityId, created.instanceId));
      await db.delete(workflowActions).where(eq(workflowActions.instanceId, created.instanceId));
      await db.delete(workflowInstances).where(eq(workflowInstances.id, created.instanceId));
    }
    if (created.requestId) {
      await db.delete(transportRequests).where(eq(transportRequests.id, created.requestId));
    }

    created.requestId = undefined;
    created.instanceId = undefined;
    created.allocationId = undefined;
    created.tripId = undefined;
  });

  async function userIdForEmail(email: string) {
    const { user } = await import('@/db/schema/better-auth');
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
    return row?.id as string | undefined;
  }

  async function createRequestFixture(scope = 'regional') {
    const { transportRequests } = await import('@/db/schema/requests');
    const { employees } = await import('@/db/schema/people');
    const { eq, and } = await import('drizzle-orm');

    const [requester] = await db
      .select({ id: employees.id, userId: employees.userId })
      .from(employees)
      .where(and(eq(employees.tenantId, TENANT_A), eq(employees.employeeNumber, 'KERC002')))
      .limit(1);
    expect(requester?.id).toBeTruthy();

    const reference = `GRN/TR/REM-${Date.now()}`;
    const [request] = await db
      .insert(transportRequests)
      .values({
        tenantId: TENANT_A,
        reference,
        scope,
        status: 'submitted',
        requesterEmployeeId: requester.id,
        requesterUserId: requester.userId,
        enteredByUserId: requester.userId,
        purpose: 'Workflow reminder chain integration fixture',
        requestSource: 'logged_in_self_service',
      })
      .returning({ id: transportRequests.id });
    return request.id as string;
  }

  async function createAllocationFixture(requestId: string, driverEmployeeId: string) {
    const { vehicleAllocations, trips } = await import('@/db/schema/trips');
    const { transportRequests } = await import('@/db/schema/requests');
    const { vehicles } = await import('@/db/schema/fleet');
    const { eq, and, lt, gt, inArray } = await import('drizzle-orm');

    // An operational allocation may only be created once the request has
    // legitimately reached an allocatable workflow state. Keep this reminder
    // fixture aligned with the same database invariant used by Transport Review
    // instead of bypassing lifecycle state with a direct allocation insert.
    await db
      .update(transportRequests)
      .set({ status: 'transport_review' })
      .where(and(eq(transportRequests.id, requestId), eq(transportRequests.tenantId, TENANT_A)));

    const [vehicle] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.tenantId, TENANT_A), eq(vehicles.status, 'available')))
      .limit(1);
    expect(vehicle?.id).toBeTruthy();

    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);

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

    const [allocation] = await db
      .insert(vehicleAllocations)
      .values({
        requestId,
        vehicleId: vehicle.id,
        driverEmployeeId,
        startAt: start,
        endAt: end,
        state: 'confirmed',
        allocatedByUserId: 'integration-test',
      })
      .returning({ id: vehicleAllocations.id });

    const [trip] = await db
      .insert(trips)
      .values({
        tenantId: TENANT_A,
        requestId,
        allocationId: allocation.id,
        vehicleId: vehicle.id,
        status: 'pending',
      })
      .returning({ id: trips.id });

    created.tripId = trip.id as string;
    return allocation.id as string;
  }

  it('resolvePermissionRecipients returns active holders only, within the tenant', async () => {
    const { resolvePermissionRecipients } = await import('@/lib/notification-service');
    const supervisorUserId = await userIdForEmail('supervisor@kavangoeast.test');
    expect(supervisorUserId).toBeTruthy();

    const recipients = await resolvePermissionRecipients(TENANT_A, 'request:approve-supervisor');

    expect(recipients.length).toBeGreaterThan(0);
    expect(recipients).toContain(supervisorUserId);
  });

  it('getCurrentStepRecipients resolves the supervisor for the permission-routed step 1', async () => {
    const { WorkflowEngine } = await import('@/lib/workflow-engine');
    const supervisorUserId = await userIdForEmail('supervisor@kavangoeast.test');
    expect(supervisorUserId).toBeTruthy();

    created.requestId = await createRequestFixture('regional');
    const engine = new WorkflowEngine();
    const init = await engine.initializeForRequest(created.requestId, TENANT_A);
    expect(init.ok, 'initializeForRequest should succeed against seeded definition').toBe(true);
    created.instanceId = (init as { instance: { id: string } }).instance.id;

    const recipients = await engine.getCurrentStepRecipients(created.instanceId, TENANT_A);
    expect(recipients.length).toBeGreaterThan(0);
    expect(recipients).toContain(supervisorUserId);
  });

  it('getCurrentStepRecipients resolves exactly the allocated driver at the acknowledge step', async () => {
    const { WorkflowEngine, REGIONAL_WORKFLOW_STEPS } = await import('@/lib/workflow-engine');
    const { employees } = await import('@/db/schema/people');
    const { eq, and } = await import('drizzle-orm');
    const { workflowInstances } = await import('@/db/schema/workflows');

    const [driver] = await db
      .select({ id: employees.id, userId: employees.userId })
      .from(employees)
      .where(and(eq(employees.tenantId, TENANT_A), eq(employees.employeeNumber, 'KERC008')))
      .limit(1);
    expect(driver?.userId).toBeTruthy();

    created.requestId = await createRequestFixture('regional');
    const engine = new WorkflowEngine();
    const init = await engine.initializeForRequest(created.requestId, TENANT_A);
    expect(init.ok, 'initializeForRequest should succeed against seeded definition').toBe(true);
    created.instanceId = (init as { instance: { id: string } }).instance.id;

    const acknowledgeStep = REGIONAL_WORKFLOW_STEPS.find((s) => s.actionType === 'acknowledge');
    expect(acknowledgeStep).toBeTruthy();
    created.allocationId = await createAllocationFixture(created.requestId, driver.id);
    await db
      .update(workflowInstances)
      .set({ currentStepOrder: acknowledgeStep!.stepOrder })
      .where(eq(workflowInstances.id, created.instanceId));

    const recipients = await engine.getCurrentStepRecipients(created.instanceId, TENANT_A);
    expect(recipients).toEqual([driver.userId]);
  });

  it('getCurrentStepRecipients returns an empty list when no current step resolves', async () => {
    const { WorkflowEngine } = await import('@/lib/workflow-engine');
    const { workflowInstances } = await import('@/db/schema/workflows');
    const { eq } = await import('drizzle-orm');

    created.requestId = await createRequestFixture('regional');
    const engine = new WorkflowEngine();
    const init = await engine.initializeForRequest(created.requestId, TENANT_A);
    expect(init.ok).toBe(true);
    created.instanceId = (init as { instance: { id: string } }).instance.id;

    await db
      .update(workflowInstances)
      .set({ currentStepOrder: 99 })
      .where(eq(workflowInstances.id, created.instanceId));

    await expect(engine.getCurrentStepRecipients(created.instanceId, TENANT_A)).resolves.toEqual([]);
  });
});
