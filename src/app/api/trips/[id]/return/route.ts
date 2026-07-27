import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, tripAuthorities, vehicleAllocations } from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { vehicles, vehicleOdometerEvents } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { requireRequestAuth, requireAnyPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and } from 'drizzle-orm';
import { setAuthorityStatus } from '@/lib/trip-authority';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as {
      endingOdometer?: number;
      fuelLevel?: string;
      returnLocation?: string;
      incidentDeclared?: boolean;
      outstandingReceiptsDeclared?: boolean;
      comments?: string;
    };
    if (
      !Number.isInteger(body.endingOdometer) ||
      Number(body.endingOdometer) < 0 ||
      !body.fuelLevel ||
      !body.returnLocation ||
      typeof body.incidentDeclared !== 'boolean' ||
      typeof body.outstandingReceiptsDeclared !== 'boolean'
    ) {
      return NextResponse.json({
        error: 'Ending odometer, fuel level, return location, incident and outstanding-receipt declarations are required',
      }, { status: 422 });
    }

    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requireAnyPermission(session, [Permissions.TRIP_MANAGE, Permissions.DRIVER_LOG_CREATE]);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    const [trip] = await db
      .select({
        trip: trips,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        authorityId: tripAuthorities.id,
        authorityStatus: tripAuthorities.status,
        beginningOdometer: tripAuthorities.beginningOdometer,
      })
      .from(trips)
      .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId)))
      .limit(1);

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    const [employee] = await db.select({ id: employees.id }).from(employees)
      .where(and(eq(employees.userId, session.user.id), eq(employees.tenantId, session.tenantId), eq(employees.employmentStatus, 'active'))).limit(1);
    if (!employee || employee.id !== trip.driverEmployeeId) return NextResponse.json({ error: 'Only the assigned driver may return this trip' }, { status: 403 });

    if (!['in_progress', 'return_due'].includes(trip.trip.status)) {
      return NextResponse.json(
        { error: `Cannot return trip with status "${trip.trip.status}". Only in-progress or return-due trips can be returned.` },
        { status: 409 },
      );
    }
    if (!['in_progress', 'delayed', 'route_deviation_pending_review', 'incident_reported'].includes(trip.authorityStatus)) {
      return NextResponse.json({ error: `Trip Authority cannot be returned from "${trip.authorityStatus}"` }, { status: 409 });
    }
    if (trip.beginningOdometer !== null && Number(body.endingOdometer) < trip.beginningOdometer) {
      return NextResponse.json({ error: `Ending odometer cannot be lower than ${trip.beginningOdometer}` }, { status: 422 });
    }

    const [updatedTrip] = await db
      .update(trips)
      .set({
        status: 'return_inspection',
        returnedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(trips.id, id))
      .returning();

    await setAuthorityStatus({
      authorityId: trip.authorityId,
      tenantId: session.tenantId,
      next: 'returned',
      patch: { endingOdometer: Number(body.endingOdometer) },
    });
    await setAuthorityStatus({
      authorityId: trip.authorityId,
      tenantId: session.tenantId,
      next: 'awaiting_arrival_inspection',
    });
    await db.insert(vehicleOdometerEvents).values({
      vehicleId: trip.trip.vehicleId,
      odometerValue: Number(body.endingOdometer),
      source: 'trip_return',
      sourceEntityType: 'trip',
      sourceEntityId: trip.trip.id,
      recordedByUserId: session.user.id,
      notes: body.comments,
    });
    await db.update(vehicles).set({
      currentOdometer: Number(body.endingOdometer),
      updatedAt: new Date(),
    }).where(and(eq(vehicles.id, trip.trip.vehicleId), eq(vehicles.tenantId, session.tenantId)));

    // Audit log
    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: 0,
      eventType: 'trip_returned',
      actorUserId: session.user.id,
      action: 'return',
      entityType: 'trip',
      entityId: id,
      summary: `Trip returned: status changed to return_inspection`,
      after: {
        authorityId: trip.authorityId,
        endingOdometer: body.endingOdometer,
        fuelLevel: body.fuelLevel,
        returnLocation: body.returnLocation,
        incidentDeclared: body.incidentDeclared,
        outstandingReceiptsDeclared: body.outstandingReceiptsDeclared,
      },
      sourceChannel: 'web',
    });

    return NextResponse.json({ trip: updatedTrip });
  } catch (error) {
    console.error('[trips/return] POST failed:', error);
    return NextResponse.json({ error: 'Failed to return trip' }, { status: 500 });
  }
}
