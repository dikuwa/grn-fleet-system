import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { auditEvents } from '@/db/schema/audit';
import { tripAuthorities, trips, vehicleAllocations } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { runAtomicMutations } from '@/lib/db-atomic';
import {
  ManualAuthorityNumberError,
  normaliseManualAuthorityNumber,
  validateManualAuthorityNumber,
} from '@/lib/trip-authority';

const DUPLICATE_PHYSICAL_NUMBER_MESSAGE =
  'This physical Trip Authority number is already reserved or in use in this organisation. Check the paper document number and try again.';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const allocationId = typeof body?.allocationId === 'string' ? body.allocationId.trim() : '';
    const rawManualAuthorityNumber = normaliseManualAuthorityNumber(body?.manualAuthorityNumber);

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
        vehicleRequirements: transportRequests.vehicleRequirements,
      })
      .from(vehicleAllocations)
      .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .innerJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
      .where(
        and(
          eq(vehicleAllocations.id, allocationId),
          eq(vehicles.tenantId, tenantId),
          eq(transportRequests.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!allocation) {
      return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });
    }

    if (allocation.state !== 'confirmed') {
      return NextResponse.json(
        {
          error: 'Only confirmed allocations can create trips. Current state: ' + allocation.state,
        },
        { status: 409 },
      );
    }

    if (
      ![
        'approved',
        'approved_emergency',
        'authorised',
        'ready_for_issue',
        'vehicle_allocated',
      ].includes(allocation.requestStatus)
    ) {
      return NextResponse.json(
        {
          error: `Transport request is not ready for trip creation (current: ${allocation.requestStatus})`,
        },
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

    let manualAuthorityNumber: string | null = null;
    if (rawManualAuthorityNumber) {
      manualAuthorityNumber = validateManualAuthorityNumber(rawManualAuthorityNumber);

      // Give a clear message before the database-level uniqueness guards fire.
      // The unique indexes on both reserved request numbers and issued authority
      // numbers remain the concurrency-safe final backstop.
      const [[issuedDuplicate], [reservedDuplicate]] = await Promise.all([
        db
          .select({ id: tripAuthorities.id })
          .from(tripAuthorities)
          .where(
            and(
              eq(tripAuthorities.tenantId, tenantId),
              eq(tripAuthorities.authorityNumber, manualAuthorityNumber),
            ),
          )
          .limit(1),
        db
          .select({ id: transportRequests.id })
          .from(transportRequests)
          .where(
            and(
              eq(transportRequests.tenantId, tenantId),
              eq(transportRequests.physicalTripAuthorityNumber, manualAuthorityNumber),
            ),
          )
          .limit(1),
      ]);
      if (issuedDuplicate || reservedDuplicate) {
        return NextResponse.json({ error: DUPLICATE_PHYSICAL_NUMBER_MESSAGE }, { status: 409 });
      }
    }

    const now = new Date();
    const tripId = randomUUID();
    const auditId = randomUUID();
    // Keep a compatibility mirror in the already-established request snapshot
    // until every authority provisioning caller reads the dedicated reservation
    // columns. The dedicated columns + unique index are the authoritative source.
    const nextVehicleRequirements = {
      ...(allocation.vehicleRequirements ?? {}),
      physicalTripAuthorityNumber: manualAuthorityNumber,
      physicalTripAuthorityNumberSetByUserId: manualAuthorityNumber ? session.user.id : null,
    };

    try {
      await runAtomicMutations((tx) => [
        tx.update(transportRequests)
          .set({
            physicalTripAuthorityNumber: manualAuthorityNumber,
            physicalTripAuthorityNumberSetByUserId: manualAuthorityNumber ? session.user.id : null,
            physicalTripAuthorityNumberSetAt: manualAuthorityNumber ? now : null,
            vehicleRequirements: nextVehicleRequirements,
            updatedAt: now,
          })
          .where(
            and(
              eq(transportRequests.id, allocation.requestId),
              eq(transportRequests.tenantId, tenantId),
            ),
          ),
        tx.insert(trips).values({
          id: tripId,
          tenantId,
          requestId: allocation.requestId,
          allocationId: allocation.id,
          vehicleId: allocation.vehicleId,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        }),
        tx.insert(auditEvents).values({
          id: auditId,
          tenantId,
          tenantSequence: Date.now(),
          eventType: 'trip_created_from_allocation',
          actorUserId: session.user.id,
          action: 'create',
          entityType: 'trip',
          entityId: tripId,
          summary: manualAuthorityNumber
            ? `Trip created; physical Trip Authority number ${manualAuthorityNumber} reserved for final authorisation`
            : 'Trip created; Trip Authority number will be generated automatically at final authorisation',
          after: {
            allocationId: allocation.id,
            requestId: allocation.requestId,
            authorityNumberMode: manualAuthorityNumber ? 'manual' : 'automatic',
            physicalTripAuthorityNumber: manualAuthorityNumber,
          },
          sourceChannel: 'web',
        }),
      ]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505' && manualAuthorityNumber) {
        return NextResponse.json({ error: DUPLICATE_PHYSICAL_NUMBER_MESSAGE }, { status: 409 });
      }
      throw error;
    }

    const [trip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.tenantId, tenantId)))
      .limit(1);

    if (!trip) {
      return NextResponse.json(
        { error: 'Trip creation committed but the trip could not be reloaded. Refresh the allocation.' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      trip,
      authority: null,
      authorityNumberMode: manualAuthorityNumber ? 'manual' : 'automatic',
      manualAuthorityNumber,
      message: manualAuthorityNumber
        ? 'Trip created. The physical Trip Authority number is reserved and will be applied after final authorisation.'
        : 'Trip created. GRN FLEET will generate the Trip Authority number automatically after final authorisation.',
    });
  } catch (error) {
    console.error('[trips/create-from-allocation] POST failed:', error);
    if (error instanceof ManualAuthorityNumberError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create trip from allocation' }, { status: 500 });
  }
}
