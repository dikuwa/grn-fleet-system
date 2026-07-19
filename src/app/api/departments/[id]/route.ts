/**
 * Department Detail API
 *
 * PATCH /api/departments/[id]  — Update a department
 * DELETE /api/departments/[id] — Deactivate a department
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { departments } from '@/db/schema/people';
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

    const [existing] = await db
      .select()
      .from(departments)
      .where(and(eq(departments.id, id), eq(departments.tenantId, session.tenantId)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Department not found' }, { status: 404 });

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.code !== undefined) updateData.code = body.code;

    const [updated] = await db
      .update(departments)
      .set(updateData)
      .where(eq(departments.id, id))
      .returning();

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Department Detail] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update department' }, { status: 500 });
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

    const [existing] = await db
      .select()
      .from(departments)
      .where(and(eq(departments.id, id), eq(departments.tenantId, session.tenantId)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Department not found' }, { status: 404 });

    await db
      .update(departments)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(departments.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Department Detail] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to deactivate department' }, { status: 500 });
  }
}
