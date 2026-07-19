import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tenants, tenantMemberships } from '@/db/schema/tenants';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { trips } from '@/db/schema/trips';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { count, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

/**
 * GET /api/platform/dashboard
 *
 * Platform-wide dashboard metrics. Requires PLATFORM_ADMIN permission.
 * Returns aggregate stats across all tenants and server-side env health.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.PLATFORM_ADMIN);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    // Get tenant counts
    const [tenantStats] = await db
      .select({
        total: count(),
        active: sql<number>`COUNT(*) FILTER (WHERE ${tenants.status} = 'active')`,
        suspended: sql<number>`COUNT(*) FILTER (WHERE ${tenants.status} = 'suspended')`,
        inactive: sql<number>`COUNT(*) FILTER (WHERE ${tenants.status} = 'inactive')`,
      })
      .from(tenants);

    // Total members across all tenants
    const [memberStats] = await db
      .select({ totalMembers: count() })
      .from(tenantMemberships);

    // Total vehicles across all tenants
    const [vehicleStats] = await db
      .select({
        total: count(),
        active: sql<number>`COUNT(*) FILTER (WHERE ${vehicles.status} = 'available')`,
        maintenance: sql<number>`COUNT(*) FILTER (WHERE ${vehicles.status} = 'maintenance')`,
      })
      .from(vehicles);

    // Total requests
    const [requestStats] = await db
      .select({ totalRequests: count() })
      .from(transportRequests);

    // Active trips
    const [tripStats] = await db
      .select({
        total: count(),
        active: sql<number>`COUNT(*) FILTER (WHERE ${trips.status} IN ('pending', 'in_progress'))`,
      })
      .from(trips);

    // Recent tenants (last 10 created)
    const recentTenants = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        code: tenants.code,
        type: tenants.type,
        status: tenants.status,
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .orderBy(desc(tenants.createdAt))
      .limit(10);

    // Environment health (server-side, safe to check)
    const envHealth = {
      database: !!(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL),
      backgroundJobs: !!process.env.INNGEST_EVENT_KEY,
      errorMonitoring: !!process.env.SENTRY_DSN || !!process.env.NEXT_PUBLIC_SENTRY_DSN,
      email: !!process.env.RESEND_API_KEY || !!process.env.EMAIL_FROM,
    };

    return NextResponse.json({
      success: true,
      data: {
        tenants: {
          total: tenantStats?.total || 0,
          active: tenantStats?.active || 0,
          suspended: tenantStats?.suspended || 0,
          inactive: tenantStats?.inactive || 0,
        },
        totalMembers: memberStats?.totalMembers || 0,
        vehicles: {
          total: vehicleStats?.total || 0,
          active: vehicleStats?.active || 0,
          maintenance: vehicleStats?.maintenance || 0,
        },
        requests: {
          totalRequests: requestStats?.totalRequests || 0,
        },
        trips: {
          total: tripStats?.total || 0,
          active: tripStats?.active || 0,
        },
        recentTenants,
        envHealth,
      },
    });
  } catch (error) {
    console.error('[Platform Dashboard] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to load platform dashboard: ' + String(error) },
      { status: 500 },
    );
  }
}
