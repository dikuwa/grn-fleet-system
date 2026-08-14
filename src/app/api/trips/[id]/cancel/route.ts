import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { auditEvents } from '@/db/schema/audit';
import { employees } from '@/db/schema/people';
import { transportRequests } from '@/db/schema/requests';
import { tripAuthorities, trips, vehicleAllocations } from '@/db/schema/trips';
import { workflowInstances } from '@/db/schema/workflows';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { runAtomicMutations } from '@/lib/db-atomic';
import { createScopedNotifications, resolveActionNotifications } from '@/lib/notification-service';
import { Permissions } from '@/lib/permissions';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';
import { WorkspaceIds } from '@/lib/workspaces';

/** Cancel an authorised trip before physical issue/departure. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/trips', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const permCheck = await requirePermission(session, Permissions.TRIP_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const reason = body.reason?.trim() || '';
    if (reason.length < 10) {
      return NextResponse.json({ error: 'A cancellation reason of at least 10 characters is required.' }, { status: 422 });
    }
    if (reason.length > 500) {
      return NextResponse.json({ error: 'Cancellation reason must be 500 characters or fewer.' }, { status: 422 });
    }

    const db = getDb();
    const [context] = await db
      .select({
        tripId: trips.id,
        tripStatus: trips.status,
        issuedAt: trips.issuedAt,
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
    if (context.tripStatus === 'cancelled') {
      return NextResponse.json({ success: true, alreadyCancelled: true });
    }
    if (context.tripStatus !== 'pending' || context.issuedAt) {
      return NextResponse.json(
        { error: 'Only a pending trip that has not been physically issued can be cancelled here.' },
        { status: 409 },
      );
    }
    if (!['provisional', 'confirmed'].includes(context.allocationState)) {
      return NextResponse.json({ error: `Allocation cannot be cancelled from ${context.allocationState}.` }, { status: 409 });
    }

    const now = new Date();
    const auditId = randomUUID();
    await runAtomicMutations((tx) => {
      const mutations = [
        tx.update(trips)
          .set({ status: 'cancelled', updatedAt: now })
          .where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId), eq(trips.status, 'pending'))),
        tx.update(vehicleAllocations)
          .set({ state: 'cancelled', overrideReason: reason, updatedAt: now })
          .where(and(
            eq(vehicleAllocations.id, context.allocationId),
            inArray(vehicleAllocations.state, ['provisional', 'confirmed']),
          )),
        tx.update(tripAuthorities)
          .set({ status: 'cancelled', cancelledAt: now, cancellationReason: reason, updatedAt: now })
          .where(and(eq(tripAuthorities.id, context.authorityId), eq(tripAuthorities.tenantId, session.tenantId))),
        tx.update(transportRequests)
          .set({ status: 'cancelled', updatedAt: now })
          .where(and(eq(transportRequests.id, context.requestId), eq(transportRequests.tenantId, session.tenantId))),
        tx.insert(auditEvents).values({
          id: auditId,
          tenantId: session.tenantId,
          tenantSequence: Date.now(),
          eventType: 'trip_cancelled',
          actorUserId: session.user.id,
          action: 'trip.cancel',
          entityType: 'trip',
          entityId: id,
          summary: `Trip cancelled for request ${context.requestReference}`,
          reason,
          before: {
            tripStatus: context.tripStatus,
            allocationState: context.allocationState,
            requestStatus: context.requestStatus,
            authorityStatus: context.authorityStatus,
          },
          after: {
            tripStatus: 'cancelled',
            allocationState: 'cancelled',
            requestStatus: 'cancelled',
            authorityStatus: 'cancelled',
          },
          sourceChannel: 'web',
        }),
      ];
      if (context.workflowInstanceId) {
        mutations.push(
          tx.update(workflowInstances)
            .set({ status: 'cancelled', updatedAt: now })
            .where(and(eq(workflowInstances.id, context.workflowInstanceId), eq(workflowInstances.status, 'active'))),
        );
      }
      return mutations;
    });

    if (context.workflowInstanceId) {
      await resolveActionNotifications({
        tenantId: session.tenantId,
        entityType: 'workflow_instance',
        entityId: context.workflowInstanceId,
        eventTypes: ['driver_acknowledgement_required', 'approval_assigned'],
      }).catch(() => undefined);
    }

    const recipientUserIds = new Set<string>();
    if (context.requesterUserId && context.requesterUserId !== session.user.id) recipientUserIds.add(context.requesterUserId);
    if (context.driverEmployeeId) {
      const [driver] = await db
        .select({ userId: employees.userId })
        .from(employees)
        .where(and(eq(employees.id, context.driverEmployeeId), eq(employees.tenantId, session.tenantId)))
        .limit(1);
      if (driver?.userId && driver.userId !== session.user.id) recipientUserIds.add(driver.userId);
    }
    if (recipientUserIds.size) {
      await createScopedNotifications({
        tenantId: session.tenantId,
        recipientUserIds: [...recipientUserIds],
        category: 'outcome',
        eventType: 'trip_cancelled',
        title: 'Trip cancelled',
        body: `Request ${context.requestReference} has been cancelled. Reason: ${reason}`,
        entityType: 'trip',
        entityId: id,
        actionUrl: `/dashboard/trips/${id}`,
        workspace: WorkspaceIds.PERSONAL,
        priority: 'high',
      }).catch(() => undefined);
    }

    await recordTenantRequestActivity({
      tenantId: session.tenantId,
      requestId: context.requestId,
      reference: context.requestReference,
      stage: 'cancelled',
      officeLabel: 'Transport office',
    }).catch(() => undefined);

    return NextResponse.json({ success: true, alreadyCancelled: false });
  } catch (error) {
    console.error('[trips/cancel] POST failed:', error);
    return NextResponse.json({ error: 'Trip cancellation failed. Refresh and try again.' }, { status: 500 });
  }
}
