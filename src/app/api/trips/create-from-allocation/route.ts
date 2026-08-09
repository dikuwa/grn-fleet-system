import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import {
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and } from 'drizzle-orm';
import { provisionTripAuthority } from '@/lib/trip-authority';
import { auditEvents, employees } from '@/db/schema';
import { createScopedNotifications } from '@/lib/notification-service';
import { WorkspaceIds } from '@/lib/workspaces';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const allocationId = typeof body?.allocationId === 'string' ? body.allocationId.trim() : '';

    if (!allocationId) {
      return NextResponse.json({ error: 'Allocation ID is required' }, { status: 400 });
    }

    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const routeCheck = await requireDashboardAction(session, '/dashboard/allocations', 'create');
    if (routeCheck instanceof NextResponse) return routeCheck;
    const permCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const tenantId = session.tenantId;

    const [allocation] = await db
      .select({
        id: vehicleAllocations.id,
        requestId: vehicleAllocations.requestId,
        vehicleId: vehicleAllocations.vehicleId,
        state: vehicleAllocations.state,
        requestStatus: transportRequests.status,
      })
      .from(vehicleAllocations)
      .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .innerJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
      .where(and(
        eq(vehicleAllocations.id, allocationId),
        eq(vehicles.tenantId, tenantId),
        eq(transportRequests.tenantId, tenantId),
      ))
      .limit(1);

    if (!allocation) {
      return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });
    }

    if (allocation.state !== 'confirmed') {
      return NextResponse.json(
        { error: 'Only confirmed allocations can create trips. Current state: ' + allocation.state },
        { status: 409 },
      );
    }

    if (!['approved', 'approved_emergency', 'authorised', 'ready_for_issue', 'vehicle_allocated'].includes(allocation.requestStatus)) {
      return NextResponse.json(
        { error: `Transport request is not ready for trip creation (current: ${allocation.requestStatus})` },
        { status: 409 },
      );
    }

    const [existingTrip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.allocationId, allocationId), eq(trips.tenantId, tenantId)))
      .limit(1);

    if (existingTrip) {
      return NextResponse.json(
        { error: 'A trip already exists for this allocation', tripId: existingTrip.id },
        { status: 409 },
      );
    }

    const [trip] = await db
      .insert(trips)
      .values({
        tenantId,
        requestId: allocation.requestId,
        allocationId: allocation.id,
        vehicleId: allocation.vehicleId,
        status: 'pending',
      })
      .returning();

    try {
      const provisioned = await provisionTripAuthority({
        tripId: trip.id,
        tenantId,
        requestId: allocation.requestId,
        allocationId: allocation.id,
        actorUserId: session.user.id,
      });
      const [driver] = await db
        .select({ userId: employees.userId })
        .from(vehicleAllocations)
        .innerJoin(employees, eq(employees.id, vehicleAllocations.driverEmployeeId))
        .where(and(eq(vehicleAllocations.id, allocation.id), eq(employees.tenantId, tenantId)))
        .limit(1);
      if (driver?.userId) {
        await createScopedNotifications({
          tenantId,
          recipientUserIds: [driver.userId],
          category: 'action_required',
          eventType: 'driver_acceptance_required',
          title: `Trip Authority ${provisioned.authority.authorityNumber} requires acceptance`,
          body: 'Review the authority, route, passenger manifest and special conditions before departure.',
          entityType: 'trip',
          entityId: trip.id,
          actionUrl: `/dashboard/trips/${trip.id}`,
          workspace: WorkspaceIds.DRIVER,
          priority: 'high',
        });
      }
      await db.insert(auditEvents).values({
        tenantId,
        tenantSequence: Date.now(),
        eventType: 'trip_authority_issued',
        actorUserId: session.user.id,
        action: 'issue',
        entityType: 'trip_authority',
        entityId: provisioned.authority.id,
        summary: `Trip Authority ${provisioned.authority.authorityNumber} issued from approved request`,
        after: { tripId: trip.id, status: provisioned.authority.status },
        sourceChannel: 'web',
      });
      return NextResponse.json({
        trip,
        authority: provisioned.authority,
        message: 'Trip and Trip Authority created successfully',
      });
    } catch (authorityError) {
      await db.delete(trips).where(and(eq(trips.id, trip.id), eq(trips.tenantId, tenantId)));
      throw authorityError;
    }
  } catch (error) {
    console.error('[trips/create-from-allocation] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create trip from allocation' }, { status: 500 });
  }
}
