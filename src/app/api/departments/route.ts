import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { departmentOffices, departments, employees, offices } from '@/db/schema';
import { eq, and, asc, sql, ne } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';
import { normaliseOrganisationCode, suggestOrganisationCode } from '@/lib/organisation-codes';
import { runAtomicMutations } from '@/lib/db-atomic';
import { getDatabaseErrorDetails } from '@/lib/database-error-details';

const UNIT_TYPES = new Set(['directorate', 'department', 'unit']);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEPARTMENT_CODE_UNIQUE_INDEX = 'uq_departments_tenant_code_normalized';

function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

function isDepartmentCodeConflict(error: unknown) {
  const details = getDatabaseErrorDetails(error);
  return details.code === '23505' && details.message.includes(DEPARTMENT_CODE_UNIQUE_INDEX);
}

async function validateReferences(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  body: Record<string, unknown>,
  currentId?: string,
) {
  const parentId = typeof body.parentId === 'string' && body.parentId ? body.parentId : null;
  if (parentId && !isUuid(parentId)) return 'The selected parent unit does not belong to this tenant.';
  if (parentId === currentId) return 'An organisation unit cannot be its own parent.';

  const requireActiveParent = !currentId || body.parentId !== undefined;
  let cursor = parentId;
  const visited = new Set<string>();
  let firstParent = true;
  while (cursor) {
    if (visited.has(cursor) || cursor === currentId) {
      return 'The selected parent would create a circular organisation hierarchy.';
    }
    visited.add(cursor);
    const [parent] = await db
      .select({ parentId: departments.parentId, isActive: departments.isActive })
      .from(departments)
      .where(and(eq(departments.id, cursor), eq(departments.tenantId, tenantId)))
      .limit(1);
    if (!parent) return 'The selected parent unit does not belong to this tenant.';
    if (firstParent && requireActiveParent && !parent.isActive) {
      return 'The selected parent unit is archived. Choose an active organisation unit.';
    }
    firstParent = false;
    cursor = parent.parentId;
  }

  const officeIds = Array.isArray(body.officeIds)
    ? body.officeIds.filter((id): id is string => typeof id === 'string')
    : [];
  for (const officeId of officeIds) {
    if (!isUuid(officeId)) {
      return 'One or more selected offices are inactive or do not belong to this tenant.';
    }
    const [office] = await db
      .select({ id: offices.id })
      .from(offices)
      .where(and(eq(offices.id, officeId), eq(offices.tenantId, tenantId), eq(offices.isActive, true)))
      .limit(1);
    if (!office) return 'One or more selected offices are inactive or do not belong to this tenant.';
  }

  const validateHead = !currentId || body.headEmployeeId !== undefined;
  if (validateHead && typeof body.headEmployeeId === 'string' && body.headEmployeeId) {
    if (!isUuid(body.headEmployeeId)) {
      return 'The selected unit head must be an active employee in this tenant.';
    }
    const [head] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(
        eq(employees.id, body.headEmployeeId),
        eq(employees.tenantId, tenantId),
        eq(employees.employmentStatus, 'active'),
      ))
      .limit(1);
    if (!head) return 'The selected unit head must be an active employee in this tenant.';
  }
  return null;
}

async function allocateDepartmentCode(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  requested: string,
) {
  const base = normaliseOrganisationCode(requested);
  if (!base) return '';

  const rows = await db.select({ code: departments.code }).from(departments).where(eq(departments.tenantId, tenantId));
  const used = new Set(rows.map((row) => normaliseOrganisationCode(row.code || '')).filter(Boolean));

  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('Unable to allocate a unique organisation unit code');
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

    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'Organisation unit name is required.' }, { status: 400 });

    const type = typeof body.type === 'string' ? body.type : 'department';
    if (!UNIT_TYPES.has(type)) return NextResponse.json({ error: 'Unsupported organisation unit type.' }, { status: 400 });

    const db = getDb();
    const tenantId = auth.session.tenantId;
    const referenceError = await validateReferences(db, tenantId, body);
    if (referenceError) return NextResponse.json({ error: referenceError }, { status: 400 });

    const requestedCode = typeof body.code === 'string' && body.code.trim()
      ? body.code
      : suggestOrganisationCode(name, 'department');
    const code = await allocateDepartmentCode(db, tenantId, requestedCode);
    if (!code) return NextResponse.json({ error: 'Organisation unit code is required.' }, { status: 400 });

    const officeIds = Array.isArray(body.officeIds)
      ? body.officeIds.filter((id): id is string => typeof id === 'string')
      : [];
    const departmentId = crypto.randomUUID();
    const departmentValues = {
      id: departmentId,
      tenantId,
      name,
      code,
      type,
      parentId: typeof body.parentId === 'string' && body.parentId ? body.parentId : null,
      headEmployeeId: typeof body.headEmployeeId === 'string' && body.headEmployeeId ? body.headEmployeeId : null,
    };

    await runAtomicMutations((executor) => {
      const mutations = [executor.insert(departments).values(departmentValues)];
      if (officeIds.length) {
        mutations.push(executor.insert(departmentOffices).values(
          officeIds.map((officeId) => ({ tenantId, departmentId, officeId })),
        ));
      }
      return mutations;
    });

    const [department] = await db
      .select()
      .from(departments)
      .where(and(eq(departments.id, departmentId), eq(departments.tenantId, tenantId)))
      .limit(1);
    if (!department) throw new Error('Created organisation unit could not be reloaded.');

    await recordAuditEvent({
      tenantId,
      actorUserId: auth.session.user.id,
      action: 'department.created',
      entityType: 'department',
      entityId: department.id,
      after: { ...department, officeIds },
      summary: `Created ${type} ${department.name}`,
    });
    return NextResponse.json({ success: true, data: department }, { status: 201 });
  } catch (error) {
    console.error('[Departments] POST failed:', error);
    if (isDepartmentCodeConflict(error)) {
      return NextResponse.json(
        { error: 'This organisation unit code is already used in this tenant. Refresh and try again.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to create organisation unit.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const permission = await requirePermission(auth.session, Permissions.TENANT_MANAGE);
    if (permission instanceof NextResponse) return permission;

    const body = (await request.json()) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return NextResponse.json({ error: 'Organisation unit ID is required.' }, { status: 400 });
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Organisation unit not found.' }, { status: 404 });
    }

    const db = getDb();
    const tenantId = auth.session.tenantId;
    const [existing] = await db
      .select()
      .from(departments)
      .where(and(eq(departments.id, id), eq(departments.tenantId, tenantId)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Organisation unit not found.' }, { status: 404 });

    const name = body.name !== undefined
      ? typeof body.name === 'string' ? body.name.trim() : ''
      : existing.name;
    if (!name) return NextResponse.json({ error: 'Organisation unit name cannot be empty.' }, { status: 400 });

    const merged = {
      ...body,
      parentId: body.parentId !== undefined ? body.parentId : existing.parentId,
      headEmployeeId: body.headEmployeeId !== undefined ? body.headEmployeeId : existing.headEmployeeId,
    };
    const referenceError = await validateReferences(db, tenantId, merged, id);
    if (referenceError) return NextResponse.json({ error: referenceError }, { status: 400 });

    const type = typeof body.type === 'string' ? body.type : existing.type;
    if (!UNIT_TYPES.has(type)) return NextResponse.json({ error: 'Unsupported organisation unit type.' }, { status: 400 });

    const code = body.code !== undefined
      ? normaliseOrganisationCode(typeof body.code === 'string' ? body.code : '')
      : existing.code;
    if (!code) return NextResponse.json({ error: 'Organisation unit code cannot be empty.' }, { status: 400 });

    const [duplicate] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(
        eq(departments.tenantId, tenantId),
        ne(departments.id, id),
        sql`upper(btrim(${departments.code})) = ${code}`,
      ))
      .limit(1);
    if (duplicate) {
      return NextResponse.json({ error: `Organisation unit code ${code} is already used in this tenant.` }, { status: 409 });
    }

    const officeIds = Array.isArray(body.officeIds)
      ? body.officeIds.filter((officeId): officeId is string => typeof officeId === 'string')
      : null;
    const isActive = typeof body.isActive === 'boolean' ? body.isActive : existing.isActive;
    const updatedAt = new Date();

    await runAtomicMutations((executor) => {
      const mutations = [
        executor
          .update(departments)
          .set({
            name,
            code,
            type,
            parentId: body.parentId !== undefined
              ? typeof body.parentId === 'string' && body.parentId ? body.parentId : null
              : existing.parentId,
            headEmployeeId: body.headEmployeeId !== undefined
              ? typeof body.headEmployeeId === 'string' && body.headEmployeeId ? body.headEmployeeId : null
              : existing.headEmployeeId,
            isActive,
            archivedAt: isActive ? null : existing.archivedAt ?? updatedAt,
            updatedAt,
          })
          .where(and(eq(departments.id, id), eq(departments.tenantId, tenantId))),
      ];

      if (officeIds) {
        mutations.push(
          executor.delete(departmentOffices).where(and(
            eq(departmentOffices.tenantId, tenantId),
            eq(departmentOffices.departmentId, id),
          )),
        );
        if (officeIds.length) {
          mutations.push(
            executor.insert(departmentOffices).values(
              officeIds.map((officeId) => ({ tenantId, departmentId: id, officeId })),
            ),
          );
        }
      }
      return mutations;
    });

    const [updated] = await db
      .select()
      .from(departments)
      .where(and(eq(departments.id, id), eq(departments.tenantId, tenantId)))
      .limit(1);
    if (!updated) throw new Error('Updated organisation unit could not be reloaded.');

    const action = typeof body.isActive === 'boolean' && body.isActive !== existing.isActive
      ? body.isActive ? 'department.restored' : 'department.archived'
      : 'department.edited';
    await recordAuditEvent({
      tenantId,
      actorUserId: auth.session.user.id,
      action,
      entityType: 'department',
      entityId: id,
      before: existing,
      after: { ...updated, officeIds },
      summary: `${action.split('.')[1]} organisation unit ${updated.name}`,
    });
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Departments] PATCH failed:', error);
    if (isDepartmentCodeConflict(error)) {
      return NextResponse.json(
        { error: 'This organisation unit code is already used in this tenant. Refresh and try again.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to update organisation unit.' }, { status: 500 });
  }
}
