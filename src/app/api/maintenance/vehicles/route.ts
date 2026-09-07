import { NextRequest, NextResponse } from 'next/server';
import { and, eq, ilike, or, type SQL } from 'drizzle-orm';
import { getDb } from '@/db';
import { vehicleCategories, vehicles } from '@/db/schema/fleet';
import {
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/**
 * GET /api/maintenance/vehicles
 *
 * Maintenance-only vehicle lookup. Recording scheduled maintenance is a
 * tenant-fleet responsibility and must not depend on a pre-existing trip,
 * inspection, defect, or maintenance relationship. Keep this separate from
 * the general Fleet lookup so other workspaces retain their narrower record
 * scopes.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const roleCheck = await requireDashboardAction(session, '/dashboard/maintenance/new', 'view');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const permCheck = await requirePermission(session, Permissions.MAINTENANCE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id')?.trim();
    const search = searchParams.get('search')?.trim();
    const requestedLimit = Number(searchParams.get('limit') || DEFAULT_LIMIT);
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const conditions: SQL[] = [
      eq(vehicles.tenantId, session.tenantId),
      eq(vehicles.isActive, true),
    ];
    if (id) conditions.push(eq(vehicles.id, id));
    if (search) {
      conditions.push(
        or(
          ilike(vehicles.licenceNumber, `%${search}%`),
          ilike(vehicles.vehicleRegisterNumber, `%${search}%`),
          ilike(vehicles.make, `%${search}%`),
          ilike(vehicles.model, `%${search}%`),
        )!,
      );
    }

    const db = getDb();
    const rows = await db
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
      .limit(id ? 1 : limit);

    return NextResponse.json({ rows });
  } catch (error) {
    console.error('[maintenance/vehicles] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch maintenance vehicles' }, { status: 500 });
  }
}
