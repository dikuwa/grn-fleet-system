/**
 * Admin Roles API
 *
 * GET   /api/admin/roles — List tenant roles with permissions
 * POST  /api/admin/roles — Create a tenant custom role
 * PATCH /api/admin/roles — Update a tenant role
 *
 * Built-in tenant role names are routing contracts and cannot be renamed, and
 * their system permission baseline cannot be removed. Tenant Administrators
 * may still tailor descriptions and add configurable permissions. Custom roles
 * remain fully tenant-editable. Every grant is restricted to permissions valid
 * in the Tenant Administrator workspace (system baseline permissions are the
 * only exception, and only for built-in roles).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { roles, rolePermissions, roleAssignments, tenantMemberships } from '@/db/schema/tenants';
import { eq, and, inArray, asc, sql } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import {
  Permissions,
  isPermissionAvailableInWorkspace,
  type PermissionCode,
} from '@/lib/permissions';
import { isPlatformSystemRole, WorkspaceIds } from '@/lib/workspaces';
import { recordAuditEvent } from '@/lib/audit-event';
import { runAtomicMutations } from '@/lib/db-atomic';
import { SYSTEM_ROLE_REQUIRED_PERMISSIONS, permissionLabel } from '@/lib/role-metadata';

const MAX_ROLE_DESCRIPTION_LENGTH = 500;
const REQUIRED_PERMISSION_LOCK_MESSAGE =
  'Required system permissions cannot be removed. They are part of the built-in role the application relies on for its workflows.';
const ROLE_UPDATE_CONFLICT = 'role_update_conflict';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, MAX_ROLE_DESCRIPTION_LENGTH) : null;
}

type PermissionValidation =
  | { ok: true; codes: PermissionCode[] }
  | { ok: false; reason: 'invalid' | 'missing-required'; missingRequired?: string[] };

/**
 * Validate a submitted permission set.
 *
 * For system roles the role's system baseline (`required`) is always allowed —
 * those codes are managed by the platform and may legitimately live outside the
 * Tenant Administrator grantable policy. Every baseline code must remain in the
 * submitted set; removing any of them is rejected. Custom roles may only carry
 * permissions that are available in the Tenant Administrator workspace.
 */
function validateRolePermissionCodes(
  value: unknown,
  required: readonly string[],
): PermissionValidation {
  if (!Array.isArray(value)) return { ok: false, reason: 'invalid' };
  const unique = [...new Set(value.filter((code): code is string => typeof code === 'string'))];
  for (const code of unique) {
    const tenantValid = isPermissionAvailableInWorkspace(
      code as PermissionCode,
      WorkspaceIds.TENANT_ADMIN,
    );
    if (!tenantValid && !required.includes(code)) return { ok: false, reason: 'invalid' };
  }
  const missingRequired = required.filter((code) => !unique.includes(code));
  if (missingRequired.length > 0) {
    return { ok: false, reason: 'missing-required', missingRequired };
  }
  return { ok: true, codes: unique as PermissionCode[] };
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

function roleRevisionMatches(updatedAt: Date) {
  return sql`date_trunc('milliseconds', ${roles.updatedAt}) = ${updatedAt.toISOString()}::timestamptz`;
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
      requiredPermissionCodes: role.isSystem
        ? (SYSTEM_ROLE_REQUIRED_PERMISSIONS[role.name] ?? [])
        : [],
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
    const description = normalizeDescription(body?.description);
    const permissionValidation = validateRolePermissionCodes(body?.permissionCodes ?? [], []);

    if (!name) return NextResponse.json({ error: 'Role name is required' }, { status: 400 });
    if (name.length > 80) {
      return NextResponse.json(
        { error: 'Role name must be 80 characters or fewer' },
        { status: 400 },
      );
    }
    if (isPlatformSystemRole(name)) {
      return NextResponse.json(
        { error: 'Platform roles are managed only from Platform Users.' },
        { status: 403 },
      );
    }
    if (!permissionValidation.ok) {
      return NextResponse.json(
        { error: 'One or more selected permissions are not available to tenant roles.' },
        { status: 400 },
      );
    }
    const permissionCodes = permissionValidation.codes;

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
    if (!UUID_PATTERN.test(roleId)) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }

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
    if (existing.isSystem && !SYSTEM_ROLE_REQUIRED_PERMISSIONS[existing.name]) {
      return NextResponse.json(
        {
          error: `"${existing.name}" is marked as a built-in role but its system definition is not recognised. Contact the platform administrator.`,
        },
        { status: 409 },
      );
    }
    const name =
      body?.name === undefined ? undefined : typeof body.name === 'string' ? body.name.trim() : '';
    const description =
      body?.description === undefined ? undefined : normalizeDescription(body.description);
    let permissionCodes: PermissionCode[] | undefined;
    if (body?.permissionCodes !== undefined) {
      const required = existing.isSystem
        ? (SYSTEM_ROLE_REQUIRED_PERMISSIONS[existing.name] ?? [])
        : [];
      const validation = validateRolePermissionCodes(body.permissionCodes, required);
      if (!validation.ok) {
        if (validation.reason === 'missing-required' && existing.isSystem) {
          return NextResponse.json(
            {
              error: `${REQUIRED_PERMISSION_LOCK_MESSAGE} ${validation.missingRequired
                ?.map(permissionLabel)
                .join(', ')}.`,
            },
            { status: 409 },
          );
        }
        return NextResponse.json(
          { error: 'One or more selected permissions are not available to tenant roles.' },
          { status: 400 },
        );
      }
      permissionCodes = validation.codes;
    }

    if (name !== undefined && !name)
      return NextResponse.json({ error: 'Role name cannot be empty' }, { status: 400 });
    if (name !== undefined && name.length > 80) {
      return NextResponse.json(
        { error: 'Role name must be 80 characters or fewer' },
        { status: 400 },
      );
    }
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
    const beforeCodes = existingPermissions.map((permission) => permission.permissionCode);
    const afterCodes = permissionCodes ?? beforeCodes;
    const permissionAdded = afterCodes.filter((code) => !beforeCodes.includes(code));
    const permissionRemoved = beforeCodes.filter((code) => !afterCodes.includes(code));
    const hasMutation = name !== undefined || description !== undefined || permissionCodes !== undefined;

    if (hasMutation) {
      await db.transaction(async (tx) => {
        const updateData: Record<string, unknown> = { updatedAt: new Date() };
        if (name !== undefined) updateData.name = name;
        if (description !== undefined) updateData.description = description || null;

        const [claimed] = await tx
          .update(roles)
          .set(updateData)
          .where(and(
            eq(roles.id, roleId),
            eq(roles.tenantId, session.tenantId),
            roleRevisionMatches(existing.updatedAt),
          ))
          .returning({ id: roles.id });
        if (!claimed) throw new Error(ROLE_UPDATE_CONFLICT);

        if (permissionCodes !== undefined) {
          await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
          if (permissionCodes.length > 0) {
            await tx
              .insert(rolePermissions)
              .values(permissionCodes.map((permissionCode) => ({ roleId, permissionCode })));
          }
        }
      });
    }

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
        permissionCodes: beforeCodes,
      },
      after: {
        name: name ?? existing.name,
        description: description === undefined ? existing.description : description || null,
        permissionCodes: afterCodes,
        permissionAdded,
        permissionRemoved,
        isSystem: existing.isSystem,
      },
      summary: `${existing.isSystem ? 'Protected system role' : 'Custom role'} updated: ${name ?? existing.name}${existing.isSystem ? ' (system identity and required permissions preserved)' : ''}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Admin Roles] PATCH failed:', error);
    if (error instanceof Error && error.message === ROLE_UPDATE_CONFLICT) {
      return NextResponse.json(
        { error: 'This role changed while the update was being prepared. Refresh Roles and review the current permissions before trying again.' },
        { status: 409 },
      );
    }
    if (databaseCode(error) === '23505') {
      return NextResponse.json(
        { error: 'A role with this name already exists in your organisation' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to update role' }, { status: 500 });
  }
}
