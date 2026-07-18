/**
 * Platform Tenant Detail API
 *
 * GET   /api/platform/tenants/[id]  — Get tenant details (requires PLATFORM_ADMIN)
 * PATCH /api/platform/tenants/[id]  — Update tenant (requires TENANT_MANAGE)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tenants, tenantBranding, tenantMemberships } from '@/db/schema/tenants';
import { requireRequestAuth, requirePermission, requireAnyPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, count } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// GET — Tenant detail with branding and stats
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    // Require platform admin OR tenant manage permission
    const permCheck = await requireAnyPermission(session, [Permissions.PLATFORM_ADMIN, Permissions.TENANT_MANAGE]);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Get branding
    const [branding] = await db
      .select()
      .from(tenantBranding)
      .where(eq(tenantBranding.tenantId, id))
      .limit(1);

    // Count tenant members
    const [memberCountResult] = await db
      .select({ count: count() })
      .from(tenantMemberships)
      .where(eq(tenantMemberships.tenantId, id));
    const memberCount = memberCountResult?.count || 0;

    return NextResponse.json({
      success: true,
      data: {
        ...tenant,
        branding: branding || null,
        stats: {
          memberCount,
        },
      },
    });
  } catch (error) {
    console.error('[Platform Tenant Detail] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to load tenant: ' + String(error) },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH — Update tenant
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session as any, Permissions.TENANT_MANAGE as any);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const db = getDb();

    // Verify tenant exists
    const [existing] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Update tenant fields
    const tenantUpdate: Record<string, unknown> = {};
    if (body.name !== undefined) tenantUpdate.name = body.name;
    if (body.status !== undefined) tenantUpdate.status = body.status;
    if (body.timezone !== undefined) tenantUpdate.timezone = body.timezone;
    if (body.locale !== undefined) tenantUpdate.locale = body.locale;
    if (body.type !== undefined) tenantUpdate.type = body.type;
    if (body.metadata !== undefined) tenantUpdate.metadata = body.metadata;
    tenantUpdate.updatedAt = new Date();

    if (Object.keys(tenantUpdate).length > 1) {
      // More than just updatedAt
      await db
        .update(tenants)
        .set(tenantUpdate)
        .where(eq(tenants.id, id));
    }

    // Update branding fields
    const brandingFields = [
      'contactEmail', 'contactPhone', 'address',
      'primaryColor', 'accentColor',
      'logoUrl', 'logoDarkUrl',
      'documentFooter', 'senderName', 'senderEmail',
    ];

    const brandingUpdate: Record<string, unknown> = {};
    for (const field of brandingFields) {
      if (body[field] !== undefined) brandingUpdate[field] = body[field];
    }

    if (Object.keys(brandingUpdate).length > 0) {
      const [existingBranding] = await db
        .select()
        .from(tenantBranding)
        .where(eq(tenantBranding.tenantId, id))
        .limit(1);

      if (existingBranding) {
        brandingUpdate.updatedAt = new Date();
        await db
          .update(tenantBranding)
          .set(brandingUpdate)
          .where(eq(tenantBranding.tenantId, id));
      } else {
        await db
          .insert(tenantBranding)
          .values({ tenantId: id, ...brandingUpdate } as any);
      }
    }

    // Fetch the updated tenant
    const [updated] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Platform Tenant Detail] PATCH failed:', error);
    return NextResponse.json(
      { error: 'Failed to update tenant: ' + String(error) },
      { status: 500 },
    );
  }
}
