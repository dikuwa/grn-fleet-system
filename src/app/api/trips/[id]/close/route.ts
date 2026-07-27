import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  trips,
  tripAuthorities,
  tripClosures,
  fuelTransactions,
  tripExpenses,
  tripIncidents,
  vehicleAllocations,
  vehicleInspections,
} from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { vehicles, vehicleStatusEvents, vehicleDefects } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { onTripClosed } from '@/lib/document-generator';
import { eq, and, inArray, isNull, ne, sql } from 'drizzle-orm';
import { setAuthorityStatus } from '@/lib/trip-authority';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await req.json();
    const { decision, reviewNotes } = body;

    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    // Require trip close permission
    const permCheck = await requirePermission(session, Permissions.TRIP_CLOSE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const userId = session.user.id;
    const tenantId = session.tenantId;

    // Find the trip — with tenant isolation
    const [trip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.tenantId, tenantId)))
      .limit(1);

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    if (trip.status === 'closed') {
      return NextResponse.json({ error: 'Trip is already closed' }, { status: 409 });
    }

    // Only return_inspection or closure_review trips can be closed
    if (trip.status !== 'return_inspection' && trip.status !== 'closure_review') {
      return NextResponse.json(
        {
          error: `Trip status "${trip.status}" must be "return_inspection" or "closure_review" before closing.`,
        },
        { status: 409 },
      );
    }

    const [authority] = await db
      .select()
      .from(tripAuthorities)
      .where(and(eq(tripAuthorities.tripId, id), eq(tripAuthorities.tenantId, tenantId)))
      .limit(1);
    if (!authority)
      return NextResponse.json({ error: 'Trip Authority not found' }, { status: 409 });

    if (decision === 'requires_correction' || decision === 'follow_up') {
      const [updatedTrip] = await db
        .update(trips)
        .set({ status: 'closure_review', updatedAt: new Date() })
        .where(eq(trips.id, id))
        .returning();
      await db.insert(auditEvents).values({
        tenantId,
        tenantSequence: Date.now(),
        eventType: 'trip_reconciliation_returned',
        actorUserId: userId,
        action: 'request_correction',
        entityType: 'trip',
        entityId: id,
        summary: 'Trip reconciliation returned for correction',
        reason: reviewNotes || 'Correction required',
        sourceChannel: 'web',
      });
      return NextResponse.json({ trip: updatedTrip, correctionRequired: true });
    }

    const [arrivalInspection] = await db
      .select({ id: vehicleInspections.id })
      .from(vehicleInspections)
      .where(
        and(
          eq(vehicleInspections.tripId, id),
          eq(vehicleInspections.type, 'return'),
          inArray(vehicleInspections.status, ['completed', 'failed']),
        ),
      )
      .limit(1);
    if (!arrivalInspection) {
      return NextResponse.json(
        { error: 'A submitted arrival inspection is required before reconciliation can close' },
        { status: 409 },
      );
    }

    const [outstandingFuel] = await db
      .select({ count: sql<number>`count(*)` })
      .from(fuelTransactions)
      .where(and(eq(fuelTransactions.tripId, id), eq(fuelTransactions.isVerified, false)));
    const [outstandingExpenses] = await db
      .select({ count: sql<number>`count(*)` })
      .from(tripExpenses)
      .where(and(eq(tripExpenses.tripId, id), ne(tripExpenses.verificationStatus, 'verified')));
    const [unsafeIncident] = await db
      .select({ id: tripIncidents.id })
      .from(tripIncidents)
      .where(
        and(
          eq(tripIncidents.tripId, id),
          eq(tripIncidents.safeToContinue, false),
          ne(tripIncidents.status, 'resolved'),
        ),
      )
      .limit(1);
    if (Number(outstandingFuel?.count ?? 0) > 0 || Number(outstandingExpenses?.count ?? 0) > 0) {
      return NextResponse.json(
        { error: 'All fuel and expense transactions must be verified before closure' },
        { status: 409 },
      );
    }
    if (unsafeIncident) {
      return NextResponse.json(
        { error: 'A safety-critical incident remains unresolved' },
        { status: 409 },
      );
    }
    if (!['awaiting_reconciliation', 'completed'].includes(authority.status)) {
      return NextResponse.json(
        { error: `Trip Authority is not ready for reconciliation (${authority.status})` },
        { status: 409 },
      );
    }

    // Calculate totals from fuel transactions
    const fuel = await db.select().from(fuelTransactions).where(eq(fuelTransactions.tripId, id));

    const totalFuelLitres = fuel.reduce((sum, f) => sum + Number(f.litres), 0);
    const totalFuelCost = fuel.reduce((sum, f) => sum + Number(f.amount), 0);

    // Create or update the trip closure record
    const [closure] = await db
      .insert(tripClosures)
      .values({
        tripId: id,
        authorisedKilometres: body.authorisedKm || null,
        actualKilometres:
          authority.beginningOdometer !== null && authority.endingOdometer !== null
            ? authority.endingOdometer - authority.beginningOdometer
            : body.actualKm || null,
        kilometreVariance:
          body.authorisedKm &&
          authority.beginningOdometer !== null &&
          authority.endingOdometer !== null
            ? authority.endingOdometer - authority.beginningOdometer - Number(body.authorisedKm)
            : null,
        totalFuelLitres: totalFuelLitres ? String(totalFuelLitres) : null,
        totalFuelCost: totalFuelCost ? String(totalFuelCost) : null,
        reviewNotes: reviewNotes || null,
        closedByUserId: userId,
        decision: decision || 'closed',
      })
      .returning();
    if (authority.status === 'awaiting_reconciliation') {
      await setAuthorityStatus({
        authorityId: authority.id,
        tenantId,
        next: 'completed',
      });
    }
    await setAuthorityStatus({
      authorityId: authority.id,
      tenantId,
      next: 'closed',
    });

    // Update trip status
    const [updatedTrip] = await db
      .update(trips)
      .set({
        status: 'closed',
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(trips.id, id))
      .returning();
    await db
      .update(transportRequests)
      .set({ status: 'closed', updatedAt: new Date() })
      .where(eq(transportRequests.id, trip.requestId));
    await db
      .update(vehicleAllocations)
      .set({ state: 'released', updatedAt: new Date() })
      .where(eq(vehicleAllocations.id, trip.allocationId));

    const [blockingDefect] = await db
      .select({ id: vehicleDefects.id })
      .from(vehicleDefects)
      .where(
        and(
          eq(vehicleDefects.vehicleId, trip.vehicleId),
          eq(vehicleDefects.isBlocking, true),
          isNull(vehicleDefects.resolvedAt),
        ),
      )
      .limit(1);
    const resultingVehicleStatus = blockingDefect ? 'maintenance' : 'available';

    // Return safe vehicles to the pool; vehicles with blocking defects remain in maintenance.
    await db
      .update(vehicles)
      .set({ status: resultingVehicleStatus, updatedAt: new Date() })
      .where(eq(vehicles.id, trip.vehicleId));

    await db.insert(vehicleStatusEvents).values({
      vehicleId: trip.vehicleId,
      previousStatus: trip.status === 'closure_review' ? 'allocated' : 'allocated',
      newStatus: resultingVehicleStatus,
      reason: blockingDefect
        ? 'Trip closed with unresolved blocking defect'
        : `Trip closed: ${id.slice(0, 8)}...`,
      changedByUserId: userId,
      referenceEntityType: 'trip',
      referenceEntityId: id,
    });

    // Audit log
    await db.insert(auditEvents).values({
      tenantId,
      tenantSequence: 0,
      eventType: 'trip_closed',
      actorUserId: userId,
      action: 'close',
      entityType: 'trip',
      entityId: id,
      summary: `Trip closed: ${totalFuelLitres}L fuel used, ${totalFuelCost} total cost`,
      sourceChannel: 'web',
    });

    // Trigger document generation (trip completion + fuel summary)
    const docs = await onTripClosed(id, tenantId, userId);

    return NextResponse.json({
      trip: updatedTrip,
      closure,
      documents: docs?.filter(Boolean) || [],
    });
  } catch (error) {
    console.error('[trips/close] POST failed:', error);
    return NextResponse.json({ error: 'Failed to close trip' }, { status: 500 });
  }
}
