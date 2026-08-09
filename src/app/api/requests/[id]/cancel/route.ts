import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { transportRequests, requestDrivers } from '@/db/schema/requests';
import { auditEvents } from '@/db/schema/audit';
import { eq, and, inArray, sql } from 'drizzle-orm';
import {
  requireDashboardAction,
  requireRequestAuth,
  requirePermission,
  requireAnyPermission,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { tripAuthorities, trips, vehicleAllocations, workflowInstances } from '@/db/schema';
import { runAtomicMutations } from '@/lib/db-atomic';

/**
 * PATCH /api/requests/[id]/cancel
 *
 * Full request cancellation. This is distinct from cancelling one allocation
 * for reallocation: the request, active allocation, pending operational trip,
 * authority and workflow are terminated together.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/requests', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;

    const permCheck = await requireAnyPermission(session, [Permissions.REQUEST_CANCEL, Permissions.REQUEST_WITHDRAW]);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const reason = body.reason?.trim() || 'Cancelled by user';
    const db = getDb();

    const [req] = await db
      .select({
        id: transportRequests.id,
        status: transportRequests.status,
        requesterUserId: transportRequests.requesterUserId,
        workflowInstanceId: transportRequests.workflowInstanceId,
      })
      .from(transportRequests)
      .where(and(eq(transportRequests.id, id), eq(transportRequests.tenantId, session.tenantId)))
      .limit(1);

    if (!req) return NextResponse.json({ error: 'Transport request not found' }, { status: 404 });
    if (req.requesterUserId !== session.user.id) {
      const adminPermission = await requirePermission(session, Permissions.REQUEST_CANCEL);
      if (adminPermission instanceof NextResponse) return adminPermission;
    }

    const nonCancellableStatuses = ['closed', 'cancelled', 'in_progress', 'vehicle_issued'];
    if (nonCancellableStatuses.includes(req.status)) {
      return NextResponse.json({ error: `Cannot cancel a request with status: ${req.status}` }, { status: 409 });
    }

    const [startedTrip] = await db
      .select({ id: trips.id, status: trips.status, issuedAt: trips.issuedAt })
      .from(trips)
      .where(and(eq(trips.requestId, id), eq(trips.tenantId, session.tenantId)))
      .limit(1);
    if (startedTrip && (startedTrip.issuedAt || startedTrip.status !== 'pending')) {
      return NextResponse.json(
        { error: 'This request has entered trip operations and can no longer be cancelled from the request workflow.' },
        { status: 409 },
      );
    }

    const now = new Date();
    await runAtomicMutations((tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mutations: any[] = [
        tx.update(transportRequests)
          .set({ status: 'cancelled', assignedDriverEmployeeId: null, updatedAt: now })
          .where(and(eq(transportRequests.id, id), eq(transportRequests.tenantId, session.tenantId))),
        tx.update(vehicleAllocations)
          .set({ state: 'cancelled', updatedAt: now })
          .where(and(
            eq(vehicleAllocations.requestId, id),
            inArray(vehicleAllocations.state, ['provisional', 'confirmed']),
          )),
        tx.update(trips)
          .set({ status: 'cancelled', updatedAt: now })
          .where(and(eq(trips.requestId, id), eq(trips.tenantId, session.tenantId), eq(trips.status, 'pending'))),
        tx.update(tripAuthorities)
          .set({
            status: 'cancelled',
            cancelledAt: now,
            cancellationReason: reason,
            updatedAt: now,
          })
          .where(and(eq(tripAuthorities.requestId, id), eq(tripAuthorities.tenantId, session.tenantId))),
        tx.update(requestDrivers)
          .set({ isConfirmed: false })
          .where(eq(requestDrivers.requestId, id)),
        tx.insert(auditEvents).values({
          tenantId: session.tenantId,
          tenantSequence: Date.now(),
          eventType: 'request_cancelled',
          actorUserId: session.user.id,
          action: 'cancel',
          entityType: 'transport_request',
          entityId: id,
          reason,
          sourceChannel: 'web',
        }),
      ];
      if (req.workflowInstanceId) {
        mutations.push(
          tx.update(workflowInstances)
            .set({ status: 'cancelled', updatedAt: now })
            .where(eq(workflowInstances.id, req.workflowInstanceId)),
        );
      }
      return mutations;
    });

    return NextResponse.json({ success: true, status: 'cancelled' });
  } catch (error) {
    console.error('Cancel request failed:', error);
    return NextResponse.json({ error: 'Cancel request failed' }, { status: 500 });
  }
}
