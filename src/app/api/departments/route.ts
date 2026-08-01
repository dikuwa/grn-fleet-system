/**
 * Departments API
 *
 * GET  /api/departments       — List departments for the tenant
 * POST /api/departments       — Create a new department
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { departments } from '@/db/schema/people';
import { eq, and, asc } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();
    const allDepts = await db
      .select()
      .from(departments)
      .where(and(eq(departments.tenantId, session.tenantId), eq(departments.isActive, true)))
      .orderBy(asc(departments.name));

    return NextResponse.json({ success: true, data: allDepts });
  } catch (error) {
    console.error('[Departments] GET failed:', error);
    return NextResponse.json({ error: 'Failed to list departments' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { name, code } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Department name is required' }, { status: 400 });
    }

    const db = getDb();
    const [dept] = await db
      .insert(departments)
      .values({
        tenantId: session.tenantId,
        name: name.trim(),
        code: code?.trim() || null,
      })
      .returning();

    return NextResponse.json({ success: true, data: dept }, { status: 201 });
  } catch (error) {
    console.error('[Departments] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create department' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { id, name, code, headEmployeeId, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'Department ID is required' }, { status: 400 });
    }

    const db = getDb();
    const [existing] = await db
      .select({ id: departments.id, tenantId: departments.tenantId })
      .from(departments)
      .where(and(eq(departments.id, id), eq(departments.tenantId, session.tenantId)))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Department not found' }, { status: 404 });
    }

    const [updated] = await db
      .update(departments)
      .set({
        name: name !== undefined ? name?.trim() : undefined,
        code: code !== undefined ? code?.trim() || null : undefined,
        headEmployeeId: headEmployeeId !== undefined ? headEmployeeId || null : undefined,
        isActive: isActive !== undefined ? isActive : undefined,
        updatedAt: new Date(),
      })
      .where(eq(departments.id, id))
      .returning();

    if (isActive !== undefined) {
      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.user.id,
        action: isActive ? 'department.restored' : 'department.archived',
        entityType: 'department',
        entityId: id,
        after: { isActive, name: updated?.name },
        summary: `${isActive ? 'Restored' : 'Archived'} department ${updated?.name ?? id}`,
      });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Departments] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update department' }, { status: 500 });
  }
}
