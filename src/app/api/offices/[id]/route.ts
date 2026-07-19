/**
 * Office Detail API
 *
 * PATCH /api/offices/[id]  — Update an office
 * DELETE /api/offices/[id] — Deactivate an office
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { offices } from '@/db/schema/people';
import { eq, and } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

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

    // Verify ownership
    const [existing] = await db
      .select()
      .from(offices)
      .where(and(eq(offices.id, id), eq(offices.tenantId, session.tenantId)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Office not found' }, { status: 404 });

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.code !== undefined) updateData.code = body.code;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.parentId !== undefined) updateData.parentId = body.parentId;
    if (body.address !== undefined) updateData.address = body.address;
    if (body.phone !== undefined) updateData.phone = body.phone;
    if (body.email !== undefined) updateData.email = body.email;
    updateData.updatedAt = new Date();

    const [updated] = await db
      .update(offices)
      .set(updateData)
      .where(eq(offices.id, id))
      .returning();

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Office Detail] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update office' }, { status: 500 });
  }
}

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

    // Verify ownership
    const [existing] = await db
      .select()
      .from(offices)
      .where(and(eq(offices.id, id), eq(offices.tenantId, session.tenantId)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Office not found' }, { status: 404 });

    await db
      .update(offices)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(offices.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Office Detail] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to deactivate office' }, { status: 500 });
  }
}
