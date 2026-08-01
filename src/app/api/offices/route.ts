/**
 * Offices API
 *
 * GET  /api/offices       — List offices for the tenant
 * POST /api/offices       — Create a new office
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { offices } from '@/db/schema/people';
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
    const allOffices = await db
      .select()
      .from(offices)
      .where(and(eq(offices.tenantId, session.tenantId), eq(offices.isActive, true)))
      .orderBy(asc(offices.name));

    return NextResponse.json({ success: true, data: allOffices });
  } catch (error) {
    console.error('[Offices] GET failed:', error);
    return NextResponse.json({ error: 'Failed to list offices' }, { status: 500 });
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
    const { name, code, type, parentId, address, phone, email } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Office name is required' }, { status: 400 });
    }

    const db = getDb();
    const [office] = await db
      .insert(offices)
      .values({
        tenantId: session.tenantId,
        name: name.trim(),
        code: code?.trim() || null,
        type: type || 'constituency_office',
        parentId: parentId || null,
        address: address || null,
        phone: phone || null,
        email: email || null,
      })
      .returning();

    return NextResponse.json({ success: true, data: office }, { status: 201 });
  } catch (error) {
    console.error('[Offices] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create office' }, { status: 500 });
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
    const { id, name, code, type, parentId, address, phone, email, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'Office ID is required' }, { status: 400 });
    }

    const db = getDb();
    const [existing] = await db
      .select({ id: offices.id, tenantId: offices.tenantId })
      .from(offices)
      .where(and(eq(offices.id, id), eq(offices.tenantId, session.tenantId)))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Office not found' }, { status: 404 });
    }

    const [updated] = await db
      .update(offices)
      .set({
        name: name !== undefined ? name?.trim() : undefined,
        code: code !== undefined ? code?.trim() || null : undefined,
        type: type !== undefined ? type : undefined,
        parentId: parentId !== undefined ? parentId || null : undefined,
        address: address !== undefined ? address || null : undefined,
        phone: phone !== undefined ? phone || null : undefined,
        email: email !== undefined ? email || null : undefined,
        isActive: isActive !== undefined ? isActive : undefined,
        updatedAt: new Date(),
      })
      .where(eq(offices.id, id))
      .returning();

    if (isActive !== undefined) {
      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.user.id,
        action: isActive ? 'office.restored' : 'office.archived',
        entityType: 'office',
        entityId: id,
        after: { isActive, name: updated?.name },
        summary: `${isActive ? 'Restored' : 'Archived'} office ${updated?.name ?? id}`,
      });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Offices] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update office' }, { status: 500 });
  }
}
