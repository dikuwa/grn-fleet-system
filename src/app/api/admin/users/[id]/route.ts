/**
 * Tenant User detail and access-lifecycle API.
 *
 * User Management controls the login account/membership. Staff Management
 * remains the source of truth for the employee record, which is deliberately
 * preserved when account access is removed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { user, session as sessionTable, verification } from '@/db/schema/better-auth';
import { tenantMemberships, roleAssignments, roles } from '@/db/schema/tenants';
import { employees, driverProfiles, departments, offices } from '@/db/schema/people';
import { userProfiles } from '@/db/schema/auth';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { eq, and, or, ne, inArray } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';

function assignmentIsActive(
  assignment: { startDate: Date | string | null; endDate: Date | string | null },
  now = new Date(),
) {
  const startsAt = assignment.startDate ? new Date(assignment.startDate) : null;
  const endsAt = assignment.endDate ? new Date(assignment.endDate) : null;
  return (!startsAt || startsAt <= now) && (!endsAt || endsAt > now);
}

async function requireTenantUserAdmin(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth;
  const permission = await requirePermission(auth.session, Permissions.TENANT_MANAGE);
  if (permission instanceof NextResponse) return { ok: false as const, error: permission };
  return auth;
}

async function activeTenantAdministrators(tenantId: string) {
  const db = getDb();
  const rows = await db
    .select({
      userId: tenantMemberships.userId,
      membershipStatus: tenantMemberships.status,
      startDate: roleAssignments.startDate,
      endDate: roleAssignments.endDate,
    })
    .from(roleAssignments)
    .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
    .innerJoin(tenantMemberships, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(roles.name, 'Tenant Administrator')));

  const now = new Date();
  return Array.from(new Set(
    rows
      .filter((row) => row.membershipStatus === 'active' && assignmentIsActive(row, now))
      .map((row) => row.userId),
  ));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireTenantUserAdmin(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const db = getDb();

    const [membership] = await db
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.userId, id), eq(tenantMemberships.tenantId, session.tenantId)))
      .limit(1);
    if (!membership) return NextResponse.json({ error: 'User not found in your organisation' }, { status: 404 });

    const [userRecord] = await db.select().from(user).where(eq(user.id, id)).limit(1);
    if (!userRecord) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const assignments = await db
      .select({
        id: roleAssignments.id,
        roleId: roleAssignments.roleId,
        roleName: roles.name,
        startDate: roleAssignments.startDate,
        endDate: roleAssignments.endDate,
        isActing: roleAssignments.isActing,
      })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(eq(roleAssignments.tenantMembershipId, membership.id));

    const availableRoles = await db
      .select()
      .from(roles)
      .where(eq(roles.tenantId, session.tenantId));

    const [linkedEmployee] = await db
      .select({
        id: employees.id,
        employeeNumber: employees.employeeNumber,
        firstName: employees.firstName,
        lastName: employees.lastName,
        email: employees.email,
        employmentStatus: employees.employmentStatus,
        jobTitle: employees.jobTitle,
        departmentId: departments.id,
        departmentName: departments.name,
        officeId: offices.id,
        officeName: offices.name,
        isDriver: employees.isDriver,
      })
      .from(employees)
      .leftJoin(departments, eq(employees.departmentId, departments.id))
      .leftJoin(offices, eq(employees.officeId, offices.id))
      .where(and(eq(employees.userId, id), eq(employees.tenantId, session.tenantId)))
      .limit(1);

    const now = new Date();
    return NextResponse.json({
      success: true,
      data: {
        ...userRecord,
        tenantStatus: membership.status,
        joinedAt: membership.joinedAt,
        roleAssignments: assignments.map((assignment) => ({
          ...assignment,
          isActive: assignmentIsActive(assignment, now),
        })),
        availableRoles,
        linkedEmployee: linkedEmployee || null,
      },
    });
  } catch (error) {
    console.error('[Admin User Detail] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load user: ' + String(error) }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireTenantUserAdmin(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const body = await request.json();
    const { name, tenantStatus, addRoleId, removeRoleId, startDate, endDate } = body;

    if (tenantStatus !== undefined) {
      const statusPermission = await requirePermission(session, Permissions.USER_MANAGE_STATUS);
      if (statusPermission instanceof NextResponse) return statusPermission;
      if (!['active', 'suspended', 'pending_activation'].includes(String(tenantStatus))) {
        return NextResponse.json({ error: 'Unsupported tenant membership status' }, { status: 422 });
      }
    }

    const db = getDb();
    const [membership] = await db
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.userId, id), eq(tenantMemberships.tenantId, session.tenantId)))
      .limit(1);
    if (!membership) return NextResponse.json({ error: 'User not found in your organisation' }, { status: 404 });

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return NextResponse.json({ error: 'User name cannot be empty' }, { status: 422 });
      }
      await db.update(user).set({ name: name.trim(), updatedAt: new Date() }).where(eq(user.id, id));
    }

    if (tenantStatus !== undefined) {
      if (membership.status === 'access_removed') {
        return NextResponse.json(
          { error: 'This account has been removed. Use Restore User Access to re-activate it.' },
          { status: 409 },
        );
      }
      if (tenantStatus !== 'active' && id === session.user.id) {
        return NextResponse.json({ error: 'You cannot suspend or deactivate your own active membership.' }, { status: 409 });
      }
      if (tenantStatus !== 'active') {
        const admins = await activeTenantAdministrators(session.tenantId);
        if (admins.length === 1 && admins[0] === id) {
          return NextResponse.json({ error: 'The final active Tenant Administrator cannot be suspended or moved to pending activation.' }, { status: 409 });
        }
      }
      await db.update(tenantMemberships).set({ status: tenantStatus }).where(eq(tenantMemberships.id, membership.id));
    }

    if (addRoleId) {
      const [role] = await db
        .select()
        .from(roles)
        .where(and(eq(roles.id, String(addRoleId)), eq(roles.tenantId, session.tenantId)))
        .limit(1);
      if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 });

      const startsAt = startDate ? new Date(startDate) : new Date();
      const endsAt = endDate ? new Date(endDate) : null;
      if (Number.isNaN(startsAt.getTime()) || (endsAt && Number.isNaN(endsAt.getTime()))) {
        return NextResponse.json({ error: 'Role dates are invalid' }, { status: 422 });
      }
      if (endsAt && endsAt <= startsAt) {
        return NextResponse.json({ error: 'Role end date must be after its start date' }, { status: 422 });
      }

      const roleHistory = await db
        .select({ id: roleAssignments.id, startDate: roleAssignments.startDate, endDate: roleAssignments.endDate })
        .from(roleAssignments)
        .where(and(eq(roleAssignments.tenantMembershipId, membership.id), eq(roleAssignments.roleId, role.id)));
      const hasActiveAssignment = roleHistory.some((assignment) => assignmentIsActive(assignment));
      if (!hasActiveAssignment) {
        await db.insert(roleAssignments).values({
          tenantMembershipId: membership.id,
          roleId: role.id,
          startDate: startsAt,
          endDate: endsAt,
        });

        if (role.name === 'Assigned Driver') {
          const [employee] = await db
            .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
            .from(employees)
            .where(and(eq(employees.userId, id), eq(employees.tenantId, session.tenantId)))
            .limit(1);
          if (employee) {
            const [existingProfile] = await db
              .select({ id: driverProfiles.id })
              .from(driverProfiles)
              .where(eq(driverProfiles.employeeId, employee.id))
              .limit(1);
            if (!existingProfile) {
              const [profile] = await db.insert(driverProfiles).values({
                employeeId: employee.id,
                driverStatus: 'authorised',
                availabilityStatus: 'available',
                notes: 'Auto-provisioned from Driver role assignment. Awaiting licence upload and verification.',
              }).returning();
              await db.update(employees).set({ isDriver: true, updatedAt: new Date() }).where(eq(employees.id, employee.id));
              await recordAuditEvent({
                tenantId: session.tenantId,
                actorUserId: session.user.id,
                action: 'driver_profile.auto_provisioned',
                entityType: 'driver_profile',
                entityId: profile.id,
                summary: `Driver profile auto-created for ${employee.firstName} ${employee.lastName} via role assignment`,
                after: { driverStatus: 'authorised', roleAssigned: role.name },
              }).catch(() => undefined);
            } else {
              await db.update(driverProfiles).set({ driverStatus: 'authorised', updatedAt: new Date() }).where(eq(driverProfiles.id, existingProfile.id));
              await db.update(employees).set({ isDriver: true, updatedAt: new Date() }).where(eq(employees.id, employee.id));
            }
          }
        }
      }
    }

    if (removeRoleId) {
      const [assignment] = await db
        .select({
          id: roleAssignments.id,
          roleName: roles.name,
          startDate: roleAssignments.startDate,
          endDate: roleAssignments.endDate,
        })
        .from(roleAssignments)
        .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
        .where(and(eq(roleAssignments.id, String(removeRoleId)), eq(roleAssignments.tenantMembershipId, membership.id)))
        .limit(1);
      if (!assignment) return NextResponse.json({ error: 'Role assignment not found' }, { status: 404 });

      const now = new Date();
      if (assignmentIsActive(assignment, now) && assignment.roleName === 'Tenant Administrator') {
        const admins = await activeTenantAdministrators(session.tenantId);
        if (admins.length <= 1 && admins.includes(id)) {
          return NextResponse.json(
            { error: 'This is the final active Tenant Administrator and the role cannot be removed.' },
            { status: 409 },
          );
        }
      }

      if (!assignment.endDate || new Date(assignment.endDate) > now) {
        await db.update(roleAssignments).set({ endDate: now }).where(eq(roleAssignments.id, assignment.id));
      }
      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.user.id,
        action: 'role_assignment.ended',
        entityType: 'role_assignment',
        entityId: assignment.id,
        summary: `Role assignment for ${assignment.roleName} closed on ${now.toISOString()}`,
        before: { startDate: assignment.startDate, endDate: assignment.endDate },
        after: { roleName: assignment.roleName, endedAt: now.toISOString(), historyPreserved: true },
      }).catch(() => undefined);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Admin User Detail] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update user: ' + String(error) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireTenantUserAdmin(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    if (id === session.user.id) {
      return NextResponse.json({ error: 'You cannot remove your own account from the organisation.' }, { status: 400 });
    }

    const db = getDb();
    const [membership] = await db
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.userId, id), eq(tenantMemberships.tenantId, session.tenantId)))
      .limit(1);
    if (!membership) return NextResponse.json({ error: 'User not found in your organisation' }, { status: 404 });

    const [userRecord] = await db.select({ id: user.id, email: user.email }).from(user).where(eq(user.id, id)).limit(1);
    if (!userRecord) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const now = new Date();
    const assignments = await db
      .select({
        id: roleAssignments.id,
        roleName: roles.name,
        startDate: roleAssignments.startDate,
        endDate: roleAssignments.endDate,
      })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(eq(roleAssignments.tenantMembershipId, membership.id));

    const activeAssignments = assignments.filter((assignment) => assignmentIsActive(assignment, now));
    if (activeAssignments.length > 0) {
      const names = activeAssignments.map((assignment) => assignment.roleName).join(', ');
      return NextResponse.json(
        {
          error: `This user still holds active role${activeAssignments.length === 1 ? '' : 's'}: ${names}. Remove active roles first. Historical and future-dated role records do not block account removal.`,
        },
        { status: 409 },
      );
    }

    const admins = await activeTenantAdministrators(session.tenantId);
    if (admins.length === 1 && admins[0] === id) {
      return NextResponse.json({ error: 'The final active Tenant Administrator cannot be removed.' }, { status: 409 });
    }

    const [employee] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.userId, id), eq(employees.tenantId, session.tenantId)))
      .limit(1);
    if (employee) {
      const [openTrip] = await db
        .select({ id: trips.id })
        .from(trips)
        .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, trips.allocationId))
        .where(and(
          eq(vehicleAllocations.driverEmployeeId, employee.id),
          eq(trips.tenantId, session.tenantId),
          ne(trips.status, 'closed'),
          ne(trips.status, 'cancelled'),
        ))
        .limit(1);
      if (openTrip) {
        return NextResponse.json(
          { error: 'This user still has active trip responsibilities that must be reassigned before account access can be removed.' },
          { status: 409 },
        );
      }

      const [openAllocation] = await db
        .select({ id: vehicleAllocations.id })
        .from(vehicleAllocations)
        .where(and(
          eq(vehicleAllocations.driverEmployeeId, employee.id),
          inArray(vehicleAllocations.state, ['provisional', 'confirmed', 'released']),
        ))
        .limit(1);
      if (openAllocation) {
        return NextResponse.json(
          { error: 'This user still has a live vehicle allocation that must be cancelled or reassigned first.' },
          { status: 409 },
        );
      }
    }

    await db.delete(sessionTable).where(eq(sessionTable.userId, id));
    await db.delete(verification).where(or(eq(verification.identifier, userRecord.email), eq(verification.identifier, id)));
    await db.update(tenantMemberships).set({ status: 'access_removed' }).where(eq(tenantMemberships.id, membership.id));
    await db.update(userProfiles).set({ status: 'removed', updatedAt: new Date() }).where(eq(userProfiles.userId, id));

    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      action: 'user_membership.removed',
      entityType: 'tenant_membership',
      entityId: membership.id,
      summary: 'User access removed from the organisation. The linked staff record was preserved.',
      after: {
        userId: id,
        userEmail: userRecord.email,
        staffRecordPreserved: true,
        activeRoleCount: activeAssignments.length,
        futureOrHistoricalRoleRecordsPreserved: assignments.length,
        sessionsRevoked: true,
        verificationTokensInvalidated: true,
        removedAt: now.toISOString(),
        accountStatus: 'access_removed',
      },
    }).catch(() => undefined);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Admin User Detail] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to remove user: ' + String(error) }, { status: 500 });
  }
}
