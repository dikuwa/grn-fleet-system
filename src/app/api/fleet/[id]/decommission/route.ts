import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicles, vehicleStatusEvents } from '@/db/schema/fleet';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and } from 'drizzle-orm';

/**
 * POST /api/fleet/[id]/decommission
 *
 * Decommission a vehicle — marks it as written_off or out_of_service
 * with a reason and audit trail. Prevents decommission of vehicles
 * that are currently on active trips.
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

    // Prevent decommission of vehicles on active trips
    if (vehicle.status === 'issued' || vehicle.status === 'allocated') {
      return NextResponse.json(
        { error: 'Cannot decommission a vehicle that is currently on an active trip or allocation. Complete or cancel the trip first.' },
        { status: 409 },
      );
    }

    const body = await req.json();
    const targetStatus = body.status || 'written_off';

    if (!['written_off', 'out_of_service'].includes(targetStatus)) {
      return NextResponse.json(
        { error: 'Decommission status must be "written_off" or "out_of_service"' },
        { status: 400 },
      );
    }

    if (!body.reason?.trim()) {
      return NextResponse.json(
        { error: 'Decommission reason is required' },
        { status: 400 },
      );
    }

    // Record status change event
    await db.insert(vehicleStatusEvents).values({
      vehicleId: id,
      previousStatus: vehicle.status,
      newStatus: targetStatus,
      reason: body.reason.trim(),
      changedByUserId: session.user.id,
    });

    // Update vehicle
    const [updated] = await db
      .update(vehicles)
      .set({
        status: targetStatus,
        isActive: targetStatus === 'out_of_service', // Only out_of_service stays active
        notes: vehicle.notes
          ? `${vehicle.notes}\n[DECOMMISSIONED: ${body.reason.trim()}]`
          : `[DECOMMISSIONED: ${body.reason.trim()}]`,
        updatedBy: session.user.id,
        updatedAt: new Date(),
      })
      .where(eq(vehicles.id, id))
      .returning();

    return NextResponse.json({
      success: true,
      data: {
        vehicle: updated,
        event: { previousStatus: vehicle.status, newStatus: targetStatus, reason: body.reason.trim() },
      },
    });
  } catch (error) {
    console.error('[fleet/decommission] POST failed:', error);
    return NextResponse.json({ error: 'Failed to decommission vehicle: ' + String(error) }, { status: 500 });
  }
}
