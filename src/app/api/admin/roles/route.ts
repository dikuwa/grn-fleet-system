/**
 * Admin Roles API
 *
 * GET   /api/admin/roles — List tenant roles with permissions
 * POST  /api/admin/roles — Create a tenant custom role
 * PATCH /api/admin/roles — Update a tenant custom role
 *
 * Built-in system roles are platform-defined contracts. Tenant Administrators
 * may assign them to people, but may not rename them or mutate their permission
 * sets. Custom roles remain tenant-editable and are restricted to permissions
 * that are valid in the Tenant Administrator workspace.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { roles, rolePermissions, roleAssignments } from '@/db/schema/tenants';
import { eq, and, inArray, asc } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import {
  Permissions,
  isPermissionAvailableInWorkspace,
  type PermissionCode,
} from '@/lib/permissions';
import { WorkspaceIds } from '@/lib/workspaces';

function normalizePermissionCodes(value: unknown): PermissionCode[] | null {
  if (!Array.isArray(value)) return null;
  const unique = [...new Set(value.filter((code): code is string => typeof code === 'string'))];
  const allowed = unique.filter((code) =>
    isPermissionAvailableInWorkspace(code as PermissionCode, WorkspaceIds.TENANT_ADMIN),
  );
  if (allowed.length !== unique.length) return null;
  return allowed as PermissionCode[];
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const roleRows = await db
      .select()
      .from(roles)
      .where(eq(roles.tenantId, session.tenantId))
      .orderBy(asc(roles.name));

    const roleIds = roleRows.map((role) => role.id);
    const perms = roleIds.length > 0
      ? await db.select().from(rolePermissions).where(inArray(rolePermissions.roleId, roleIds))
      : [];

    const permsByRole = new Map<string, string[]>();
    for (const permission of perms) {
      const existing = permsByRole.get(permission.roleId) || [];
      existing.push(permission.permissionCode);
      permsByRole.set(permission.roleId, existing);
    }

    const assignments = roleIds.length > 0
      ? await db.select().from(roleAssignments).where(inArray(roleAssignments.roleId, roleIds))
      : [];

    const now = new Date();
    const memberCountByRole = new Map<string, number>();
    for (const assignment of assignments) {
      const started = !assignment.startDate || new Date(assignment.startDate) <= now;
      const notEnded = !assignment.endDate || new Date(assignment.endDate) > now;
      if (!started || !notEnded) continue;
      memberCountByRole.set(
        assignment.roleId,
        (memberCountByRole.get(assignment.roleId) || 0) + 1,
      );
    }

    const enrichedRoles = roleRows.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      memberCount: memberCountByRole.get(role.id) || 0,
      permissionCodes: permsByRole.get(role.id) || [],
      editable: !role.isSystem,
    }));

    return NextResponse.json({ success: true, data: { roles: enrichedRoles } });
  } catch (error) {
    console.error('[Admin Roles] GET failed:', error);
    return NextResponse.json({ error: 'Failed to list roles: ' + String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const description = typeof body?.description === 'string' ? body.description.trim() : '';
    const permissionCodes = normalizePermissionCodes(body?.permissionCodes ?? []);

    if (!name) {
      return NextResponse.json({ error: 'Role name is required' }, { status: 400 });
    }
    if (permissionCodes === null) {
      return NextResponse.json(
        { error: 'One or more selected permissions are not available to tenant roles.' },
        { status: 400 },
      );
    }

    const db = getDb();
    const [existing] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, session.tenantId), eq(roles.name, name)))
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: `A role named "${name}" already exists in your organisation` },
        { status: 409 },
      );
    }

    const [role] = await db
      .insert(roles)
      .values({
        tenantId: session.tenantId,
        name,
        description: description || null,
        isSystem: false,
      })
      .returning();

    if (permissionCodes.length > 0) {
      await db.insert(rolePermissions).values(
        permissionCodes.map((permissionCode) => ({ roleId: role.id, permissionCode })),
      );
    }

    return NextResponse.json({ success: true, data: role }, { status: 201 });
  } catch (error) {
    console.error('[Admin Roles] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create role: ' + String(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const roleId = typeof body?.roleId === 'string' ? body.roleId : '';
    if (!roleId) {
      return NextResponse.json({ error: 'Role ID is required' }, { status: 400 });
    }

    const db = getDb();
    const [existing] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, session.tenantId)))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }
    if (existing.isSystem) {
      return NextResponse.json(
        {
          error: 'Built-in system roles are managed by GovFleet and cannot be edited. Assign or remove the role from users instead.',
        },
        { status: 409 },
      );
    }

    const name = body?.name === undefined
      ? undefined
      : typeof body.name === 'string'
        ? body.name.trim()
        : '';
    const description = body?.description === undefined
      ? undefined
      : typeof body.description === 'string'
        ? body.description.trim()
        : '';
    const permissionCodes = body?.permissionCodes === undefined
      ? undefined
      : normalizePermissionCodes(body.permissionCodes);

    if (name !== undefined && !name) {
      return NextResponse.json({ error: 'Role name cannot be empty' }, { status: 400 });
    }
    if (permissionCodes === null) {
      return NextResponse.json(
        { error: 'One or more selected permissions are not available to tenant roles.' },
        { status: 400 },
      );
    }

    if (name && name !== existing.name) {
      const [duplicate] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, session.tenantId), eq(roles.name, name)))
        .limit(1);
      if (duplicate && duplicate.id !== roleId) {
        return NextResponse.json(
          { error: `A role named "${name}" already exists in your organisation` },
          { status: 409 },
        );
      }
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description || null;
    if (Object.keys(updateData).length > 1) {
      await db.update(roles).set(updateData).where(eq(roles.id, roleId));
    }

    if (permissionCodes !== undefined) {
      await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      if (permissionCodes.length > 0) {
        await db.insert(rolePermissions).values(
          permissionCodes.map((permissionCode) => ({ roleId, permissionCode })),
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Admin Roles] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update role: ' + String(error) }, { status: 500 });
  }
}
