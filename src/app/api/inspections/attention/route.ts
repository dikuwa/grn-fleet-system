/**
 * GET /api/inspections/attention
 *
 * Live count of inspection work that is actually ready for an Inspector or
 * Control Administrative Officer to perform. Inspections are persisted when
 * completed, so counting only `vehicle_inspections.status = in_progress`
 * misses the real queue. The attention badge therefore follows the same trip
 * and Trip Authority lifecycle gates used by the inspection form context.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, count, eq, inArray, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { tripAuthorities, trips, vehicleAllocations } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';

const DEPARTURE_REQUEST_STATUSES = ['authorised', 'ready_for_issue', 'approved', 'approved_emergency'];
const DEPARTURE_AUTHORITY_STATUSES = ['driver_accepted', 'awaiting_pre_trip_inspection'];
const RETURN_TRIP_STATUSES = ['in_progress', 'return_due', 'return_inspection'];
const RETURN_AUTHORITY_STATUSES = ['returned', 'awaiting_arrival_inspection'];

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const routeCheck = await requireDashboardAction(session, '/dashboard/inspections', 'view');
    if (routeCheck instanceof NextResponse) return routeCheck;

    const db = getDb();
    const [row] = await db
      .select({ total: count() })
      .from(trips)
      .innerJoin(
        transportRequests,
        and(
          eq(transportRequests.id, trips.requestId),
          eq(transportRequests.tenantId, session.tenantId),
        ),
      )
      .innerJoin(
        vehicleAllocations,
        and(
          eq(vehicleAllocations.id, trips.allocationId),
          eq(vehicleAllocations.requestId, trips.requestId),
          eq(vehicleAllocations.vehicleId, trips.vehicleId),
          eq(vehicleAllocations.state, 'confirmed'),
        ),
      )
      .innerJoin(
        tripAuthorities,
        and(
          eq(tripAuthorities.tripId, trips.id),
          eq(tripAuthorities.requestId, trips.requestId),
          eq(tripAuthorities.allocationId, trips.allocationId),
          eq(tripAuthorities.tenantId, session.tenantId),
        ),
      )
      .where(
        and(
          eq(trips.tenantId, session.tenantId),
          or(
            and(
              eq(trips.status, 'pending'),
              inArray(transportRequests.status, DEPARTURE_REQUEST_STATUSES),
              inArray(tripAuthorities.status, DEPARTURE_AUTHORITY_STATUSES),
            ),
            and(
              inArray(trips.status, RETURN_TRIP_STATUSES),
              inArray(tripAuthorities.status, RETURN_AUTHORITY_STATUSES),
            ),
          ),
        ),
      );

    return NextResponse.json({
      success: true,
      data: { total: Number(row?.total ?? 0) },
    });
  } catch (error) {
    console.error('Inspections attention API failed:', error);
    return NextResponse.json({ error: 'Failed to load attention count' }, { status: 500 });
  }
}
