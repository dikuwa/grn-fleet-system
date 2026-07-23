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
import { employees, driverProfiles, driverLicences } from '@/db/schema/people';
import { auditEvents } from '@/db/schema/audit';
import { eq, and, gt, lt, inArray, ne, gte, sql } from 'drizzle-orm';
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
      .select({ id: vehicleAllocations.id, state: vehicleAllocations.state, startAt: vehicleAllocations.startAt, endAt: vehicleAllocations.endAt, driverEmployeeId: vehicleAllocations.driverEmployeeId })
      .from(vehicleAllocations)
      .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .where(and(eq(vehicleAllocations.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!allocation) {
      return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });
    }
    if (!['provisional', 'confirmed'].includes(allocation.state)) {
      return NextResponse.json({ error: 'Driver replacement is only allowed before physical issue' }, { status: 409 });
    }

    // Verify the employee exists, is a driver, and belongs to this tenant
    const requiredLicenceExpiry = allocation.endAt.toISOString().slice(0, 10);
    const [driver] = await db
      .select({ id: employees.id, profileId: driverProfiles.id })
      .from(employees)
      .innerJoin(driverProfiles, eq(driverProfiles.employeeId, employees.id))
      .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
      .where(and(
        eq(employees.id, driverEmployeeId),
        eq(employees.tenantId, session.tenantId),
        eq(employees.isDriver, true),
        eq(employees.employmentStatus, 'active'),
        eq(driverProfiles.driverStatus, 'authorised'),
        eq(driverProfiles.availabilityStatus, 'available'),
        eq(driverLicences.verificationStatus, 'verified'),
        eq(driverLicences.isVerified, true),
        gte(driverLicences.expiryDate, requiredLicenceExpiry),
      ))
      .limit(1);

    if (!driver) {
      return NextResponse.json({ error: 'Driver is inactive, unavailable, unverified, or has no valid licence' }, { status: 409 });
    }

    const [conflict] = await db.select({ id: vehicleAllocations.id })
      .from(vehicleAllocations)
      .where(and(
        eq(vehicleAllocations.driverEmployeeId, driverEmployeeId),
        ne(vehicleAllocations.id, id),
        inArray(vehicleAllocations.state, ['provisional', 'confirmed', 'issued']),
        lt(vehicleAllocations.startAt, allocation.endAt),
        gt(vehicleAllocations.endAt, allocation.startAt),
      ))
      .limit(1);
    if (conflict) return NextResponse.json({ error: 'Driver is already assigned during this period' }, { status: 409 });

    // Assign driver
    await db
      .update(vehicleAllocations)
      .set({ driverEmployeeId, version: sql`${vehicleAllocations.version} + 1`, updatedAt: new Date() })
      .where(eq(vehicleAllocations.id, id));

    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: Date.now(),
      eventType: allocation.driverEmployeeId ? 'driver_replaced' : 'driver_assigned',
      actorUserId: session.user.id,
      action: 'assign',
      entityType: 'allocation',
      entityId: id,
      summary: allocation.driverEmployeeId ? `Driver replaced: ${allocation.driverEmployeeId} → ${driverEmployeeId}` : `Driver ${driverEmployeeId} assigned to allocation`,
      before: { driverEmployeeId: allocation.driverEmployeeId },
      after: { driverEmployeeId },
    });

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

    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: Date.now(),
      eventType: 'driver_unassigned',
      actorUserId: session.user.id,
      action: 'unassign',
      entityType: 'allocation',
      entityId: id,
      summary: 'Driver removed from allocation',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Allocation Driver] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to unassign driver' }, { status: 500 });
  }
}
