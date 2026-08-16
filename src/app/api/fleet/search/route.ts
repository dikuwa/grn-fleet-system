import { NextRequest, NextResponse } from 'next/server';
import { and, eq, ilike, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { vehicleCategories, vehicles } from '@/db/schema/fleet';
import {
  getSessionRoleNames,
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { Permissions } from '@/lib/permissions';
import { vehicleScopeCondition } from '@/lib/record-scope';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/**
 * Bounded vehicle lookup for shared searchable selectors.
 *
 * This intentionally keeps selector traffic separate from the general Fleet
 * list endpoint. The result set is always limited and uses the same active
 * workspace route/permission/record-scope boundary as Vehicle Lookup.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const routeCheck = await requireDashboardAction(session, '/dashboard/fleet', 'view');
    if (routeCheck instanceof NextResponse) return routeCheck;
    const permissionCheck = await requirePermission(session, Permissions.VEHICLE_VIEW);
    if (permissionCheck instanceof NextResponse) return permissionCheck;

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search')?.trim() || '';
    const status = searchParams.get('status')?.trim() || '';
    if (search.length < 2) {
      return NextResponse.json({ rows: [] }, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    const requestedLimit = Number(searchParams.get('limit') || DEFAULT_LIMIT);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

    const roleNames = await getSessionRoleNames(session);
    const access = resolveDashboardAccess('/dashboard/fleet', roleNames);
    if (!access.allowed || !access.recordScope) {
      return NextResponse.json({ error: 'Vehicle lookup is not available' }, { status: 403 });
    }

    const conditions = [
      vehicleScopeCondition({
        tenantId: session.tenantId,
        userId: session.user.id,
        recordScope: access.recordScope,
      }),
      or(
        ilike(vehicles.licenceNumber, `%${search}%`),
        ilike(vehicles.vehicleRegisterNumber, `%${search}%`),
        ilike(vehicles.vin, `%${search}%`),
        ilike(vehicles.engineNumber, `%${search}%`),
        ilike(vehicles.make, `%${search}%`),
        ilike(vehicles.model, `%${search}%`),
      )!,
    ];
    if (status) conditions.push(eq(vehicles.status, status));

    const rows = await getDb()
      .select({
        id: vehicles.id,
        licenceNumber: vehicles.licenceNumber,
        vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
        make: vehicles.make,
        model: vehicles.model,
        currentOdometer: vehicles.currentOdometer,
        status: vehicles.status,
        fuelType: vehicles.fuelType,
        categoryName: vehicleCategories.name,
      })
      .from(vehicles)
      .leftJoin(
        vehicleCategories,
        and(
          eq(vehicles.categoryId, vehicleCategories.id),
          eq(vehicleCategories.tenantId, session.tenantId),
        ),
      )
      .where(and(...conditions))
      .orderBy(vehicles.licenceNumber)
      .limit(limit);

    return NextResponse.json(
      { rows },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('[fleet/search] GET failed:', error);
    return NextResponse.json({ error: 'Unable to search vehicles' }, { status: 500 });
  }
}
