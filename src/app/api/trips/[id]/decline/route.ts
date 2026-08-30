import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { employees } from '@/db/schema/people';
import { transportRequests } from '@/db/schema/requests';
import { tripAuthorities, trips, vehicleAllocations } from '@/db/schema/trips';
import { requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';
import { createScopedNotifications, resolveActionNotifications, resolveActiveRoleRecipients } from '@/lib/notification-service';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';

/**
 * Driver cannot perform the already-authorised assignment.
 *
 * This is deliberately not a request cancellation and not a workflow rejection.
 * The request remains at driver acknowledgement. The authorised allocation and
 * Trip Authority driver stay aligned until Transport nominates a replacement
 * and the revised authority receives the required approval.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/driver-mobile', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;

    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const reason = body.reason?.trim() || '';
    if (reason.length < 10) {
      return NextResponse.json({ error: 'Explain why you cannot perform this trip (at least 10 characters).' }, { status: 422 });
    }
    if (reason.length > 500) {
      return NextResponse.json({ error: 'Reason must be 500 characters or fewer.' }, { status: 422 });
    }

    const db = getDb();
    const [employee] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(
        eq(employees.userId, session.user.id),
        eq(employees.tenantId, session.tenantId),
        eq(employees.employmentStatus, 'active'),
      ))
      .limit(1);
    if (!employee) return NextResponse.json({ error: 'Active driver employee record not found.' }, { status: 403 });

    const [context] = await db
      .select({
        tripId: trips.id,
        tripStatus: trips.status,
        issuedAt: trips.issuedAt,
        driverAcknowledgedAt: trips.driverAcknowledgedAt,
        allocationId: vehicleAllocations.id,
        allocationVersion: vehicleAllocations.version,
        allocationState: vehicleAllocations.state,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        requestId: transportRequests.id,
        requestReference: transportRequests.reference,
        requestStatus: transportRequests.status,
        requesterUserId: transportRequests.requesterUserId,
        workflowInstanceId: transportRequests.workflowInstanceId,
        authorityId: tripAuthorities.id,
        authorityStatus: tripAuthorities.status,
      })
      .from(trips)
      .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, trips.allocationId))
      .innerJoin(transportRequests, eq(transportRequests.id, trips.requestId))
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .where(and(
        eq(trips.id, id),
        eq(trips.tenantId, session.tenantId),
        eq(transportRequests.tenantId, session.tenantId),
        eq(tripAuthorities.tenantId, session.tenantId),
      ))
      .limit(1);

    if (!context) return NextResponse.json({ error: 'Trip not found.' }, { status: 404 });
    if (context.driverEmployeeId !== employee.id) {
      return NextResponse.json({ error: 'Only the currently assigned primary driver can decline this trip.' }, { status: 403 });
    }
    if (
      context.tripStatus !== 'pending' ||
      context.issuedAt ||
      context.driverAcknowledgedAt ||
      context.allocationState !== 'confirmed' ||
      context.authorityStatus !== 'awaiting_driver_acceptance'
    ) {
      return NextResponse.json(
        { error: 'This assignment can only be declined before acknowledgement and physical vehicle issue.' },
        { status: 409 },
      );
    }
    if (context.requestStatus !== 'driver_acknowledgement_pending') {
      return NextResponse.json({ error: `Request is not awaiting driver acknowledgement (${context.requestStatus}).` }, { status: 409 });
    }
    if (!context.workflowInstanceId) {
      return NextResponse.json({ error: 'The authorised request has no active acknowledgement workflow.' }, { status: 409 });
    }

    const now = new Date();
    const auditSequence = Date.now();
    const declineSnapshot = {
      employeeId: employee.id,
      userId: session.user.id,
      reason,
      declinedAt: now.toISOString(),
    };

    await db.execute(sql`
      WITH allocation_claim AS (
        UPDATE vehicle_allocations va
        SET version = version + 1,
            updated_at = ${now}
        WHERE va.id = ${context.allocationId}::uuid
          AND va.request_id = ${context.requestId}::uuid
          AND va.state = 'confirmed'
          AND va.version = ${context.allocationVersion}
          AND va.driver_employee_id = ${employee.id}::uuid
          AND EXISTS (
            SELECT 1
            FROM trips t
            WHERE t.id = ${id}::uuid
              AND t.tenant_id = ${session.tenantId}::uuid
              AND t.request_id = va.request_id
              AND t.allocation_id = va.id
              AND t.status = 'pending'
              AND t.issued_at IS NULL
              AND t.driver_acknowledged_at IS NULL
          )
          AND EXISTS (
            SELECT 1
            FROM transport_requests tr
            WHERE tr.id = va.request_id
              AND tr.tenant_id = ${session.tenantId}::uuid
              AND tr.status = 'driver_acknowledgement_pending'
              AND tr.assigned_driver_employee_id = ${employee.id}::uuid
          )
          AND EXISTS (
            SELECT 1
            FROM trip_authorities ta
            WHERE ta.id = ${context.authorityId}::uuid
              AND ta.trip_id = ${id}::uuid
              AND ta.allocation_id = va.id
              AND ta.tenant_id = ${session.tenantId}::uuid
              AND ta.status = 'awaiting_driver_acceptance'
              AND NOT (COALESCE(ta.data, '{}'::jsonb) ? 'driverDecline')
          )
        RETURNING va.id
      ),
      authority_claim AS (
        UPDATE trip_authorities ta
        SET data = COALESCE(ta.data, '{}'::jsonb) || jsonb_build_object(
              'driverDecline', ${JSON.stringify(declineSnapshot)}::jsonb
            ),
            updated_at = ${now}
        WHERE ta.id = ${context.authorityId}::uuid
          AND ta.tenant_id = ${session.tenantId}::uuid
          AND ta.status = 'awaiting_driver_acceptance'
          AND NOT (COALESCE(ta.data, '{}'::jsonb) ? 'driverDecline')
          AND EXISTS (SELECT 1 FROM allocation_claim)
        RETURNING ta.id
      ),
      audit_inserted AS (
        INSERT INTO audit_events (
          tenant_id, tenant_sequence, event_type, actor_user_id, actor_employee_id,
          action, entity_type, entity_id, summary, reason, before, after, source_channel
        )
        SELECT
          ${session.tenantId}::uuid,
          ${auditSequence},
          'driver_assignment_declined',
          ${session.user.id},
          ${employee.id}::uuid,
          'driver.decline_assignment',
          'trip',
          ${id}::uuid,
          ${`Assigned driver could not perform request ${context.requestReference}`},
          ${reason},
          jsonb_build_object(
            'allocationId', ${context.allocationId}::text,
            'allocationVersion', ${context.allocationVersion},
            'driverEmployeeId', ${employee.id}::text,
            'authorityId', ${context.authorityId}::text
          ),
          jsonb_build_object(
            'allocationId', ${context.allocationId}::text,
            'allocationVersion', ${context.allocationVersion + 1},
            'driverEmployeeId', ${employee.id}::text,
            'authorityId', ${context.authorityId}::text,
            'driverDeclined', true,
            'reassignmentRequired', true
          ),
          'web'
        FROM authority_claim
        RETURNING id
      )
      SELECT CAST(CASE
        WHEN (SELECT count(*) FROM allocation_claim) = 1
         AND (SELECT count(*) FROM authority_claim) = 1
         AND (SELECT count(*) FROM audit_inserted) = 1
        THEN '1'
        ELSE 'atomic_driver_decline_failed_'
          || (SELECT count(*) FROM allocation_claim)::text
          || (SELECT count(*) FROM authority_claim)::text
          || (SELECT count(*) FROM audit_inserted)::text
      END AS integer) AS committed
    `);

    await resolveActionNotifications({
      tenantId: session.tenantId,
      entityType: 'workflow_instance',
      entityId: context.workflowInstanceId,
      eventTypes: ['driver_acknowledgement_required', 'approval_assigned'],
    }).catch(() => undefined);

    const transportRecipients = await resolveActiveRoleRecipients(session.tenantId, [SystemRoles.TRANSPORT_ADMIN]);
    if (transportRecipients.length) {
      await createScopedNotifications({
        tenantId: session.tenantId,
        recipientUserIds: transportRecipients,
        category: 'action_required',
        eventType: 'driver_reassignment_required',
        title: 'Driver reassignment required',
        body: `The assigned driver cannot perform request ${context.requestReference}. Reason: ${reason}`,
        entityType: 'trip',
        entityId: id,
        actionUrl: `/dashboard/trips/${id}`,
        workspace: WorkspaceIds.TRANSPORT_ADMIN,
        priority: 'high',
      }).catch(() => undefined);
    }

    if (context.requesterUserId && context.requesterUserId !== session.user.id) {
      await createScopedNotifications({
        tenantId: session.tenantId,
        recipientUserIds: [context.requesterUserId],
        category: 'awareness',
        eventType: 'driver_reassignment_pending',
        title: 'Driver reassignment in progress',
        body: `Transport Administration is assigning another driver for request ${context.requestReference}.`,
        entityType: 'trip',
        entityId: id,
        actionUrl: `/dashboard/requests/${context.requestId}`,
        workspace: WorkspaceIds.PERSONAL,
        priority: 'normal',
      }).catch(() => undefined);
    }

    await recordTenantRequestActivity({
      tenantId: session.tenantId,
      requestId: context.requestId,
      reference: context.requestReference,
      stage: 'driver_reassignment_required',
      officeLabel: 'Transport office',
    }).catch(() => undefined);

    return NextResponse.json({
      success: true,
      message: 'Transport Administration has been notified to assign another driver.',
      reassignmentRequired: true,
    });
  } catch (error) {
    console.error('[trips/decline] POST failed:', error);
    if (String(error).includes('atomic_driver_decline_failed')) {
      return NextResponse.json(
        { error: 'The trip assignment changed while your response was being saved. Refresh the Driver Console.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'The assignment could not be declined. Refresh and try again.' }, { status: 500 });
  }
}
