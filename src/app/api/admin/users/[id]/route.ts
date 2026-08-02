/**
 * Admin User Detail API
 *
 * GET   /api/admin/users/[id]    — Get user details with roles
 * PATCH /api/admin/users/[id]    — Update user (name, status, role)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { user } from '@/db/schema/better-auth';
import { tenantMemberships, roleAssignments, roles } from '@/db/schema/tenants';
import { employees, driverProfiles, departments, offices } from '@/db/schema/people';
import { eq, and } from 'drizzle-orm';
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

    // Update tenant membership status (activate/suspend)
    if (tenantStatus !== undefined) {
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

      // Check for existing active assignment
      const [existing] = await db
        .select()
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.tenantMembershipId, membership.id),
            eq(roleAssignments.roleId, addRoleId),
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

    // Remove a role assignment
    if (removeRoleId) {
      await db
        .delete(roleAssignments)
        .where(
          and(
            eq(roleAssignments.id, removeRoleId),
            eq(roleAssignments.tenantMembershipId, membership.id),
          ),
        );
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
