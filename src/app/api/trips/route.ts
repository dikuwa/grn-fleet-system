/**
 * Trips API
 *
 * GET  /api/trips — List trips
 * POST /api/trips — Retired legacy creation endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { eq, and, desc, ilike, or, sql, type SQL } from 'drizzle-orm';
import {
  getSessionRoleNames,
  requireDashboardAction,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { tripScopeCondition } from '@/lib/record-scope';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const viewCheck = await requireDashboardAction(session, '/dashboard/trips', 'view');
    if (viewCheck instanceof NextResponse) return viewCheck;
    const roleNames = await getSessionRoleNames(session);
    const access = resolveDashboardAccess('/dashboard/trips', roleNames);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status')?.trim();
    const driverAssigned =
      searchParams.get('driver_assigned') === 'true' || access.recordScope === 'assigned';
    const search = searchParams.get('search')?.trim();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    const db = getDb();
    const tenantId = session.tenantId;
    const conditions: SQL[] = [
      tripScopeCondition({
        tenantId,
        userId: session.user.id,
        recordScope: access.recordScope ?? 'assigned',
      }),
    ];
    if (status) conditions.push(eq(trips.status, status));
    if (search) {
      conditions.push(
        or(ilike(vehicles.licenceNumber, `%${search}%`), ilike(vehicles.make, `%${search}%`))!,
      );
    }

    const where = and(...conditions);

    const [dbRows, totalResult] = await Promise.all([
      db
        .select({
          id: trips.id,
          status: trips.status,
          issuedAt: trips.issuedAt,
          driverAcknowledgedAt: trips.driverAcknowledgedAt,
          startedAt: trips.startedAt,
          returnedAt: trips.returnedAt,
          closedAt: trips.closedAt,
          createdAt: trips.createdAt,
          vehicleId: trips.vehicleId,
          make: vehicles.make,
          model: vehicles.model,
          licenceNumber: vehicles.licenceNumber,
          vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
          requestReference: transportRequests.reference,
          requestStatus: transportRequests.status,
          hasDepartureInspection: sql<boolean>`EXISTS (
            SELECT 1 FROM vehicle_inspections vi
            WHERE vi.trip_id = ${trips.id}
              AND vi.tenant_id = ${tenantId}::uuid
              AND vi.type = 'departure'
          )`,
          hasReturnInspection: sql<boolean>`EXISTS (
            SELECT 1 FROM vehicle_inspections vi
            WHERE vi.trip_id = ${trips.id}
              AND vi.tenant_id = ${tenantId}::uuid
              AND vi.type = 'return'
          )`,
          purpose: transportRequests.purpose,
          routeKm: sql<number>`COALESCE((
            SELECT SUM(COALESCE(rr.total_kilometres, rr.mapped_distance_km, 0))
            FROM request_routes rr
            WHERE rr.request_id = ${trips.requestId}
          ), 0)`.as('route_km'),
        })
        .from(trips)
        .leftJoin(
          vehicles,
          and(eq(trips.vehicleId, vehicles.id), eq(vehicles.tenantId, tenantId)),
        )
        .leftJoin(
          transportRequests,
          and(eq(trips.requestId, transportRequests.id), eq(transportRequests.tenantId, tenantId)),
        )
        .leftJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
        .where(where)
        .orderBy(desc(trips.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(trips)
        .leftJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
        .where(where),
    ]);

    const totalCount = Number(totalResult[0]?.count ?? 0);
    const totalPages = Math.ceil(totalCount / limit);
    const data = dbRows.map((row) => ({
      ...row,
      reference: row.requestReference,
      vehicleLicence: row.licenceNumber,
      startAt: row.startedAt || row.issuedAt,
      endAt: row.returnedAt || row.closedAt,
      canDeclineAssignment:
        row.status === 'pending' &&
        !row.issuedAt &&
        !row.driverAcknowledgedAt &&
        row.requestStatus === 'driver_acknowledgement_pending',
    }));

    return NextResponse.json({
      success: true,
      data,
      rows: data,
      totalCount,
      page,
      totalPages,
      driverAssigned,
    });
  } catch (error) {
    console.error('[Trips API] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch trips' }, { status: 500 });
  }
}

/**
 * The old POST implementation created a trip and immediately provisioned a
 * Trip Authority from the allocation. That bypassed the current workflow where
 * an optional physical number is only reserved during preparation and the
 * official authority is provisioned after final authorisation.
 *
 * Keep the route explicit rather than silently forwarding stale clients: a
 * caller using the old contract must update to the canonical endpoint so it
 * cannot accidentally restore the retired lifecycle.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;

  const routeCheck = await requireDashboardAction(session, '/dashboard/allocations', 'create');
  if (routeCheck instanceof NextResponse) return routeCheck;

  return NextResponse.json(
    {
      error:
        'This trip creation endpoint has been retired. Use /api/trips/create-from-allocation so Trip Authority issuance remains tied to final authorisation.',
      replacement: '/api/trips/create-from-allocation',
    },
    { status: 410 },
  );
}
