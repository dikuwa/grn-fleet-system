import { getDb } from '@/db';
import { tenants } from '@/db/schema/tenants';
import { tenantSubscriptions } from '@/db/schema/subscriptions';
import { subscriptionPackages } from '@/db/schema/packages';
import { eq } from 'drizzle-orm';

/**
 * Tenant lifecycle + entitlement layer.
 *
 * All subscription-aware checks live here so feature gates are not
 * scattered across pages. Supports both INTERNAL_DEFAULT (legacy unlimited)
 * and real package-based entitlements.
 */

export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'TRIAL' | 'ARCHIVED' | 'DRAFT' | 'PENDING_INVITATION' | 'INVITATION_SENT' | 'INVITATION_EXPIRED' | 'SETUP_IN_PROGRESS' | 'PENDING_PLATFORM_REVIEW' | 'READY_FOR_ACTIVATION' | 'RESTRICTED' | 'ONBOARDING_FAILED';
export type PlanCode = string;
export type SubscriptionStatusType = 'NOT_CONFIGURED' | 'PENDING_PAYMENT' | 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED' | 'SUSPENDED' | 'RESTRICTED';

export interface TenantEntitlements {
  tenantId: string;
  name: string;
  // Legacy subscription status (ACTIVE/SUSPENDED/TRIAL/ARCHIVED)
  status: TenantStatus;
  // Onboarding lifecycle status (DRAFT → … → ACTIVE). This is the column the
  // lifecycle gate in `canTenantOperate` reads — keep it populated from
  // `tenants.lifecycle_status`, NOT the legacy `status` column.
  lifecycleStatus: TenantStatus;
  planCode: PlanCode;
  subscriptionStatus: SubscriptionStatusType;
  trialEndsAt: Date | null;
  vehicleLimit: number | null; // null = unlimited
  userLimit: number | null;
  storageLimit: number | null; // GB
  // Package features (from subscription)
  features: string[];
  packageName: string | null;
  subscriptionActive: boolean;
}

const UNLIMITED = Number.MAX_SAFE_INTEGER;

/**
 * Load and normalise the entitlements for a tenant.
 */
export async function getTenantEntitlements(tenantId: string): Promise<TenantEntitlements | null> {
  const db = getDb();

  // Get tenant with subscription and package info
  const [tenantRow] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenantRow) return null;

  // Try to get active subscription with package details
  const [subRow] = await db
    .select({
      subscription: tenantSubscriptions,
      pkg: subscriptionPackages,
    })
    .from(tenantSubscriptions)
    .innerJoin(subscriptionPackages, eq(tenantSubscriptions.packageId, subscriptionPackages.id))
    .where(eq(tenantSubscriptions.tenantId, tenantId))
    .limit(1);

  const pkg = subRow?.pkg;
  const subscription = subRow?.subscription;

  // Determine entitlements - use package limits if available, fallback to tenant row
  const vehicleLimit = pkg?.maxVehicles ?? tenantRow.vehicleLimit;
  const userLimit = pkg?.maxUsers ?? tenantRow.userLimit;
  const storageLimit = pkg?.maxStorageGb ?? tenantRow.storageLimit;
  const features = Object.keys(pkg?.features ?? {});
  const packageName = pkg?.name ?? null;
  const subscriptionActive = subscription ? ['trialing', 'active', 'grace_period'].includes(subscription.status) : false;

  return {
    tenantId: tenantRow.id,
    name: tenantRow.name,
    status: (tenantRow.status as TenantStatus) ?? 'ACTIVE',
    // lifecycleStatus is the authoritative onboarding gate column. Default to
    // ACTIVE so tenants created before the lifecycle column existed are not
    // accidentally blocked.
    lifecycleStatus: (tenantRow.lifecycleStatus as TenantStatus) ?? 'ACTIVE',
    planCode: (tenantRow.planCode as PlanCode) ?? (pkg?.code ?? 'INTERNAL_DEFAULT'),
    subscriptionStatus: (tenantRow.subscriptionStatus as SubscriptionStatusType) ?? 'NOT_CONFIGURED',
    trialEndsAt: tenantRow.trialEndsAt,
    vehicleLimit,
    userLimit,
    storageLimit,
    features,
    packageName,
    subscriptionActive,
  };
}

/**
 * Is the tenant allowed to log in and operate at all?
 * Suspended, archived, and onboarding/pending tenants are blocked platform-wide.
 *
 * The lifecycle gate reads `lifecycleStatus` (the onboarding column), NOT the
 * legacy `status` column — tenants are created with `status: 'ACTIVE'` while
 * `lifecycleStatus` drives the DRAFT → … → ACTIVE onboarding flow.
 */
export function canTenantOperate(e: TenantEntitlements): {
  ok: boolean;
  reason?: string;
  lifecycleBlock?: boolean;
} {
  // First check lifecycle status blocks.
  // SETUP_IN_PROGRESS is intentionally NOT blocked here: the tenant admin needs
  // session access to log in and complete the setup wizard. The dashboard layer
  // funnels them to /dashboard/setup while setup is incomplete.
  const blockedLifecycleStatuses: TenantStatus[] = [
    'DRAFT',
    'PENDING_INVITATION',
    'INVITATION_SENT',
    'INVITATION_EXPIRED',
    'PENDING_PLATFORM_REVIEW',
    'READY_FOR_ACTIVATION',
    'ONBOARDING_FAILED',
    'ARCHIVED',
    'SUSPENDED',
    'RESTRICTED',
  ];

  const lifecycle = e.lifecycleStatus;
  if (blockedLifecycleStatuses.includes(lifecycle)) {
    const reasonMap: Record<string, string> = {
      DRAFT: 'This tenant is still being configured. Please complete onboarding.',
      PENDING_INVITATION: 'Awaiting invitation to be sent.',
      INVITATION_SENT: 'Invitation sent. Awaiting acceptance.',
      INVITATION_EXPIRED: 'The invitation has expired. Request a new one.',
      SETUP_IN_PROGRESS: 'Tenant setup is in progress. Complete the setup wizard.',
      PENDING_PLATFORM_REVIEW: 'This tenant is pending platform administrator review.',
      READY_FOR_ACTIVATION: 'This tenant is awaiting activation. Contact the platform administrator.',
      ONBOARDING_FAILED: 'Onboarding failed. Contact support.',
      ARCHIVED: 'This tenant is archived and no longer active.',
      SUSPENDED: 'This tenant is suspended. Contact the platform administrator.',
      RESTRICTED: 'This tenant is restricted due to billing issues. Contact the platform administrator.',
    };
    return {
      ok: false,
      reason: reasonMap[lifecycle] || 'This tenant cannot operate in its current state.',
      lifecycleBlock: true,
    };
  }

  // Then check subscription status
  if (e.subscriptionStatus === 'EXPIRED') {
    return { ok: false, reason: 'Subscription has expired. Contact the platform administrator to renew.' };
  }
  if (e.subscriptionStatus === 'CANCELLED') {
    return { ok: false, reason: 'Subscription has been cancelled.' };
  }
  if (e.subscriptionStatus === 'PAST_DUE' || e.subscriptionStatus === 'RESTRICTED') {
    return { ok: false, reason: 'Subscription is past due. Please make a payment to restore access.' };
  }

  // Legacy trial check (reads the legacy `status` column)
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
 * Check if a specific feature is available for the tenant
 */
export function hasFeature(e: TenantEntitlements, feature: string): boolean {
  if (!e.subscriptionActive) return false;
  return e.features.includes(feature);
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
