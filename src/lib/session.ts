/**
 * Server-side session helpers.
 *
 * Provides two helper functions to resolve the current user's session and
 * their associated tenant membership.  Both share the same tenant-resolution
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
import { user as userTable, session, tenantMemberships, tenants } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { parseCookies } from '@/lib/utils';

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
 * Find a valid session by reading the better-auth.session_token cookie
 * and looking it up in the database. Returns { user, session, token }
 * or null.
 */
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

  if (!sessionRecord || new Date(sessionRecord.expiresAt) < new Date()) {
    return null;
  }

  const [userRecord] = await db
    .select()
    .from(userTable)
    .where(eq(userTable.id, sessionRecord.userId))
    .limit(1);

  if (!userRecord) return null;

  return { user: userRecord, session: sessionRecord, token };
}

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
  sessionData: { user: { id: string; email: string; name: string | null; image: string | null } },
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

/**
 * Get the current session from an incoming request's headers.
 * Use this inside API route handlers where you have the `Request` object.
 */
export async function getServerSessionFromRequest(
  request: Request,
): Promise<SessionInfo> {
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
