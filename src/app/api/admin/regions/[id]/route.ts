import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { regions } from '@/db/schema/fleet';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, ne } from 'drizzle-orm';

/**
 * PATCH /api/admin/regions/[id] — Update a region
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const db = getDb();

    // Verify region exists and belongs to tenant
    const [existing] = await db
      .select({ id: regions.id })
      .from(regions)
      .where(and(eq(regions.id, id), eq(regions.tenantId, session.tenantId)))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Region not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        return NextResponse.json({ error: 'Region name cannot be empty' }, { status: 400 });
      }
      updateData.name = body.name.trim();
    }
    if (body.code !== undefined) {
      const code = body.code.trim().toUpperCase();
      // Check for duplicate code within tenant (excluding this region)
      const [duplicate] = await db
        .select({ id: regions.id, name: regions.name })
        .from(regions)
        .where(and(eq(regions.tenantId, session.tenantId), eq(regions.code, code), ne(regions.id, id)))
        .limit(1);
      if (duplicate) {
        return NextResponse.json({ error: 'A region with this code already exists' }, { status: 409 });
      }
      updateData.code = code;
    }
    if (body.description !== undefined) {
      updateData.description = body.description?.trim() || null;
    }
    if (body.isActive !== undefined) {
      updateData.isActive = Boolean(body.isActive);
    }
    if (body.sortOrder !== undefined) {
      updateData.sortOrder = Number(body.sortOrder);
    }

    updateData.updatedAt = new Date();

    const [updated] = await db
      .update(regions)
      .set(updateData)
      .where(eq(regions.id, id))
      .returning();

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[admin/regions/id] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update region' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/regions/[id] — Delete a region
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    // Verify region exists and belongs to tenant
    const [existing] = await db
      .select({ id: regions.id })
      .from(regions)
      .where(and(eq(regions.id, id), eq(regions.tenantId, session.tenantId)))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Region not found' }, { status: 404 });
    }

    await db.delete(regions).where(eq(regions.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[admin/regions/id] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to delete region' }, { status: 500 });
  }
}
