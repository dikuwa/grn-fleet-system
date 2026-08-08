import { NextRequest, NextResponse } from 'next/server';
import { count, desc, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { tenants, tenantMemberships } from '@/db/schema/tenants';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { trips } from '@/db/schema/trips';
import { demoRequests } from '@/db/schema/demo-requests';
import { cmsEnquiries } from '@/db/schema/cms-content';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requirePermission(session, Permissions.PLATFORM_ADMIN);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const [tenantRows, memberRows, vehicleRows, requestRows, tripRows, demoRows, enquiryRows, recentTenants] = await Promise.all([
      db.select({
        total: count(),
        active: sql<number>`count(*) filter (where upper(${tenants.status}) = 'ACTIVE')`,
        suspended: sql<number>`count(*) filter (where upper(${tenants.status}) = 'SUSPENDED')`,
        trial: sql<number>`count(*) filter (where upper(${tenants.status}) = 'TRIAL')`,
      }).from(tenants),
      db.select({ total: count() }).from(tenantMemberships),
      db.select({
        total: count(),
        available: sql<number>`count(*) filter (where ${vehicles.status} = 'available')`,
        maintenance: sql<number>`count(*) filter (where ${vehicles.status} = 'maintenance')`,
      }).from(vehicles),
      db.select({ total: count() }).from(transportRequests),
      db.select({ total: count(), active: sql<number>`count(*) filter (where ${trips.status} in ('pending', 'in_progress'))` }).from(trips),
      db.select({
        total: count(),
        new: sql<number>`count(*) filter (where ${demoRequests.status} = 'new')`,
        qualified: sql<number>`count(*) filter (where ${demoRequests.status} = 'qualified')`,
        scheduled: sql<number>`count(*) filter (where ${demoRequests.status} = 'scheduled')`,
      }).from(demoRequests),
      db.select({
        total: count(),
        new: sql<number>`count(*) filter (where ${cmsEnquiries.status} = 'new')`,
        inProgress: sql<number>`count(*) filter (where ${cmsEnquiries.status} = 'in_progress')`,
      }).from(cmsEnquiries),
      db.select({ id: tenants.id, name: tenants.name, code: tenants.code, type: tenants.type, status: tenants.status, lifecycleStatus: tenants.lifecycleStatus, createdAt: tenants.createdAt }).from(tenants).orderBy(desc(tenants.createdAt)).limit(6),
    ]);

    const tenantStats = tenantRows[0];
    const vehiclesStats = vehicleRows[0];
    const demos = demoRows[0];
    const enquiries = enquiryRows[0];

    return NextResponse.json({
      success: true,
      data: {
        tenants: { total: Number(tenantStats?.total ?? 0), active: Number(tenantStats?.active ?? 0), suspended: Number(tenantStats?.suspended ?? 0), trial: Number(tenantStats?.trial ?? 0) },
        totalMembers: Number(memberRows[0]?.total ?? 0),
        vehicles: { total: Number(vehiclesStats?.total ?? 0), available: Number(vehiclesStats?.available ?? 0), maintenance: Number(vehiclesStats?.maintenance ?? 0) },
        requests: { total: Number(requestRows[0]?.total ?? 0) },
        trips: { total: Number(tripRows[0]?.total ?? 0), active: Number(tripRows[0]?.active ?? 0) },
        intake: {
          demos: { total: Number(demos?.total ?? 0), new: Number(demos?.new ?? 0), qualified: Number(demos?.qualified ?? 0), scheduled: Number(demos?.scheduled ?? 0) },
          enquiries: { total: Number(enquiries?.total ?? 0), new: Number(enquiries?.new ?? 0), inProgress: Number(enquiries?.inProgress ?? 0) },
        },
        recentTenants,
        envHealth: {
          database: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL),
          backgroundJobs: Boolean(process.env.INNGEST_EVENT_KEY),
          errorMonitoring: Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN),
          email: Boolean(process.env.RESEND_API_KEY || process.env.EMAIL_FROM),
        },
      },
    });
  } catch (error) {
    console.error('[Platform Dashboard] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load platform dashboard: ' + String(error) }, { status: 500 });
  }
}
