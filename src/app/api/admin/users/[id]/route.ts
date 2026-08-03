/**
 * Admin User Detail API
 *
 * GET    /api/admin/users/[id]    — Get user details with roles
 * PATCH  /api/admin/users/[id]    — Update user (name, status, role)
 * DELETE /api/admin/users/[id]    — Remove a role-less/pending user from the organisation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { user, session as sessionTable, verification } from '@/db/schema/better-auth';
import { tenantMemberships, roleAssignments, roles } from '@/db/schema/tenants';
import { employees, driverProfiles, departments, offices } from '@/db/schema/people';
import { userProfiles } from '@/db/schema/auth';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { eq, and, or, ne, gt, isNull, count, inArray } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';

// ---------------------------------------------------------------------------
// GET — User detail
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    // Verify the user is a member of this tenant
    const [membership] = await db
      .select()
      .from(tenantMemberships)
      .where(
        and(eq(tenantMemberships.userId, id), eq(tenantMemberships.tenantId, session.tenantId)),
      )
      .limit(1);

    if (!membership) {
      return NextResponse.json({ error: 'User not found in your organisation' }, { status: 404 });
    }

    const [userRecord] = await db
      .select()
      .from(user)
      .where(eq(user.id, id))
      .limit(1);

    if (!userRecord) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Fetch role assignments
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

    // Fetch available roles for assignment
    const availableRoles = await db
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, session.tenantId), eq(roles.isSystem, true)));

    // Linked employee summary (one employee may be linked to this account)
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

    return NextResponse.json({
      success: true,
      data: {
        ...userRecord,
        tenantStatus: membership.status,
        joinedAt: membership.joinedAt,
        roleAssignments: assignments,
        availableRoles,
        linkedEmployee: linkedEmployee || null,
      },
    });
  } catch (error) {
    console.error('[Admin User Detail] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to load user: ' + String(error) },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH — Update user
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { name, tenantStatus, addRoleId, removeRoleId, startDate, endDate } = body;

    // Account status changes (activate / suspend) require the dedicated
    // user:manage-status capability, keeping them in User Management.
    if (tenantStatus !== undefined) {
      const statusPerm = await requirePermission(session, Permissions.USER_MANAGE_STATUS);
      if (statusPerm instanceof NextResponse) return statusPerm;
    }

    const db = getDb();

    // Verify membership
    const [membership] = await db
      .select()
      .from(tenantMemberships)
      .where(
        and(eq(tenantMemberships.userId, id), eq(tenantMemberships.tenantId, session.tenantId)),
      )
      .limit(1);

    if (!membership) {
      return NextResponse.json({ error: 'User not found in your organisation' }, { status: 404 });
    }

    // Update user name
    if (name !== undefined) {
      await db
        .update(user)
        .set({ name, updatedAt: new Date() })
        .where(eq(user.id, id));
    }

    // Update tenant membership status (activate/suspend). Access-removed
    // accounts are managed exclusively through the restore endpoint so a
    // removed user can never be silently re-activated via a generic status
    // change without an audit trail.
    if (tenantStatus !== undefined) {
      if (membership.status === 'access_removed') {
        return NextResponse.json(
          { error: 'This account has been removed. Use “Restore User Access” to re-activate it.' },
          { status: 409 },
        );
      }
      await db
        .update(tenantMemberships)
        .set({ status: tenantStatus })
        .where(eq(tenantMemberships.id, membership.id));
    }

    // Add a role assignment
    if (addRoleId) {
      // Verify the role exists in this tenant
      const [role] = await db
        .select()
        .from(roles)
        .where(and(eq(roles.id, addRoleId), eq(roles.tenantId, session.tenantId)))
        .limit(1);

      if (!role) {
        return NextResponse.json({ error: 'Role not found' }, { status: 404 });
      }

      // Check for an existing ACTIVE assignment only — a soft-closed (ended)
      // assignment must not block re-assigning the same role later.
      const now = new Date();
      const [existing] = await db
        .select()
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.tenantMembershipId, membership.id),
            eq(roleAssignments.roleId, addRoleId),
            or(isNull(roleAssignments.endDate), gt(roleAssignments.endDate, now)),
          ),
        )
        .limit(1);

      if (!existing) {
        await db.insert(roleAssignments).values({
          tenantMembershipId: membership.id,
          roleId: addRoleId,
          startDate: startDate ? new Date(startDate) : new Date(),
          endDate: endDate ? new Date(endDate) : null,
        });

        // ── Auto-provision driver profile if the assigned role is Driver ──
        if (role.name === 'Assigned Driver') {
          const [employee] = await db
            .select({ id: employees.id, tenantId: employees.tenantId, firstName: employees.firstName, lastName: employees.lastName })
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
                after: { driverStatus: 'pending_verification', roleAssigned: role.name },
              });
            } else {
              // Reactivate existing profile
              await db.update(driverProfiles).set({ driverStatus: 'authorised', updatedAt: new Date() }).where(eq(driverProfiles.id, existingProfile.id));
              await db.update(employees).set({ isDriver: true, updatedAt: new Date() }).where(eq(employees.id, employee.id));
            }
          }
        }
      }
    }

    // Remove a role assignment — SOFT CLOSE: history is preserved by writing an
    // end date instead of deleting the row, so historical role records stay
    // valid for audit and workflow reconstruction.
    if (removeRoleId) {
      const now = new Date();
      const [assignment] = await db
        .select({
          id: roleAssignments.id,
          roleId: roleAssignments.roleId,
          roleName: roles.name,
          endDate: roleAssignments.endDate,
        })
        .from(roleAssignments)
        .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
        .where(
          and(
            eq(roleAssignments.id, removeRoleId),
            eq(roleAssignments.tenantMembershipId, membership.id),
          ),
        )
        .limit(1);

      if (!assignment) {
        return NextResponse.json({ error: 'Role assignment not found' }, { status: 404 });
      }

      const isActive = !assignment.endDate || new Date(assignment.endDate) > now;
      if (isActive && assignment.roleName === 'Tenant Administrator') {
        // Final Tenant Administrator protection — includes the actor removing
        // their own last admin role. Removing it would leave the tenant
        // unmanageable.
        const [adminCount] = await db
          .select({ total: count() })
          .from(roleAssignments)
          .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
          .innerJoin(tenantMemberships, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
          .where(
            and(
              eq(tenantMemberships.tenantId, session.tenantId),
              eq(roles.name, 'Tenant Administrator'),
              or(isNull(roleAssignments.endDate), gt(roleAssignments.endDate, now)),
            ),
          );
        if (Number(adminCount?.total) <= 1) {
          return NextResponse.json(
            { error: 'This is the final Tenant Administrator in your organisation and cannot be removed.' },
            { status: 409 },
          );
        }
      }

      await db
        .update(roleAssignments)
        .set({ endDate: now })
        .where(eq(roleAssignments.id, removeRoleId));

      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.user.id,
        action: 'role_assignment.ended',
        entityType: 'role_assignment',
        entityId: removeRoleId,
        summary: `Role assignment for ${assignment.roleName} closed on ${now.toISOString()}`,
        before: { endDate: assignment.endDate },
        after: { roleName: assignment.roleName, endedAt: now.toISOString(), historyPreserved: true },
      }).catch((auditErr) => console.warn('[Admin User Detail] role-end audit failed:', auditErr));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Admin User Detail] PATCH failed:', error);
    return NextResponse.json(
      { error: 'Failed to update user: ' + String(error) },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — Remove a user's access to the organisation
//
// Guardrails (user-access lifecycle):
//   • Only ACTIVE role assignments block removal. Historical/ended assignments
//     (soft-closed via PATCH) never block it — the ROLE COUNT RULE.
//   • The final active Tenant Administrator in the tenant cannot be removed.
//   • Dependency checks: users with open operational responsibilities (active
//     trips or live allocations as the assigned driver) must be reassigned first.
//   • Sessions are revoked and invitation/verification tokens invalidated so
//     the user cannot log in or activate through an old link.
//   • The tenant membership is soft-marked `access_removed` (not deleted) and
//     the linked staff/employee record is preserved unchanged, so the person
//     still appears in the Staff Directory and the account can be restored.
// ---------------------------------------------------------------------------

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    if (id === session.user.id) {
      return NextResponse.json(
        { error: 'You cannot remove your own account from the organisation.' },
        { status: 400 },
      );
    }

    const db = getDb();

    // Verify the user is a member of this tenant (cross-tenant protection)
    const [membership] = await db
      .select()
      .from(tenantMemberships)
      .where(
        and(eq(tenantMemberships.userId, id), eq(tenantMemberships.tenantId, session.tenantId)),
      )
      .limit(1);

    if (!membership) {
      return NextResponse.json({ error: 'User not found in your organisation' }, { status: 404 });
    }

    const [userRecord] = await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(eq(user.id, id))
      .limit(1);
    if (!userRecord) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // ── 1. ACTIVE-ROLE GATE (ROLE COUNT RULE) ──────────────────────────────
    // Count only assignments that are currently in force. Historical records
    // with an end date in the past (or a future start date) never block removal.
    const now = new Date();
    const allAssignments = await db
      .select({ id: roleAssignments.id, roleName: roles.name, endDate: roleAssignments.endDate })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(eq(roleAssignments.tenantMembershipId, membership.id));

    const activeAssignments = allAssignments.filter(
      (a) => !a.endDate || new Date(a.endDate) > now,
    );
    if (activeAssignments.length > 0) {
      const names = activeAssignments.map((a) => a.roleName).join(', ');
      return NextResponse.json(
        {
          error: `This user still holds active role${activeAssignments.length !== 1 ? 's' : ''}: ${names}. Remove their role${activeAssignments.length !== 1 ? 's' : ''} first — historical role records do not block this action.`,
        },
        { status: 409 },
      );
    }

    // ── 2. FINAL TENANT ADMINISTRATOR PROTECTION ──────────────────────────
    const holdsTenantAdmin = allAssignments.some(
      (a) => a.roleName === 'Tenant Administrator' && (!a.endDate || new Date(a.endDate) > now),
    );
    if (holdsTenantAdmin) {
      const [adminCount] = await db
        .select({ total: count() })
        .from(roleAssignments)
        .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
        .innerJoin(tenantMemberships, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
        .where(
          and(
            eq(tenantMemberships.tenantId, session.tenantId),
            eq(roles.name, 'Tenant Administrator'),
            or(isNull(roleAssignments.endDate), gt(roleAssignments.endDate, now)),
          ),
        );
      if (Number(adminCount?.total) <= 1) {
        return NextResponse.json(
          { error: 'This account is protected and cannot be deleted from Tenant User Management.' },
          { status: 409 },
        );
      }
    }

    // ── 3. DEPENDENCY CHECKS (active operational responsibilities) ─────────
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
        .where(
          and(
            eq(vehicleAllocations.driverEmployeeId, employee.id),
            eq(trips.tenantId, session.tenantId),
            ne(trips.status, 'closed'),
            ne(trips.status, 'cancelled'),
          ),
        )
        .limit(1);
      if (openTrip) {
        return NextResponse.json(
          { error: 'This user still has active trip responsibilities that must be reassigned before the account can be removed.' },
          { status: 409 },
        );
      }
      const [openAllocation] = await db
        .select({ id: vehicleAllocations.id })
        .from(vehicleAllocations)
        .where(
          and(
            eq(vehicleAllocations.driverEmployeeId, employee.id),
            inArray(vehicleAllocations.state, ['provisional', 'confirmed', 'released']),
          ),
        )
        .limit(1);
      if (openAllocation) {
        return NextResponse.json(
          { error: 'This user still has a live vehicle allocation that must be cancelled or reassigned first.' },
          { status: 409 },
        );
      }
    }

    // ── 4. REVOKE SESSIONS + INVALIDATE VERIFICATION TOKENS ───────────────
    // The user can no longer use an existing session, and any outstanding
    // invite/verification link becomes inert. Performed before the state
    // change so no window remains where a live token is valid.
    await db.delete(sessionTable).where(eq(sessionTable.userId, id));
    await db
      .delete(verification)
      .where(or(eq(verification.identifier, userRecord.email), eq(verification.identifier, id)));

    // ── 5. SOFT REMOVE (staff preserved) ───────────────────────────────────
    // The membership is marked `access_removed` (so the account leaves User
    // Management and session resolution fails) while the employee record stays
    // fully intact. Role history is preserved verbatim.
    await db.transaction(async (tx) => {
      await tx
        .update(tenantMemberships)
        .set({ status: 'access_removed' })
        .where(eq(tenantMemberships.id, membership.id));
      await tx
        .update(userProfiles)
        .set({ status: 'removed', updatedAt: new Date() })
        .where(eq(userProfiles.userId, id));
    });

    try {
      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.user.id,
        action: 'user_membership.removed',
        entityType: 'tenant_membership',
        entityId: membership.id,
        summary: `User removed from the organisation. The linked staff record was preserved.`,
        after: {
          userId: id,
          userEmail: userRecord.email,
          staffRecordPreserved: true,
          activeRoleCount: activeAssignments.length,
          sessionsRevoked: true,
          verificationTokensInvalidated: true,
          removedFrom: now.toISOString(),
          accountStatus: 'access_removed',
        },
      });
    } catch (auditErr) {
      console.warn('[Admin User Detail] DELETE audit failed:', auditErr);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Admin User Detail] DELETE failed:', error);
    return NextResponse.json(
      { error: 'Failed to remove user: ' + String(error) },
      { status: 500 },
    );
  }
}
