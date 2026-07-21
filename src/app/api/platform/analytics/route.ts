/**
 * Cross-Tenant Platform Analytics API
 *
 * GET /api/platform/analytics
 * Returns aggregate stats across all tenants (requires PLATFORM_ADMIN)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tenants } from '@/db/schema/tenants';
import { vehicles } from '@/db/schema/fleet';
import { trips, fuelTransactions } from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { transportRequests } from '@/db/schema/requests';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, count, sql, and } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.PLATFORM_ADMIN);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    // Run all aggregate queries in parallel
    const [
      tenantResult,
      vehicleResult,
      tripResult,
      employeeResult,
      requestResult,
      fuelResult,
      activeTripResult,
    ] = await Promise.all([
      // Total tenants by status
      db
        .select({
          status: tenants.status,
          count: count(),
        })
        .from(tenants)
        .groupBy(tenants.status),

      // Total vehicles by status
      db
        .select({
          status: vehicles.status,
          count: count(),
        })
        .from(vehicles)
        .groupBy(vehicles.status),

      // Total trips by status
      db
        .select({
          status: trips.status,
          count: count(),
        })
        .from(trips)
        .groupBy(trips.status),

      // Total employees
      db
        .select({ count: count() })
        .from(employees),

      // Total transport requests by status
      db
        .select({
          status: transportRequests.status,
          count: count(),
        })
        .from(transportRequests)
        .groupBy(transportRequests.status),

      // Fuel total volume and cost
      db
        .select({
          totalLitres: sql<string>`COALESCE(SUM(litres), 0)`,
          totalAmount: sql<string>`COALESCE(SUM(amount), 0)`,
        })
        .from(fuelTransactions),

      // Active trips (started but not closed)
      db
        .select({ count: count() })
        .from(trips)
        .where(
          and(
            eq(trips.status, 'in_progress'),
          ),
        ),
    ]);

    // Compute summary from grouped results
    const totalTenants = tenantResult.reduce((sum, r) => sum + Number(r.count), 0);
    const activeTenants = tenantResult.find((r) => r.status === 'active')?.count ?? 0;
    const totalVehicles = vehicleResult.reduce((sum, r) => sum + Number(r.count), 0);
    const totalTrips = tripResult.reduce((sum, r) => sum + Number(r.count), 0);
    const totalActiveTrips = Number(activeTripResult[0]?.count ?? 0);
    const totalEmployees = Number(employeeResult[0]?.count ?? 0);
    const totalRequests = requestResult.reduce((sum, r) => sum + Number(r.count), 0);
    const totalFuelLitres = Number(fuelResult[0]?.totalLitres ?? 0);
    const totalFuelCost = Number(fuelResult[0]?.totalAmount ?? 0);

    // Per-tenant vehicle breakdown
    const perTenantVehicles = await db
      .select({
        tenantId: vehicles.tenantId,
        tenantName: tenants.name,
        vehicleCount: count(),
      })
      .from(vehicles)
      .innerJoin(tenants, eq(vehicles.tenantId, tenants.id))
      .groupBy(vehicles.tenantId, tenants.name)
      .orderBy(sql`count(*) DESC`);

    // Per-tenant active trip breakdown
    const perTenantActiveTrips = await db
      .select({
        tenantId: trips.tenantId,
        tenantName: tenants.name,
        activeTripCount: count(),
      })
      .from(trips)
      .innerJoin(tenants, eq(trips.tenantId, tenants.id))
      .where(eq(trips.status, 'in_progress'))
      .groupBy(trips.tenantId, tenants.name)
      .orderBy(sql`count(*) DESC`);

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalTenants: Number(totalTenants),
          activeTenants: Number(activeTenants),
          totalVehicles: Number(totalVehicles),
          totalTrips: Number(totalTrips),
          activeTrips: Number(totalActiveTrips),
          totalEmployees: Number(totalEmployees),
          totalRequests: Number(totalRequests),
          totalFuelLitres: Math.round(totalFuelLitres * 100) / 100,
          totalFuelCost: Math.round(totalFuelCost * 100) / 100,
        },
        tenantBreakdown: {
          vehicles: perTenantVehicles,
          activeTrips: perTenantActiveTrips,
        },
        tenantStatuses: tenantResult,
        vehicleStatuses: vehicleResult,
        tripStatuses: tripResult,
      },
    });
  } catch (error) {
    console.error('[Platform Analytics] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to load analytics: ' + String(error) },
      { status: 500 },
    );
  }
}
