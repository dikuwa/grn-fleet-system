import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { departmentOffices, departments, employees, offices } from '@/db/schema';
import { eq, and, asc, sql, ne } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';
import { normaliseOrganisationCode, suggestOrganisationCode } from '@/lib/organisation-codes';

const UNIT_TYPES = new Set(['directorate', 'department', 'unit']);

async function validateReferences(db: ReturnType<typeof getDb>, tenantId: string, body: Record<string, unknown>, currentId?: string) {
  const parentId = typeof body.parentId === 'string' && body.parentId ? body.parentId : null;
  if (parentId === currentId) return 'An organisation unit cannot be its own parent.';
  let cursor = parentId;
  const visited = new Set<string>();
  while (cursor) {
    if (visited.has(cursor) || cursor === currentId) return 'The selected parent would create a circular organisation hierarchy.';
    visited.add(cursor);
    const [parent] = await db.select({ parentId: departments.parentId }).from(departments).where(and(eq(departments.id, cursor), eq(departments.tenantId, tenantId))).limit(1);
    if (!parent) return 'The selected parent unit does not belong to this tenant.';
    cursor = parent.parentId;
  }
  const officeIds = Array.isArray(body.officeIds) ? body.officeIds.filter((id): id is string => typeof id === 'string') : [];
  for (const officeId of officeIds) {
    const [office] = await db.select({ id: offices.id }).from(offices).where(and(eq(offices.id, officeId), eq(offices.tenantId, tenantId), eq(offices.isActive, true))).limit(1);
    if (!office) return 'One or more selected offices do not belong to this tenant.';
  }
  if (typeof body.headEmployeeId === 'string' && body.headEmployeeId) {
    const [head] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, body.headEmployeeId), eq(employees.tenantId, tenantId))).limit(1);
    if (!head) return 'The selected unit head does not belong to this tenant.';
  }
  return null;
}

export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true';
  const conditions = [eq(departments.tenantId, auth.session.tenantId)];
  if (!includeArchived) conditions.push(eq(departments.isActive, true));
  const data = await getDb().select().from(departments).where(and(...conditions)).orderBy(asc(departments.name));
  return NextResponse.json({ success: true, data });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const permission = await requirePermission(auth.session, Permissions.TENANT_MANAGE);
    if (permission instanceof NextResponse) return permission;
    const body = await request.json() as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'Organisation unit name is required.' }, { status: 400 });
    const type = typeof body.type === 'string' ? body.type : 'department';
    if (!UNIT_TYPES.has(type)) return NextResponse.json({ error: 'Unsupported organisation unit type.' }, { status: 400 });
    const code = normaliseOrganisationCode(typeof body.code === 'string' && body.code ? body.code : suggestOrganisationCode(name, 'department'));
    const db = getDb();
    const referenceError = await validateReferences(db, auth.session.tenantId, body);
    if (referenceError) return NextResponse.json({ error: referenceError }, { status: 400 });
    const [duplicate] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.tenantId, auth.session.tenantId), sql`upper(${departments.code}) = ${code}`)).limit(1);
    if (duplicate) return NextResponse.json({ error: `Organisation unit code ${code} is already used in this tenant.` }, { status: 409 });
    const officeIds = Array.isArray(body.officeIds) ? body.officeIds.filter((id): id is string => typeof id === 'string') : [];
    const department = await db.transaction(async (tx) => {
      const [created] = await tx.insert(departments).values({
        tenantId: auth.session.tenantId, name, code, type,
        parentId: typeof body.parentId === 'string' && body.parentId ? body.parentId : null,
        headEmployeeId: typeof body.headEmployeeId === 'string' && body.headEmployeeId ? body.headEmployeeId : null,
      }).returning();
      if (officeIds.length) await tx.insert(departmentOffices).values(officeIds.map((officeId) => ({ tenantId: auth.session.tenantId, departmentId: created.id, officeId })));
      return created;
    });
    await recordAuditEvent({ tenantId: auth.session.tenantId, actorUserId: auth.session.user.id, action: 'department.created', entityType: 'department', entityId: department.id, after: { ...department, officeIds }, summary: `Created ${type} ${department.name}` });
    return NextResponse.json({ success: true, data: department }, { status: 201 });
  } catch (error) {
    console.error('[Departments] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create organisation unit.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const permission = await requirePermission(auth.session, Permissions.TENANT_MANAGE);
    if (permission instanceof NextResponse) return permission;
    const body = await request.json() as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return NextResponse.json({ error: 'Organisation unit ID is required.' }, { status: 400 });
    const db = getDb();
    const [existing] = await db.select().from(departments).where(and(eq(departments.id, id), eq(departments.tenantId, auth.session.tenantId))).limit(1);
    if (!existing) return NextResponse.json({ error: 'Organisation unit not found.' }, { status: 404 });
    const merged = { ...body, parentId: body.parentId !== undefined ? body.parentId : existing.parentId, headEmployeeId: body.headEmployeeId !== undefined ? body.headEmployeeId : existing.headEmployeeId };
    const referenceError = await validateReferences(db, auth.session.tenantId, merged, id);
    if (referenceError) return NextResponse.json({ error: referenceError }, { status: 400 });
    const type = typeof body.type === 'string' ? body.type : existing.type;
    if (!UNIT_TYPES.has(type)) return NextResponse.json({ error: 'Unsupported organisation unit type.' }, { status: 400 });
    const code = body.code !== undefined ? normaliseOrganisationCode(String(body.code)) : existing.code;
    if (code) {
      const [duplicate] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.tenantId, auth.session.tenantId), ne(departments.id, id), sql`upper(${departments.code}) = ${code}`)).limit(1);
      if (duplicate) return NextResponse.json({ error: `Organisation unit code ${code} is already used in this tenant.` }, { status: 409 });
    }
    const officeIds = Array.isArray(body.officeIds) ? body.officeIds.filter((officeId): officeId is string => typeof officeId === 'string') : null;
    const updated = await db.transaction(async (tx) => {
      const isActive = typeof body.isActive === 'boolean' ? body.isActive : existing.isActive;
      const [record] = await tx.update(departments).set({
        name: typeof body.name === 'string' ? body.name.trim() : existing.name,
        code, type,
        parentId: body.parentId !== undefined ? (typeof body.parentId === 'string' && body.parentId ? body.parentId : null) : existing.parentId,
        headEmployeeId: body.headEmployeeId !== undefined ? (typeof body.headEmployeeId === 'string' && body.headEmployeeId ? body.headEmployeeId : null) : existing.headEmployeeId,
        isActive, archivedAt: isActive ? null : existing.archivedAt ?? new Date(), updatedAt: new Date(),
      }).where(and(eq(departments.id, id), eq(departments.tenantId, auth.session.tenantId))).returning();
      if (officeIds) {
        await tx.delete(departmentOffices).where(and(eq(departmentOffices.tenantId, auth.session.tenantId), eq(departmentOffices.departmentId, id)));
        if (officeIds.length) await tx.insert(departmentOffices).values(officeIds.map((officeId) => ({ tenantId: auth.session.tenantId, departmentId: id, officeId })));
      }
      return record;
    });
    const action = typeof body.isActive === 'boolean' && body.isActive !== existing.isActive ? (body.isActive ? 'department.restored' : 'department.archived') : 'department.edited';
    await recordAuditEvent({ tenantId: auth.session.tenantId, actorUserId: auth.session.user.id, action, entityType: 'department', entityId: id, before: existing, after: { ...updated, officeIds }, summary: `${action.split('.')[1]} organisation unit ${updated.name}` });
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Departments] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update organisation unit.' }, { status: 500 });
  }
}
