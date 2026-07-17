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
import { eq, and } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

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

    return NextResponse.json({
      success: true,
      data: {
        ...userRecord,
        tenantStatus: membership.status,
        joinedAt: membership.joinedAt,
        roleAssignments: assignments,
        availableRoles,
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
    const { name, tenantStatus, addRoleId, removeRoleId } = body;

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
          startDate: new Date(),
        });
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
