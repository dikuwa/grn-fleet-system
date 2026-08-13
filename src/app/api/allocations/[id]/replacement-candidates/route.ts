/**
 * Replacement Candidates API
 *
 * GET /api/allocations/[id]/replacement-candidates
 *
 * Returns tenant vehicles that may replace the current allocation vehicle.
 * Candidate availability mirrors the canonical replacement service exactly:
 * fleet status must be `available`, statutory vehicle compliance must remain
 * valid through the allocation period, there must be no unresolved blocking
 * safety defect, and there must be no overlapping provisional/confirmed
 * allocation in the requested period.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicleAllocations } from '@/db/schema/trips';
import { vehicleDefects, vehicles } from '@/db/schema/fleet';
import { eq, and, ne, inArray, lt, gt, isNull } from 'drizzle-orm';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

const LIVE_ALLOCATION_STATES = ['provisional', 'confirmed'] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;

    const routeCheck = await requireDashboardAction(auth.session, '/dashboard/allocations', 'update');
    if (routeCheck instanceof NextResponse) return routeCheck;
    const permCheck = await requirePermission(auth.session, Permissions.ALLOCATION_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const tenantId = auth.session.tenantId;

    const [allocation] = await db
      .select({
        id: vehicleAllocations.id,
        state: vehicleAllocations.state,
        vehicleId: vehicleAllocations.vehicleId,
        startAt: vehicleAllocations.startAt,
        endAt: vehicleAllocations.endAt,
      })
      .from(vehicleAllocations)
      .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .where(and(eq(vehicleAllocations.id, id), eq(vehicles.tenantId, tenantId)))
      .limit(1);

    if (!allocation) {
      return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });
    }
    if (!LIVE_ALLOCATION_STATES.includes(allocation.state as (typeof LIVE_ALLOCATION_STATES)[number])) {
      return NextResponse.json(
        { error: `Vehicle replacement is not available for an allocation in '${allocation.state}' state` },
        { status: 409 },
      );
    }

    const { startAt, endAt, vehicleId: currentVehicleId } = allocation;
    const requiredThroughDate = endAt.toISOString().slice(0, 10);

    const allVehicles = await db
      .select({
        id: vehicles.id,
        make: vehicles.make,
        model: vehicles.model,
        licenceNumber: vehicles.licenceNumber,
        vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
        currentOdometer: vehicles.currentOdometer,
        status: vehicles.status,
        licenceExpiryDate: vehicles.licenceExpiryDate,
        roadworthyTestDate: vehicles.roadworthyTestDate,
      })
      .from(vehicles)
      .where(eq(vehicles.tenantId, tenantId))
      .orderBy(vehicles.make, vehicles.model);

    const [overlappingAllocations, blockingDefects] = await Promise.all([
      db
        .select({ vehicleId: vehicleAllocations.vehicleId })
        .from(vehicleAllocations)
        .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
        .where(
          and(
            eq(vehicles.tenantId, tenantId),
            ne(vehicleAllocations.id, id),
            ne(vehicleAllocations.vehicleId, currentVehicleId),
            inArray(vehicleAllocations.state, [...LIVE_ALLOCATION_STATES]),
            lt(vehicleAllocations.startAt, endAt),
            gt(vehicleAllocations.endAt, startAt),
          ),
        ),
      db
        .select({ vehicleId: vehicleDefects.vehicleId })
        .from(vehicleDefects)
        .innerJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id))
        .where(
          and(
            eq(vehicles.tenantId, tenantId),
            eq(vehicleDefects.isBlocking, true),
            isNull(vehicleDefects.resolvedAt),
          ),
        ),
    ]);

    const overlappingVehicleIds = new Set(overlappingAllocations.map((row) => row.vehicleId));
    const blockingVehicleIds = new Set(blockingDefects.map((row) => row.vehicleId));

    const result = allVehicles
      .filter((vehicle) => vehicle.id !== currentVehicleId)
      .map((vehicle) => {
        const hasScheduleConflict = overlappingVehicleIds.has(vehicle.id);
        const hasBlockingDefect = blockingVehicleIds.has(vehicle.id);
        const licenceExpiresTooSoon = Boolean(
          vehicle.licenceExpiryDate && vehicle.licenceExpiryDate < requiredThroughDate,
        );
        const roadworthyExpiresTooSoon = Boolean(
          vehicle.roadworthyTestDate && vehicle.roadworthyTestDate < requiredThroughDate,
        );
        return {
          ...vehicle,
          available:
            vehicle.status === 'available' &&
            !hasScheduleConflict &&
            !hasBlockingDefect &&
            !licenceExpiresTooSoon &&
            !roadworthyExpiresTooSoon,
          blockers: [
            ...(vehicle.status !== 'available' ? [`Vehicle status is ${vehicle.status}`] : []),
            ...(hasScheduleConflict ? ['Vehicle is already allocated during this period'] : []),
            ...(hasBlockingDefect ? ['Vehicle has an unresolved blocking safety defect'] : []),
            ...(licenceExpiresTooSoon
              ? [`Vehicle licence expires before the allocation ends (${vehicle.licenceExpiryDate})`]
              : []),
            ...(roadworthyExpiresTooSoon
              ? [`Vehicle roadworthy validity ends before the allocation ends (${vehicle.roadworthyTestDate})`]
              : []),
          ],
        };
      })
      .sort((a, b) => (a.available === b.available ? 0 : a.available ? -1 : 1));

    return NextResponse.json({ vehicles: result, requiredThroughDate });
  } catch (error) {
    console.error('[Replacement Candidates] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch replacement candidates' },
      { status: 500 },
    );
  }
}
