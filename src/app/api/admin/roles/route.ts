/**
 * Admin Roles API
 *
 * GET   /api/admin/roles    — List tenant roles with permissions
 * POST  /api/admin/roles    — Create a new custom role
 * PATCH /api/admin/roles    — Update an existing role (name, description, permissions)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { roles, rolePermissions, roleAssignments, permissions } from '@/db/schema/tenants';
import { eq, and, inArray, asc, count } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

// ---------------------------------------------------------------------------
// GET — List roles for the tenant
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    // Fetch all roles for this tenant (including system roles)
    const roleRows = await db
      .select()
      .from(roles)
      .where(eq(roles.tenantId, session.tenantId))
      .orderBy(asc(roles.name));

    // Fetch permission codes for each role
    const roleIds = roleRows.map((r) => r.id);
    const perms = roleIds.length > 0
      ? await db
          .select()
          .from(rolePermissions)
          .where(inArray(rolePermissions.roleId, roleIds))
      : [];

    const permsByRole = new Map<string, string[]>();
    for (const rp of perms) {
      const existing = permsByRole.get(rp.roleId) || [];
      existing.push(rp.permissionCode);
      permsByRole.set(rp.roleId, existing);
    }

    // Count members per role
    const assignments = roleIds.length > 0
      ? await db
          .select()
          .from(roleAssignments)
          .where(inArray(roleAssignments.roleId, roleIds))
      : [];

    const memberCountByRole = new Map<string, number>();
    for (const ra of assignments) {
      memberCountByRole.set(ra.roleId, (memberCountByRole.get(ra.roleId) || 0) + 1);
    }

    const enrichedRoles = roleRows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      memberCount: memberCountByRole.get(r.id) || 0,
      permissionCodes: permsByRole.get(r.id) || [],
    }));

    return NextResponse.json({ success: true, data: { roles: enrichedRoles } });
  } catch (error) {
    console.error('[Admin Roles] GET failed:', error);
    return NextResponse.json({ error: 'Failed to list roles: ' + String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Create a new custom role
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { name, description, permissionCodes } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Role name is required' }, { status: 400 });
    }

    const db = getDb();

    // Check for duplicate name within tenant
    const [existing] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, session.tenantId), eq(roles.name, name.trim())))
      .limit(1);

    if (existing) {
      return NextResponse.json({ error: `A role named "${name.trim()}" already exists in your organisation` }, { status: 409 });
    }

    const [role] = await db
      .insert(roles)
      .values({
        tenantId: session.tenantId,
        name: name.trim(),
        description: description || null,
        isSystem: false,
      })
      .returning();

    // Assign permissions if provided
    if (permissionCodes?.length > 0) {
      await db.insert(rolePermissions).values(
        permissionCodes.map((code: string) => ({
          roleId: role.id,
          permissionCode: code,
        })),
      );
    }

    return NextResponse.json({ success: true, data: role }, { status: 201 });
  } catch (error) {
    console.error('[Admin Roles] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create role: ' + String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — Update a role
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { roleId, name, description, permissionCodes } = body;

    if (!roleId) {
      return NextResponse.json({ error: 'Role ID is required' }, { status: 400 });
    }

    const db = getDb();

    // Verify the role exists in this tenant
    const [existing] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, session.tenantId)))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }

    // Update role metadata (skip system role name changes)
    if (!existing.isSystem) {
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;

      if (Object.keys(updateData).length > 1) {
        await db
          .update(roles)
          .set(updateData)
          .where(eq(roles.id, roleId));
      }
    }

    // Update permissions if provided
    if (permissionCodes !== undefined) {
      // Remove all existing permissions for this role
      await db
        .delete(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId));

      // Add new permissions
      if (permissionCodes.length > 0) {
        await db.insert(rolePermissions).values(
          permissionCodes.map((code: string) => ({
            roleId,
            permissionCode: code,
          })),
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Admin Roles] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update role: ' + String(error) }, { status: 500 });
  }
}
