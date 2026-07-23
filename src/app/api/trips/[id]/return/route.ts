import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { auditEvents } from '@/db/schema/audit';
import { requireRequestAuth, requireAnyPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
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

    const [employee] = await db.select({ id: employees.id }).from(employees)
      .where(and(eq(employees.userId, session.user.id), eq(employees.tenantId, session.tenantId), eq(employees.employmentStatus, 'active'))).limit(1);
    if (!employee || employee.id !== trip.driverEmployeeId) return NextResponse.json({ error: 'Only the assigned driver may return this trip' }, { status: 403 });

    if (!['in_progress', 'return_due'].includes(trip.trip.status)) {
      return NextResponse.json(
        { error: `Cannot return trip with status "${trip.trip.status}". Only in-progress or return-due trips can be returned.` },
        { status: 409 },
      );
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
      sourceChannel: 'web',
    });

    return NextResponse.json({ trip: updatedTrip });
  } catch (error) {
    console.error('[trips/return] POST failed:', error);
    return NextResponse.json({ error: 'Failed to return trip' }, { status: 500 });
  }
}
