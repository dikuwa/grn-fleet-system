import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { tenantMemberships } from '@/db/schema/tenants';
import { checkEntitlement, type TenantEntitlements } from '@/lib/entitlements';

const CAPACITY_STATUSES = ['active', 'pending', 'pending_activation', 'suspended'] as const;

export async function lockTenantUserCapacity(executor: any, tenantId: string) {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`tenant_user_capacity:${tenantId}`}, 0))`,
  );
}

export async function checkTenantUserCapacityLocked(
  executor: any,
  tenantId: string,
  entitlements: TenantEntitlements,
  incoming = 1,
) {
  await lockTenantUserCapacity(executor, tenantId);

  const [countRow] = await executor
    .select({ total: count() })
    .from(tenantMemberships)
    .where(and(
      eq(tenantMemberships.tenantId, tenantId),
      inArray(tenantMemberships.status, [...CAPACITY_STATUSES]),
    ));

  return checkEntitlement(entitlements, 'users', Number(countRow?.total ?? 0), incoming);
}
