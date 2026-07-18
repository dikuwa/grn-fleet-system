/**
 * Platform Tenant Administration API
 *
 * GET  /api/platform/tenants  — List all tenants (requires PLATFORM_ADMIN)
 * POST /api/platform/tenants — Create a new tenant (requires TENANT_MANAGE)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tenants, tenantBranding, tenantMemberships } from '@/db/schema/tenants';
import { requireRequestAuth, requirePermission, requireAnyPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, desc, count, or, like, and } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// GET — List all tenants
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;    // Require platform admin OR tenant manage permission
    const permCheck = await requireAnyPermission(session, [Permissions.PLATFORM_ADMIN, Permissions.TENANT_MANAGE]);
    if (permCheck instanceof NextResponse) return permCheck;


    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const status = searchParams.get('status') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '25', 10);
    const offset = (page - 1) * limit;

    const db = getDb();

    // Build filters
    const conditions: ReturnType<typeof and>[] = [];
    if (q) {
      conditions.push(
        or(
          like(tenants.name, `%${q}%`),
          like(tenants.code, `%${q}%`),
          like(tenants.slug, `%${q}%`),
        )!,
      );
    }
    if (status) {
      conditions.push(eq(tenants.status, status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [totalResult] = await db
      .select({ count: count() })
      .from(tenants)
      .where(whereClause);

    const total = totalResult?.count || 0;

    // Fetch tenants with branding info
    const rows = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        code: tenants.code,
        slug: tenants.slug,
        type: tenants.type,
        status: tenants.status,
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

    // Get member counts per tenant
    const memberCounts = await db
      .select({
        tenantId: tenantMemberships.tenantId,
        count: count(),
      })
      .from(tenantMemberships)
      .groupBy(tenantMemberships.tenantId);

    const memberCountMap = new Map(
      memberCounts.map((m) => [m.tenantId, m.count]),
    );

    const enriched = rows.map((t) => ({
      ...t,
      memberCount: memberCountMap.get(t.id) || 0,
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
// POST — Create a new tenant
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { name, code, slug, type, timezone, locale } = body;

    // Validate required fields
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Tenant name is required' }, { status: 400 });
    }
    if (!code?.trim()) {
      return NextResponse.json({ error: 'Tenant code is required' }, { status: 400 });
    }
    if (!slug?.trim()) {
      return NextResponse.json({ error: 'Tenant slug is required' }, { status: 400 });
    }

    const db = getDb();

    // Check for duplicate code or slug
    const [existing] = await db
      .select()
      .from(tenants)
      .where(
        or(
          eq(tenants.code, code.trim().toUpperCase()),
          eq(tenants.slug, slug.trim().toLowerCase()),
        )!,
      )
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: `A tenant with code "${code}" or slug "${slug}" already exists` },
        { status: 409 },
      );
    }

    const [tenant] = await db
      .insert(tenants)
      .values({
        name: name.trim(),
        code: code.trim().toUpperCase(),
        slug: slug.trim().toLowerCase(),
        type: type || 'regional_council',
        status: 'active',
        timezone: timezone || 'Africa/Windhoek',
        locale: locale || 'en-NA',
      })
      .returning();

    // Create default branding config
    await db.insert(tenantBranding).values({
      tenantId: tenant.id,
      primaryColor: '#1F4E8C',
      accentColor: '#0F766E',
    });

    return NextResponse.json({ success: true, data: tenant }, { status: 201 });
  } catch (error) {
    console.error('[Platform Tenants] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to create tenant: ' + String(error) },
      { status: 500 },
    );
  }
}

