import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, tripAuthorities, vehicleAllocations } from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { vehicles, vehicleOdometerEvents } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { requireDashboardAction, requireRequestAuth, requireAnyPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { transportRequests } from '@/db/schema/requests';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';
import { runAtomicMutations } from '@/lib/db-atomic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    if (!Number.isInteger(body.endingOdometer) || Number(body.endingOdometer) < 0 || !body.fuelLevel || !body.returnLocation || typeof body.incidentDeclared !== 'boolean' || typeof body.outstandingReceiptsDeclared !== 'boolean') {
      return NextResponse.json({ error: 'Ending odometer, fuel level, return location, incident and outstanding-receipt declarations are required' }, { status: 422 });
    }

    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/trips', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const permCheck = await requireAnyPermission(session, [Permissions.TRIP_MANAGE, Permissions.DRIVER_LOG_CREATE]);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const [trip] = await db.select({
      trip: trips,
      driverEmployeeId: vehicleAllocations.driverEmployeeId,
      allocationState: vehicleAllocations.state,
      authorityId: tripAuthorities.id,
      authorityStatus: tripAuthorities.status,
      beginningOdometer: tripAuthorities.beginningOdometer,
      requestReference: transportRequests.reference,
    }).from(trips)
      .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .innerJoin(transportRequests, eq(transportRequests.id, trips.requestId))
      .where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId), eq(transportRequests.tenantId, session.tenantId), eq(tripAuthorities.tenantId, session.tenantId)))
      .limit(1);

    if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    const [employee] = await db.select({ id: employees.id }).from(employees)
      .where(and(eq(employees.userId, session.user.id), eq(employees.tenantId, session.tenantId), eq(employees.employmentStatus, 'active'))).limit(1);
    if (!employee || employee.id !== trip.driverEmployeeId) return NextResponse.json({ error: 'Only the assigned driver may return this trip' }, { status: 403 });
    if (!['in_progress', 'return_due'].includes(trip.trip.status)) return NextResponse.json({ error: `Cannot return trip with status "${trip.trip.status}".` }, { status: 409 });
    if (!['in_progress', 'delayed', 'route_deviation_pending_review', 'incident_reported'].includes(trip.authorityStatus)) return NextResponse.json({ error: `Trip Authority cannot be returned from "${trip.authorityStatus}"` }, { status: 409 });
    if (trip.allocationState !== 'confirmed') return NextResponse.json({ error: `Allocation is no longer active (${trip.allocationState})` }, { status: 409 });
    if (trip.beginningOdometer !== null && Number(body.endingOdometer) < trip.beginningOdometer) return NextResponse.json({ error: `Ending odometer cannot be lower than ${trip.beginningOdometer}` }, { status: 422 });

    const now = new Date();
    await runAtomicMutations((tx) => [
      tx.update(trips).set({ status: 'return_inspection', returnedAt: now, updatedAt: now }).where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId))),
      // Preserve the canonical authority state sequence inside one transaction.
      tx.update(tripAuthorities).set({ status: 'returned', endingOdometer: Number(body.endingOdometer), version: sql`${tripAuthorities.version} + 1`, updatedAt: now }).where(and(eq(tripAuthorities.id, trip.authorityId), eq(tripAuthorities.tenantId, session.tenantId), inArray(tripAuthorities.status, ['in_progress', 'delayed', 'route_deviation_pending_review', 'incident_reported']))),
      tx.update(tripAuthorities).set({ status: 'awaiting_arrival_inspection', version: sql`${tripAuthorities.version} + 1`, updatedAt: now }).where(and(eq(tripAuthorities.id, trip.authorityId), eq(tripAuthorities.tenantId, session.tenantId), eq(tripAuthorities.status, 'returned'))),
      tx.insert(vehicleOdometerEvents).values({ vehicleId: trip.trip.vehicleId, odometerValue: Number(body.endingOdometer), source: 'trip_return', sourceEntityType: 'trip', sourceEntityId: trip.trip.id, recordedByUserId: session.user.id, notes: body.comments }),
      tx.update(vehicles).set({ currentOdometer: Number(body.endingOdometer), updatedAt: now }).where(and(eq(vehicles.id, trip.trip.vehicleId), eq(vehicles.tenantId, session.tenantId))),
      tx.insert(auditEvents).values({ tenantId: session.tenantId, tenantSequence: Date.now(), eventType: 'trip_returned', actorUserId: session.user.id, action: 'return', entityType: 'trip', entityId: id, summary: 'Trip returned: awaiting arrival inspection', after: { authorityId: trip.authorityId, endingOdometer: body.endingOdometer, fuelLevel: body.fuelLevel, returnLocation: body.returnLocation, incidentDeclared: body.incidentDeclared, outstandingReceiptsDeclared: body.outstandingReceiptsDeclared }, sourceChannel: 'web' }),
    ]);

    await recordTenantRequestActivity({ tenantId: session.tenantId, requestId: trip.trip.requestId, reference: trip.requestReference, stage: 'completed', officeLabel: 'Return inspection' }).catch((err) => console.warn('[trips/return] Post-commit activity failed:', err));
    const [updatedTrip] = await db.select().from(trips).where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId))).limit(1);
    return NextResponse.json({ trip: updatedTrip });
  } catch (error) {
    console.error('[trips/return] POST failed:', error);
    return NextResponse.json({ error: 'Failed to return trip' }, { status: 500 });
  }
}
