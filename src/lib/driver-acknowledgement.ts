import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { employees } from '@/db/schema/people';
import { tripAuthorities, trips, vehicleAllocations } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { workflowInstances } from '@/db/schema/workflows';
import type { AuthSession } from '@/lib/auth-helpers';
import { forbiddenResponse, requirePermission } from '@/lib/auth-helpers';
import type { PermissionCode } from '@/lib/permissions';
import { workflowCompletedStatus } from '@/lib/request-status';
import { WorkflowEngine, type EngineResult, type WorkflowActionResult } from '@/lib/workflow-engine';
import {
  createScopedNotifications,
  resolveActionNotifications,
  resolveActiveRoleRecipients,
} from '@/lib/notification-service';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';

/**
 * Driver acknowledgement is acceptance of an already authorised assignment,
 * not another approval decision. The workflow action, trip acknowledgement,
 * authority acceptance, request status and workflow completion are committed
 * together so the driver can never acknowledge only half of the trip state.
 *
 * `acceptanceData` contains the stronger Driver Console evidence (vehicle,
 * route, manifest, licence and responsibility confirmations plus optional
 * device/location metadata). The canonical HTTP endpoint validates that data
 * before calling this transaction helper.
 */
export async function processDriverAcknowledgement(input: {
  instanceId: string;
  result: WorkflowActionResult;
  comment?: string;
  acceptanceData?: Record<string, unknown>;
  session: AuthSession;
}): Promise<EngineResult> {
  const { instanceId, result, comment, acceptanceData, session } = input;
  if (result !== 'acknowledged') {
    return {
      ok: false,
      error: NextResponse.json(
        { error: 'Driver acknowledgement only accepts the assigned trip. Report an issue to Transport Administration if the assignment cannot be accepted.' },
        { status: 400 },
      ),
    };
  }

  const db = getDb();
  const engine = new WorkflowEngine({ db });
  const status = await engine.getWorkflowStatus(instanceId);
  if (!status?.currentStep) {
    return { ok: false, error: NextResponse.json({ error: 'Workflow step not found.' }, { status: 404 }) };
  }
  const { instance, currentStep } = status;
  if (instance.status !== 'active' || currentStep.actionType !== 'acknowledge') {
    return {
      ok: false,
      error: NextResponse.json({ error: 'This trip is no longer awaiting driver acknowledgement.' }, { status: 409 }),
    };
  }
  if (currentStep.requiredPermission) {
    const permission = await requirePermission(session, currentStep.requiredPermission as PermissionCode);
    if (permission instanceof NextResponse) return { ok: false, error: permission };
  }

  const [context] = await db
    .select({
      requestId: transportRequests.id,
      requestReference: transportRequests.reference,
      requestStatus: transportRequests.status,
      requesterUserId: transportRequests.requesterUserId,
      allocationId: vehicleAllocations.id,
      allocationVersion: vehicleAllocations.version,
      vehicleId: vehicleAllocations.vehicleId,
      driverEmployeeId: vehicleAllocations.driverEmployeeId,
      driverUserId: employees.userId,
      tripId: trips.id,
      tripStatus: trips.status,
      tripIssuedAt: trips.issuedAt,
      tripAcknowledgedAt: trips.driverAcknowledgedAt,
      authorityId: tripAuthorities.id,
      authorityStatus: tripAuthorities.status,
    })
    .from(transportRequests)
    .innerJoin(vehicleAllocations, eq(vehicleAllocations.requestId, transportRequests.id))
    .innerJoin(trips, eq(trips.allocationId, vehicleAllocations.id))
    .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
    .innerJoin(employees, eq(employees.id, vehicleAllocations.driverEmployeeId))
    .where(and(
      eq(transportRequests.id, instance.requestId),
      eq(transportRequests.tenantId, session.tenantId),
      eq(vehicleAllocations.state, 'confirmed'),
      eq(trips.tenantId, session.tenantId),
      eq(tripAuthorities.tenantId, session.tenantId),
    ))
    .orderBy(desc(vehicleAllocations.updatedAt), desc(vehicleAllocations.createdAt))
    .limit(1);
  if (!context) {
    return {
      ok: false,
      error: NextResponse.json({ error: 'The current confirmed trip, allocation or driver assignment could not be found.' }, { status: 409 }),
    };
  }

  const expectedTripId = typeof acceptanceData?.tripId === 'string' ? acceptanceData.tripId : null;
  const expectedAuthorityId = typeof acceptanceData?.authorityId === 'string' ? acceptanceData.authorityId : null;
  if (
    (expectedTripId && expectedTripId !== context.tripId) ||
    (expectedAuthorityId && expectedAuthorityId !== context.authorityId)
  ) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: 'The trip assignment changed before acknowledgement. Refresh the Driver Console and review the current trip.' },
        { status: 409 },
      ),
    };
  }
  if (!context.driverUserId || context.driverUserId !== session.user.id) {
    return { ok: false, error: forbiddenResponse('Only the driver assigned to this trip may acknowledge it.') };
  }
  if (
    context.tripStatus !== 'pending' ||
    context.tripIssuedAt ||
    context.tripAcknowledgedAt ||
    context.authorityStatus !== 'awaiting_driver_acceptance'
  ) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: 'The current trip or Trip Authority is no longer awaiting this driver acknowledgement.' },
        { status: 409 },
      ),
    };
  }

  const actionId = randomUUID();
  const auditId = randomUUID();
  const now = new Date();
  const nowIso = now.toISOString();
  const completedStatus = workflowCompletedStatus();
  const acceptanceDataJson = JSON.stringify({
    ...(acceptanceData ?? {}),
    acceptedAt: nowIso,
    acceptedByUserId: session.user.id,
    source: 'driver_console',
    acceptedVehicleId: context.vehicleId,
    acceptedAllocationVersion: context.allocationVersion + 1,
  });

  try {
    // The final division guard makes a stale/concurrent transition fail inside
    // this same SQL statement so PostgreSQL rolls every CTE back together. If
    // execute() returns successfully, all required rows were committed once.
    await db.execute(sql`
      WITH allocation_claim AS (
        UPDATE vehicle_allocations va
        SET version = version + 1,
            updated_at = ${nowIso}::timestamptz
        WHERE va.id = ${context.allocationId}::uuid
          AND va.request_id = ${context.requestId}::uuid
          AND va.state = 'confirmed'
          AND va.version = ${context.allocationVersion}
          AND va.vehicle_id = ${context.vehicleId}::uuid
          AND va.driver_employee_id = ${context.driverEmployeeId}::uuid
          AND EXISTS (
            SELECT 1
            FROM trips t
            WHERE t.id = ${context.tripId}::uuid
              AND t.tenant_id = ${session.tenantId}::uuid
              AND t.request_id = va.request_id
              AND t.allocation_id = va.id
              AND t.vehicle_id = va.vehicle_id
              AND t.status = 'pending'
              AND t.issued_at IS NULL
              AND t.driver_acknowledged_at IS NULL
          )
          AND EXISTS (
            SELECT 1
            FROM trip_authorities ta
            WHERE ta.id = ${context.authorityId}::uuid
              AND ta.trip_id = ${context.tripId}::uuid
              AND ta.allocation_id = va.id
              AND ta.tenant_id = ${session.tenantId}::uuid
              AND ta.status = 'awaiting_driver_acceptance'
          )
        RETURNING va.id
      ),
      claimed AS (
        UPDATE workflow_instances wi
        SET status = 'completed', current_step_order = ${currentStep.stepOrder}, updated_at = ${nowIso}::timestamptz
        WHERE wi.id = ${instanceId}::uuid
          AND wi.status = 'active'
          AND wi.current_step_order = ${currentStep.stepOrder}
          AND EXISTS (SELECT 1 FROM allocation_claim)
          AND NOT EXISTS (
            SELECT 1 FROM workflow_actions wa
            WHERE wa.instance_id = wi.id AND wa.step_order = ${currentStep.stepOrder}
          )
        RETURNING wi.id, wi.request_id
      ),
      trip_updated AS (
        UPDATE trips t
        SET driver_acknowledged_at = ${nowIso}::timestamptz,
            driver_acknowledged_by_employee_id = ${context.driverEmployeeId}::uuid,
            updated_at = ${nowIso}::timestamptz
        FROM claimed c
        WHERE t.id = ${context.tripId}::uuid
          AND t.request_id = c.request_id
          AND t.tenant_id = ${session.tenantId}::uuid
          AND t.status = 'pending'
          AND t.issued_at IS NULL
          AND t.driver_acknowledged_at IS NULL
          AND t.allocation_id = ${context.allocationId}::uuid
          AND t.vehicle_id = ${context.vehicleId}::uuid
          AND EXISTS (SELECT 1 FROM allocation_claim)
        RETURNING t.id
      ),
      authority_updated AS (
        UPDATE trip_authorities ta
        SET status = 'driver_accepted',
            accepted_at = ${nowIso}::timestamptz,
            accepted_by_employee_id = ${context.driverEmployeeId}::uuid,
            acceptance_data = ${acceptanceDataJson}::jsonb,
            updated_at = ${nowIso}::timestamptz
        FROM claimed c
        WHERE ta.id = ${context.authorityId}::uuid
          AND ta.request_id = c.request_id
          AND ta.trip_id = ${context.tripId}::uuid
          AND ta.allocation_id = ${context.allocationId}::uuid
          AND ta.tenant_id = ${session.tenantId}::uuid
          AND ta.status = 'awaiting_driver_acceptance'
          AND EXISTS (SELECT 1 FROM trip_updated)
        RETURNING ta.id
      ),
      request_updated AS (
        UPDATE transport_requests tr
        SET status = ${completedStatus}, updated_at = ${nowIso}::timestamptz
        FROM claimed c
        WHERE tr.id = c.request_id
          AND tr.tenant_id = ${session.tenantId}::uuid
          AND tr.status = ${context.requestStatus}
          AND tr.assigned_driver_employee_id = ${context.driverEmployeeId}::uuid
          AND EXISTS (SELECT 1 FROM authority_updated)
        RETURNING tr.id
      ),
      action_inserted AS (
        INSERT INTO workflow_actions (
          id, instance_id, step_order, action_type, result,
          actor_user_id, actor_employee_id, comment, metadata, created_at
        )
        SELECT
          ${actionId}::uuid, c.id, ${currentStep.stepOrder}, 'acknowledge', 'acknowledged',
          ${session.user.id}, ${context.driverEmployeeId}::uuid, ${comment?.trim() || null},
          ${acceptanceDataJson}::jsonb, ${nowIso}::timestamptz
        FROM claimed c
        INNER JOIN request_updated ru ON ru.id = c.request_id
        RETURNING id
      ),
      audit_inserted AS (
        INSERT INTO audit_events (
          id, tenant_id, tenant_sequence, event_type, actor_user_id,
          actor_employee_id, action, entity_type, entity_id,
          source_channel, summary, reason, after, created_at
        )
        SELECT
          ${auditId}::uuid, ${session.tenantId}::uuid, ${Date.now()}, 'workflow_acknowledged',
          ${session.user.id}, ${context.driverEmployeeId}::uuid, 'workflow.acknowledged',
          'workflow_action', ${instanceId}::uuid, 'web',
          'Assigned driver acknowledged the authorised trip', ${comment?.trim() || null},
          ${acceptanceDataJson}::jsonb, ${nowIso}::timestamptz
        FROM action_inserted
        RETURNING id
      )
      SELECT 1 / (
        (SELECT count(*)::integer FROM allocation_claim) *
        (SELECT count(*)::integer FROM claimed) *
        (SELECT count(*)::integer FROM trip_updated) *
        (SELECT count(*)::integer FROM authority_updated) *
        (SELECT count(*)::integer FROM request_updated) *
        (SELECT count(*)::integer FROM action_inserted) *
        (SELECT count(*)::integer FROM audit_inserted)
      ) AS committed
    `);
  } catch (error) {
    console.warn('[driver-acknowledgement] Atomic acknowledgement rolled back:', error);
    const latest = await engine.getWorkflowStatus(instanceId).catch(() => null);
    if (
      !latest?.currentStep ||
      latest.instance.status !== 'active' ||
      latest.instance.currentStepOrder !== currentStep.stepOrder ||
      latest.currentStep.actionType !== 'acknowledge'
    ) {
      return {
        ok: false,
        error: NextResponse.json(
          { error: 'The trip changed while acknowledgement was being recorded. Refresh to see the latest state.' },
          { status: 409 },
        ),
      };
    }
    return {
      ok: false,
      error: NextResponse.json(
        { error: 'The authorised trip is not in a consistent state for acknowledgement. Refresh and ask Transport Administration to review it.' },
        { status: 409 },
      ),
    };
  }

  await resolveActionNotifications({
    tenantId: session.tenantId,
    entityType: 'workflow_instance',
    entityId: instanceId,
    eventTypes: ['driver_acknowledgement_required', 'approval_assigned'],
  }).catch(() => undefined);
  await recordTenantRequestActivity({
    tenantId: session.tenantId,
    requestId: context.requestId,
    reference: context.requestReference,
    stage: 'acknowledged',
    officeLabel: 'Assigned Driver',
  }).catch(() => undefined);

  if (context.requesterUserId && context.requesterUserId !== session.user.id) {
    await createScopedNotifications({
      tenantId: session.tenantId,
      recipientUserIds: [context.requesterUserId],
      category: 'outcome',
      eventType: 'driver_acknowledged',
      title: 'Driver acknowledged the trip',
      body: `The assigned driver has acknowledged authorised request ${context.requestReference}.`,
      entityType: 'workflow_instance',
      entityId: instanceId,
      actionUrl: `/dashboard/requests/${context.requestId}`,
      workspace: WorkspaceIds.PERSONAL,
      workflowStage: String(currentStep.stepOrder),
      priority: 'normal',
    }).catch(() => undefined);
  }

  const inspectionRecipients = await resolveActiveRoleRecipients(session.tenantId, [
    SystemRoles.INSPECTOR,
    SystemRoles.RELEASE_OFFICER,
  ]).catch(() => []);
  const uniqueInspectionRecipients = inspectionRecipients.filter(
    (userId, index, values) => userId !== session.user.id && values.indexOf(userId) === index,
  );
  if (uniqueInspectionRecipients.length) {
    await createScopedNotifications({
      tenantId: session.tenantId,
      recipientUserIds: uniqueInspectionRecipients,
      category: 'action_required',
      eventType: 'departure_inspection_required',
      title: 'Departure inspection required',
      body: `The driver has accepted ${context.requestReference}. Switch to the Inspections workspace and complete the official departure inspection before the vehicle can depart.`,
      entityType: 'trip',
      entityId: context.tripId,
      actionUrl: `/dashboard/inspections/new?type=departure&tripId=${context.tripId}&vehicleId=${context.vehicleId}`,
      workspace: null,
      priority: 'high',
    }).catch((error) => console.warn('[driver-acknowledgement] Inspection notification failed:', error));
  }

  const [updated] = await db
    .select()
    .from(workflowInstances)
    .where(eq(workflowInstances.id, instanceId))
    .limit(1);
  if (!updated) {
    return { ok: false, error: NextResponse.json({ error: 'Workflow could not be reloaded after acknowledgement.' }, { status: 500 }) };
  }
  return { ok: true, message: 'Trip acknowledged successfully.', instance: updated };
}
