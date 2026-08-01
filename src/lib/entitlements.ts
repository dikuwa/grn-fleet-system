import { getDb } from '@/db';
import { tenants } from '@/db/schema/tenants';
import { eq } from 'drizzle-orm';

/**
 * Tenant lifecycle + entitlement layer.
 *
 * All subscription-aware checks live here so feature gates are not
 * scattered across pages. Billing is NOT implemented yet — the platform
 * ships with INTERNAL_DEFAULT / NOT_CONFIGURED and an unlimited ceiling
 * so nothing is artificially blocked, while the data model and access
 * points are ready for a future plan.
 */

export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'TRIAL' | 'ARCHIVED';
export type PlanCode = 'INTERNAL_DEFAULT';
export type SubscriptionStatus = 'NOT_CONFIGURED';

export interface TenantEntitlements {
  tenantId: string;
  name: string;
  status: TenantStatus;
  planCode: PlanCode;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
  vehicleLimit: number | null; // null = unlimited
  userLimit: number | null;
  storageLimit: number | null; // GB
}

const UNLIMITED = Number.MAX_SAFE_INTEGER;

/**
 * Load and normalise the entitlements for a tenant.
 */
export async function getTenantEntitlements(tenantId: string): Promise<TenantEntitlements | null> {
  const db = getDb();
  const [row] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!row) return null;
  return {
    tenantId: row.id,
    name: row.name,
    status: (row.status as TenantStatus) ?? 'ACTIVE',
    planCode: (row.planCode as PlanCode) ?? 'INTERNAL_DEFAULT',
    subscriptionStatus: (row.subscriptionStatus as SubscriptionStatus) ?? 'NOT_CONFIGURED',
    trialEndsAt: row.trialEndsAt,
    vehicleLimit: row.vehicleLimit,
    userLimit: row.userLimit,
    storageLimit: row.storageLimit,
  };
}

/**
 * Is the tenant allowed to log in and operate at all?
 * Suspended and archived tenants are blocked platform-wide.
 */
export function canTenantOperate(e: TenantEntitlements): {
  ok: boolean;
  reason?: string;
} {
  if (e.status === 'SUSPENDED') {
    return { ok: false, reason: 'This tenant is suspended. Contact the platform administrator.' };
  }
  if (e.status === 'ARCHIVED') {
    return { ok: false, reason: 'This tenant is archived and no longer active.' };
  }
  if (e.status === 'TRIAL' && e.trialEndsAt && e.trialEndsAt.getTime() < Date.now()) {
    return { ok: false, reason: 'The trial period has ended. Contact the platform administrator.' };
  }
  return { ok: true };
}

/** Effective vehicle limit (null → unlimited). */
export function vehicleLimit(e: TenantEntitlements): number {
  return e.vehicleLimit ?? UNLIMITED;
}

/** Effective user limit (null → unlimited). */
export function userLimit(e: TenantEntitlements): number {
  return e.userLimit ?? UNLIMITED;
}

/** Effective storage limit in bytes (null → unlimited). */
export function storageLimitBytes(e: TenantEntitlements): number {
  return e.storageLimit === null || e.storageLimit === undefined
    ? UNLIMITED
    : e.storageLimit * 1024 * 1024 * 1024;
}

/**
 * Check a numeric resource against the tenant's entitlement.
 * Returns a human-readable error when over the limit.
 */
export function checkEntitlement(
  e: TenantEntitlements,
  kind: 'vehicles' | 'users' | 'storage_bytes',
  current: number,
  incoming = 0,
): { ok: boolean; message?: string } {
  const ceiling =
    kind === 'vehicles'
      ? vehicleLimit(e)
      : kind === 'users'
        ? userLimit(e)
        : storageLimitBytes(e);
  if (ceiling === UNLIMITED) return { ok: true };
  if (current + incoming > ceiling) {
    const label = kind === 'vehicles' ? 'vehicle' : kind === 'users' ? 'user' : 'storage';
    return {
      ok: false,
      message: `${label.charAt(0).toUpperCase() + label.slice(1)} limit reached (${ceiling.toLocaleString()} on the ${e.planCode} plan). Contact the platform administrator to increase it.`,
    };
  }
  return { ok: true };
}
