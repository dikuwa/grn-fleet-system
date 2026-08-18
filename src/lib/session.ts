/**
 * Server-side session helpers.
 *
 * Provides two helper functions to resolve the current user's session and
 * their associated tenant membership. Both share the same tenant-resolution
 * logic via the private `resolveUserTenant` helper.
 *
 * NOTE: These helpers read the session cookie directly from the request
 * headers and look up the session in the database via Drizzle, rather than
 * calling Better Auth's auth.api.getSession() which expects signed cookies.
 * Our custom auth handler sets unsigned cookies, so we need to parse them
 * manually here.
 */

import { headers } from 'next/headers';
import { getDb } from '@/db';
import {
  demoSandboxes,
  user as userTable,
  session,
  tenantMemberships,
  tenants,
} from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { parseCookies } from '@/lib/utils';
import { canTenantOperate, getTenantEntitlements } from '@/lib/entitlements';

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null | undefined;
};

export type SessionInfo = {
  user: SessionUser;
  tenantId: string;
  tenantSlug: string;
} | null;

async function findSessionFromCookie(
  cookieHeader: string | null,
): Promise<{
  user: typeof userTable.$inferSelect;
  session: typeof session.$inferSelect;
  token: string;
} | null> {
  const cookies = parseCookies(cookieHeader);
  const token = cookies['better-auth.session_token'];
  if (!token) return null;

  const db = getDb();
  const [sessionRecord] = await db
    .select()
    .from(session)
    .where(eq(session.token, token))
    .limit(1);

  if (!sessionRecord || new Date(sessionRecord.expiresAt) < new Date()) return null;

  const [userRecord] = await db
    .select()
    .from(userTable)
    .where(eq(userTable.id, sessionRecord.userId))
    .limit(1);

  if (!userRecord) return null;
  return { user: userRecord, session: sessionRecord, token };
}

/**
 * Demo sandboxes have their own explicit lifecycle in addition to subscription
 * trials. Enforce it here so expiry is authoritative even when no scheduled
 * cleanup job is configured. Any dashboard/API request made after `expiresAt`
 * suspends the sandbox and stops session resolution immediately.
 */
async function demoSandboxCanOperate(tenantId: string): Promise<boolean> {
  const db = getDb();
  const [sandbox] = await db
    .select({
      id: demoSandboxes.id,
      status: demoSandboxes.status,
      isActive: demoSandboxes.isActive,
      expiresAt: demoSandboxes.expiresAt,
    })
    .from(demoSandboxes)
    .where(eq(demoSandboxes.tenantId, tenantId))
    .limit(1);

  if (!sandbox) return false;
  const now = new Date();
  const expired = !sandbox.isActive || sandbox.status !== 'active' || sandbox.expiresAt <= now;
  if (!expired) return true;

  // Synchronise stale active rows lazily. Idempotent updates make this safe
  // when several requests arrive around the expiry boundary.
  if (sandbox.status === 'active' && sandbox.isActive && sandbox.expiresAt <= now) {
    await Promise.all([
      db
        .update(demoSandboxes)
        .set({ status: 'expired', isActive: false })
        .where(eq(demoSandboxes.id, sandbox.id)),
      db
        .update(tenants)
        .set({
          status: 'SUSPENDED',
          lifecycleStatus: 'SUSPENDED',
          lifecycleReason: 'Demo sandbox expired',
          lifecycleChangedAt: now,
          updatedAt: now,
        })
        .where(eq(tenants.id, tenantId)),
    ]);
  }

  return false;
}

async function resolveUserTenant(
  userId: string,
): Promise<{ tenantId: string; tenantSlug: string } | null> {
  try {
    const db = getDb();
    const membership = await db
      .select({
        tenantId: tenantMemberships.tenantId,
        tenantSlug: tenants.slug,
        tenantType: tenants.type,
      })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenantMemberships.tenantId, tenants.id))
      .where(
        and(
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.status, 'active'),
          sql`LOWER(${tenants.status}) IN ('active', 'trial')`,
        ),
      )
      .limit(1);

    if (membership.length === 0) return null;

    const activeMembership = membership[0];
    const tenantId = activeMembership.tenantId;

    if (activeMembership.tenantType === 'demo_sandbox') {
      const demoAllowed = await demoSandboxCanOperate(tenantId);
      if (!demoAllowed) return null;
    }

    // Evaluate subscription lifecycle at session establishment so trial expiry
    // and entitlement changes are enforced from the same server boundary.
    try {
      const { evaluateSubscriptionLifecycle } = await import('@/lib/platform/subscriptions');
      await evaluateSubscriptionLifecycle(tenantId);
    } catch (err) {
      console.warn('[session] Subscription lifecycle evaluation skipped:', err);
    }

    const entitlements = await getTenantEntitlements(tenantId);
    if (entitlements) {
      const gate = canTenantOperate(entitlements);
      if (!gate.ok) return null;
    }

    return { tenantId: activeMembership.tenantId, tenantSlug: activeMembership.tenantSlug };
  } catch {
    return null;
  }
}

function buildSessionInfo(
  sessionData: {
    user: { id: string; email: string; name: string | null; image: string | null };
  },
  tenant: { tenantId: string; tenantSlug: string },
): SessionInfo {
  return {
    user: {
      id: sessionData.user.id,
      email: sessionData.user.email,
      name: sessionData.user.name,
      image: sessionData.user.image,
    },
    tenantId: tenant.tenantId,
    tenantSlug: tenant.tenantSlug,
  };
}

export async function getServerSession(): Promise<SessionInfo> {
  try {
    const h = await headers();
    const cookieHeader = h.get('cookie');
    const result = await findSessionFromCookie(cookieHeader);
    if (!result) return null;

    const tenant = await resolveUserTenant(result.user.id);
    if (!tenant) return null;
    return buildSessionInfo(result, tenant);
  } catch {
    return null;
  }
}

export async function getServerSessionFromRequest(request: Request): Promise<SessionInfo> {
  try {
    const cookieHeader = request.headers.get('cookie');
    const result = await findSessionFromCookie(cookieHeader);
    if (!result) return null;

    const tenant = await resolveUserTenant(result.user.id);
    if (!tenant) return null;
    return buildSessionInfo(result, tenant);
  } catch {
    return null;
  }
}
