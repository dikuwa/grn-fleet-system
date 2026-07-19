import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicles, vehicleStatusEvents } from '@/db/schema/fleet';
import { offices } from '@/db/schema/people';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and } from 'drizzle-orm';

/**
 * POST /api/fleet/[id]/transfer
 *
 * Transfer a vehicle to a different office within the same tenant.
 * Records the transfer in status events and updates the vehicle's
 * assigned office.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.VEHICLE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const { id } = await params;

    // Verify vehicle exists and belongs to this tenant
    const [vehicle] = await db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!vehicle) {
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    }

    const body = await req.json();
    const targetOfficeId = body.officeId;

    if (!targetOfficeId) {
      return NextResponse.json({ error: 'Target office ID is required' }, { status: 400 });
    }

    // Verify target office exists and belongs to this tenant
    const [targetOffice] = await db
      .select()
      .from(offices)
      .where(and(eq(offices.id, targetOfficeId), eq(offices.tenantId, session.tenantId)))
      .limit(1);

    if (!targetOffice) {
      return NextResponse.json({ error: 'Target office not found in your tenant' }, { status: 404 });
    }

    // Prevent transfer if target is same as current
    if (vehicle.officeId === targetOfficeId && vehicle.assignedOfficeId === targetOfficeId) {
      return NextResponse.json(
        { error: 'Vehicle is already assigned to this office' },
        { status: 409 },
      );
    }

    const reason = body.reason?.trim() || `Transfer to ${targetOffice.name}`;

    // Record status change event
    await db.insert(vehicleStatusEvents).values({
      vehicleId: id,
      previousStatus: vehicle.status,
      newStatus: vehicle.status,
      reason: `TRANSFER: ${reason}`,
      changedByUserId: session.user.id,
    });

    // Update vehicle
    const [updated] = await db
      .update(vehicles)
      .set({
        officeId: targetOfficeId,
        assignedOfficeId: targetOfficeId,
        updatedBy: session.user.id,
        updatedAt: new Date(),
        notes: vehicle.notes
          ? `${vehicle.notes}\n[TRANSFERRED TO ${targetOffice.name}: ${reason}]`
          : `[TRANSFERRED TO ${targetOffice.name}: ${reason}]`,
      })
      .where(eq(vehicles.id, id))
      .returning();

    return NextResponse.json({
      success: true,
      data: {
        vehicle: updated,
        previousOfficeId: vehicle.officeId,
        newOfficeId: targetOfficeId,
        officeName: targetOffice.name,
      },
    });
  } catch (error) {
    console.error('[fleet/transfer] POST failed:', error);
    return NextResponse.json({ error: 'Failed to transfer vehicle: ' + String(error) }, { status: 500 });
  }
}
