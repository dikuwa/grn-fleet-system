import { and, ne, sql } from 'drizzle-orm';
import { tenantMemberships } from '@/db/schema/tenants';

export async function lockUserMembershipInvariant(executor: any, userId: string) {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`user_membership:${userId}`}, 0))`,
  );
}

export async function hasOtherUsableMembership(
  executor: any,
  userId: string,
  excludedMembershipId: string,
) {
  await lockUserMembershipInvariant(executor, userId);

  const [membership] = await executor
    .select({ id: tenantMemberships.id })
    .from(tenantMemberships)
    .where(and(
      sql`${tenantMemberships.userId} = ${userId}`,
      ne(tenantMemberships.id, excludedMembershipId),
      ne(tenantMemberships.status, 'access_removed'),
    ))
    .limit(1);

  return Boolean(membership);
}
