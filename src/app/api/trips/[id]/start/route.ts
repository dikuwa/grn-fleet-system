import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, vehicleInspections, vehicleAllocations } from '@/db/schema/trips';
import { vehicles, vehicleStatusEvents } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { transportRequests } from '@/db/schema/requests';
import { auditEvents } from '@/db/schema/audit';
import { requireRequestAuth, requireAnyPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { onTripIssued } from '@/lib/document-generator';
import { eq, and } from 'drizzle-orm';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requireAnyPermission(session, [Permissions.TRIP_MANAGE, Permissions.DRIVER_LOG_CREATE]);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    const [trip] = await db
      .select({ trip: trips, driverEmployeeId: vehicleAllocations.driverEmployeeId })
      .from(trips)
      .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId)))
      .limit(1);

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    const tripRecord = trip.trip;

    if (tripRecord.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot start trip with status "${tripRecord.status}". Only pending trips can be started.` },
        { status: 409 },
      );
    }
    if (!tripRecord.issuedAt) return NextResponse.json({ error: 'Vehicle must be physically issued before the trip starts' }, { status: 409 });
    const [employee] = await db.select({ id: employees.id }).from(employees)
      .where(and(eq(employees.userId, session.user.id), eq(employees.tenantId, session.tenantId))).limit(1);
    if (!employee || employee.id !== trip.driverEmployeeId) return NextResponse.json({ error: 'Only the assigned driver may start this trip' }, { status: 403 });
    const [inspection] = await db.select({ id: vehicleInspections.id }).from(vehicleInspections)
      .where(and(eq(vehicleInspections.tripId, id), eq(vehicleInspections.type, 'departure'), eq(vehicleInspections.overallPass, true))).limit(1);
    if (!inspection) return NextResponse.json({ error: 'Passed pre-departure inspection is required' }, { status: 409 });

    const [updatedTrip] = await db
      .update(trips)
      .set({
        status: 'in_progress',
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(trips.id, id))
      .returning();

    // Update vehicle status to allocated + log status event
    await db
      .update(vehicles)
      .set({ status: 'allocated', updatedAt: new Date() })
      .where(eq(vehicles.id, tripRecord.vehicleId));

    await db.insert(vehicleStatusEvents).values({
      vehicleId: tripRecord.vehicleId,
      previousStatus: 'available',
      newStatus: 'allocated',
      reason: `Trip started: ${tripRecord.id.slice(0, 8)}...`,
      changedByUserId: session.user.id,
      referenceEntityType: 'trip',
      referenceEntityId: tripRecord.id,
    });

    // Generate trip authority document when trip is issued
    if (tripRecord.allocationId) {
      await onTripIssued(tripRecord.allocationId, session.tenantId, session.user.id).catch((err) => {
        console.warn('[trips/start] Document generation failed:', err);
      });
    }
    await db.update(transportRequests).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(transportRequests.id, tripRecord.requestId));

    // Audit log
    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: 0,
      eventType: 'trip_started',
      actorUserId: session.user.id,
      action: 'start',
      entityType: 'trip',
      entityId: id,
      summary: `Trip started: vehicle ${tripRecord.vehicleId?.slice(0, 8) || 'unknown'}`,
      sourceChannel: 'web',
    });

    return NextResponse.json({ trip: updatedTrip });
  } catch (error) {
    console.error('[trips/start] POST failed:', error);
    return NextResponse.json({ error: 'Failed to start trip' }, { status: 500 });
  }
}
