import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicles } from '@/db/schema/fleet';
import {
  getSessionRoleNames,
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { Permissions } from '@/lib/permissions';
import { generatePredictions } from '@/lib/predictive-maintenance';
import { vehicleScopeCondition } from '@/lib/record-scope';

/**
 * GET /api/fleet/predictive-maintenance
 *
 * Predictive maintenance must respect the active workspace's vehicle record
 * scope. Maintenance Officers have related vehicle access rather than a
 * tenant-wide fleet grant, so the API first resolves the vehicle IDs they may
 * see and only then asks the rules engine to score those vehicles.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    // VEHICLE_VIEW is shared by several operational workspaces. The predictive
    // maintenance screen is intentionally Maintenance-only, so direct API calls
    // must pass the same route matrix as the page itself before scope resolution.
    const routeCheck = await requireDashboardAction(
      session,
      '/dashboard/fleet/predictive-maintenance',
      'view',
    );
    if (routeCheck instanceof NextResponse) return routeCheck;

    const permCheck = await requirePermission(session, Permissions.VEHICLE_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const roleNames = await getSessionRoleNames(session);
    const access = resolveDashboardAccess('/dashboard/fleet/predictive-maintenance', roleNames);
    if (!access.allowed || !access.recordScope) {
      return NextResponse.json({ error: 'Predictive maintenance access is not available' }, { status: 403 });
    }

    const db = getDb();
    const visibleVehicles = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(
        vehicleScopeCondition({
          tenantId: session.tenantId,
          userId: session.user.id,
          recordScope: access.recordScope,
        }),
      );

    const result = await generatePredictions(
      session.tenantId,
      visibleVehicles.map((vehicle) => vehicle.id),
    );
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[predictive-maintenance] GET failed:', error);
    return NextResponse.json({ error: 'Failed to generate predictions' }, { status: 500 });
  }
}
