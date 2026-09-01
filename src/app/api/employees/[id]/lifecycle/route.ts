import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  auditEvents,
  departments,
  driverProfiles,
  employeeAssignments,
  employeeAvailability,
  employeeDocuments,
  employees,
  offices,
  roleAssignments,
  roles,
  tenantMemberships,
  transportRequests,
  trips,
  userProfiles,
  vehicleAllocations,
  workflowActions,
} from '@/db/schema';
import { and, count, eq, gt, inArray, isNull, lte, ne, or } from 'drizzle-orm';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { AVAILABILITY_STATUSES } from '@/lib/employee-lifecycle';
import { normaliseAvailability, normaliseEmployeeStatus } from '@/lib/employee-status';
import { getTenantEntitlements, checkEntitlement } from '@/lib/entitlements';
import { recordAuditEvent } from '@/lib/audit-event';

async function getEmployee(id: string, tenantId: string) {
  const db = getDb();
  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.tenantId, tenantId)))
    .limit(1);
  return employee;
}

function driverAvailabilityFromEmployee(status: string): string {
  if (status === 'available') return 'available';
  if (status === 'annual_leave' || status === 'sick_leave') return 'leave';
  return 'unavailable';
}

function assignmentIsActive(
  assignment: { startDate: Date | string | null; endDate: Date | string | null },
  now = new Date(),
) {
  const startsAt = assignment.startDate ? new Date(assignment.startDate) : null;
  const endsAt = assignment.endDate ? new Date(assignment.endDate) : null;
  return (!startsAt || startsAt <= now) && (!endsAt || endsAt > now);
}

async function assertNoLiveDriverResponsibility(employeeId: string, tenantId: string) {
  const db = getDb();
  const [[openTrip], [openAllocation]] = await Promise.all([
    db
      .select({ id: trips.id })
      .from(trips)
      .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, trips.allocationId))
      .where(and(
        eq(trips.tenantId, tenantId),
        eq(vehicleAllocations.driverEmployeeId, employeeId),
        ne(trips.status, 'closed'),
        ne(trips.status, 'cancelled'),
      ))
      .limit(1),
    db
      .select({ id: vehicleAllocations.id })
      .from(vehicleAllocations)
      .innerJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
      .where(and(
        eq(transportRequests.tenantId, tenantId),
        eq(vehicleAllocations.driverEmployeeId, employeeId),
        inArray(vehicleAllocations.state, ['provisional', 'confirmed', 'released']),
      ))
      .limit(1),
  ]);

  if (openTrip) {
    return 'This employee has an active trip responsibility. Reassign or close the trip before changing this driver lifecycle state.';
  }
  if (openAllocation) {
    return 'This employee has a live vehicle allocation. Cancel or reassign it before changing this driver lifecycle state.';
  }
  return null;
}

async function wouldDisableFinalTenantAdmin(userId: string, tenantId: string) {
  const db = getDb();
  const now = new Date();
  const assignments = await db
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
    assignments
      .filter((assignment) => assignmentIsActive(assignment, now))
      .map((assignment) => assignment.userId),
  )];
  return activeAdmins.length === 1 && activeAdmins[0] === userId;
}

async function restoreArchivedAccountIfAllowed(
  userId: string,
  tenantId: string,
  archivedAt: Date | string | null,
) {
  const db = getDb();
  const [[membership], [profile]] = await Promise.all([
    db
      .select({ id: tenantMemberships.id, status: tenantMemberships.status })
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.tenantId, tenantId)))
      .limit(1),
    db
      .select({ status: userProfiles.status, disabledAt: userProfiles.disabledAt })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1),
  ]);

  // Only the archive-specific inactive state may be reversed here. Suspended,
  // removed, pending and other states belong to User Management and remain intact.
  if (!membership || membership.status !== 'inactive') return false;

  const entitlements = await getTenantEntitlements(tenantId);
  if (entitlements) {
    const [countRow] = await db
      .select({ total: count() })
      .from(tenantMemberships)
      .where(and(
        eq(tenantMemberships.tenantId, tenantId),
        inArray(tenantMemberships.status, ['active', 'pending', 'pending_activation', 'suspended']),
      ));
    const result = checkEntitlement(entitlements, 'users', Number(countRow?.total ?? 0), 1);
    if (!result.ok) {
      throw new Error(result.message || 'USER_LIMIT_REACHED');
    }
  }

  const archivedTimestamp = archivedAt ? new Date(archivedAt).getTime() : null;
  const disabledTimestamp = profile?.disabledAt ? new Date(profile.disabledAt).getTime() : null;
  const archiveDisabledGlobalProfile =
    profile?.status === 'disabled'
    && archivedTimestamp !== null
    && disabledTimestamp !== null
    && archivedTimestamp === disabledTimestamp;

  await db.transaction(async (tx) => {
    await tx
      .update(tenantMemberships)
      .set({ status: 'active' })
      .where(and(
        eq(tenantMemberships.id, membership.id),
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.status, 'inactive'),
      ));

    // Only undo the global profile disable when this exact staff archive set it.
    // A separate security suspension/disablement must remain authoritative.
    if (archiveDisabledGlobalProfile) {
      await tx
        .update(userProfiles)
        .set({ accountEnabled: true, status: 'active', disabledAt: null, updatedAt: new Date() })
        .where(and(eq(userProfiles.userId, userId), eq(userProfiles.status, 'disabled')));
    }
  });
  return true;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const roleCheck = await requireDashboardAction(auth.session, '/dashboard/staff', 'view');
  if (roleCheck instanceof NextResponse) return roleCheck;
  const permission = await requirePermission(auth.session, Permissions.STAFF_VIEW);
  if (permission instanceof NextResponse) return permission;

  const { id } = await params;
  const employee = await getEmployee(id, auth.session.tenantId);
  if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const db = getDb();
  const [assignments, availability] = await Promise.all([
    db
      .select()
      .from(employeeAssignments)
      .where(and(eq(employeeAssignments.employeeId, id), eq(employeeAssignments.tenantId, auth.session.tenantId))),
    db
      .select()
      .from(employeeAvailability)
      .where(and(eq(employeeAvailability.employeeId, id), eq(employeeAvailability.tenantId, auth.session.tenantId))),
  ]);
  return NextResponse.json({ employee, assignments, availability });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const roleCheck = await requireDashboardAction(auth.session, '/dashboard/staff', 'update');
  if (roleCheck instanceof NextResponse) return roleCheck;
  const permission = await requirePermission(auth.session, Permissions.STAFF_LIFECYCLE_MANAGE);
  if (permission instanceof NextResponse) return permission;

  const { id } = await params;
  const employee = await getEmployee(id, auth.session.tenantId);
  if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const body = (await request.json()) as {
    action:
      | 'archive'
      | 'restore'
      | 'status'
      | 'availability'
      | 'transfer'
      | 'deactivate_account'
      | 'reactivate_account'
      | 'remove_driver';
    status?: string;
    startAt?: string;
    endAt?: string;
    reason?: string;
    notes?: string;
    officeId?: string;
    departmentId?: string;
    jobTitle?: string;
    position?: string;
    supervisorEmployeeId?: string;
  } & Record<string, unknown>;

  if (Object.prototype.hasOwnProperty.call(body, 'supportingDocumentKey')) {
    return NextResponse.json(
      { error: 'Supporting document uploads are not available for staff lifecycle actions.' },
      { status: 422 },
    );
  }

  if (body.action === 'deactivate_account' || body.action === 'reactivate_account') {
    return NextResponse.json(
      { error: 'Login access is managed from User Management. Staff Management cannot activate or deactivate user accounts.' },
      { status: 409 },
    );
  }

  const db = getDb();
  const now = new Date();
  let after: Record<string, unknown> = {};

  if (body.action === 'archive') {
    if (!body.reason?.trim()) {
      return NextResponse.json({ error: 'Archive reason is required' }, { status: 400 });
    }
    if (employee.userId === auth.session.user.id) {
      return NextResponse.json(
        { error: 'You cannot archive your own staff record while using this Tenant Administrator account.' },
        { status: 409 },
      );
    }
    if (employee.isDriver) {
      const dependencyError = await assertNoLiveDriverResponsibility(employee.id, auth.session.tenantId);
      if (dependencyError) return NextResponse.json({ error: dependencyError }, { status: 409 });
    }

    let accountArchived = false;
    let globalProfileDisabled = false;
    if (employee.userId) {
      const [membership] = await db
        .select({ id: tenantMemberships.id, status: tenantMemberships.status })
        .from(tenantMemberships)
        .where(and(
          eq(tenantMemberships.userId, employee.userId),
          eq(tenantMemberships.tenantId, auth.session.tenantId),
        ))
        .limit(1);

      if (membership?.status === 'active') {
        if (await wouldDisableFinalTenantAdmin(employee.userId, auth.session.tenantId)) {
          return NextResponse.json(
            { error: 'This employee is the final active Tenant Administrator. Assign another active Tenant Administrator before archiving.' },
            { status: 409 },
          );
        }

        const otherMemberships = await db
          .select({ id: tenantMemberships.id, status: tenantMemberships.status })
          .from(tenantMemberships)
          .where(and(
            eq(tenantMemberships.userId, employee.userId),
            ne(tenantMemberships.id, membership.id),
          ));
        globalProfileDisabled = !otherMemberships.some(
          (otherMembership) => otherMembership.status !== 'access_removed',
        );
        accountArchived = true;
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .update(employees)
        .set({
          employmentStatus: 'archived',
          availabilityStatus: 'temporarily_unavailable',
          archivedAt: now,
          archivedByUserId: auth.session.user.id,
          updatedAt: now,
        })
        .where(and(eq(employees.id, id), eq(employees.tenantId, auth.session.tenantId)));

      if (employee.isDriver) {
        await tx
          .update(driverProfiles)
          .set({ availabilityStatus: 'unavailable', unavailableUntil: null, updatedAt: now })
          .where(eq(driverProfiles.employeeId, id));
      }

      if (employee.userId && accountArchived) {
        await tx
          .update(tenantMemberships)
          .set({ status: 'inactive' })
          .where(and(
            eq(tenantMemberships.userId, employee.userId),
            eq(tenantMemberships.tenantId, auth.session.tenantId),
            eq(tenantMemberships.status, 'active'),
          ));

        if (globalProfileDisabled) {
          await tx
            .update(userProfiles)
            .set({ accountEnabled: false, status: 'disabled', disabledAt: now, updatedAt: now })
            .where(and(eq(userProfiles.userId, employee.userId), eq(userProfiles.status, 'active')));
        }
      }
    });
    after = { employmentStatus: 'archived', accountArchived, globalProfileDisabled };
  } else if (body.action === 'restore') {
    let accountRestored = false;
    try {
      if (employee.userId) {
        accountRestored = await restoreArchivedAccountIfAllowed(
          employee.userId,
          auth.session.tenantId,
          employee.archivedAt,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      return NextResponse.json(
        { error: message || 'User limit reached. Increase the tenant user allowance before restoring this account.' },
        { status: 409 },
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .update(employees)
        .set({
          employmentStatus: 'active',
          // Restoring employment does not imply immediate operational availability.
          availabilityStatus: employee.isDriver ? 'temporarily_unavailable' : 'available',
          archivedAt: null,
          archivedByUserId: null,
          updatedAt: now,
        })
        .where(and(eq(employees.id, id), eq(employees.tenantId, auth.session.tenantId)));

      if (employee.isDriver) {
        // Licence verification/driver authorisation remains authoritative. The
        // driver must be explicitly made available after compliance is valid.
        await tx
          .update(driverProfiles)
          .set({ availabilityStatus: 'unavailable', unavailableUntil: null, updatedAt: now })
          .where(eq(driverProfiles.employeeId, id));
      }
    });
    after = {
      employmentStatus: 'active',
      availabilityStatus: employee.isDriver ? 'temporarily_unavailable' : 'available',
      accountRestored,
    };
  } else if (body.action === 'status') {
    const canonical = normaliseEmployeeStatus(body.status);
    if (!canonical || (canonical !== 'active' && canonical !== 'inactive')) {
      return NextResponse.json(
        { error: 'Invalid employment status. Use Mark Active or Mark Inactive for routine status changes.' },
        { status: 400 },
      );
    }
    await db
      .update(employees)
      .set({ employmentStatus: canonical, updatedAt: now })
      .where(and(eq(employees.id, id), eq(employees.tenantId, auth.session.tenantId)));
    if (employee.isDriver && canonical === 'inactive') {
      await db
        .update(driverProfiles)
        .set({ availabilityStatus: 'unavailable', updatedAt: now })
        .where(eq(driverProfiles.employeeId, id));
    }
    after = { employmentStatus: canonical };
  } else if (body.action === 'remove_driver') {
    if (!employee.isDriver) {
      return NextResponse.json({ error: 'This employee is not currently designated as a driver.' }, { status: 409 });
    }
    const dependencyError = await assertNoLiveDriverResponsibility(employee.id, auth.session.tenantId);
    if (dependencyError) return NextResponse.json({ error: dependencyError }, { status: 409 });
    await db.transaction(async (tx) => {
      await tx
        .update(employees)
        .set({ isDriver: false, updatedAt: now })
        .where(and(eq(employees.id, id), eq(employees.tenantId, auth.session.tenantId)));
      await tx
        .update(driverProfiles)
        .set({
          driverStatus: 'revoked',
          availabilityStatus: 'unavailable',
          notes: body.reason?.trim() || 'Driver designation removed',
          updatedAt: now,
        })
        .where(eq(driverProfiles.employeeId, id));
    });
    after = { isDriver: false, driverStatus: 'revoked', availabilityStatus: 'unavailable' };
  } else if (body.action === 'availability') {
    const canonicalAvailability = normaliseAvailability(body.status);
    if (
      !canonicalAvailability
      || !AVAILABILITY_STATUSES.includes(canonicalAvailability as typeof AVAILABILITY_STATUSES[number])
    ) {
      return NextResponse.json({ error: 'Invalid availability status' }, { status: 400 });
    }
    const startAt = body.startAt ? new Date(body.startAt) : now;
    const endAt = body.endAt ? new Date(body.endAt) : null;
    if (Number.isNaN(startAt.getTime()) || (endAt && Number.isNaN(endAt.getTime()))) {
      return NextResponse.json({ error: 'Availability dates are invalid' }, { status: 400 });
    }
    if (endAt && endAt <= startAt) {
      return NextResponse.json({ error: 'Availability end must be after start' }, { status: 400 });
    }
    if (employee.employmentStatus !== 'active' && canonicalAvailability === 'available') {
      return NextResponse.json(
        { error: 'Only active employees can be marked available.' },
        { status: 409 },
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .update(employeeAvailability)
        .set({ isActive: false, endAt: now })
        .where(and(
          eq(employeeAvailability.employeeId, id),
          eq(employeeAvailability.tenantId, auth.session.tenantId),
          eq(employeeAvailability.isActive, true),
        ));
      await tx.insert(employeeAvailability).values({
        tenantId: auth.session.tenantId,
        employeeId: id,
        status: canonicalAvailability,
        startAt,
        endAt,
        reason: body.reason?.trim() || null,
        notes: body.notes?.trim() || null,
        enteredByUserId: auth.session.user.id,
      });
      await tx
        .update(employees)
        .set({ availabilityStatus: canonicalAvailability, updatedAt: now })
        .where(and(eq(employees.id, id), eq(employees.tenantId, auth.session.tenantId)));
      if (employee.isDriver) {
        await tx
          .update(driverProfiles)
          .set({
            availabilityStatus: driverAvailabilityFromEmployee(canonicalAvailability),
            unavailableUntil: endAt,
            updatedAt: now,
          })
          .where(eq(driverProfiles.employeeId, id));
      }
    });
    after = { availabilityStatus: canonicalAvailability, startAt, endAt };
  } else if (body.action === 'transfer') {
    if (!body.officeId || !body.jobTitle?.trim()) {
      return NextResponse.json({ error: 'Office and job title are required' }, { status: 400 });
    }
    if (body.supervisorEmployeeId === id) {
      return NextResponse.json({ error: 'An employee cannot supervise themselves.' }, { status: 400 });
    }

    const [[office], [department], [supervisor]] = await Promise.all([
      db
        .select({ id: offices.id })
        .from(offices)
        .where(and(
          eq(offices.id, body.officeId),
          eq(offices.tenantId, auth.session.tenantId),
          eq(offices.isActive, true),
        ))
        .limit(1),
      body.departmentId
        ? db
            .select({ id: departments.id })
            .from(departments)
            .where(and(
              eq(departments.id, body.departmentId),
              eq(departments.tenantId, auth.session.tenantId),
              eq(departments.isActive, true),
            ))
            .limit(1)
        : Promise.resolve([undefined] as const),
      body.supervisorEmployeeId
        ? db
            .select({ id: employees.id })
            .from(employees)
            .where(and(
              eq(employees.id, body.supervisorEmployeeId),
              eq(employees.tenantId, auth.session.tenantId),
              eq(employees.employmentStatus, 'active'),
            ))
            .limit(1)
        : Promise.resolve([undefined] as const),
    ]);

    if (!office) return NextResponse.json({ error: 'The selected office does not belong to this tenant.' }, { status: 400 });
    if (body.departmentId && !department) {
      return NextResponse.json({ error: 'The selected department does not belong to this tenant.' }, { status: 400 });
    }
    if (body.supervisorEmployeeId && !supervisor) {
      return NextResponse.json({ error: 'The selected supervisor is not an active employee in this tenant.' }, { status: 400 });
    }

    const jobTitle = body.jobTitle.trim();
    await db.transaction(async (tx) => {
      await tx
        .update(employeeAssignments)
        .set({ isCurrent: false, endDate: now.toISOString().slice(0, 10) })
        .where(and(
          eq(employeeAssignments.employeeId, id),
          eq(employeeAssignments.tenantId, auth.session.tenantId),
          eq(employeeAssignments.isCurrent, true),
        ));
      await tx.insert(employeeAssignments).values({
        tenantId: auth.session.tenantId,
        employeeId: id,
        officeId: office.id,
        departmentId: body.departmentId || null,
        jobTitle,
        position: body.position?.trim() || jobTitle,
        supervisorEmployeeId: body.supervisorEmployeeId || null,
        startDate: now.toISOString().slice(0, 10),
        reason: body.reason?.trim() || 'Transfer',
        createdByUserId: auth.session.user.id,
      });
      await tx
        .update(employees)
        .set({
          officeId: office.id,
          departmentId: body.departmentId || null,
          jobTitle,
          substantivePosition: body.position?.trim() || jobTitle,
          supervisorEmployeeId: body.supervisorEmployeeId || null,
          employmentStatus: 'active',
          updatedAt: now,
        })
        .where(and(eq(employees.id, id), eq(employees.tenantId, auth.session.tenantId)));
    });
    after = {
      officeId: office.id,
      departmentId: body.departmentId || null,
      jobTitle,
      supervisorEmployeeId: body.supervisorEmployeeId || null,
    };
  } else {
    return NextResponse.json({ error: 'Unsupported lifecycle action' }, { status: 400 });
  }

  await recordAuditEvent({
    tenantId: auth.session.tenantId,
    actorUserId: auth.session.user.id,
    action: `employee.${body.action}`,
    entityType: 'employee',
    entityId: id,
    before: employee,
    after,
    reason: body.reason,
    summary: `${employee.firstName} ${employee.lastName}: ${body.action}`,
  });
  return NextResponse.json({ success: true, data: after });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const roleCheck = await requireDashboardAction(auth.session, '/dashboard/staff', 'delete');
  if (roleCheck instanceof NextResponse) return roleCheck;
  const permission = await requirePermission(auth.session, Permissions.STAFF_LIFECYCLE_MANAGE);
  if (permission instanceof NextResponse) return permission;

  const { id } = await params;
  const employee = await getEmployee(id, auth.session.tenantId);
  if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  if (employee.userId) {
    return NextResponse.json(
      { error: 'This staff record is linked to a login account. Manage or remove account access from User Management, and archive the staff record when history must be preserved.' },
      { status: 409 },
    );
  }

  const db = getDb();
  const [requests, allocations, actions, audits, documents] = await Promise.all([
    db
      .select({ count: count() })
      .from(transportRequests)
      .where(and(eq(transportRequests.tenantId, auth.session.tenantId), eq(transportRequests.requesterEmployeeId, id))),
    db
      .select({ count: count() })
      .from(vehicleAllocations)
      .innerJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
      .where(and(eq(transportRequests.tenantId, auth.session.tenantId), eq(vehicleAllocations.driverEmployeeId, id))),
    db
      .select({ count: count() })
      .from(workflowActions)
      .where(eq(workflowActions.actorEmployeeId, id)),
    db
      .select({ count: count() })
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, auth.session.tenantId), eq(auditEvents.actorEmployeeId, id))),
    db
      .select({ count: count() })
      .from(employeeDocuments)
      .where(eq(employeeDocuments.employeeId, id)),
  ]);
  const dependencies =
    Number(requests[0]?.count ?? 0)
    + Number(allocations[0]?.count ?? 0)
    + Number(actions[0]?.count ?? 0)
    + Number(audits[0]?.count ?? 0)
    + Number(documents[0]?.count ?? 0);
  if (dependencies > 0) {
    return NextResponse.json(
      { error: 'This employee has historical records and must be archived instead of deleted.' },
      { status: 409 },
    );
  }

  await db
    .delete(employees)
    .where(and(eq(employees.id, id), eq(employees.tenantId, auth.session.tenantId)));
  await recordAuditEvent({
    tenantId: auth.session.tenantId,
    actorUserId: auth.session.user.id,
    action: 'employee.permanently_deleted',
    entityType: 'employee',
    before: employee,
    reason: 'No historical dependencies and no linked login account',
  });
  return NextResponse.json({ success: true });
}
