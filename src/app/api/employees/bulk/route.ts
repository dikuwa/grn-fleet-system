import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { employeeAvailability, employees, userProfiles, tenantMemberships, offices, departments } from '@/db/schema';
import { and, eq, inArray, ilike, or } from 'drizzle-orm';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';
import { AVAILABILITY_OPTIONS, normaliseAvailability, normaliseEmployeeStatus } from '@/lib/employee-status';

const MAX_BULK = 500;
// Select-all-across-pages mode resolves matching employee IDs server-side.
// Safety cap prevents a mis-scoped filter from touching an entire tenant.
const MAX_BULK_FILTER = 2000;

const BULK_ACTIONS = [
  'mark_active',
  'mark_inactive',
  'set_availability',
  'assign_office',
  'assign_department',
  'archive',
  'restore',
] as const;
type BulkAction = (typeof BULK_ACTIONS)[number];

export async function POST(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const roleCheck = await requireDashboardAction(auth.session, '/dashboard/staff', 'update');
  if (roleCheck instanceof NextResponse) return roleCheck;
  const lifecyclePermission = await requirePermission(auth.session, Permissions.STAFF_LIFECYCLE_MANAGE);
  if (lifecyclePermission instanceof NextResponse) return lifecyclePermission;

  const body = (await request.json()) as {
    ids?: string[];
    action?: BulkAction;
    availability?: string;
    officeId?: string;
    departmentId?: string;
    reason?: string;
    allSelected?: boolean;
    filter?: {
      q?: string;
      office?: string;
      department?: string;
      status?: string;
      availability?: string;
    };
  };

  if (!body.action || !BULK_ACTIONS.includes(body.action)) {
    return NextResponse.json({ error: 'Unsupported bulk action.' }, { status: 400 });
  }
  const action = body.action;

  const db = getDb();
  const tenantId = auth.session.tenantId;

  // Resolve target employee IDs. Two modes:
  //  1. Explicit ids (checkbox selection on the current page).
  //  2. allSelected + filter — "select all N matching current filters" across
  //     every page. IDs are resolved server-side, strictly tenant-scoped, using
  //     the exact same filter conditions as the Staff Directory query.
  let ids: string[] = [];
  if (body.allSelected) {
    const filter = body.filter || {};
    const conditions: ReturnType<typeof and>[] = [eq(employees.tenantId, tenantId)];

    const query = filter.q?.trim() || '';
    if (query) {
      conditions.push(
        or(
          ilike(employees.firstName, `%${query}%`),
          ilike(employees.lastName, `%${query}%`),
          ilike(employees.employeeNumber, `%${query}%`),
          ilike(employees.email, `%${query}%`),
          ilike(employees.jobTitle, `%${query}%`),
        )!,
      );
    }
    if (filter.office) conditions.push(eq(employees.officeId, filter.office));
    if (filter.department) conditions.push(eq(employees.departmentId, filter.department));
    if (filter.status) conditions.push(eq(employees.employmentStatus, filter.status));
    if (filter.availability) conditions.push(eq(employees.availabilityStatus, filter.availability));

    const matched = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(...conditions))
      .limit(MAX_BULK_FILTER + 1);

    if (matched.length > MAX_BULK_FILTER) {
      return NextResponse.json(
        {
          error: `Select-all is limited to ${MAX_BULK_FILTER} employees. Narrow your filters and try again.`,
        },
        { status: 400 },
      );
    }
    ids = matched.map((row) => row.id);
  } else {
    ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String))] : [];
  }

  if (ids.length === 0) return NextResponse.json({ error: 'No employees selected.' }, { status: 400 });
  if (!body.allSelected && ids.length > MAX_BULK) {
    return NextResponse.json({ error: `Bulk updates are limited to ${MAX_BULK} employees.` }, { status: 400 });
  }

  // Office/department assignment additionally requires staff management rights.
  if (action === 'assign_office' || action === 'assign_department') {
    const staffPerm = await requirePermission(auth.session, Permissions.STAFF_MANAGE);
    if (staffPerm instanceof NextResponse) return staffPerm;
  }

  const employeesFound = await db
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      employmentStatus: employees.employmentStatus,
      availabilityStatus: employees.availabilityStatus,
      userId: employees.userId,
      officeId: employees.officeId,
      departmentId: employees.departmentId,
    })
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), inArray(employees.id, ids)));

  if (employeesFound.length === 0) {
    return NextResponse.json({ error: 'No matching employees in this tenant.' }, { status: 404 });
  }

  const now = new Date();
  const employeeIds = employeesFound.map((employee) => employee.id);

  // ---- validate action-specific payloads ---------------------------------
  let availability: string | null = null;
  if (action === 'set_availability') {
    availability = normaliseAvailability(body.availability);
    if (!availability || !AVAILABILITY_OPTIONS.some((option) => option.value === availability)) {
      return NextResponse.json({ error: 'A valid availability status is required.' }, { status: 400 });
    }
  }

  if (action === 'archive' && !body.reason?.trim()) {
    return NextResponse.json({ error: 'A reason is required to archive employees.' }, { status: 400 });
  }

  // ---- apply the action ----------------------------------------------------
  let updated = 0;
  let disabledAccounts = 0;

  if (action === 'mark_active' || action === 'mark_inactive') {
    const target = normaliseEmployeeStatus(action === 'mark_active' ? 'active' : 'inactive');
    if (!target) return NextResponse.json({ error: 'Invalid target status.' }, { status: 400 });
    const result = await db
      .update(employees)
      .set({
        employmentStatus: target,
        archivedAt: target === 'archived' ? now : null,
        archivedByUserId: target === 'archived' ? auth.session.user.id : null,
        updatedAt: now,
      })
      .where(and(eq(employees.tenantId, tenantId), inArray(employees.id, employeeIds)));
    updated = result.rowCount ?? 0;
  } else if (action === 'set_availability') {
    const current = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), inArray(employees.id, employeeIds)));
    await db
      .update(employees)
      .set({ availabilityStatus: availability!, updatedAt: now })
      .where(and(eq(employees.tenantId, tenantId), inArray(employees.id, employeeIds)));
    await db.insert(employeeAvailability).values(
      current.map((employee) => ({
        tenantId,
        employeeId: employee.id,
        status: availability!,
        startAt: now,
        endAt: null,
        reason: 'Bulk availability update',
        enteredByUserId: auth.session.user.id,
      })),
    );
    updated = current.length;
  } else if (action === 'assign_office') {
    const [validOffice] = await db
      .select({ id: offices.id })
      .from(offices)
      .where(and(eq(offices.id, body.officeId as string), eq(offices.tenantId, tenantId), eq(offices.isActive, true)))
      .limit(1);
    if (!body.officeId || !validOffice) {
      return NextResponse.json({ error: 'The selected office does not belong to this tenant.' }, { status: 400 });
    }
    const result = await db
      .update(employees)
      .set({ officeId: validOffice.id, updatedAt: now })
      .where(and(eq(employees.tenantId, tenantId), inArray(employees.id, employeeIds)));
    updated = result.rowCount ?? 0;
  } else if (action === 'assign_department') {
    const [validDepartment] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.id, body.departmentId as string), eq(departments.tenantId, tenantId), eq(departments.isActive, true)))
      .limit(1);
    if (!body.departmentId || !validDepartment) {
      return NextResponse.json({ error: 'The selected department does not belong to this tenant.' }, { status: 400 });
    }
    const result = await db
      .update(employees)
      .set({ departmentId: validDepartment.id, updatedAt: now })
      .where(and(eq(employees.tenantId, tenantId), inArray(employees.id, employeeIds)));
    updated = result.rowCount ?? 0;
  } else if (action === 'archive' || action === 'restore') {
    const isArchive = action === 'archive';
    await db
      .update(employees)
      .set({
        employmentStatus: isArchive ? 'archived' : 'active',
        archivedAt: isArchive ? now : null,
        archivedByUserId: isArchive ? auth.session.user.id : null,
        updatedAt: now,
      })
      .where(and(eq(employees.tenantId, tenantId), inArray(employees.id, employeeIds)));
    updated = employeesFound.length;
    // Destructive archive also revokes linked login accounts (independent of
    // the staff status change, but consistent with the destructive semantics
    // of archiving). Restore re-enables them.
    const linkedUserIds = employeesFound.map((employee) => employee.userId).filter((id): id is string => Boolean(id));
    if (linkedUserIds.length > 0) {
      await db
        .update(userProfiles)
        .set({
          accountEnabled: !isArchive,
          status: isArchive ? 'disabled' : 'active',
          disabledAt: isArchive ? now : null,
          updatedAt: now,
        })
        .where(inArray(userProfiles.userId, linkedUserIds));
      await db
        .update(tenantMemberships)
        .set({ status: isArchive ? 'inactive' : 'active' })
        .where(and(eq(tenantMemberships.tenantId, tenantId), inArray(tenantMemberships.userId, linkedUserIds)));
      disabledAccounts = linkedUserIds.length;
    }
  }

  // ---- audit ---------------------------------------------------------------
  const actionLabel: Record<BulkAction, string> = {
    mark_active: 'Employee marked Active',
    mark_inactive: 'Employee marked Inactive',
    set_availability: 'Availability changed',
    assign_office: 'Office assigned',
    assign_department: 'Department assigned',
    archive: 'Employee archived',
    restore: 'Employee restored',
  };
  await recordAuditEvent({
    tenantId,
    actorUserId: auth.session.user.id,
    action: `employee.bulk_${action}`,
    entityType: 'employee',
    entityId: employeeIds.join(','),
    after: { count: updated, disabledAccounts, reason: body.reason, availability, officeId: body.officeId, departmentId: body.departmentId },
    summary: `${actionLabel[action]} for ${updated} employee(s) in bulk`,
    reason: body.reason,
  });

  return NextResponse.json({ success: true, updated, disabledAccounts });
}
