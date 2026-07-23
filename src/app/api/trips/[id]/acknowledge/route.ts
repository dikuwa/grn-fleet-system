/**
 * Driver Acknowledgement API
 *
 * POST /api/trips/[id]/acknowledge — Driver acknowledges trip authority before departure
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { auditEvents } from '@/db/schema/audit';
import { requireRequestAuth } from '@/lib/auth-helpers';
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

    const db = getDb();

    // Fetch the trip with tenant isolation
    const [trip] = await db
      .select({ id: trips.id, status: trips.status, driverAcknowledgedAt: trips.driverAcknowledgedAt, driverEmployeeId: vehicleAllocations.driverEmployeeId, requestStatus: transportRequests.status })
      .from(trips)
      .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .innerJoin(transportRequests, eq(trips.requestId, transportRequests.id))
      .where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId)))
      .limit(1);

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    if (trip.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot acknowledge trip with status "${trip.status}". Only pending trips can be acknowledged.` },
        { status: 409 },
      );
    }

    if (trip.requestStatus !== 'authorised') return NextResponse.json({ error: 'Final authorisation is required before driver acknowledgement' }, { status: 409 });

    // Find the current user's employee record to use as acknowledgedByDriverId
    const [employee] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.userId, session.user.id), eq(employees.tenantId, session.tenantId)))
      .limit(1);

    if (!employee || employee.id !== trip.driverEmployeeId) return NextResponse.json({ error: 'Only the assigned driver may acknowledge this trip' }, { status: 403 });
    if (trip.driverAcknowledgedAt) return NextResponse.json({ success: true, alreadyAcknowledged: true });

    const [updatedTrip] = await db
      .update(trips)
      .set({
        driverAcknowledgedByEmployeeId: employee.id,
        driverAcknowledgedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(trips.id, trip.id))
      .returning();

    // Audit log
    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: 0,
      eventType: 'driver_acknowledged',
      actorUserId: session.user.id,
      action: 'acknowledge',
      entityType: 'trip',
      entityId: id,
      summary: `Driver acknowledged trip authority`,
      sourceChannel: 'web',
    });

    return NextResponse.json({ success: true, trip: updatedTrip });
  } catch (error) {
    console.error('[trips/acknowledge] POST failed:', error);
    return NextResponse.json({ error: 'Failed to acknowledge trip' }, { status: 500 });
  }
}
