/**
 * Server-side session helpers.
 *
 * Provides two helper functions to resolve the current user's session and
 * their associated tenant membership.  Both share the same tenant-resolution
 * logic via the private `resolveUserTenant` helper.
 */

import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getDb } from '@/db';
import { tenantMemberships, tenants } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the active tenant membership for a given user ID.
 * Returns the first active membership found (users can belong to
 * multiple tenants, but one session is the "active" context).
 */
async function resolveUserTenant(
  userId: string,
): Promise<{ tenantId: string; tenantSlug: string } | null> {
  try {
    const db = getDb();
    const membership = await db
      .select({
        tenantId: tenantMemberships.tenantId,
        tenantSlug: tenants.slug,
      })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenantMemberships.tenantId, tenants.id))
      .where(
        and(
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.status, 'active'),
          eq(tenants.status, 'active'),
        ),
      )
      .limit(1);

    if (membership.length === 0) return null;
    return membership[0];
  } catch {
    return null;
  }
}

function buildSessionInfo(
  session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>,
  tenant: { tenantId: string; tenantSlug: string },
): SessionInfo {
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image,
    },
    tenantId: tenant.tenantId,
    tenantSlug: tenant.tenantSlug,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the current session from the request context (server-side).
 * Works in API routes, server components, and route handlers.
 *
 * Uses `headers()` from `next/headers` — only call this from
 * server components / route handlers, NOT from client code.
 */
export async function getServerSession(): Promise<SessionInfo> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    if (!session?.user) return null;

    const tenant = await resolveUserTenant(session.user.id);
    if (!tenant) return null;

    return buildSessionInfo(session, tenant);
  } catch {
    return null;
  }
}

/**
 * Get the current session from an incoming request's headers.
 * Use this inside API route handlers where you have the `Request` object.
 */
export async function getServerSessionFromRequest(
  request: Request,
): Promise<SessionInfo> {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });
    if (!session?.user) return null;

    const tenant = await resolveUserTenant(session.user.id);
    if (!tenant) return null;

    return buildSessionInfo(session, tenant);
  } catch {
    return null;
  }
}
