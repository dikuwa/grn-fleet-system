import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { regions } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { eq, and, like, or, type SQL } from 'drizzle-orm';
import { requireRequestAuth } from '@/lib/auth-helpers';

/**
 * GET /api/regions
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search')?.trim();

    const conditions: SQL[] = [eq(regions.tenantId, session.tenantId)];

    if (search) {
      conditions.push(
        or(
          like(regions.name, `%${search}%`),
          like(regions.code, `%${search}%`),
        )!,
      );
    }

    const rows = await db
      .select()
      .from(regions)
      .where(and(...conditions))
      .orderBy(regions.sortOrder, regions.name);

    return NextResponse.json({ rows });
  } catch (error) {
    console.error('[regions] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch regions' }, { status: 500 });
  }
}

/**
 * POST /api/regions
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();
    const body = await req.json();

    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'Region name is required' }, { status: 400 });
    }
    if (!body.code?.trim()) {
      return NextResponse.json({ error: 'Region code is required' }, { status: 400 });
    }

    // Check for duplicate code within tenant
    const [existing] = await db
      .select({ id: regions.id })
      .from(regions)
      .where(
        and(
          eq(regions.code, body.code.trim()),
          eq(regions.tenantId, session.tenantId),
        ),
      )
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: `A region with code "${body.code}" already exists` },
        { status: 409 },
      );
    }

    const [region] = await db
      .insert(regions)
      .values({
        tenantId: session.tenantId,
        name: body.name.trim(),
        code: body.code.trim(),
        description: body.description?.trim() || null,
        isActive: body.isActive !== false,
        sortOrder: body.sortOrder ?? 0,
      })
      .returning();

    // Audit log
    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: 0,
      eventType: 'region_created',
      actorUserId: session.user.id,
      action: 'create',
      entityType: 'region',
      entityId: region.id,
      summary: `Region created: ${region.name} (${region.code})`,
      sourceChannel: 'web',
    });

    return NextResponse.json({ region }, { status: 201 });
  } catch (error) {
    console.error('[regions] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create region' }, { status: 500 });
  }
}

/**
 * PATCH /api/regions
 */
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();
    const body = await req.json();

    if (!body.id) {
      return NextResponse.json({ error: 'Region ID is required' }, { status: 400 });
    }

    const [existing] = await db
      .select({ id: regions.id, tenantId: regions.tenantId })
      .from(regions)
      .where(eq(regions.id, body.id))
      .limit(1);

    if (!existing || existing.tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Region not found' }, { status: 404 });
    }

    const [updated] = await db
      .update(regions)
      .set({
        name: body.name?.trim() ?? undefined,
        code: body.code?.trim() ?? undefined,
        description: body.description !== undefined ? (body.description?.trim() || null) : undefined,
        isActive: body.isActive ?? undefined,
        sortOrder: body.sortOrder ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(regions.id, body.id))
      .returning();

    // Audit log
    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: 0,
      eventType: 'region_updated',
      actorUserId: session.user.id,
      action: 'update',
      entityType: 'region',
      entityId: updated.id,
      summary: `Region updated: ${updated.name} (${updated.code})`,
      sourceChannel: 'web',
    });

    return NextResponse.json({ region: updated });
  } catch (error) {
    console.error('[regions] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update region' }, { status: 500 });
  }
}

/**
 * DELETE /api/regions?id=xxx
 */
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();
    const id = new URL(req.url).searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Region ID is required' }, { status: 400 });
    }

    const [existing] = await db
      .select({ id: regions.id, tenantId: regions.tenantId })
      .from(regions)
      .where(eq(regions.id, id))
      .limit(1);

    if (!existing || existing.tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Region not found' }, { status: 404 });
    }

    // Audit log before deletion
    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: 0,
      eventType: 'region_deleted',
      actorUserId: session.user.id,
      action: 'delete',
      entityType: 'region',
      entityId: id,
      summary: `Region deleted (ID: ${id})`,
      sourceChannel: 'web',
    });

    await db.delete(regions).where(eq(regions.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[regions] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to delete region' }, { status: 500 });
  }
}
