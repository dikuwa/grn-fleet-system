/**
 * Vehicle Issue API
 *
 * POST /api/trips/[id]/issue — Record physical vehicle issue (keys, fuel card, odometer)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, tripAuthorities, tripIssues, vehicleInspections, vehicleAllocations } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { auditEvents } from '@/db/schema/audit';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
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
    const roleCheck = await requireDashboardAction(session, '/dashboard/trips', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;

    const permCheck = await requirePermission(session, Permissions.TRIP_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    // Fetch the trip with tenant isolation
    const [trip] = await db
      .select({
        id: trips.id,
        status: trips.status,
        allocationId: trips.allocationId,
        requestId: trips.requestId,
        driverAcknowledgedAt: trips.driverAcknowledgedAt,
        driverAcknowledgedByEmployeeId: trips.driverAcknowledgedByEmployeeId,
        requestStatus: transportRequests.status,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        authorityStatus: tripAuthorities.status,
        authorityBeginningOdometer: tripAuthorities.beginningOdometer,
      })
      .from(trips)
      .innerJoin(transportRequests, eq(trips.requestId, transportRequests.id))
      .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId)))
      .limit(1);

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    if (trip.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot issue vehicle for trip with status "${trip.status}". Only pending trips can be issued.` },
        { status: 409 },
      );
    }

    if (!trip.allocationId) {
      return NextResponse.json(
        { error: 'Trip has no allocation. Cannot issue vehicle.' },
        { status: 400 },
      );
    }
    if (trip.requestStatus !== 'authorised') return NextResponse.json({ error: 'Final authorisation is required before issue' }, { status: 409 });
    if (trip.authorityStatus !== 'ready_for_departure') {
      return NextResponse.json({ error: `Trip Authority is not ready for physical issue (${trip.authorityStatus})` }, { status: 409 });
    }
    if (!trip.driverEmployeeId || !trip.driverAcknowledgedAt || trip.driverAcknowledgedByEmployeeId !== trip.driverEmployeeId) {
      return NextResponse.json({ error: 'The assigned driver must acknowledge the trip before issue' }, { status: 409 });
    }
    const [departureInspection] = await db.select({ id: vehicleInspections.id })
      .from(vehicleInspections)
      .where(and(
        eq(vehicleInspections.tripId, id),
        eq(vehicleInspections.type, 'departure'),
        eq(vehicleInspections.status, 'completed'),
        eq(vehicleInspections.overallPass, true),
      )).limit(1);
    if (!departureInspection) return NextResponse.json({ error: 'A passed pre-departure inspection is required before issue' }, { status: 409 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await req.json().catch(() => ({}));
    const {
      issueOdometer,
      keysIssued = true,
      fuelCardIssued = false,
      notes,
    } = body;
    if (
      !Number.isInteger(Number(issueOdometer)) ||
      Number(issueOdometer) < (trip.authorityBeginningOdometer ?? 0)
    ) {
      return NextResponse.json({
        error: `Issue odometer must be a whole number at or above ${trip.authorityBeginningOdometer ?? 0}`,
      }, { status: 422 });
    }
    if (keysIssued !== true) {
      return NextResponse.json({ error: 'Vehicle keys must be issued before departure' }, { status: 422 });
    }

    // Check if an issue record already exists for this allocation
    const [existingIssue] = await db
      .select()
      .from(tripIssues)
      .where(eq(tripIssues.allocationId, trip.allocationId))
      .limit(1);

    if (existingIssue) {
      return NextResponse.json(
        { error: 'Vehicle already issued for this allocation' },
        { status: 409 },
      );
    }

    // Create the issue record
    const [issue] = await db
      .insert(tripIssues)
      .values({
        tripId: id,
        allocationId: trip.allocationId,
        issuedAt: new Date(),
        issueOdometer: issueOdometer || null,
        keysIssued,
        fuelCardIssued,
        issuedByUserId: session.user.id,
        acknowledgedByDriverId: trip.driverEmployeeId,
        acknowledgedAt: trip.driverAcknowledgedAt,
        notes: notes || null,
      })
      .returning();

    // Update trip issuedAt timestamp
    await db
      .update(trips)
      .set({ issuedAt: new Date(), updatedAt: new Date() })
      .where(eq(trips.id, id));
    await db.update(transportRequests).set({ status: 'vehicle_issued', updatedAt: new Date() }).where(eq(transportRequests.id, trip.requestId));
    await db.update(vehicleAllocations).set({ state: 'issued', updatedAt: new Date() }).where(eq(vehicleAllocations.id, trip.allocationId));

    // Audit log
    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: 0,
      eventType: 'vehicle_issued',
      actorUserId: session.user.id,
      action: 'issue',
      entityType: 'trip',
      entityId: id,
      summary: `Vehicle issued: keys=${keysIssued}, fuelCard=${fuelCardIssued}${issueOdometer ? `, odometer=${issueOdometer}` : ''}`,
      sourceChannel: 'web',
    });

    return NextResponse.json({ success: true, issue });
  } catch (error) {
    console.error('[trips/issue] POST failed:', error);
    return NextResponse.json({ error: 'Failed to issue vehicle' }, { status: 500 });
  }
}
