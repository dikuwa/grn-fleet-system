import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { vehicles, vehicleOdometerEvents } from '@/db/schema/fleet';
import { requireAnyPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const permission = await requireAnyPermission(auth.session, [
      Permissions.VEHICLE_VIEW,
      Permissions.VEHICLE_MANAGE,
      Permissions.MAINTENANCE_VIEW,
      Permissions.INSPECTION_VIEW,
      Permissions.AUDIT_READ,
    ]);
    if (permission instanceof NextResponse) return permission;

    const { id } = await params;
    const db = getDb();
    const [vehicle] = await db
      .select({ id: vehicles.id, currentOdometer: vehicles.currentOdometer })
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.tenantId, auth.session.tenantId)))
      .limit(1);
    if (!vehicle) return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });

    const rows = await db
      .select({
        id: vehicleOdometerEvents.id,
        odometerValue: vehicleOdometerEvents.odometerValue,
        source: vehicleOdometerEvents.source,
        sourceEntityType: vehicleOdometerEvents.sourceEntityType,
        sourceEntityId: vehicleOdometerEvents.sourceEntityId,
        notes: vehicleOdometerEvents.notes,
        createdAt: vehicleOdometerEvents.createdAt,
      })
      .from(vehicleOdometerEvents)
      .where(eq(vehicleOdometerEvents.vehicleId, id))
      .orderBy(desc(vehicleOdometerEvents.createdAt))
      .limit(100);

    return NextResponse.json({ success: true, data: { currentOdometer: vehicle.currentOdometer, events: rows } });
  } catch (error) {
    console.error('[fleet/odometer] GET failed:', error);
    return NextResponse.json({ error: 'Could not load odometer history' }, { status: 500 });
  }
}
