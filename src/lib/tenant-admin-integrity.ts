import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { roleAssignments, roles, tenantMemberships } from '@/db/schema/tenants';
import { lockUserMembershipInvariant } from '@/lib/user-membership-integrity';

export async function lockTenantAdministratorInvariant(executor: any, tenantId: string) {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`tenant_administrator:${tenantId}`}, 0))`,
  );
}

export async function wouldDisableFinalActiveTenantAdministrator(
  executor: any,
  tenantId: string,
  userId: string,
  now = new Date(),
) {
  await lockUserMembershipInvariant(executor, userId);
  await lockTenantAdministratorInvariant(executor, tenantId);

  const rows = await executor
    .select({ userId: tenantMemberships.userId })
    .from(roleAssignments)
    .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
    .innerJoin(tenantMemberships, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
    .where(and(
      eq(tenantMemberships.tenantId, tenantId),
      eq(tenantMemberships.status, 'active'),
      eq(roles.name, 'Tenant Administrator'),
      lte(roleAssignments.startDate, now),
      or(isNull(roleAssignments.endDate), gt(roleAssignments.endDate, now)),
    ));

  const activeAdminUserIds = new Set(rows.map((row: { userId: string }) => row.userId));
  return activeAdminUserIds.size === 1 && activeAdminUserIds.has(userId);
}
