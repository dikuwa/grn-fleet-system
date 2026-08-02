import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { offices } from '@/db/schema/people';
import { eq, and, asc, sql, ne } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';
import { normaliseOrganisationCode, suggestOrganisationCode } from '@/lib/organisation-codes';

const OFFICE_TYPES = new Set(['head_office', 'regional_office', 'constituency_office', 'settlement_office', 'satellite_office', 'depot', 'workshop', 'other']);

async function validateParent(db: ReturnType<typeof getDb>, tenantId: string, parentId: string | null, currentId?: string) {
  if (!parentId) return null;
  if (parentId === currentId) return 'An office cannot be its own parent.';
  let cursor: string | null = parentId;
  const visited = new Set<string>();
  while (cursor) {
    if (visited.has(cursor) || cursor === currentId) return 'The selected parent would create a circular office hierarchy.';
    visited.add(cursor);
    const [parent] = await db.select({ parentId: offices.parentId }).from(offices)
      .where(and(eq(offices.id, cursor), eq(offices.tenantId, tenantId))).limit(1);
    if (!parent) return 'The selected parent office does not belong to this tenant.';
    cursor = parent.parentId;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true';
  const conditions = [eq(offices.tenantId, auth.session.tenantId)];
  if (!includeArchived) conditions.push(eq(offices.isActive, true));
  const data = await getDb().select().from(offices).where(and(...conditions)).orderBy(asc(offices.name));
  return NextResponse.json({ success: true, data });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const permission = await requirePermission(auth.session, Permissions.TENANT_MANAGE);
    if (permission instanceof NextResponse) return permission;
    const body = await request.json();
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: 'Office name is required.' }, { status: 400 });
    const type = body.type || 'constituency_office';
    if (!OFFICE_TYPES.has(type)) return NextResponse.json({ error: 'Unsupported office type.' }, { status: 400 });
    const code = normaliseOrganisationCode(body.code || suggestOrganisationCode(name, 'office'));
    if (!code) return NextResponse.json({ error: 'Office code is required.' }, { status: 400 });
    const db = getDb();
    const parentError = await validateParent(db, auth.session.tenantId, body.parentId || null);
    if (parentError) return NextResponse.json({ error: parentError }, { status: 400 });
    const [duplicate] = await db.select({ id: offices.id }).from(offices).where(and(
      eq(offices.tenantId, auth.session.tenantId), sql`upper(${offices.code}) = ${code}`,
    )).limit(1);
    if (duplicate) return NextResponse.json({ error: `Office code ${code} is already used in this tenant.` }, { status: 409 });
    const [office] = await db.insert(offices).values({
      tenantId: auth.session.tenantId, name, code, type, parentId: body.parentId || null,
      address: body.address?.trim() || null, town: body.town?.trim() || null,
      phone: body.phone?.trim() || null, email: body.email?.trim().toLowerCase() || null,
    }).returning();
    await recordAuditEvent({ tenantId: auth.session.tenantId, actorUserId: auth.session.user.id, action: 'office.created', entityType: 'office', entityId: office.id, after: office, summary: `Created office ${office.name}` });
    return NextResponse.json({ success: true, data: office }, { status: 201 });
  } catch (error) {
    console.error('[Offices] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create office.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const permission = await requirePermission(auth.session, Permissions.TENANT_MANAGE);
    if (permission instanceof NextResponse) return permission;
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'Office ID is required.' }, { status: 400 });
    const db = getDb();
    const [existing] = await db.select().from(offices).where(and(eq(offices.id, body.id), eq(offices.tenantId, auth.session.tenantId))).limit(1);
    if (!existing) return NextResponse.json({ error: 'Office not found.' }, { status: 404 });
    const parentId = body.parentId !== undefined ? body.parentId || null : existing.parentId;
    const parentError = await validateParent(db, auth.session.tenantId, parentId, existing.id);
    if (parentError) return NextResponse.json({ error: parentError }, { status: 400 });
    const type = body.type ?? existing.type;
    if (!OFFICE_TYPES.has(type)) return NextResponse.json({ error: 'Unsupported office type.' }, { status: 400 });
    const code = body.code !== undefined ? normaliseOrganisationCode(body.code) : existing.code;
    if (code) {
      const [duplicate] = await db.select({ id: offices.id }).from(offices).where(and(
        eq(offices.tenantId, auth.session.tenantId), ne(offices.id, existing.id), sql`upper(${offices.code}) = ${code}`,
      )).limit(1);
      if (duplicate) return NextResponse.json({ error: `Office code ${code} is already used in this tenant.` }, { status: 409 });
    }
    const isActive = body.isActive ?? existing.isActive;
    const [updated] = await db.update(offices).set({
      name: body.name !== undefined ? body.name.trim() : existing.name,
      code, type, parentId,
      address: body.address !== undefined ? body.address?.trim() || null : existing.address,
      town: body.town !== undefined ? body.town?.trim() || null : existing.town,
      phone: body.phone !== undefined ? body.phone?.trim() || null : existing.phone,
      email: body.email !== undefined ? body.email?.trim().toLowerCase() || null : existing.email,
      isActive,
      archivedAt: isActive ? null : existing.archivedAt ?? new Date(),
      updatedAt: new Date(),
    }).where(and(eq(offices.id, existing.id), eq(offices.tenantId, auth.session.tenantId))).returning();
    const action = body.isActive !== undefined && body.isActive !== existing.isActive
      ? (body.isActive ? 'office.restored' : 'office.archived') : 'office.edited';
    await recordAuditEvent({ tenantId: auth.session.tenantId, actorUserId: auth.session.user.id, action, entityType: 'office', entityId: updated.id, before: existing, after: updated, summary: `${action.split('.')[1]} office ${updated.name}` });
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Offices] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update office.' }, { status: 500 });
  }
}
