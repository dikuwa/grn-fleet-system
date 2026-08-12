import { NextRequest, NextResponse } from 'next/server';
import { and, eq, ne, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { auditEvents } from '@/db/schema/audit';
import { tripAuthorities, trips, vehicleAllocations } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  ManualAuthorityNumberError,
  normaliseManualAuthorityNumber,
  validateManualAuthorityNumber,
} from '@/lib/trip-authority';

const PHYSICAL_AUTHORITY_KEY = 'physicalTripAuthorityNumber';
const PHYSICAL_AUTHORITY_SET_BY_KEY = 'physicalTripAuthorityNumberSetByUserId';

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

      const [issuedDuplicate] = await db
        .select({ id: tripAuthorities.id })
        .from(tripAuthorities)
        .where(
          and(
            eq(tripAuthorities.tenantId, tenantId),
            eq(tripAuthorities.authorityNumber, manualAuthorityNumber),
          ),
        )
        .limit(1);
      if (issuedDuplicate) {
        return NextResponse.json(
          {
            error:
              'This Trip Authority number is already in use. Check the physical document number and try again.',
          },
          { status: 409 },
        );
      }

      const [stagedDuplicate] = await db
        .select({ id: transportRequests.id })
        .from(transportRequests)
        .where(
          and(
            eq(transportRequests.tenantId, tenantId),
            ne(transportRequests.id, allocation.requestId),
            sql`${transportRequests.vehicleRequirements}->>${PHYSICAL_AUTHORITY_KEY} = ${manualAuthorityNumber}`,
          ),
        )
        .limit(1);
      if (stagedDuplicate) {
        return NextResponse.json(
          {
            error:
              'This physical Trip Authority number is already reserved on another transport request in this organisation.',
          },
          { status: 409 },
        );
      }
    }

    const nextVehicleRequirements = {
      ...(allocation.vehicleRequirements ?? {}),
      [PHYSICAL_AUTHORITY_KEY]: manualAuthorityNumber,
      [PHYSICAL_AUTHORITY_SET_BY_KEY]: manualAuthorityNumber ? session.user.id : null,
    };

    await db
      .update(transportRequests)
      .set({ vehicleRequirements: nextVehicleRequirements, updatedAt: new Date() })
      .where(
        and(
          eq(transportRequests.id, allocation.requestId),
          eq(transportRequests.tenantId, tenantId),
        ),
      );

    try {
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

      await db.insert(auditEvents).values({
        tenantId,
        tenantSequence: Date.now(),
        eventType: 'trip_created_from_allocation',
        actorUserId: session.user.id,
        action: 'create',
        entityType: 'trip',
        entityId: trip.id,
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
      });

      return NextResponse.json({
        trip,
        authority: null,
        authorityNumberMode: manualAuthorityNumber ? 'manual' : 'automatic',
        manualAuthorityNumber,
        message: manualAuthorityNumber
          ? 'Trip created. The physical Trip Authority number is reserved and will be applied after final authorisation.'
          : 'Trip created. GRN FLEET will generate the Trip Authority number automatically after final authorisation.',
      });
    } catch (tripError) {
      await db
        .update(transportRequests)
        .set({ vehicleRequirements: allocation.vehicleRequirements ?? {}, updatedAt: new Date() })
        .where(
          and(
            eq(transportRequests.id, allocation.requestId),
            eq(transportRequests.tenantId, tenantId),
          ),
        )
        .catch(() => undefined);
      throw tripError;
    }
  } catch (error) {
    console.error('[trips/create-from-allocation] POST failed:', error);
    if (error instanceof ManualAuthorityNumberError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create trip from allocation' }, { status: 500 });
  }
}
