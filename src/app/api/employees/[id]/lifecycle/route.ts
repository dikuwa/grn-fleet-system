import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  auditEvents,
  driverProfiles,
  employeeAssignments,
  employeeAvailability,
  employeeDocuments,
  employees,
  tenantMemberships,
  transportRequests,
  userProfiles,
  vehicleAllocations,
  workflowActions,
} from '@/db/schema';
import { and, count, eq } from 'drizzle-orm';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { AVAILABILITY_STATUSES } from '@/lib/employee-lifecycle';
import { normaliseAvailability, normaliseEmployeeStatus } from '@/lib/employee-status';
import { recordAuditEvent } from '@/lib/audit-event';

async function getEmployee(id: string, tenantId: string) {
  const db = getDb();
  const [employee] = await db.select().from(employees)
    .where(and(eq(employees.id, id), eq(employees.tenantId, tenantId))).limit(1);
  return employee;
}

/**
 * Map an employee availability value to the driver-profile availability
 * vocabulary (available / assigned / unavailable / leave) so the staff record
 * and the driver roster never drift apart.
 */
function driverAvailabilityFromEmployee(status: string): string {
  if (status === 'available') return 'available';
  if (status === 'annual_leave' || status === 'sick_leave') return 'leave';
  return 'unavailable';
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
    db.select().from(employeeAssignments).where(eq(employeeAssignments.employeeId, id)),
    db.select().from(employeeAvailability).where(eq(employeeAvailability.employeeId, id)),
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

  const body = await request.json() as {
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
    supportingDocumentKey?: string;
    officeId?: string;
    departmentId?: string;
    jobTitle?: string;
    position?: string;
    supervisorEmployeeId?: string;
  };

  // Account-status mutations live in User Management and require the
  // dedicated user:manage-status capability — staff lifecycle rights alone
  // are never enough to toggle a login account.
  if (body.action === 'deactivate_account' || body.action === 'reactivate_account') {
    const accountPerm = await requirePermission(auth.session, Permissions.USER_MANAGE_STATUS);
    if (accountPerm instanceof NextResponse) return accountPerm;
  }
  const db = getDb();
  const now = new Date();
  let after: Record<string, unknown> = {};

  if (body.action === 'archive') {
    if (!body.reason?.trim()) return NextResponse.json({ error: 'Archive reason is required' }, { status: 400 });
    await db.update(employees).set({
      employmentStatus: 'archived',
      availabilityStatus: 'temporarily_unavailable',
      archivedAt: now,
      archivedByUserId: auth.session.user.id,
      updatedAt: now,
    }).where(eq(employees.id, id));
    // Keep the driver roster in lockstep: an archived employee is unavailable.
    if (employee.isDriver) {
      await db.update(driverProfiles)
        .set({ availabilityStatus: 'unavailable', unavailableUntil: null, updatedAt: now })
        .where(eq(driverProfiles.employeeId, id));
    }
    if (employee.userId) {
      await Promise.all([
        db.update(userProfiles).set({ accountEnabled: false, status: 'disabled', disabledAt: now, updatedAt: now })
          .where(eq(userProfiles.userId, employee.userId)),
        db.update(tenantMemberships).set({ status: 'inactive' })
          .where(and(eq(tenantMemberships.userId, employee.userId), eq(tenantMemberships.tenantId, auth.session.tenantId))),
      ]);
    }
    after = { employmentStatus: 'archived', accountEnabled: false };
  } else if (body.action === 'restore') {
    await db.update(employees).set({
      employmentStatus: 'active',
      availabilityStatus: 'available',
      archivedAt: null,
      archivedByUserId: null,
      updatedAt: now,
    }).where(eq(employees.id, id));
    // Restore the driver profile alongside the staff record.
    if (employee.isDriver) {
      await db.update(driverProfiles)
        .set({ availabilityStatus: 'available', unavailableUntil: null, updatedAt: now })
        .where(eq(driverProfiles.employeeId, id));
    }
    if (employee.userId) {
      await Promise.all([
        db.update(userProfiles).set({ accountEnabled: true, status: 'active', disabledAt: null, updatedAt: now })
          .where(eq(userProfiles.userId, employee.userId)),
        db.update(tenantMemberships).set({ status: 'active' })
          .where(and(eq(tenantMemberships.userId, employee.userId), eq(tenantMemberships.tenantId, auth.session.tenantId))),
      ]);
    }
    after = { employmentStatus: 'active', accountEnabled: true };
  } else if (body.action === 'status') {
    // Routine staff status changes only. Archiving, suspending and account
    // revocation have their own dedicated actions so that changing staff
    // status never silently changes user account status.
    const canonical = normaliseEmployeeStatus(body.status);
    if (!canonical || (canonical !== 'active' && canonical !== 'inactive')) {
      return NextResponse.json({ error: 'Invalid employment status. Use Mark Active or Mark Inactive for routine status changes.' }, { status: 400 });
    }
    await db.update(employees).set({ employmentStatus: canonical, updatedAt: now }).where(eq(employees.id, id));
    // An inactive employee must not remain selectable on the driver roster.
    // Marking active never auto-clears availability — being employed is not
    // the same as being available to drive, so that stays an explicit choice.
    if (employee.isDriver && canonical === 'inactive') {
      await db.update(driverProfiles)
        .set({ availabilityStatus: 'unavailable', updatedAt: now })
        .where(eq(driverProfiles.employeeId, id));
    }
    after = { employmentStatus: canonical };
  } else if (body.action === 'deactivate_account') {
    if (!employee.userId) return NextResponse.json({ error: 'Employee has no linked login account' }, { status: 400 });
    await Promise.all([
      db.update(userProfiles).set({ accountEnabled: false, status: 'disabled', disabledAt: now, updatedAt: now })
        .where(eq(userProfiles.userId, employee.userId)),
      db.update(tenantMemberships).set({ status: 'inactive' })
        .where(and(eq(tenantMemberships.userId, employee.userId), eq(tenantMemberships.tenantId, auth.session.tenantId))),
    ]);
    after = { accountEnabled: false };
  } else if (body.action === 'reactivate_account') {
    if (!employee.userId) return NextResponse.json({ error: 'Employee has no linked login account' }, { status: 400 });
    await Promise.all([
      db.update(userProfiles).set({ accountEnabled: true, status: 'active', disabledAt: null, updatedAt: now })
        .where(eq(userProfiles.userId, employee.userId)),
      db.update(tenantMemberships).set({ status: 'active' })
        .where(and(eq(tenantMemberships.userId, employee.userId), eq(tenantMemberships.tenantId, auth.session.tenantId))),
    ]);
    after = { accountEnabled: true };
  } else if (body.action === 'remove_driver') {
    await db.update(employees).set({ isDriver: false, updatedAt: now }).where(eq(employees.id, id));
    await db.update(driverProfiles)
      .set({ driverStatus: 'revoked', notes: body.reason || 'Driver designation removed', updatedAt: now })
      .where(eq(driverProfiles.employeeId, id));
    after = { isDriver: false, driverStatus: 'revoked' };
  } else if (body.action === 'availability') {
    const canonicalAvailability = normaliseAvailability(body.status);
    if (!canonicalAvailability || !AVAILABILITY_STATUSES.includes(canonicalAvailability as typeof AVAILABILITY_STATUSES[number])) {
      return NextResponse.json({ error: 'Invalid availability status' }, { status: 400 });
    }
    const startAt = body.startAt ? new Date(body.startAt) : now;
    const endAt = body.endAt ? new Date(body.endAt) : null;
    if (endAt && endAt <= startAt) return NextResponse.json({ error: 'Availability end must be after start' }, { status: 400 });
    await db.update(employeeAvailability).set({ isActive: false })
      .where(and(eq(employeeAvailability.employeeId, id), eq(employeeAvailability.isActive, true)));
    await db.insert(employeeAvailability).values({
      tenantId: auth.session.tenantId,
      employeeId: id,
      status: canonicalAvailability,
      startAt,
      endAt,
      reason: body.reason?.trim() || null,
      notes: body.notes?.trim() || null,
      supportingDocumentKey: body.supportingDocumentKey || null,
      enteredByUserId: auth.session.user.id,
    });
    await db.update(employees).set({ availabilityStatus: canonicalAvailability, updatedAt: now }).where(eq(employees.id, id));
    // Keep the driver profile in lockstep so leave/unavailable staff drop out
    // of driver allocation searches immediately.
    if (employee.isDriver) {
      await db.update(driverProfiles)
        .set({
          availabilityStatus: driverAvailabilityFromEmployee(canonicalAvailability),
          unavailableUntil: endAt,
          updatedAt: now,
        })
        .where(eq(driverProfiles.employeeId, id));
    }
    after = { availabilityStatus: canonicalAvailability, startAt, endAt };
  } else if (body.action === 'transfer') {
    if (!body.officeId || !body.jobTitle) return NextResponse.json({ error: 'Office and job title are required' }, { status: 400 });
    await db.update(employeeAssignments).set({ isCurrent: false, endDate: now.toISOString().slice(0, 10) })
      .where(and(eq(employeeAssignments.employeeId, id), eq(employeeAssignments.isCurrent, true)));
    await db.insert(employeeAssignments).values({
      tenantId: auth.session.tenantId,
      employeeId: id,
      officeId: body.officeId,
      departmentId: body.departmentId || null,
      jobTitle: body.jobTitle,
      position: body.position || body.jobTitle,
      supervisorEmployeeId: body.supervisorEmployeeId || null,
      startDate: now.toISOString().slice(0, 10),
      reason: body.reason || 'Transfer',
      createdByUserId: auth.session.user.id,
    });
    await db.update(employees).set({
      officeId: body.officeId,
      departmentId: body.departmentId || null,
      jobTitle: body.jobTitle,
      substantivePosition: body.position || body.jobTitle,
      supervisorEmployeeId: body.supervisorEmployeeId || null,
      employmentStatus: 'active',
      updatedAt: now,
    }).where(eq(employees.id, id));
    after = { officeId: body.officeId, departmentId: body.departmentId, jobTitle: body.jobTitle };
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
  const db = getDb();
  const [requests, allocations, actions, audits, documents] = await Promise.all([
    db.select({ count: count() }).from(transportRequests).where(eq(transportRequests.requesterEmployeeId, id)),
    db.select({ count: count() }).from(vehicleAllocations).where(eq(vehicleAllocations.driverEmployeeId, id)),
    db.select({ count: count() }).from(workflowActions).where(eq(workflowActions.actorEmployeeId, id)),
    db.select({ count: count() }).from(auditEvents).where(eq(auditEvents.actorEmployeeId, id)),
    db.select({ count: count() }).from(employeeDocuments).where(eq(employeeDocuments.employeeId, id)),
  ]);
  const dependencies = Number(requests[0].count) + Number(allocations[0].count) + Number(actions[0].count) + Number(audits[0].count) + Number(documents[0].count);
  if (dependencies > 0) {
    return NextResponse.json({ error: 'This employee has historical records and must be archived instead of deleted.' }, { status: 409 });
  }
  await db.delete(employees).where(eq(employees.id, id));
  await recordAuditEvent({
    tenantId: auth.session.tenantId,
    actorUserId: auth.session.user.id,
    action: 'employee.permanently_deleted',
    entityType: 'employee',
    before: employee,
    reason: 'No historical dependencies',
  });
  return NextResponse.json({ success: true });
}
