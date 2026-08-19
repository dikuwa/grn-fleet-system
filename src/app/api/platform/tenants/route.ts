/**
 * Platform Tenant Administration API
 *
 * GET  /api/platform/tenants — List all tenants.
 * POST /api/platform/tenants — Retired. Tenant creation must use the full
 * Platform onboarding flow so subscription, roles, invitation, operational
 * defaults and lifecycle controls are provisioned consistently.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tenants, tenantBranding, tenantMemberships } from '@/db/schema/tenants';
import { requireRequestAuth, requirePermission, requireAnyPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, desc, count, or, ilike, and } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// GET — List all tenants
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requireAnyPermission(session, [
      Permissions.PLATFORM_ADMIN,
      Permissions.TENANT_VIEW,
    ]);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const status = searchParams.get('status') || '';
    const lifecycle = searchParams.get('lifecycle') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '25', 10);
    const offset = (page - 1) * limit;

    const db = getDb();

    const conditions: ReturnType<typeof and>[] = [];
    if (q) {
      conditions.push(
        or(
          ilike(tenants.name, `%${q}%`),
          ilike(tenants.code, `%${q}%`),
          ilike(tenants.slug, `%${q}%`),
        )!,
      );
    }
    if (status) {
      conditions.push(eq(tenants.status, status.toUpperCase()));
    }
    if (lifecycle) {
      conditions.push(eq(tenants.lifecycleStatus, lifecycle.toUpperCase()));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db
      .select({ count: count() })
      .from(tenants)
      .where(whereClause);

    const total = totalResult?.count || 0;

    const rows = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        code: tenants.code,
        slug: tenants.slug,
        type: tenants.type,
        status: tenants.status,
        lifecycleStatus: tenants.lifecycleStatus,
        timezone: tenants.timezone,
        createdAt: tenants.createdAt,
        updatedAt: tenants.updatedAt,
        contactEmail: tenantBranding.contactEmail,
        contactPhone: tenantBranding.contactPhone,
      })
      .from(tenants)
      .leftJoin(tenantBranding, eq(tenants.id, tenantBranding.tenantId))
      .where(whereClause)
      .orderBy(desc(tenants.createdAt))
      .limit(limit)
      .offset(offset);

    const memberCounts = await db
      .select({
        tenantId: tenantMemberships.tenantId,
        count: count(),
      })
      .from(tenantMemberships)
      .groupBy(tenantMemberships.tenantId);

    const memberCountMap = new Map(
      memberCounts.map((membership) => [membership.tenantId, membership.count]),
    );

    const enriched = rows.map((tenant) => ({
      ...tenant,
      memberCount: memberCountMap.get(tenant.id) || 0,
    }));

    return NextResponse.json({
      success: true,
      data: {
        tenants: enriched,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[Platform Tenants] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to list tenants: ' + String(error) },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST — Retired direct creation path
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.PLATFORM_ADMIN);
    if (permCheck instanceof NextResponse) return permCheck;

    return NextResponse.json(
      {
        error:
          'Direct tenant creation has been retired. Use the Platform tenant onboarding workflow so the organisation receives its subscription, roles, administrator invitation, operational defaults and lifecycle controls.',
        code: 'TENANT_ONBOARDING_REQUIRED',
        onboardingPath: '/dashboard/platform/onboard',
      },
      { status: 410 },
    );
  } catch (error) {
    console.error('[Platform Tenants] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to route tenant creation: ' + String(error) },
      { status: 500 },
    );
  }
}
