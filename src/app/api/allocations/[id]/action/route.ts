/**
 * Allocation Action API
 *
 * POST /api/allocations/[id]/action
 *
 * Actions:
 *   - confirm: confirm a provisional allocation
 *   - cancel: cancel this assignment and return the request to Transport Review
 *   - replace_vehicle: delegate to the canonical replacement service
 *
 * Physical issue and final release are separate trip lifecycle operations.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tripAuthorities, trips, vehicleAllocations } from '@/db/schema/trips';
import { requestDrivers, transportRequests } from '@/db/schema/requests';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { auditEvents } from '@/db/schema/audit';
import { eq, and } from 'drizzle-orm';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { runAtomicMutations } from '@/lib/db-atomic';
import { replaceVehicle, VehicleReplaceError } from '@/lib/allocations/vehicle-replacement';
import { createScopedNotifications } from '@/lib/notification-service';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const routeCheck = await requireDashboardAction(session, '/dashboard/allocations', 'update');
    if (routeCheck instanceof NextResponse) return routeCheck;
    const permCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { actionType, vehicleId: replacementVehicleId, reason, handoverOdometer } = body;
    if (!actionType || !['confirm', 'cancel', 'replace_vehicle'].includes(actionType)) {
      return NextResponse.json({ error: 'actionType must be: confirm, cancel, or replace_vehicle' }, { status: 400 });
    }

    if (actionType === 'replace_vehicle') {
      const result = await replaceVehicle({
        allocationId: id,
        replacementVehicleId,
        reason,
        handoverOdometer: handoverOdometer != null ? Number(handoverOdometer) : null,
      }, session);
      return NextResponse.json(result);
    }

    const db = getDb();
    const [allocation] = await db
      .select({
        id: vehicleAllocations.id,
        state: vehicleAllocations.state,
        vehicleId: vehicleAllocations.vehicleId,
        requestId: vehicleAllocations.requestId,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        requestStatus: transportRequests.status,
        requestReference: transportRequests.reference,
        requesterUserId: transportRequests.requesterUserId,
      })
      .from(vehicleAllocations)
      .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .innerJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
      .where(and(
        eq(vehicleAllocations.id, id),
        eq(vehicles.tenantId, session.tenantId),
        eq(transportRequests.tenantId, session.tenantId),
      ))
      .limit(1);

    if (!allocation) return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });

    if (actionType === 'confirm') {
      // Confirmation is deliberately idempotent because the operator flow
      // confirms first and then creates the trip. If the second request fails
      // or the browser retries after a lost response, a confirmed allocation
      // must remain usable instead of trapping the operator behind a 409.
      if (allocation.state === 'confirmed') {
        return NextResponse.json({ success: true, state: 'confirmed', alreadyConfirmed: true });
      }
      if (allocation.state !== 'provisional') {
        return NextResponse.json({ error: `Cannot confirm an allocation in '${allocation.state}' state` }, { status: 409 });
      }
      const now = new Date();
      await runAtomicMutations((tx) => [
        tx.update(vehicleAllocations)
          .set({ state: 'confirmed', updatedAt: now })
          .where(and(eq(vehicleAllocations.id, id), eq(vehicleAllocations.state, 'provisional'))),
        tx.insert(auditEvents).values({
          tenantId: session.tenantId,
          tenantSequence: Date.now(),
          eventType: 'allocation_confirmed',
          actorUserId: session.user.id,
          action: 'confirm',
          entityType: 'allocation',
          entityId: id,
          summary: `Allocation confirmed for request ${allocation.requestReference}`,
          before: { state: allocation.state },
          after: { state: 'confirmed' },
        }),
      ]);
      return NextResponse.json({ success: true, state: 'confirmed', alreadyConfirmed: false });
    }

    if (!['provisional', 'confirmed'].includes(allocation.state)) {
      return NextResponse.json({ error: `Cannot cancel an allocation in '${allocation.state}' state` }, { status: 409 });
    }
    const cancellationReason = typeof reason === 'string' ? reason.trim() : '';
    if (!cancellationReason) {
      return NextResponse.json({ error: 'A cancellation reason is required' }, { status: 400 });
    }

    const [trip] = await db
      .select({ id: trips.id, status: trips.status, issuedAt: trips.issuedAt })
      .from(trips)
      .where(and(eq(trips.allocationId, id), eq(trips.tenantId, session.tenantId)))
      .limit(1);
    if (trip && (trip.issuedAt || trip.status !== 'pending')) {
      return NextResponse.json(
        { error: 'This allocation has entered trip operations. Use the operational replacement/incident workflow instead of cancelling it.' },
        { status: 409 },
      );
    }

    const now = new Date();
    await runAtomicMutations((tx) => [
      tx.update(vehicleAllocations)
        .set({ state: 'cancelled', overrideReason: cancellationReason, updatedAt: now })
        .where(eq(vehicleAllocations.id, id)),
      tx.update(transportRequests)
        .set({
          status: 'transport_review',
          assignedDriverEmployeeId: null,
          updatedAt: now,
        })
        .where(and(eq(transportRequests.id, allocation.requestId), eq(transportRequests.tenantId, session.tenantId))),
      tx.update(requestDrivers)
        .set({ isConfirmed: false })
        .where(eq(requestDrivers.requestId, allocation.requestId)),
      tx.update(trips)
        .set({ status: 'cancelled', updatedAt: now })
        .where(and(eq(trips.allocationId, id), eq(trips.tenantId, session.tenantId), eq(trips.status, 'pending'))),
      tx.update(tripAuthorities)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancellationReason,
          updatedAt: now,
        })
        .where(and(eq(tripAuthorities.allocationId, id), eq(tripAuthorities.tenantId, session.tenantId))),
      tx.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: 'allocation_cancelled',
        actorUserId: session.user.id,
        action: 'cancel',
        entityType: 'allocation',
        entityId: id,
        summary: `Allocation cancelled; request ${allocation.requestReference} returned to Transport Review`,
        reason: cancellationReason,
        before: { state: allocation.state, driverEmployeeId: allocation.driverEmployeeId },
        after: { state: 'cancelled', requestStatus: 'transport_review', driverEmployeeId: null },
      }),
    ]);

    try {
      if (allocation.requesterUserId) {
        await createScopedNotifications({
          tenantId: session.tenantId,
          recipientUserIds: [allocation.requesterUserId],
          category: 'awareness',
          eventType: 'allocation.cancelled',
          title: 'Vehicle allocation cancelled',
          body: `The vehicle allocation for request ${allocation.requestReference} was cancelled and returned to Transport Review. Reason: ${cancellationReason}`,
          entityType: 'allocation',
          entityId: id,
          actionUrl: `/dashboard/requests/${allocation.requestId}`,
          workspace: 'personal',
        });
      }

      if (allocation.driverEmployeeId) {
        const [driver] = await db
          .select({ userId: employees.userId })
          .from(employees)
          .where(and(
            eq(employees.id, allocation.driverEmployeeId),
            eq(employees.tenantId, session.tenantId),
          ))
          .limit(1);
        if (driver?.userId) {
          await createScopedNotifications({
            tenantId: session.tenantId,
            recipientUserIds: [driver.userId],
            category: 'awareness',
            eventType: 'driver.assignment_cancelled',
            title: 'Driver assignment cancelled',
            body: `Your assignment to request ${allocation.requestReference} was cancelled. Reason: ${cancellationReason}`,
            entityType: 'allocation',
            entityId: id,
            actionUrl: '/dashboard/trips',
            workspace: 'driver',
          });
        }
      }

      await recordTenantRequestActivity({
        tenantId: session.tenantId,
        requestId: allocation.requestId,
        reference: allocation.requestReference,
        stage: 'transport_review',
        officeLabel: 'Transport office',
      });
    } catch (postCommitError) {
      console.warn('[Allocation Action] Post-commit cancellation notification/activity failed:', postCommitError);
    }

    return NextResponse.json({ success: true, state: 'cancelled', requestStatus: 'transport_review' });
  } catch (error) {
    if (error instanceof VehicleReplaceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[Allocation Action] POST failed:', error);
    return NextResponse.json({ error: 'Failed to process allocation action' }, { status: 500 });
  }
}
