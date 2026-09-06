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
import { employees, driverProfiles, driverLicences, departments, offices } from '@/db/schema/people';
import { userProfiles } from '@/db/schema/auth';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { eq, and, or, ne, inArray, isNull, sql } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';
import { wouldDisableFinalActiveTenantAdministrator } from '@/lib/tenant-admin-integrity';
import { lockUserMembershipInvariant } from '@/lib/user-membership-integrity';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asDate(value: Date | string | null | undefined) {
  return value ? new Date(value) : null;
}

function assignmentIsActive(
  assignment: { startDate: Date | string | null; endDate: Date | string | null },
  now = new Date(),
) {
  const startsAt = asDate(assignment.startDate);
  const endsAt = asDate(assignment.endDate);
  return (!startsAt || startsAt <= now) && (!endsAt || endsAt > now);
}

function assignmentOverlapsWindow(
  assignment: { startDate: Date | string | null; endDate: Date | string | null },
  startsAt: Date,
  endsAt: Date | null,
) {
  const existingStart = asDate(assignment.startDate);
  const existingEnd = asDate(assignment.endDate);
  const existingStartsBeforeNewEnds = endsAt === null || existingStart === null || existingStart < endsAt;
  const newStartsBeforeExistingEnds = existingEnd === null || startsAt < existingEnd;
  return existingStartsBeforeNewEnds && newStartsBeforeExistingEnds;
}

function assignmentEndRevisionMatches(endDate: Date | string | null | undefined) {
  const reviewedEnd = asDate(endDate);
  return reviewedEnd
    ? sql`date_trunc('milliseconds', ${roleAssignments.endDate}) = ${reviewedEnd.toISOString()}::timestamptz`
    : isNull(roleAssignments.endDate);
}

async function requireTenantUserAdmin(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth;
  const permission = await requirePermission(auth.session, Permissions.TENANT_MANAGE);
  if (permission instanceof NextResponse) return { ok: false as const, error: permission };
  return auth;
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
    return NextResponse.json({ error: 'Failed to load user' }, { status: 500 });
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
    if (addRoleId && removeRoleId) {
      return NextResponse.json({ error: 'Add and remove role actions must be submitted separately' }, { status: 422 });
    }

    const db = getDb();
    const [membership] = await db
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.userId, id), eq(tenantMemberships.tenantId, session.tenantId)))
      .limit(1);
    if (!membership) return NextResponse.json({ error: 'User not found in your organisation' }, { status: 404 });

    const trimmedName = name === undefined ? undefined : typeof name === 'string' ? name.trim() : '';
    if (trimmedName !== undefined && !trimmedName) {
      return NextResponse.json({ error: 'User name cannot be empty' }, { status: 422 });
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
    }

    if (trimmedName !== undefined || tenantStatus !== undefined) {
      const updateResult = await db.transaction(async (tx) => {
        if (tenantStatus !== undefined && tenantStatus !== 'active') {
          const finalAdmin = await wouldDisableFinalActiveTenantAdministrator(
            tx,
            session.tenantId,
            id,
          );
          if (finalAdmin) return 'final-admin' as const;
        }

        if (tenantStatus !== undefined) {
          const [updatedMembership] = await tx
            .update(tenantMemberships)
            .set({ status: tenantStatus })
            .where(and(
              eq(tenantMemberships.id, membership.id),
              eq(tenantMemberships.tenantId, session.tenantId),
              eq(tenantMemberships.status, membership.status),
            ))
            .returning({ id: tenantMemberships.id });
          if (!updatedMembership) return 'conflict' as const;
        }

        if (trimmedName !== undefined) {
          await tx.update(user).set({ name: trimmedName, updatedAt: new Date() }).where(eq(user.id, id));
        }

        await recordAuditEvent({
          tenantId: session.tenantId,
          actorUserId: session.user.id,
          eventType: 'user_account_updated',
          action: 'update',
          entityType: 'tenant_membership',
          entityId: membership.id,
          before: { tenantStatus: membership.status },
          after: {
            userId: id,
            ...(trimmedName !== undefined ? { name: trimmedName } : {}),
            ...(tenantStatus !== undefined ? { tenantStatus } : {}),
          },
          summary: 'Tenant user account details updated',
        }, tx);
        return 'success' as const;
      });

      if (updateResult === 'final-admin') {
        return NextResponse.json(
          { error: 'The final active Tenant Administrator cannot be suspended or moved to pending activation.' },
          { status: 409 },
        );
      }
      if (updateResult === 'conflict') {
        return NextResponse.json(
          { error: 'This tenant membership changed while the update was being prepared. Refresh User Management and review the current status before trying again.' },
          { status: 409 },
        );
      }
    }

    if (addRoleId) {
      if (!UUID_PATTERN.test(String(addRoleId))) {
        return NextResponse.json({ error: 'Role not found' }, { status: 404 });
      }
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
      if (roleHistory.some((assignment) => assignmentOverlapsWindow(assignment, startsAt, endsAt))) {
        return NextResponse.json(
          { error: 'This user already holds the selected role during part or all of the requested period' },
          { status: 409 },
        );
      }

      const [employee] = role.name === 'Assigned Driver'
        ? await db
            .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
            .from(employees)
            .where(and(
              eq(employees.userId, id),
              eq(employees.tenantId, session.tenantId),
              eq(employees.employmentStatus, 'active'),
            ))
            .limit(1)
        : [];
      if (role.name === 'Assigned Driver' && !employee) {
        return NextResponse.json(
          { error: 'Assigned Driver can only be granted to a login account linked to an active staff record' },
          { status: 422 },
        );
      }

      const [existingProfile] = employee
        ? await db
            .select({
              id: driverProfiles.id,
              driverStatus: driverProfiles.driverStatus,
              availabilityStatus: driverProfiles.availabilityStatus,
            })
            .from(driverProfiles)
            .where(eq(driverProfiles.employeeId, employee.id))
            .limit(1)
        : [];

      let hasValidVerifiedLicence = false;
      if (existingProfile) {
        const verifiedLicences = await db
          .select({ expiryDate: driverLicences.expiryDate })
          .from(driverLicences)
          .where(and(
            eq(driverLicences.driverProfileId, existingProfile.id),
            eq(driverLicences.verificationStatus, 'verified'),
            eq(driverLicences.isActive, true),
          ));
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        hasValidVerifiedLicence = verifiedLicences.some((licence) => {
          const expiry = new Date(licence.expiryDate);
          expiry.setHours(0, 0, 0, 0);
          return expiry >= today;
        });
      }

      await db.transaction(async (tx) => {
        const [assignment] = await tx.insert(roleAssignments).values({
          tenantMembershipId: membership.id,
          roleId: role.id,
          startDate: startsAt,
          endDate: endsAt,
        }).returning({ id: roleAssignments.id });

        let driverProfileId: string | null = existingProfile?.id ?? null;
        let driverLifecycle: string | null = null;
        let driverAvailability: string | null = null;
        if (employee) {
          if (!existingProfile) {
            const [profile] = await tx.insert(driverProfiles).values({
              employeeId: employee.id,
              driverStatus: 'pending_verification',
              availabilityStatus: 'unavailable',
              notes: 'Auto-provisioned from Assigned Driver role. Licence upload and verification are required before operational assignment.',
            }).returning({ id: driverProfiles.id });
            driverProfileId = profile.id;
            driverLifecycle = 'pending_verification';
            driverAvailability = 'unavailable';
          } else if (existingProfile.driverStatus === 'suspended') {
            driverLifecycle = 'suspended';
            driverAvailability = 'unavailable';
            await tx
              .update(driverProfiles)
              .set({ availabilityStatus: 'unavailable', updatedAt: new Date() })
              .where(eq(driverProfiles.id, existingProfile.id));
          } else if (hasValidVerifiedLicence) {
            driverLifecycle = 'authorised';
            driverAvailability = existingProfile.availabilityStatus || 'available';
            await tx
              .update(driverProfiles)
              .set({ driverStatus: 'authorised', updatedAt: new Date() })
              .where(eq(driverProfiles.id, existingProfile.id));
          } else {
            driverLifecycle = 'pending_verification';
            driverAvailability = 'unavailable';
            await tx
              .update(driverProfiles)
              .set({
                driverStatus: 'pending_verification',
                availabilityStatus: 'unavailable',
                updatedAt: new Date(),
              })
              .where(eq(driverProfiles.id, existingProfile.id));
          }

          await tx
            .update(employees)
            .set({ isDriver: true, updatedAt: new Date() })
            .where(and(eq(employees.id, employee.id), eq(employees.tenantId, session.tenantId)));
        }

        await recordAuditEvent({
          tenantId: session.tenantId,
          actorUserId: session.user.id,
          eventType: 'role_assignment_created',
          action: 'create',
          entityType: 'role_assignment',
          entityId: assignment.id,
          after: {
            userId: id,
            roleId: role.id,
            roleName: role.name,
            startDate: startsAt,
            endDate: endsAt,
            ...(driverProfileId ? {
              driverProfileId,
              driverStatus: driverLifecycle,
              driverAvailability,
              driverLicenceVerificationRequired: driverLifecycle !== 'authorised',
            } : {}),
          },
          summary: `Role assigned: ${role.name}`,
        }, tx);
      });
    }

    if (removeRoleId) {
      if (!UUID_PATTERN.test(String(removeRoleId))) {
        return NextResponse.json({ error: 'Role assignment not found' }, { status: 404 });
      }
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
      const assignmentStart = asDate(assignment.startDate);
      const existingEnd = asDate(assignment.endDate);
      if (!existingEnd || existingEnd > now) {
        const endedAt = assignmentStart && assignmentStart > now ? assignmentStart : now;
        const removalResult = await db.transaction(async (tx) => {
          if (assignmentIsActive(assignment, now) && assignment.roleName === 'Tenant Administrator') {
            const finalAdmin = await wouldDisableFinalActiveTenantAdministrator(
              tx,
              session.tenantId,
              id,
              now,
            );
            if (finalAdmin) return 'final-admin' as const;
          }

          const [endedAssignment] = await tx
            .update(roleAssignments)
            .set({ endDate: endedAt })
            .where(and(
              eq(roleAssignments.id, assignment.id),
              eq(roleAssignments.tenantMembershipId, membership.id),
              assignmentEndRevisionMatches(assignment.endDate),
            ))
            .returning({ id: roleAssignments.id });
          if (!endedAssignment) return 'conflict' as const;

          await recordAuditEvent({
            tenantId: session.tenantId,
            actorUserId: session.user.id,
            eventType: assignmentStart && assignmentStart > now ? 'role_assignment_cancelled' : 'role_assignment_ended',
            action: 'update',
            entityType: 'role_assignment',
            entityId: assignment.id,
            summary: assignmentStart && assignmentStart > now
              ? `Scheduled role assignment cancelled: ${assignment.roleName}`
              : `Role assignment ended: ${assignment.roleName}`,
            before: { startDate: assignment.startDate, endDate: assignment.endDate },
            after: { roleName: assignment.roleName, endedAt: endedAt.toISOString(), historyPreserved: true },
          }, tx);
          return 'success' as const;
        });

        if (removalResult === 'final-admin') {
          return NextResponse.json(
            { error: 'This is the final active Tenant Administrator and the role cannot be removed.' },
            { status: 409 },
          );
        }
        if (removalResult === 'conflict') {
          return NextResponse.json(
            { error: 'This role assignment changed while the removal was being prepared. Refresh User Management and review the current role state before trying again.' },
            { status: 409 },
          );
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Admin User Detail] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
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
        .innerJoin(transportRequests, eq(transportRequests.id, vehicleAllocations.requestId))
        .where(and(
          eq(vehicleAllocations.driverEmployeeId, employee.id),
          eq(transportRequests.tenantId, session.tenantId),
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

    const removalResult = await db.transaction(async (tx) => {
      const finalAdmin = await wouldDisableFinalActiveTenantAdministrator(
        tx,
        session.tenantId,
        id,
        now,
      );
      if (finalAdmin) return { state: 'final-admin' as const };

      await lockUserMembershipInvariant(tx, id);
      const otherMemberships = await tx
        .select({ id: tenantMemberships.id, status: tenantMemberships.status })
        .from(tenantMemberships)
        .where(and(eq(tenantMemberships.userId, id), ne(tenantMemberships.id, membership.id)));
      const hasRemainingMembership = otherMemberships.some(
        (otherMembership) => otherMembership.status !== 'access_removed',
      );
      const revokeGlobalAccount = !hasRemainingMembership;

      const [removedMembership] = await tx
        .update(tenantMemberships)
        .set({ status: 'access_removed' })
        .where(and(
          eq(tenantMemberships.id, membership.id),
          eq(tenantMemberships.tenantId, session.tenantId),
          eq(tenantMemberships.status, membership.status),
        ))
        .returning({ id: tenantMemberships.id });
      if (!removedMembership) return { state: 'conflict' as const };

      if (revokeGlobalAccount) {
        await tx.delete(sessionTable).where(eq(sessionTable.userId, id));
        await tx.delete(verification).where(or(eq(verification.identifier, userRecord.email), eq(verification.identifier, id)));
        await tx
          .update(userProfiles)
          .set({
            status: 'removed',
            accountEnabled: false,
            disabledAt: now,
            updatedAt: now,
          })
          .where(eq(userProfiles.userId, id));
      }

      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.user.id,
        eventType: 'user_access_removed',
        action: 'delete',
        entityType: 'tenant_membership',
        entityId: membership.id,
        summary: 'User access removed from the organisation. The linked staff record was preserved.',
        after: {
          userId: id,
          userEmail: userRecord.email,
          staffRecordPreserved: true,
          activeRoleCount: activeAssignments.length,
          futureOrHistoricalRoleRecordsPreserved: assignments.length,
          otherMembershipsPreserved: otherMemberships.length,
          globalAccountRevoked: revokeGlobalAccount,
          sessionsRevoked: revokeGlobalAccount,
          verificationTokensInvalidated: revokeGlobalAccount,
          removedAt: now.toISOString(),
          accountStatus: 'access_removed',
        },
      }, tx);

      return { state: 'success' as const };
    });

    if (removalResult.state === 'final-admin') {
      return NextResponse.json({ error: 'The final active Tenant Administrator cannot be removed.' }, { status: 409 });
    }
    if (removalResult.state === 'conflict') {
      return NextResponse.json(
        { error: 'This tenant membership changed while account removal was being prepared. Refresh User Management and review the current state before trying again.' },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Admin User Detail] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to remove user' }, { status: 500 });
  }
}
