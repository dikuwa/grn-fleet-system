import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { tenants } from '@/db/schema/tenants';

/**
 * Remove a tenant whose Platform onboarding bootstrap failed before any
 * external side effects (such as invitation email delivery) are attempted.
 *
 * Tenant-owned onboarding records use ON DELETE CASCADE, so deleting the
 * tenant is the single source of truth for compensating a failed bootstrap.
 * This keeps Neon HTTP production compatible without pretending that a long,
 * return-value-heavy onboarding sequence can be expressed as one db.batch().
 */
export async function cleanupFailedTenantOnboarding(tenantId: string): Promise<void> {
  const db = getDb();
  await db.delete(tenants).where(eq(tenants.id, tenantId));
}
