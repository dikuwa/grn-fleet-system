import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { auditEvents } from '@/db/schema/audit';
import { employees } from '@/db/schema/people';
import { requestDrivers, transportRequests } from '@/db/schema/requests';
import { tripAuthorities, trips, vehicleAllocations } from '@/db/schema/trips';
import { requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';
import { runAtomicMutations } from '@/lib/db-atomic';
import { createScopedNotifications, resolveActionNotifications, resolveActiveRoleRecipients } from '@/lib/notification-service';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';

/**
 * Driver cannot perform the already-authorised assignment.
 *
 * This is deliberately not a request cancellation and not a workflow rejection.
 * The approved trip remains at driver acknowledgement while the current driver
 * is removed from the confirmed allocation. Transport Administration can then
 * assign another compliant driver without replaying the approval chain.
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

    const now = new Date();
    const auditId = randomUUID();
    await runAtomicMutations((tx) => [
      tx.update(vehicleAllocations)
        .set({
          driverEmployeeId: null,
          overrideReason: `Driver unable to perform: ${reason}`,
          version: sql`${vehicleAllocations.version} + 1`,
          updatedAt: now,
        })
        .where(and(
          eq(vehicleAllocations.id, context.allocationId),
          eq(vehicleAllocations.state, 'confirmed'),
          eq(vehicleAllocations.driverEmployeeId, employee.id),
        )),
      tx.update(transportRequests)
        .set({ assignedDriverEmployeeId: null, updatedAt: now })
        .where(and(
          eq(transportRequests.id, context.requestId),
          eq(transportRequests.tenantId, session.tenantId),
          eq(transportRequests.status, 'driver_acknowledgement_pending'),
        )),
      tx.update(requestDrivers)
        .set({ isConfirmed: false })
        .where(and(eq(requestDrivers.requestId, context.requestId), eq(requestDrivers.employeeId, employee.id))),
      tx.insert(auditEvents).values({
        id: auditId,
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: 'driver_assignment_declined',
        actorUserId: session.user.id,
        actorEmployeeId: employee.id,
        action: 'driver.decline_assignment',
        entityType: 'trip',
        entityId: id,
        summary: `Assigned driver could not perform request ${context.requestReference}`,
        reason,
        before: { allocationId: context.allocationId, driverEmployeeId: employee.id },
        after: { allocationId: context.allocationId, driverEmployeeId: null, reassignmentRequired: true },
        sourceChannel: 'web',
      }),
    ]);

    await resolveActionNotifications({
      tenantId: session.tenantId,
      entityType: 'workflow_instance',
      entityId: context.workflowInstanceId || '',
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
    return NextResponse.json({ error: 'The assignment could not be declined. Refresh and try again.' }, { status: 500 });
  }
}
