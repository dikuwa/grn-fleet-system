import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { regions, Region } from '@/db/schema/fleet';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, asc, and } from 'drizzle-orm';

/**
 * GET /api/admin/regions — List regions for the current tenant
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('includeInactive') === 'true';

    const db = getDb();
    const conditions = [eq(regions.tenantId, session.tenantId)];
    if (!includeInactive) {
      conditions.push(eq(regions.isActive, true));
    }

    const rows = await db
      .select()
      .from(regions)
      .where(and(...conditions))
      .orderBy(asc(regions.sortOrder), asc(regions.name));

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error('[admin/regions] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load regions' }, { status: 500 });
  }
}

/**
 * POST /api/admin/regions — Create a new region
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { name, code, description, sortOrder } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Region name is required' }, { status: 400 });
    }
    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      return NextResponse.json({ error: 'Region code is required' }, { status: 400 });
    }

    const db = getDb();

    // Check for duplicate code within this tenant
    const [existing] = await db
      .select({ id: regions.id })
      .from(regions)
      .where(and(eq(regions.tenantId, session.tenantId), eq(regions.code, code.trim().toUpperCase())))
      .limit(1);

    if (existing) {
      return NextResponse.json({ error: 'A region with this code already exists' }, { status: 409 });
    }

    const [region] = await db
      .insert(regions)
      .values({
        tenantId: session.tenantId,
        name: name.trim(),
        code: code.trim().toUpperCase(),
        description: description?.trim() || null,
        sortOrder: sortOrder != null ? Number(sortOrder) : 0,
      })
      .returning();

    return NextResponse.json({ success: true, data: region }, { status: 201 });
  } catch (error) {
    console.error('[admin/regions] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create region' }, { status: 500 });
  }
}
