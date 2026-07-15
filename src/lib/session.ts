import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getDb } from '@/db';
import { tenantMemberships, tenants } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

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

/**
 * Get the current session from the request context (server-side).
 * Works in API routes, server components, and route handlers.
 */
export async function getServerSession(): Promise<SessionInfo> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return null;

    // Get the user's primary tenant membership
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
          eq(tenantMemberships.userId, session.user.id),
          eq(tenantMemberships.status, 'active'),
          eq(tenants.status, 'active'),
        ),
      )
      .limit(1);

    if (membership.length === 0) return null;

    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        image: session.user.image,
      },
      tenantId: membership[0].tenantId,
      tenantSlug: membership[0].tenantSlug,
    };
  } catch {
    return null;
  }
}

/**
 * Get the current session from request headers (for API routes).
 * Use when you have access to the NextRequest object.
 */
export async function getServerSessionFromRequest(
  request: Request,
): Promise<SessionInfo> {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return null;

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
          eq(tenantMemberships.userId, session.user.id),
          eq(tenantMemberships.status, 'active'),
          eq(tenants.status, 'active'),
        ),
      )
      .limit(1);

    if (membership.length === 0) return null;

    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        image: session.user.image,
      },
      tenantId: membership[0].tenantId,
      tenantSlug: membership[0].tenantSlug,
    };
  } catch {
    return null;
  }
}
