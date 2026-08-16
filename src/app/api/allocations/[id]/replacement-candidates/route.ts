/**
 * Replacement Candidates API
 *
 * GET /api/allocations/[id]/replacement-candidates
 *
 * Returns tenant vehicles that are currently available candidates by fleet
 * status and allocation-period overlap. This endpoint is deliberately only a
 * discovery aid: the canonical replacement service remains authoritative for
 * driver licence/class, professional-authorisation, trip phase, defects and
 * all concurrency checks at the moment replacement is committed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicleAllocations } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { eq, and, ne, inArray, lt, gt } from 'drizzle-orm';
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

    const allVehicles = await db
      .select({
        id: vehicles.id,
        make: vehicles.make,
        model: vehicles.model,
        licenceNumber: vehicles.licenceNumber,
        vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
        currentOdometer: vehicles.currentOdometer,
        status: vehicles.status,
        requiredLicenceClass: vehicles.requiredLicenceClass,
        professionalAuthorisationRequired: vehicles.professionalAuthorisationRequired,
      })
      .from(vehicles)
      .where(eq(vehicles.tenantId, tenantId))
      .orderBy(vehicles.make, vehicles.model);

    const overlappingAllocations = await db
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
      );

    const overlappingVehicleIds = new Set(overlappingAllocations.map((row) => row.vehicleId));

    const result = allVehicles
      .filter((vehicle) => vehicle.id !== currentVehicleId)
      .map((vehicle) => ({
        ...vehicle,
        available: vehicle.status === 'available' && !overlappingVehicleIds.has(vehicle.id),
        eligibilityNote:
          vehicle.status !== 'available'
            ? `Vehicle status is ${vehicle.status}.`
            : overlappingVehicleIds.has(vehicle.id)
              ? 'Vehicle has an overlapping live allocation.'
              : vehicle.professionalAuthorisationRequired
                ? 'Availability confirmed; final replacement still requires professional-authorisation eligibility.'
                : vehicle.requiredLicenceClass
                  ? `Availability confirmed; final replacement still verifies driver licence coverage for class ${vehicle.requiredLicenceClass}.`
                  : 'Availability confirmed; final replacement still performs driver and lifecycle validation.',
      }))
      .sort((a, b) => (a.available === b.available ? 0 : a.available ? -1 : 1));

    return NextResponse.json({
      vehicles: result,
      authoritativeEligibility: 'replacement_service',
    });
  } catch (error) {
    console.error('[Replacement Candidates] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch replacement candidates' },
      { status: 500 },
    );
  }
}
