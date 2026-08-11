/**
 * Admin Roles API
 *
 * GET   /api/admin/roles — List tenant roles with permissions
 * POST  /api/admin/roles — Create a tenant custom role
 * PATCH /api/admin/roles — Update a tenant role
 *
 * Built-in tenant role names are routing contracts and cannot be renamed.
 * Tenant Administrators may still tailor their descriptions and stored
 * permission sets. Custom roles remain fully tenant-editable. Every grant is
 * restricted to permissions valid in the Tenant Administrator workspace.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { roles, rolePermissions, roleAssignments, tenantMemberships } from '@/db/schema/tenants';
import { eq, and, inArray, asc } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import {
  Permissions,
  isPermissionAvailableInWorkspace,
  type PermissionCode,
} from '@/lib/permissions';
import { isPlatformSystemRole, WorkspaceIds } from '@/lib/workspaces';
import { recordAuditEvent } from '@/lib/audit-event';
import { runAtomicMutations } from '@/lib/db-atomic';

function normalizePermissionCodes(value: unknown): PermissionCode[] | null {
  if (!Array.isArray(value)) return null;
  const unique = [...new Set(value.filter((code): code is string => typeof code === 'string'))];
  const allowed = unique.filter((code) =>
    isPermissionAvailableInWorkspace(code as PermissionCode, WorkspaceIds.TENANT_ADMIN),
  );
  if (allowed.length !== unique.length) return null;
  return allowed as PermissionCode[];
}

function databaseCode(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const value = error as { code?: unknown; cause?: { code?: unknown } };
  return typeof value.code === 'string'
    ? value.code
    : typeof value.cause?.code === 'string'
      ? value.cause.code
      : null;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const allRoleRows = await db
      .select()
      .from(roles)
      .where(eq(roles.tenantId, session.tenantId))
      .orderBy(asc(roles.name));
    const roleRows = allRoleRows.filter((role) => !isPlatformSystemRole(role.name));
    const roleIds = roleRows.map((role) => role.id);
    const perms =
      roleIds.length > 0
        ? await db.select().from(rolePermissions).where(inArray(rolePermissions.roleId, roleIds))
        : [];

    const permsByRole = new Map<string, string[]>();
    for (const permission of perms) {
      const existing = permsByRole.get(permission.roleId) || [];
      existing.push(permission.permissionCode);
      permsByRole.set(permission.roleId, existing);
    }

    const assignments =
      roleIds.length > 0
        ? await db
            .select({
              roleId: roleAssignments.roleId,
              startDate: roleAssignments.startDate,
              endDate: roleAssignments.endDate,
            })
            .from(roleAssignments)
            .innerJoin(
              tenantMemberships,
              eq(roleAssignments.tenantMembershipId, tenantMemberships.id),
            )
            .where(
              and(
                inArray(roleAssignments.roleId, roleIds),
                eq(tenantMemberships.tenantId, session.tenantId),
                eq(tenantMemberships.status, 'active'),
              ),
            )
        : [];

    const now = new Date();
    const memberCountByRole = new Map<string, number>();
    for (const assignment of assignments) {
      const started = new Date(assignment.startDate) <= now;
      const notEnded = !assignment.endDate || new Date(assignment.endDate) > now;
      if (!started || !notEnded) continue;
      memberCountByRole.set(assignment.roleId, (memberCountByRole.get(assignment.roleId) || 0) + 1);
    }

    const enrichedRoles = roleRows.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      memberCount: memberCountByRole.get(role.id) || 0,
      permissionCodes: permsByRole.get(role.id) || [],
      editable: true,
      nameEditable: !role.isSystem,
    }));

    return NextResponse.json({ success: true, data: { roles: enrichedRoles } });
  } catch (error) {
    console.error('[Admin Roles] GET failed:', error);
    return NextResponse.json({ error: 'Failed to list roles' }, { status: 500 });
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

    if (!name) return NextResponse.json({ error: 'Role name is required' }, { status: 400 });
    if (isPlatformSystemRole(name)) {
      return NextResponse.json(
        { error: 'Platform roles are managed only from Platform Users.' },
        { status: 403 },
      );
    }
    if (permissionCodes === null) {
      return NextResponse.json(
        { error: 'One or more selected permissions are not available to tenant roles.' },
        { status: 400 },
      );
    }

    const db = getDb();
    const [existing] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, session.tenantId), eq(roles.name, name)))
      .limit(1);
    if (existing) {
      return NextResponse.json(
        { error: `A role named "${name}" already exists in your organisation` },
        { status: 409 },
      );
    }

    const roleId = crypto.randomUUID();
    await runAtomicMutations((executor) => {
      const mutations = [
        executor.insert(roles).values({
          id: roleId,
          tenantId: session.tenantId,
          name,
          description: description || null,
          isSystem: false,
        }),
      ];
      if (permissionCodes.length > 0) {
        mutations.push(
          executor
            .insert(rolePermissions)
            .values(permissionCodes.map((permissionCode) => ({ roleId, permissionCode }))),
        );
      }
      return mutations;
    });

    const [role] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, session.tenantId)))
      .limit(1);
    if (!role) throw new Error('Created role could not be reloaded.');

    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      eventType: 'role_created',
      action: 'create',
      entityType: 'role',
      entityId: role.id,
      after: { name: role.name, description: role.description, permissionCodes },
      summary: `Custom role created: ${role.name}`,
    });

    return NextResponse.json({ success: true, data: role }, { status: 201 });
  } catch (error) {
    console.error('[Admin Roles] POST failed:', error);
    if (databaseCode(error) === '23505') {
      return NextResponse.json(
        { error: 'A role with this name already exists in your organisation' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to create role' }, { status: 500 });
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
    if (!roleId) return NextResponse.json({ error: 'Role ID is required' }, { status: 400 });

    const db = getDb();
    const [existing] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, session.tenantId)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    if (isPlatformSystemRole(existing.name)) {
      return NextResponse.json(
        { error: 'Platform roles cannot be viewed or changed from tenant administration.' },
        { status: 403 },
      );
    }
    const name =
      body?.name === undefined ? undefined : typeof body.name === 'string' ? body.name.trim() : '';
    const description =
      body?.description === undefined
        ? undefined
        : typeof body.description === 'string'
          ? body.description.trim()
          : '';
    const permissionCodes =
      body?.permissionCodes === undefined
        ? undefined
        : normalizePermissionCodes(body.permissionCodes);

    if (name !== undefined && !name)
      return NextResponse.json({ error: 'Role name cannot be empty' }, { status: 400 });
    if (name !== undefined && isPlatformSystemRole(name)) {
      return NextResponse.json(
        { error: 'Tenant roles cannot use a reserved platform role name.' },
        { status: 403 },
      );
    }
    if (existing.isSystem && name !== undefined && name !== existing.name) {
      return NextResponse.json(
        { error: 'Built-in role names are used for workspace routing and cannot be renamed.' },
        { status: 409 },
      );
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

    const existingPermissions = await db
      .select({ permissionCode: rolePermissions.permissionCode })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));

    await runAtomicMutations((executor) => {
      const mutations: Array<PromiseLike<unknown>> = [];
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description || null;
      if (Object.keys(updateData).length > 1) {
        mutations.push(
          executor
            .update(roles)
            .set(updateData)
            .where(and(eq(roles.id, roleId), eq(roles.tenantId, session.tenantId))),
        );
      }

      if (permissionCodes !== undefined) {
        mutations.push(executor.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId)));
        if (permissionCodes.length > 0) {
          mutations.push(
            executor
              .insert(rolePermissions)
              .values(permissionCodes.map((permissionCode) => ({ roleId, permissionCode }))),
          );
        }
      }
      return mutations;
    });

    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      eventType: 'role_updated',
      action: 'update',
      entityType: 'role',
      entityId: roleId,
      before: {
        name: existing.name,
        description: existing.description,
        permissionCodes: existingPermissions.map((permission) => permission.permissionCode),
      },
      after: {
        name: name ?? existing.name,
        description: description === undefined ? existing.description : description || null,
        permissionCodes:
          permissionCodes ?? existingPermissions.map((permission) => permission.permissionCode),
      },
      summary: `Custom role updated: ${name ?? existing.name}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Admin Roles] PATCH failed:', error);
    if (databaseCode(error) === '23505') {
      return NextResponse.json(
        { error: 'A role with this name already exists in your organisation' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to update role' }, { status: 500 });
  }
}
