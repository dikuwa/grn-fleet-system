/**
 * Server-side session helpers.
 *
 * A Better Auth identity may belong to more than one tenant. The selected
 * tenant is carried in a non-sensitive cookie and is always revalidated against
 * active membership, tenant lifecycle, demo expiry and subscription gates.
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
import { eq, and, sql, asc } from 'drizzle-orm';
import { parseCookies } from '@/lib/utils';
import { canTenantOperate, getTenantEntitlements } from '@/lib/entitlements';

export const ACTIVE_TENANT_COOKIE = 'grn-active-tenant';

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

export type TenantChoice = {
  id: string;
  name: string;
  slug: string;
  type: string;
};

type SessionIdentity = {
  user: typeof userTable.$inferSelect;
  session: typeof session.$inferSelect;
  token: string;
};

type TenantCandidate = TenantChoice;

async function findSessionFromCookie(cookieHeader: string | null): Promise<SessionIdentity | null> {
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
 * Return the authenticated global identity without requiring a tenant context.
 * This is intentionally narrow and is used only while choosing a tenant after
 * sign-in or switching organisations.
 */
export async function getSessionIdentityFromRequest(request: Request): Promise<SessionUser | null> {
  try {
    const result = await findSessionFromCookie(request.headers.get('cookie'));
    if (!result) return null;
    return {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      image: result.user.image,
    };
  } catch {
    return null;
  }
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

async function loadTenantCandidates(userId: string): Promise<TenantCandidate[]> {
  const db = getDb();
  return db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      type: tenants.type,
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
    .orderBy(asc(tenants.name));
}

async function tenantCandidateCanOperate(candidate: TenantCandidate): Promise<boolean> {
  const tenantId = candidate.id;
  if (candidate.type === 'demo_sandbox') {
    const demoAllowed = await demoSandboxCanOperate(tenantId);
    if (!demoAllowed) return false;
  }

  try {
    const { evaluateSubscriptionLifecycle } = await import('@/lib/platform/subscriptions');
    await evaluateSubscriptionLifecycle(tenantId);
  } catch (err) {
    console.warn('[session] Subscription lifecycle evaluation skipped:', err);
  }

  const entitlements = await getTenantEntitlements(tenantId);
  if (!entitlements) return true;
  return canTenantOperate(entitlements).ok;
}

export async function getUserTenantChoices(userId: string): Promise<TenantChoice[]> {
  try {
    const candidates = await loadTenantCandidates(userId);
    const choices: TenantChoice[] = [];
    for (const candidate of candidates) {
      if (await tenantCandidateCanOperate(candidate)) choices.push(candidate);
    }
    return choices;
  } catch {
    return [];
  }
}

async function resolveUserTenant(
  userId: string,
  preferredTenantId?: string | null,
): Promise<{ tenantId: string; tenantSlug: string } | null> {
  try {
    const candidates = await loadTenantCandidates(userId);
    if (candidates.length === 0) return null;

    const ordered = preferredTenantId
      ? [
          ...candidates.filter((candidate) => candidate.id === preferredTenantId),
          ...candidates.filter((candidate) => candidate.id !== preferredTenantId),
        ]
      : candidates;

    for (const candidate of ordered) {
      if (await tenantCandidateCanOperate(candidate)) {
        return { tenantId: candidate.id, tenantSlug: candidate.slug };
      }
    }
    return null;
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

async function buildSessionFromCookie(cookieHeader: string | null): Promise<SessionInfo> {
  const result = await findSessionFromCookie(cookieHeader);
  if (!result) return null;
  const cookies = parseCookies(cookieHeader);
  const tenant = await resolveUserTenant(result.user.id, cookies[ACTIVE_TENANT_COOKIE]);
  if (!tenant) return null;
  return buildSessionInfo(result, tenant);
}

export async function getServerSession(): Promise<SessionInfo> {
  try {
    const h = await headers();
    return await buildSessionFromCookie(h.get('cookie'));
  } catch {
    return null;
  }
}

export async function getServerSessionFromRequest(request: Request): Promise<SessionInfo> {
  try {
    return await buildSessionFromCookie(request.headers.get('cookie'));
  } catch {
    return null;
  }
}
