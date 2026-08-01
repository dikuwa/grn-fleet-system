import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { employees, roleDelegations, roles, offices, departments } from '@/db/schema';
import { regions } from '@/db/schema/fleet';
import { and, asc, eq, gt, inArray, lt, or } from 'drizzle-orm';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { findDelegationConflicts } from '@/lib/employee-lifecycle';
import { recordAuditEvent } from '@/lib/audit-event';

export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const permission = await requirePermission(auth.session, Permissions.STAFF_VIEW);
  if (permission instanceof NextResponse) return permission;
  const db = getDb();
  const now = new Date();
  await db.update(roleDelegations).set({ status: 'active', updatedAt: now })
    .where(and(eq(roleDelegations.tenantId, auth.session.tenantId), eq(roleDelegations.status, 'scheduled'), lt(roleDelegations.startAt, now), gt(roleDelegations.endAt, now)));
  await db.update(roleDelegations).set({ status: 'expired', updatedAt: now })
    .where(and(eq(roleDelegations.tenantId, auth.session.tenantId), inArray(roleDelegations.status, ['scheduled', 'active']), lt(roleDelegations.endAt, now)));

  const rows = await db.select({
    id: roleDelegations.id,
    roleId: roleDelegations.roleId,
    roleName: roles.name,
    substantiveHolderEmployeeId: roleDelegations.substantiveHolderEmployeeId,
    actingEmployeeId: roleDelegations.actingEmployeeId,
    actingFirstName: employees.firstName,
    actingLastName: employees.lastName,
    actingTitle: roleDelegations.actingTitle,
    officeId: roleDelegations.officeId,
    departmentId: roleDelegations.departmentId,
    regionId: roleDelegations.regionId,
    startAt: roleDelegations.startAt,
    endAt: roleDelegations.endAt,
    reason: roleDelegations.reason,
    status: roleDelegations.status,
    canApprove: roleDelegations.canApprove,
    canSign: roleDelegations.canSign,
    appointmentMemoKey: roleDelegations.appointmentMemoKey,
    overrideReason: roleDelegations.overrideReason,
  }).from(roleDelegations)
    .innerJoin(roles, eq(roles.id, roleDelegations.roleId))
    .innerJoin(employees, eq(employees.id, roleDelegations.actingEmployeeId))
    .where(eq(roleDelegations.tenantId, auth.session.tenantId))
    .orderBy(asc(roleDelegations.startAt));
  return NextResponse.json({ data: rows, now });
}

export async function POST(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const roleCheck = await requireDashboardAction(auth.session, '/dashboard/delegations', 'create');
  if (roleCheck instanceof NextResponse) return roleCheck;
  const permission = await requirePermission(auth.session, Permissions.DELEGATION_MANAGE);
  if (permission instanceof NextResponse) return permission;
  const body = await request.json() as {
    roleId: string;
    substantiveHolderEmployeeId?: string;
    actingEmployeeId: string;
    actingTitle: string;
    officeId?: string;
    departmentId?: string;
    regionId?: string;
    startAt: string;
    endAt: string;
    reason: string;
    approvalAuthority?: string;
    canApprove?: boolean;
    canSign?: boolean;
    canAllocateVehicles?: boolean;
    canAssignDrivers?: boolean;
    canReconcileTrips?: boolean;
    canDelegateFurther?: boolean;
    appointmentMemoKey?: string;
    overrideReason?: string;
  };
  if (!body.roleId || !body.actingEmployeeId || !body.actingTitle?.trim() || !body.reason?.trim()) {
    return NextResponse.json({ error: 'Role, acting employee, acting title, and reason are required' }, { status: 400 });
  }
  const startAt = new Date(body.startAt);
  const endAt = new Date(body.endAt);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return NextResponse.json({ error: 'Valid start and end dates are required' }, { status: 400 });
  }
  const db = getDb();
  const [[employee], [role], existing, [office], [department], [region]] = await Promise.all([
    db.select().from(employees).where(and(eq(employees.id, body.actingEmployeeId), eq(employees.tenantId, auth.session.tenantId))).limit(1),
    db.select().from(roles).where(and(eq(roles.id, body.roleId), eq(roles.tenantId, auth.session.tenantId))).limit(1),
    db.select({
      actingEmployeeId: roleDelegations.actingEmployeeId,
      roleId: roleDelegations.roleId,
      startAt: roleDelegations.startAt,
      endAt: roleDelegations.endAt,
      status: roleDelegations.status,
    }).from(roleDelegations).where(and(
      eq(roleDelegations.tenantId, auth.session.tenantId),
      or(eq(roleDelegations.roleId, body.roleId), eq(roleDelegations.actingEmployeeId, body.actingEmployeeId)),
      lt(roleDelegations.startAt, endAt),
      gt(roleDelegations.endAt, startAt),
    )),
    body.officeId
      ? db.select({ id: offices.id }).from(offices)
          .where(and(eq(offices.id, body.officeId), eq(offices.tenantId, auth.session.tenantId))).limit(1)
      : Promise.resolve([undefined] as const),
    body.departmentId
      ? db.select({ id: departments.id }).from(departments)
          .where(and(eq(departments.id, body.departmentId), eq(departments.tenantId, auth.session.tenantId))).limit(1)
      : Promise.resolve([undefined] as const),
    body.regionId
      ? db.select({ id: regions.id }).from(regions)
          .where(and(eq(regions.id, body.regionId), eq(regions.tenantId, auth.session.tenantId))).limit(1)
      : Promise.resolve([undefined] as const),
  ]);
  if (!employee || !role) return NextResponse.json({ error: 'Employee or role was not found in your organisation' }, { status: 404 });
  if (body.officeId && !office) return NextResponse.json({ error: 'Office scope was not found in your organisation' }, { status: 404 });
  if (body.departmentId && !department) return NextResponse.json({ error: 'Department scope was not found in your organisation' }, { status: 404 });
  if (body.regionId && !region) return NextResponse.json({ error: 'Region scope was not found in your organisation' }, { status: 404 });
  if (!employee.userId && (body.canApprove || body.canSign)) {
    return NextResponse.json({ error: 'An acting approver or signatory must have an active user account' }, { status: 400 });
  }
  const conflicts = findDelegationConflicts({
    actingEmployeeId: employee.id,
    roleId: role.id,
    substantiveHolderEmployeeId: body.substantiveHolderEmployeeId,
    startAt,
    endAt,
    actingEmployeeStatus: employee.employmentStatus,
    actingAvailability: employee.availabilityStatus,
    existing,
  });
  if (conflicts.length && !body.overrideReason?.trim()) {
    return NextResponse.json({ error: 'Delegation conflicts must be resolved or overridden', conflicts }, { status: 409 });
  }
  const now = new Date();
  const [delegation] = await db.insert(roleDelegations).values({
    tenantId: auth.session.tenantId,
    roleId: body.roleId,
    substantiveHolderEmployeeId: body.substantiveHolderEmployeeId || null,
    actingEmployeeId: body.actingEmployeeId,
    actingTitle: body.actingTitle.trim(),
    officeId: body.officeId || null,
    departmentId: body.departmentId || null,
    regionId: body.regionId || null,
    startAt,
    endAt,
    reason: body.reason.trim(),
    approvalAuthority: body.approvalAuthority || null,
    canApprove: body.canApprove || false,
    canSign: body.canSign || false,
    canAllocateVehicles: body.canAllocateVehicles || false,
    canAssignDrivers: body.canAssignDrivers || false,
    canReconcileTrips: body.canReconcileTrips || false,
    canDelegateFurther: body.canDelegateFurther || false,
    appointmentMemoKey: body.appointmentMemoKey || null,
    createdByUserId: auth.session.user.id,
    authorisedByUserId: auth.session.user.id,
    status: startAt <= now && endAt > now ? 'active' : 'scheduled',
    overrideReason: body.overrideReason || null,
  }).returning();
  await recordAuditEvent({
    tenantId: auth.session.tenantId,
    actorUserId: auth.session.user.id,
    action: 'delegation.created',
    entityType: 'role_delegation',
    entityId: delegation.id,
    after: { ...delegation, conflicts },
    reason: body.reason,
    summary: `${employee.firstName} ${employee.lastName} appointed ${body.actingTitle}`,
    isActing: true,
  });
  return NextResponse.json({ data: delegation, conflicts }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const roleCheck = await requireDashboardAction(auth.session, '/dashboard/delegations', 'update');
  if (roleCheck instanceof NextResponse) return roleCheck;
  const permission = await requirePermission(auth.session, Permissions.DELEGATION_MANAGE);
  if (permission instanceof NextResponse) return permission;
  const body = await request.json() as { id: string; action: 'revoke' | 'cancel'; reason: string };
  if (!body.id || !body.reason?.trim()) return NextResponse.json({ error: 'Delegation and reason are required' }, { status: 400 });
  const db = getDb();
  const [existing] = await db.select().from(roleDelegations)
    .where(and(eq(roleDelegations.id, body.id), eq(roleDelegations.tenantId, auth.session.tenantId))).limit(1);
  if (!existing) return NextResponse.json({ error: 'Delegation not found' }, { status: 404 });
  const status = body.action === 'cancel' ? 'cancelled' : 'revoked';
  await db.update(roleDelegations).set({
    status,
    revokedAt: new Date(),
    revokedByUserId: auth.session.user.id,
    revocationReason: body.reason,
    updatedAt: new Date(),
  }).where(eq(roleDelegations.id, body.id));
  await recordAuditEvent({
    tenantId: auth.session.tenantId,
    actorUserId: auth.session.user.id,
    action: `delegation.${status}`,
    entityType: 'role_delegation',
    entityId: body.id,
    before: existing,
    after: { status },
    reason: body.reason,
  });
  return NextResponse.json({ success: true });
}
