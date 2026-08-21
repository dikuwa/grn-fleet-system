import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  departments,
  employeeAvailability,
  employees,
  offices,
  roleAssignments,
  roles,
  tenantMemberships,
  trips,
  userProfiles,
  vehicleAllocations,
} from '@/db/schema';
import { and, count, eq, gt, ilike, inArray, isNull, lte, ne, or } from 'drizzle-orm';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getTenantEntitlements, checkEntitlement } from '@/lib/entitlements';
import { recordAuditEvent } from '@/lib/audit-event';
import { AVAILABILITY_OPTIONS, normaliseAvailability, normaliseEmployeeStatus } from '@/lib/employee-status';
import { runAtomicMutations } from '@/lib/db-atomic';

const MAX_BULK = 500;
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

function assignmentIsActive(
  assignment: { startDate: Date | string | null; endDate: Date | string | null },
  now = new Date(),
) {
  const startsAt = assignment.startDate ? new Date(assignment.startDate) : null;
  const endsAt = assignment.endDate ? new Date(assignment.endDate) : null;
  return (!startsAt || startsAt <= now) && (!endsAt || endsAt > now);
}

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
        { error: `Select-all is limited to ${MAX_BULK_FILTER} employees. Narrow your filters and try again.` },
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
      archivedAt: employees.archivedAt,
      userId: employees.userId,
      officeId: employees.officeId,
      departmentId: employees.departmentId,
    })
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), inArray(employees.id, ids)));

  if (employeesFound.length === 0) {
    return NextResponse.json({ error: 'No matching employees in this tenant.' }, { status: 404 });
  }
  if (employeesFound.length !== ids.length) {
    return NextResponse.json(
      { error: 'One or more selected employees do not belong to this tenant. Refresh the directory and try again.' },
      { status: 422 },
    );
  }

  const now = new Date();
  const employeeIds = employeesFound.map((employee) => employee.id);
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

  // Staff archival is an employment lifecycle operation, but a linked login
  // account is still governed by User Management safeguards. Never let a bulk
  // staff action disable the current/final Tenant Administrator or a driver
  // with live operational responsibility.
  let accessUserIds: string[] = [];
  let globalProfileUserIds: string[] = [];
  if (action === 'archive') {
    const linkedUserIds = employeesFound
      .map((employee) => employee.userId)
      .filter((value): value is string => Boolean(value));

    if (linkedUserIds.includes(auth.session.user.id)) {
      return NextResponse.json(
        { error: 'You cannot archive your own staff record while using this Tenant Administrator account.' },
        { status: 409 },
      );
    }

    const [openTrip] = await db
      .select({ id: trips.id })
      .from(trips)
      .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, trips.allocationId))
      .where(and(
        eq(trips.tenantId, tenantId),
        inArray(vehicleAllocations.driverEmployeeId, employeeIds),
        ne(trips.status, 'closed'),
        ne(trips.status, 'cancelled'),
      ))
      .limit(1);
    if (openTrip) {
      return NextResponse.json(
        { error: 'At least one selected employee has an active trip responsibility. Reassign or close the trip before archiving.' },
        { status: 409 },
      );
    }

    const [openAllocation] = await db
      .select({ id: vehicleAllocations.id })
      .from(vehicleAllocations)
      .where(and(
        inArray(vehicleAllocations.driverEmployeeId, employeeIds),
        inArray(vehicleAllocations.state, ['provisional', 'confirmed', 'released']),
      ))
      .limit(1);
    if (openAllocation) {
      return NextResponse.json(
        { error: 'At least one selected employee has a live vehicle allocation. Cancel or reassign it before archiving.' },
        { status: 409 },
      );
    }

    if (linkedUserIds.length > 0) {
      const activeMemberships = await db
        .select({ userId: tenantMemberships.userId })
        .from(tenantMemberships)
        .where(and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.status, 'active'),
          inArray(tenantMemberships.userId, linkedUserIds),
        ));
      accessUserIds = [...new Set(activeMemberships.map((membership) => membership.userId))];

      if (accessUserIds.length > 0) {
        const adminAssignments = await db
          .select({
            userId: tenantMemberships.userId,
            startDate: roleAssignments.startDate,
            endDate: roleAssignments.endDate,
          })
          .from(roleAssignments)
          .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
          .innerJoin(tenantMemberships, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
          .where(and(
            eq(tenantMemberships.tenantId, tenantId),
            eq(tenantMemberships.status, 'active'),
            eq(roles.name, 'Tenant Administrator'),
            lte(roleAssignments.startDate, now),
            or(isNull(roleAssignments.endDate), gt(roleAssignments.endDate, now)),
          ));
        const activeAdmins = [...new Set(
          adminAssignments
            .filter((assignment) => assignmentIsActive(assignment, now))
            .map((assignment) => assignment.userId),
        )];
        const selectedAdmins = new Set(accessUserIds);
        if (activeAdmins.length > 0 && activeAdmins.every((userId) => selectedAdmins.has(userId))) {
          return NextResponse.json(
            { error: 'This bulk archive would disable the final active Tenant Administrator. Assign another active Tenant Administrator first.' },
            { status: 409 },
          );
        }

        // The Better Auth identity is global. Archive only this tenant's
        // membership unless the user has no remaining organisation membership
        // that could still legitimately use the shared login.
        const otherMemberships = await db
          .select({ userId: tenantMemberships.userId, status: tenantMemberships.status })
          .from(tenantMemberships)
          .where(and(
            inArray(tenantMemberships.userId, accessUserIds),
            ne(tenantMemberships.tenantId, tenantId),
          ));
        const usersWithOtherUsableMemberships = new Set(
          otherMemberships
            .filter((membership) => membership.status !== 'access_removed')
            .map((membership) => membership.userId),
        );
        globalProfileUserIds = accessUserIds.filter(
          (userId) => !usersWithOtherUsableMemberships.has(userId),
        );
      }
    }
  }

  if (action === 'restore') {
    const linkedUserIds = employeesFound
      .map((employee) => employee.userId)
      .filter((value): value is string => Boolean(value));
    if (linkedUserIds.length > 0) {
      const archivedMemberships = await db
        .select({ userId: tenantMemberships.userId })
        .from(tenantMemberships)
        .where(and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.status, 'inactive'),
          inArray(tenantMemberships.userId, linkedUserIds),
        ));
      accessUserIds = [...new Set(archivedMemberships.map((membership) => membership.userId))];

      if (accessUserIds.length > 0) {
        const entitlements = await getTenantEntitlements(tenantId);
        if (entitlements) {
          const [countRow] = await db
            .select({ total: count() })
            .from(tenantMemberships)
            .where(and(
              eq(tenantMemberships.tenantId, tenantId),
              inArray(tenantMemberships.status, ['active', 'pending', 'pending_activation', 'suspended']),
            ));
          const entitlement = checkEntitlement(
            entitlements,
            'users',
            Number(countRow?.total ?? 0),
            accessUserIds.length,
          );
          if (!entitlement.ok) {
            return NextResponse.json(
              { error: entitlement.message || 'User limit reached. Increase the user allowance before restoring these staff accounts.' },
              { status: 409 },
            );
          }
        }

        // Only re-enable a global profile when this exact staff archive disabled
        // it. A security suspension or disablement from another workflow remains
        // authoritative and is never undone by bulk staff restore.
        const archivedAtByUserId = new Map(
          employeesFound
            .filter((employee): employee is typeof employee & { userId: string } => Boolean(employee.userId))
            .map((employee) => [employee.userId, employee.archivedAt] as const),
        );
        const profiles = await db
          .select({ userId: userProfiles.userId, status: userProfiles.status, disabledAt: userProfiles.disabledAt })
          .from(userProfiles)
          .where(inArray(userProfiles.userId, accessUserIds));
        globalProfileUserIds = profiles
          .filter((profile) => {
            if (profile.status !== 'disabled' || !profile.disabledAt) return false;
            const archivedAt = archivedAtByUserId.get(profile.userId);
            return Boolean(archivedAt) && new Date(archivedAt!).getTime() === new Date(profile.disabledAt).getTime();
          })
          .map((profile) => profile.userId);
      }
    }
  }

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
    const nextAvailability = availability;
    if (!nextAvailability) {
      return NextResponse.json({ error: 'A valid availability status is required.' }, { status: 400 });
    }
    await runAtomicMutations((executor) => [
      executor
        .update(employeeAvailability)
        .set({ endAt: now, isActive: false })
        .where(and(
          eq(employeeAvailability.tenantId, tenantId),
          inArray(employeeAvailability.employeeId, employeeIds),
          isNull(employeeAvailability.endAt),
        )),
      executor
        .update(employees)
        .set({ availabilityStatus: nextAvailability, updatedAt: now })
        .where(and(eq(employees.tenantId, tenantId), inArray(employees.id, employeeIds))),
      executor.insert(employeeAvailability).values(
        employeeIds.map((employeeId) => ({
          tenantId,
          employeeId,
          status: nextAvailability,
          startAt: now,
          endAt: null,
          reason: 'Bulk availability update',
          enteredByUserId: auth.session.user.id,
        })),
      ),
    ]);
    updated = employeeIds.length;
  } else if (action === 'assign_office') {
    const [validOffice] = await db
      .select({ id: offices.id })
      .from(offices)
      .where(and(
        eq(offices.id, body.officeId as string),
        eq(offices.tenantId, tenantId),
        eq(offices.isActive, true),
      ))
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
      .where(and(
        eq(departments.id, body.departmentId as string),
        eq(departments.tenantId, tenantId),
        eq(departments.isActive, true),
      ))
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
    await runAtomicMutations((executor) => {
      const employeeUpdate = executor
        .update(employees)
        .set({
          employmentStatus: isArchive ? 'archived' : 'active',
          archivedAt: isArchive ? now : null,
          archivedByUserId: isArchive ? auth.session.user.id : null,
          updatedAt: now,
        })
        .where(and(eq(employees.tenantId, tenantId), inArray(employees.id, employeeIds)));

      if (accessUserIds.length === 0) return [employeeUpdate];

      const membershipUpdate = executor
        .update(tenantMemberships)
        .set({ status: isArchive ? 'inactive' : 'active' })
        .where(and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.status, isArchive ? 'active' : 'inactive'),
          inArray(tenantMemberships.userId, accessUserIds),
        ));

      if (globalProfileUserIds.length === 0) {
        return [employeeUpdate, membershipUpdate];
      }

      const profileUpdate = executor
        .update(userProfiles)
        .set(isArchive
          ? { accountEnabled: false, status: 'disabled', disabledAt: now, updatedAt: now }
          : { accountEnabled: true, status: 'active', disabledAt: null, updatedAt: now })
        .where(and(
          inArray(userProfiles.userId, globalProfileUserIds),
          eq(userProfiles.status, isArchive ? 'active' : 'disabled'),
        ));

      return [employeeUpdate, membershipUpdate, profileUpdate];
    });
    updated = employeesFound.length;
    disabledAccounts = globalProfileUserIds.length;
  }

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
    after: {
      count: updated,
      accountAccessChanges: disabledAccounts,
      tenantMembershipAccessChanges: accessUserIds.length,
      reason: body.reason,
      availability,
      officeId: body.officeId,
      departmentId: body.departmentId,
    },
    summary: `${actionLabel[action]} for ${updated} employee(s) in bulk`,
    reason: body.reason,
  });

  return NextResponse.json({ success: true, updated, disabledAccounts });
}
