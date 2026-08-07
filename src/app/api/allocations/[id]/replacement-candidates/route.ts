/**
 * Replacement Candidates API
 *
 * GET /api/allocations/[id]/replacement-candidates
 *
 * Returns vehicles eligible to replace the vehicle on a given allocation.
 * Only returns vehicles in the same tenant with a "usable" status (available,
 * provisional) that do not have overlapping active allocations in the period.
 * The current vehicle is excluded.
 *
 * Response shape:
 * {
 *   vehicles: [
 *     {
 *       id, make, model, licenceNumber, vehicleRegisterNumber,
 *       currentOdometer, status, available: boolean
 *     }
 *   ]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicleAllocations } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { eq, and, ne, inArray, lt, gt } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;

    const permCheck = await requirePermission(auth.session, Permissions.ALLOCATION_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    // 1. Fetch the current allocation to get its period
    const [allocation] = await db
      .select({
        id: vehicleAllocations.id,
        vehicleId: vehicleAllocations.vehicleId,
        startAt: vehicleAllocations.startAt,
        endAt: vehicleAllocations.endAt,
      })
      .from(vehicleAllocations)
      .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .where(and(eq(vehicleAllocations.id, id), eq(vehicles.tenantId, auth.session.tenantId)))
      .limit(1);

    if (!allocation) {
      return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });
    }

    const { startAt, endAt, vehicleId: currentVehicleId } = allocation;

    // 2. Fetch all eligible vehicles in the tenant
    const allVehicles = await db
      .select({
        id: vehicles.id,
        make: vehicles.make,
        model: vehicles.model,
        licenceNumber: vehicles.licenceNumber,
        vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
        currentOdometer: vehicles.currentOdometer,
        status: vehicles.status,
      })
      .from(vehicles)
      .where(eq(vehicles.tenantId, auth.session.tenantId))
      .orderBy(vehicles.make, vehicles.model);

    // 3. Find overlapping allocations (to flag vehicles that are already allocated)
    const overlappingAllocations = await db
      .select({ vehicleId: vehicleAllocations.vehicleId })
      .from(vehicleAllocations)
      .where(
        and(
          ne(vehicleAllocations.vehicleId, currentVehicleId),
          inArray(vehicleAllocations.state, ['provisional', 'confirmed', 'allocated', 'issued']),
          lt(vehicleAllocations.startAt, endAt),
          gt(vehicleAllocations.endAt, startAt),
        ),
      );

    const overlappingVehicleIds = new Set(
      overlappingAllocations.map((a) => a.vehicleId),
    );

    // 4. Build the result set
    const result = allVehicles
      .filter((v) => v.id !== currentVehicleId)
      .map((v) => ({
        ...v,
        available: ['available', 'provisional'].includes(v.status) && !overlappingVehicleIds.has(v.id),
      }))
      // Prioritise available vehicles first
      .sort((a, b) => (a.available === b.available ? 0 : a.available ? -1 : 1));

    return NextResponse.json({ vehicles: result });
  } catch (error) {
    console.error('[Replacement Candidates] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch replacement candidates' },
      { status: 500 },
    );
  }
}