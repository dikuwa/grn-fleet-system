import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { vehicles, vehicleOdometerEvents } from '@/db/schema/fleet';
import {
  getSessionRoleNames,
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { Permissions } from '@/lib/permissions';
import { vehicleScopeCondition } from '@/lib/record-scope';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const routeCheck = await requireDashboardAction(session, '/dashboard/fleet', 'view');
    if (routeCheck instanceof NextResponse) return routeCheck;
    const permission = await requirePermission(session, Permissions.VEHICLE_VIEW);
    if (permission instanceof NextResponse) return permission;

    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'Vehicle ID is invalid' }, { status: 400 });
    }

    const roleNames = await getSessionRoleNames(session);
    const access = resolveDashboardAccess('/dashboard/fleet', roleNames);
    const db = getDb();
    const [vehicle] = await db
      .select({ id: vehicles.id, currentOdometer: vehicles.currentOdometer })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.id, id),
          vehicleScopeCondition({
            tenantId: session.tenantId,
            userId: session.user.id,
            recordScope: access.recordScope ?? 'assigned',
          }),
        ),
      )
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
      .where(eq(vehicleOdometerEvents.vehicleId, vehicle.id))
      .orderBy(desc(vehicleOdometerEvents.createdAt))
      .limit(100);

    return NextResponse.json({ success: true, data: { currentOdometer: vehicle.currentOdometer, events: rows } });
  } catch (error) {
    console.error('[fleet/odometer] GET failed:', error);
    return NextResponse.json({ error: 'Could not load odometer history' }, { status: 500 });
  }
}
