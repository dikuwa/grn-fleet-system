/**
 * Server-side auth helpers for route protection, tenant isolation,
 * and permission enforcement.
 *
 * These functions are designed to be called at the top of every API route
 * handler and server component that needs auth gating.
 */

import { cache } from 'react';
import { getDb } from '@/db';
import { tenantMemberships, roleAssignments, rolePermissions, roles } from '@/db/schema';
import { getServerSession, getServerSessionFromRequest } from '@/lib/session';
import { Permissions, isPermissionAvailableInWorkspace, type PermissionCode } from '@/lib/permissions';
import { eq, and, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { canPerformDashboardAction, type DashboardAction } from '@/lib/dashboard-access';
import {
  getEligibleWorkspaces,
  resolveActiveWorkspace,
  SystemRoles,
  type WorkspaceId,
} from '@/lib/workspaces';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthSession = {
  user: { id: string; email: string; name: string | null; image: string | null | undefined };
  tenantId: string;
  tenantSlug: string;
};

export type AuthResult = { ok: true; session: AuthSession } | { ok: false; error: NextResponse };

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

export function unauthorizedResponse(message = 'Authentication required') {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbiddenResponse(message = 'You do not have permission to perform this action') {
  return NextResponse.json({ error: message }, { status: 403 });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function requireAuth(): Promise<AuthSession> {
  const sess = await getServerSession();
  if (!sess) throw new Error('AUTH_REQUIRED');
  return sess as AuthSession;
}

export async function requireRequestAuth(request: Request): Promise<AuthResult> {
  const raw = await getServerSessionFromRequest(request);
  if (!raw) return { ok: false, error: unauthorizedResponse() };
  return {
    ok: true,
    session: {
      user: raw.user,
      tenantId: raw.tenantId,
      tenantSlug: raw.tenantSlug,
    },
  };
}

// ---------------------------------------------------------------------------
// Tenant-scoped query helpers
// ---------------------------------------------------------------------------

export async function verifySessionTenant(session: AuthSession): Promise<boolean> {
  const db = getDb();
  const result = await db
    .select({ id: tenantMemberships.id })
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.userId, session.user.id),
        eq(tenantMemberships.tenantId, session.tenantId),
        eq(tenantMemberships.status, 'active'),
      ),
    )
    .limit(1);
  return result.length > 0;
}

export async function requireValidTenant(session: AuthSession): Promise<true | NextResponse> {
  const valid = await verifySessionTenant(session);
  if (!valid) return forbiddenResponse('Your session is no longer valid for this tenant.');
  return true;
}

// ---------------------------------------------------------------------------
// Permission enforcement
// ---------------------------------------------------------------------------

/**
 * Platform system roles are product-level capabilities, so an older seeded
 * role must not silently lose access merely because a later migration added a
 * permission row. We union the canonical system-role capabilities with stored
 * grants. Custom tenant roles remain entirely database-driven.
 */
function platformImpliedPermissions(roleNames: readonly string[]): PermissionCode[] {
  const implied = new Set<PermissionCode>();
  const add = (...permissions: PermissionCode[]) => permissions.forEach((permission) => implied.add(permission));

  if (roleNames.includes(SystemRoles.PLATFORM_ADMIN)) {
    add(
      Permissions.PLATFORM_ADMIN,
      Permissions.PLATFORM_SUPPORT,
      Permissions.TENANT_VIEW,
      Permissions.TENANT_MANAGE,
      Permissions.SITE_MANAGE,
      Permissions.BILLING_MANAGE,
      Permissions.RESET_MANAGE,
      Permissions.DEMO_MANAGE,
      Permissions.AUDIT_READ,
      Permissions.AUDIT_EXPORT,
      Permissions.EMERGENCY_CONTACTS_MANAGE,
    );
  }

  if (roleNames.includes(SystemRoles.PLATFORM_SUPPORT)) {
    add(
      Permissions.PLATFORM_SUPPORT,
      Permissions.TENANT_VIEW,
      Permissions.DEMO_MANAGE,
      Permissions.EMERGENCY_CONTACTS_MANAGE,
    );
  }

  if (roleNames.includes(SystemRoles.PLATFORM_AUDITOR)) {
    add(Permissions.TENANT_VIEW, Permissions.AUDIT_READ, Permissions.AUDIT_EXPORT);
  }

  return Array.from(implied);
}

const loadRoleContext = cache(
  async (
    userId: string,
    tenantId: string,
  ): Promise<{
    roleNames: string[];
    permissionCodes: PermissionCode[];
    activeWorkspace: WorkspaceId;
  } | null> => {
    const db = getDb();
    const now = new Date();

    const [membership] = await db
      .select({ id: tenantMemberships.id, activeWorkspace: tenantMemberships.activeWorkspace })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.status, 'active'),
        ),
      )
      .limit(1);

    if (!membership) return null;

    const assignments = await db
      .select({
        roleId: roleAssignments.roleId,
        startDate: roleAssignments.startDate,
        endDate: roleAssignments.endDate,
      })
      .from(roleAssignments)
      .where(eq(roleAssignments.tenantMembershipId, membership.id));

    const validAssignments = assignments.filter((assignment) => {
      if (new Date(assignment.startDate) > now) return false;
      if (assignment.endDate && new Date(assignment.endDate) < now) return false;
      return true;
    });

    if (validAssignments.length === 0) {
      return {
        roleNames: [],
        permissionCodes: [],
        activeWorkspace: resolveActiveWorkspace([], membership.activeWorkspace),
      };
    }

    const roleIds = validAssignments.map((assignment) => assignment.roleId);
    const [roleRows, permissionRows] = await Promise.all([
      db.select({ name: roles.name }).from(roles).where(inArray(roles.id, roleIds)),
      db
        .select({ permissionCode: rolePermissions.permissionCode })
        .from(rolePermissions)
        .where(inArray(rolePermissions.roleId, roleIds)),
    ]);

    const roleNames = Array.from(new Set(roleRows.map((row) => row.name)));
    const storedPermissions = permissionRows.map((row) => row.permissionCode as PermissionCode);
    const permissionCodes = Array.from(
      new Set<PermissionCode>([...storedPermissions, ...platformImpliedPermissions(roleNames)]),
    );

    return {
      roleNames,
      permissionCodes,
      activeWorkspace: resolveActiveWorkspace(roleNames, membership.activeWorkspace),
    };
  },
);

export async function hasPermission(
  session: AuthSession,
  permissionCode: PermissionCode,
): Promise<boolean> {
  // Legacy emergency workflow override is retired. Keep the permission code
  // readable for historical role/audit records, but never authorize it at
  // runtime — including for tenant roles that still carry an old stored grant.
  if (permissionCode === Permissions.TRIP_AUTHORIZE_EMERGENCY) return false;

  const context = await loadRoleContext(session.user.id, session.tenantId);
  if (!context) return false;
  if (!context.permissionCodes.includes(permissionCode)) return false;
  return isPermissionAvailableInWorkspace(permissionCode, context.activeWorkspace);
}

export async function getSessionPermissions(session: AuthSession): Promise<PermissionCode[]> {
  const context = await loadRoleContext(session.user.id, session.tenantId);
  if (!context) return [];
  return context.permissionCodes.filter(
    (permission) =>
      permission !== Permissions.TRIP_AUTHORIZE_EMERGENCY &&
      isPermissionAvailableInWorkspace(permission, context.activeWorkspace),
  );
}

export async function getSessionRoleNames(session: AuthSession): Promise<string[]> {
  const context = await loadRoleContext(session.user.id, session.tenantId);
  if (!context) return [`workspace:${resolveActiveWorkspace([], undefined)}`];
  return [...context.roleNames, `workspace:${context.activeWorkspace}`];
}

export async function getSessionWorkspace(session: AuthSession) {
  const roleContext = await getSessionRoleNames(session);
  const roleNames = roleContext.filter((value) => !value.startsWith('workspace:'));
  const marker = roleContext.find((value) => value.startsWith('workspace:'));
  const activeWorkspace = resolveActiveWorkspace(roleNames, marker?.slice('workspace:'.length));
  return {
    activeWorkspace,
    eligibleWorkspaces: getEligibleWorkspaces(roleNames),
    roleNames,
  };
}

export async function setSessionWorkspace(session: AuthSession, workspace: WorkspaceId) {
  const db = getDb();
  const context = await getSessionWorkspace(session);
  if (!context.eligibleWorkspaces.some((candidate) => candidate.id === workspace)) return false;
  await db
    .update(tenantMemberships)
    .set({ activeWorkspace: workspace })
    .where(
      and(
        eq(tenantMemberships.userId, session.user.id),
        eq(tenantMemberships.tenantId, session.tenantId),
        eq(tenantMemberships.status, 'active'),
      ),
    );
  return true;
}

export async function requireDashboardAction(
  session: AuthSession,
  dashboardPath: string,
  action: DashboardAction,
): Promise<true | NextResponse> {
  const roleNames = await getSessionRoleNames(session);
  if (!canPerformDashboardAction(dashboardPath, roleNames, action)) {
    return forbiddenResponse('Your active role does not allow this action.');
  }
  return true;
}

export async function requirePermission(
  session: AuthSession,
  permissionCode: PermissionCode,
): Promise<true | NextResponse> {
  const allowed = await hasPermission(session, permissionCode);
  if (!allowed) return forbiddenResponse();
  return true;
}

export async function requireAnyPermission(
  session: AuthSession,
  permissionCodes: PermissionCode[],
): Promise<true | NextResponse> {
  for (const code of permissionCodes) {
    const allowed = await hasPermission(session, code);
    if (allowed) return true;
  }
  return forbiddenResponse('You do not have the required permissions for this action.');
}

export async function requireAllPermissions(
  session: AuthSession,
  permissionCodes: PermissionCode[],
): Promise<true | NextResponse> {
  for (const code of permissionCodes) {
    const allowed = await hasPermission(session, code);
    if (!allowed) return forbiddenResponse(`Missing required permission: ${code}`);
  }
  return true;
}
