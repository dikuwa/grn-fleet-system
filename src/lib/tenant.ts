import { getDb } from '@/db';
import { tenants, tenantMemberships } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Verify that a user belongs to a specific tenant
 */
export async function verifyTenantMembership(
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const db = getDb();
  const result = await db
    .select({ id: tenantMemberships.id })
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.userId, userId),
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.status, 'active'),
      ),
    )
    .limit(1);

  return result.length > 0;
}

/**
 * Get all tenants a user has access to
 */
export async function getUserTenants(userId: string) {
  const db = getDb();
  return db
    .select({
      tenant: tenants,
      membership: tenantMemberships,
    })
    .from(tenantMemberships)
    .innerJoin(tenants, eq(tenantMemberships.tenantId, tenants.id))
    .where(
      and(
        eq(tenantMemberships.userId, userId),
        eq(tenantMemberships.status, 'active'),
      ),
    );
}

/**
 * Tenant-scoped query helper
 * Ensures every tenant-owned query is scoped to the correct tenant.
 */
export function tenantScope(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: { tenantId: any },
  tenantId: string,
) {
  return eq(table.tenantId, tenantId);
}

/**
 * SQL template tag for setting the app tenant context
 * Used for RLS policies
 */
export function setTenantContextSql(tenantId: string): string {
  return `SELECT set_config('app.tenant_id', '${tenantId.replace(/'/g, "''")}', true)`;
}

/**
 * Verify tenant access and return tenant or throw
 */
export async function requireTenantAccess(
  userId: string,
  tenantId: string,
): Promise<typeof tenants.$inferSelect> {
  const db = getDb();
  const member = await verifyTenantMembership(userId, tenantId);
  if (!member) {
    throw new Error('Access denied: you do not have access to this tenant');
  }
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.status, 'active')))
    .limit(1);

  if (!tenant) {
    throw new Error('Tenant not found or inactive');
  }
  return tenant;
}
