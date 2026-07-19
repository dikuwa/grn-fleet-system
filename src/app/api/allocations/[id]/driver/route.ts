/**
 * Allocation Driver Assignment API
 *
 * PATCH /api/allocations/[id]/driver  — Assign a driver to an allocation
 * DELETE /api/allocations/[id]/driver  — Unassign the driver
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicleAllocations } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { eq, and } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { driverEmployeeId } = body;

    if (!driverEmployeeId) {
      return NextResponse.json({ error: 'driverEmployeeId is required' }, { status: 400 });
    }

    const db = getDb();

    // Verify allocation exists and belongs to this tenant
    const [allocation] = await db
      .select({ id: vehicleAllocations.id, state: vehicleAllocations.state })
      .from(vehicleAllocations)
      .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .where(and(eq(vehicleAllocations.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!allocation) {
      return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });
    }

    // Verify the employee exists, is a driver, and belongs to this tenant
    const [driver] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.id, driverEmployeeId), eq(employees.tenantId, session.tenantId), eq(employees.isDriver, true)))
      .limit(1);

    if (!driver) {
      return NextResponse.json({ error: 'Driver not found or not a valid driver in this tenant' }, { status: 404 });
    }

    // Assign driver
    await db
      .update(vehicleAllocations)
      .set({ driverEmployeeId, updatedAt: new Date() })
      .where(eq(vehicleAllocations.id, id));

    return NextResponse.json({ success: true, driverEmployeeId });
  } catch (error) {
    console.error('[Allocation Driver] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to assign driver' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    // Verify allocation exists and belongs to this tenant
    const [allocation] = await db
      .select({ id: vehicleAllocations.id })
      .from(vehicleAllocations)
      .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .where(and(eq(vehicleAllocations.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!allocation) {
      return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });
    }

    // Unassign driver
    await db
      .update(vehicleAllocations)
      .set({ driverEmployeeId: null, updatedAt: new Date() })
      .where(eq(vehicleAllocations.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Allocation Driver] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to unassign driver' }, { status: 500 });
  }
}
