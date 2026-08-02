/**
 * Server-side auth helpers for route protection, tenant isolation,
 * and permission enforcement.
 *
 * These functions are designed to be called at the top of every API route
 * handler and server component that needs auth gating.
 */

import { getDb } from '@/db';
import { tenantMemberships, roleAssignments, rolePermissions, roles } from '@/db/schema';
import { getServerSession, getServerSessionFromRequest } from '@/lib/session';
import { isPermissionAvailableInWorkspace, type PermissionCode } from '@/lib/permissions';
import { eq, and, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { canPerformDashboardAction, type DashboardAction } from '@/lib/dashboard-access';
import { getEligibleWorkspaces, resolveActiveWorkspace, type WorkspaceId } from '@/lib/workspaces';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Non-nullable session info used by all auth helpers.
 * The `SessionInfo` type in `session.ts` is nullable (`| null`); this alias
 * narrows it to the resolved, non-null variant so callers don't need to
 * re-narrow.
 */
export type AuthSession = {
  user: { id: string; email: string; name: string | null; image: string | null | undefined };
  tenantId: string;
  tenantSlug: string;
};

export type AuthResult = { ok: true; session: AuthSession } | { ok: false; error: NextResponse };

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/**
 * Standardised error responses for auth failures.
 */
export function unauthorizedResponse(message = 'Authentication required') {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbiddenResponse(message = 'You do not have permission to perform this action') {
  return NextResponse.json({ error: message }, { status: 403 });
}

// ---------------------------------------------------------------------------
// requireAuth — server components
// ---------------------------------------------------------------------------

/**
 * Require an authenticated session with an active tenant membership.
 *
 * Use in server components and route handlers where the Request object
 * is NOT available.
 *
 * Throws an error; catch it in your component and redirect to login.
 */
export async function requireAuth(): Promise<AuthSession> {
  const sess = await getServerSession();
  if (!sess) {
    throw new Error('AUTH_REQUIRED');
  }
  return sess as AuthSession;
}

/**
 * Same as requireAuth but accepts a Request object.
 *
 * Use in API route handlers where you have the Request available.
 * Returns the session OR a NextResponse error object.
 *
 * Usage:
 * ```ts
 * const auth = await requireRequestAuth(req);
 * if (!auth.ok) return auth.error;
 * const { session } = auth;
 * ```
 */
export async function requireRequestAuth(request: Request): Promise<AuthResult> {
  const raw = await getServerSessionFromRequest(request);
  if (!raw) {
    return { ok: false, error: unauthorizedResponse() };
  }
  const session: AuthSession = {
    user: raw.user,
    tenantId: raw.tenantId,
    tenantSlug: raw.tenantSlug,
  };
  return { ok: true, session };
}

// ---------------------------------------------------------------------------
// Tenant-scoped query helpers
// ---------------------------------------------------------------------------

/**
 * Verify the session's user actually belongs to the session's tenant.
 * This is a belt-and-suspenders check — the session system already resolves
 * the tenant from the membership, but this catches edge cases (e.g. a user
 * whose membership was revoked mid-session).
 */
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

/**
 * Convenience wrapper: require session tenant to be valid or return 403.
 */
export async function requireValidTenant(session: AuthSession): Promise<true | NextResponse> {
  const valid = await verifySessionTenant(session);
  if (!valid) {
    return forbiddenResponse('Your session is no longer valid for this tenant.');
  }
  return true;
}

// ---------------------------------------------------------------------------
// Permission enforcement
// ---------------------------------------------------------------------------

/**
 * Check whether the current user has a specific permission within their
 * active tenant context. Returns true/false.
 */
export async function hasPermission(
  session: AuthSession,
  permissionCode: PermissionCode,
): Promise<boolean> {
  const db = getDb();

  // Find the user's tenant membership
  const [membership] = await db
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

  if (!membership) return false;

  // Get all active role assignments for this membership (respecting time bounds)
  const now = new Date();
  const assignments = await db
    .select({
      roleId: roleAssignments.roleId,
      startDate: roleAssignments.startDate,
      endDate: roleAssignments.endDate,
    })
    .from(roleAssignments)
    .where(and(eq(roleAssignments.tenantMembershipId, membership.id)));

  // Filter by time bounds: startDate must be <= now, endDate must be null or >= now
  const validAssignments = assignments.filter((a) => {
    if (new Date(a.startDate) > now) {
      return false;
    }
    if (a.endDate && new Date(a.endDate) < now) {
      return false;
    }
    return true;
  });

  if (validAssignments.length === 0) return false;

  const roleIds = validAssignments.map((a) => a.roleId);

  // Get all permission codes for these roles
  const permissions = await db
    .select({ permissionCode: rolePermissions.permissionCode })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, roleIds));

  const assigned = permissions.some((p) => p.permissionCode === permissionCode);
  if (!assigned) return false;
  const workspace = await getSessionWorkspace(session);
  return isPermissionAvailableInWorkspace(permissionCode, workspace.activeWorkspace);
}

/** Resolve every active permission for the current tenant session. */
export async function getSessionPermissions(session: AuthSession): Promise<PermissionCode[]> {
  const db = getDb();
  const now = new Date();
  const rows = await db
    .select({
      permissionCode: rolePermissions.permissionCode,
      startDate: roleAssignments.startDate,
      endDate: roleAssignments.endDate,
    })
    .from(roleAssignments)
    .innerJoin(tenantMemberships, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roleAssignments.roleId))
    .where(
      and(
        eq(tenantMemberships.userId, session.user.id),
        eq(tenantMemberships.tenantId, session.tenantId),
        eq(tenantMemberships.status, 'active'),
      ),
    );

  const assignedPermissions = Array.from(
    new Set(
      rows
        .filter((row) => row.startDate <= now && (!row.endDate || row.endDate >= now))
        .map((row) => row.permissionCode as PermissionCode),
    ),
  );
  const workspace = await getSessionWorkspace(session);
  return assignedPermissions.filter((permission) =>
    isPermissionAvailableInWorkspace(permission, workspace.activeWorkspace),
  );
}

/** Resolve every currently active substantive or acting role name. */
export async function getSessionRoleNames(session: AuthSession): Promise<string[]> {
  const db = getDb();
  const now = new Date();
  const rows = await db
    .select({
      roleName: roles.name,
      startDate: roleAssignments.startDate,
      endDate: roleAssignments.endDate,
      activeWorkspace: tenantMemberships.activeWorkspace,
    })
    .from(roleAssignments)
    .innerJoin(tenantMemberships, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(
      and(
        eq(tenantMemberships.userId, session.user.id),
        eq(tenantMemberships.tenantId, session.tenantId),
        eq(tenantMemberships.status, 'active'),
      ),
    );

  const roleNames = Array.from(
    new Set(
      rows
        .filter((row) => row.startDate <= now && (!row.endDate || row.endDate >= now))
        .map((row) => row.roleName),
    ),
  );
  const activeWorkspace = resolveActiveWorkspace(roleNames, rows[0]?.activeWorkspace);
  return [...roleNames, `workspace:${activeWorkspace}`];
}

/** Resolve the user's eligible and currently selected workspace. */
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

/** Persist a workspace only after recalculating eligibility from active roles. */
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

/**
 * Enforce the same role/action policy used by dashboard navigation and layouts.
 * API routes must call this in addition to any record-level ownership checks.
 */
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

/**
 * Require a specific permission or return a 403 response.
 *
 * Usage in API routes:
 * ```ts
 * const permCheck = await requirePermission(session, Permissions.VEHICLE_MANAGE);
 * if (permCheck instanceof NextResponse) return permCheck;
 * ```
 */
export async function requirePermission(
  session: AuthSession,
  permissionCode: PermissionCode,
): Promise<true | NextResponse> {
  const allowed = await hasPermission(session, permissionCode);
  if (!allowed) {
    return forbiddenResponse();
  }
  return true;
}

/**
 * Require ANY of the specified permissions.
 */
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

/**
 * Require ALL of the specified permissions.
 */
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
