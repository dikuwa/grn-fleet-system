import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { regions } from '@/db/schema/fleet';
import { notifications } from '@/db/schema/notifications';
import { eq, and, ilike, or, ne, type SQL } from 'drizzle-orm';
import { requireRequestAuth, requirePermission, requireAnyPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';

function databaseCode(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const value = error as { code?: unknown; cause?: { code?: unknown } };
  return typeof value.code === 'string'
    ? value.code
    : typeof value.cause?.code === 'string'
      ? value.cause.code
      : null;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requireAnyPermission(session, [Permissions.TENANT_VIEW, Permissions.TENANT_MANAGE]);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const search = new URL(req.url).searchParams.get('search')?.trim();
    const conditions: SQL[] = [eq(regions.tenantId, session.tenantId)];
    if (search) {
      conditions.push(or(ilike(regions.name, `%${search}%`), ilike(regions.code, `%${search}%`))!);
    }

    const rows = await db.select().from(regions).where(and(...conditions)).orderBy(regions.sortOrder, regions.name);
    return NextResponse.json({ rows });
  } catch (error) {
    console.error('[regions] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch regions' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!name) return NextResponse.json({ error: 'Region name is required' }, { status: 400 });
    if (!code) return NextResponse.json({ error: 'Region code is required' }, { status: 400 });
    if (code.length > 10) return NextResponse.json({ error: 'Region code must be 10 characters or fewer' }, { status: 422 });

    const [existing] = await db.select({ id: regions.id }).from(regions).where(and(eq(regions.code, code), eq(regions.tenantId, session.tenantId))).limit(1);
    if (existing) return NextResponse.json({ error: `A region with code "${code}" already exists` }, { status: 409 });

    const [region] = await db.insert(regions).values({
      tenantId: session.tenantId,
      name,
      code,
      description: typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null,
      isActive: body.isActive !== false,
      sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    }).returning();

    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      eventType: 'region_created',
      action: 'create',
      entityType: 'region',
      entityId: region.id,
      after: { name: region.name, code: region.code, isActive: region.isActive },
      summary: `Region created: ${region.name} (${region.code})`,
    });
    await db.insert(notifications).values({
      tenantId: session.tenantId,
      recipientUserId: session.user.id,
      type: 'region_created',
      title: `Region Created — ${region.name}`,
      body: `Region "${region.name}" (${region.code}) was created.`,
      entityType: 'region',
      entityId: region.id,
      actionUrl: '/dashboard/admin/regions',
      priority: 'normal',
    });
    return NextResponse.json({ region }, { status: 201 });
  } catch (error) {
    console.error('[regions] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create region' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const body = await req.json();
    if (!body.id) return NextResponse.json({ error: 'Region ID is required' }, { status: 400 });

    const [existing] = await db.select().from(regions).where(and(eq(regions.id, body.id), eq(regions.tenantId, session.tenantId))).limit(1);
    if (!existing) return NextResponse.json({ error: 'Region not found' }, { status: 404 });

    const name = body.name === undefined ? undefined : typeof body.name === 'string' ? body.name.trim() : '';
    const code = body.code === undefined ? undefined : typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (name !== undefined && !name) return NextResponse.json({ error: 'Region name cannot be empty' }, { status: 422 });
    if (code !== undefined && (!code || code.length > 10)) return NextResponse.json({ error: 'Region code is required and must be 10 characters or fewer' }, { status: 422 });

    if (code && code !== existing.code) {
      const [duplicate] = await db.select({ id: regions.id }).from(regions).where(and(eq(regions.tenantId, session.tenantId), eq(regions.code, code), ne(regions.id, existing.id))).limit(1);
      if (duplicate) return NextResponse.json({ error: `A region with code "${code}" already exists` }, { status: 409 });
    }

    const [updated] = await db.update(regions).set({
      name,
      code,
      description: body.description !== undefined ? (typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null) : undefined,
      isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
      sortOrder: body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : undefined,
      updatedAt: new Date(),
    }).where(and(eq(regions.id, existing.id), eq(regions.tenantId, session.tenantId))).returning();

    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      eventType: 'region_updated',
      action: 'update',
      entityType: 'region',
      entityId: updated.id,
      before: { name: existing.name, code: existing.code, isActive: existing.isActive },
      after: { name: updated.name, code: updated.code, isActive: updated.isActive },
      summary: `Region updated: ${updated.name} (${updated.code})`,
    });
    return NextResponse.json({ region: updated });
  } catch (error) {
    console.error('[regions] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update region' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Region ID is required' }, { status: 400 });

    const [existing] = await db.select().from(regions).where(and(eq(regions.id, id), eq(regions.tenantId, session.tenantId))).limit(1);
    if (!existing) return NextResponse.json({ error: 'Region not found' }, { status: 404 });

    try {
      await db.delete(regions).where(and(eq(regions.id, id), eq(regions.tenantId, session.tenantId)));
    } catch (error) {
      if (databaseCode(error) === '23503') {
        return NextResponse.json(
          { error: 'This region is already referenced by tenant records or workflow configuration. Deactivate it instead so historical records remain valid.' },
          { status: 409 },
        );
      }
      throw error;
    }

    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      eventType: 'region_deleted',
      action: 'delete',
      entityType: 'region',
      entityId: null,
      before: { id: existing.id, name: existing.name, code: existing.code },
      summary: `Region deleted: ${existing.name} (${existing.code})`,
    });
    await db.insert(notifications).values({
      tenantId: session.tenantId,
      recipientUserId: session.user.id,
      type: 'region_deleted',
      title: 'Region Deleted',
      body: `Region "${existing.name}" (${existing.code}) was deleted.`,
      entityType: null,
      entityId: null,
      actionUrl: '/dashboard/admin/regions',
      priority: 'normal',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[regions] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to delete region' }, { status: 500 });
  }
}
