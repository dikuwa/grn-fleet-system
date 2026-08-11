/**
 * Tenant subscription management service.
 *
 * Handles the subscription lifecycle (trial → active → grace → restricted →
 * expired), payment submissions with manual Platform Admin review, and billing
 * settings configuration.
 */

import { getDb } from '@/db';
import {
  tenantSubscriptions,
  paymentSubmissions,
  billingSettings,
} from '@/db/schema/subscriptions';
import { tenants, tenantMemberships } from '@/db/schema/tenants';
import { subscriptionPackages } from '@/db/schema/packages';
import { vehicles } from '@/db/schema/fleet';
import { employees, driverProfiles, offices, departments } from '@/db/schema/people';
import { eq, and, desc, sql, ne } from 'drizzle-orm';
import { getPackageById, getPackagePrice } from './packages';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubscriptionStatus =
  | 'pending_payment'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'grace_period'
  | 'cancelled'
  | 'expired'
  | 'suspended'
  | 'restricted'
  | 'not_configured';

export type BillingInterval = 'monthly' | 'quarterly' | 'annually';
export type PaymentMethod = 'bank_transfer' | 'mobile_payment' | 'card' | 'invoice' | 'other';

export type SubscriptionWithDetails = typeof tenantSubscriptions.$inferSelect & {
  packageName: string;
  packageCode: string;
  tenantName: string;
};

// ---------------------------------------------------------------------------
// Lifecycle helpers
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function nextPeriod(interval: BillingInterval, from: Date): Date {
  switch (interval) {
    case 'monthly': return new Date(from.getFullYear(), from.getMonth() + 1, from.getDate());
    case 'quarterly': return new Date(from.getFullYear(), from.getMonth() + 3, from.getDate());
    case 'annually': return new Date(from.getFullYear() + 1, from.getMonth(), from.getDate());
  }
}

function addBillingPeriods(interval: BillingInterval, from: Date, periods: number): Date {
  let result = new Date(from);
  for (let index = 0; index < periods; index += 1) result = nextPeriod(interval, result);
  return result;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Get a tenant's active subscription with package and tenant names. */
export async function getTenantSubscription(tenantId: string): Promise<SubscriptionWithDetails | null> {
  const db = getDb();
  const rows = await db
    .select({
      subscription: tenantSubscriptions,
      package: subscriptionPackages,
      tenant: tenants,
    })
    .from(tenantSubscriptions)
    .innerJoin(subscriptionPackages, eq(tenantSubscriptions.packageId, subscriptionPackages.id))
    .innerJoin(tenants, eq(tenantSubscriptions.tenantId, tenants.id))
    .where(eq(tenantSubscriptions.tenantId, tenantId))
    .limit(1);

  if (rows.length === 0) return null;
  const { subscription, package: pkg, tenant } = rows[0]!;
  return {
    ...subscription,
    packageName: pkg.name,
    packageCode: pkg.code,
    tenantName: tenant.name,
  };
}

/** List all subscriptions with tenant and package info. */
export async function listSubscriptions(): Promise<SubscriptionWithDetails[]> {
  const db = getDb();
  const rows = await db
    .select({
      subscription: tenantSubscriptions,
      package: subscriptionPackages,
      tenant: tenants,
    })
    .from(tenantSubscriptions)
    .innerJoin(subscriptionPackages, eq(tenantSubscriptions.packageId, subscriptionPackages.id))
    .innerJoin(tenants, eq(tenantSubscriptions.tenantId, tenants.id))
    .orderBy(desc(tenantSubscriptions.createdAt));

  return rows.map(({ subscription, package: pkg, tenant }) => ({
    ...subscription,
    packageName: pkg.name,
    packageCode: pkg.code,
    tenantName: tenant.name,
  }));
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export type CreateSubscriptionInput = {
  tenantId: string;
  packageId: string;
  billingInterval: BillingInterval;
  status?: SubscriptionStatus;
  trialDays?: number;
  gracePeriodDays?: number;
  startNow?: boolean;
};

/**
 * Create a subscription for a tenant. If the package has a trial, the
 * subscription starts in `trialing`; otherwise it is `pending_payment` (manual
 * workflow) or `active` when startNow is set.
 */
export async function createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionWithDetails> {
  const db = getDb();

  const pkg = await getPackageById(input.packageId);
  if (!pkg) throw new Error('Package not found');

  const priceCents = getPackagePrice(pkg, input.billingInterval);
  if (priceCents === null) {
    throw new Error(`Package "${pkg.name}" is not available on ${input.billingInterval} billing`);
  }

  const now = new Date();
  const trialDays = input.trialDays ?? pkg.trialDays ?? 0;

  let status: SubscriptionStatus = input.status ?? 'pending_payment';
  const periodStart = now;
  let periodEnd = nextPeriod(input.billingInterval, now);
  let trialEndsAt: Date | null = null;

  if (trialDays > 0) {
    status = 'trialing';
    trialEndsAt = addDays(now, trialDays);
    // Trial period ends when trial ends; billing period follows the trial.
    periodEnd = trialEndsAt;
  } else if (input.startNow) {
    status = 'active';
  }

  await db
    .insert(tenantSubscriptions)
    .values({
      tenantId: input.tenantId,
      packageId: input.packageId,
      status,
      billingInterval: input.billingInterval,
      priceCents,
      currency: 'NAD',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      trialEndsAt,
      gracePeriodEndsAt: input.gracePeriodDays ? addDays(periodEnd, input.gracePeriodDays) : null,
      nextPaymentDueAt: periodEnd,
    })
    .returning();

  // Reflect subscription status onto the tenant row.
  await db
    .update(tenants)
    .set({
      planCode: pkg.code as typeof tenants.$inferSelect.planCode,
      subscriptionStatus: mapSubscriptionToTenantStatus(status) as typeof tenants.$inferSelect.subscriptionStatus,
      trialEndsAt,
      vehicleLimit: pkg.maxVehicles,
      userLimit: pkg.maxUsers,
      storageLimit: pkg.maxStorageGb,
    })
    .where(eq(tenants.id, input.tenantId));

  const result = await getTenantSubscription(input.tenantId);
  if (!result) throw new Error('Subscription created but could not be loaded');
  return result;
}

/** Map a subscription status to the tenant-level subscription status. */
function mapSubscriptionToTenantStatus(status: SubscriptionStatus): string {
  switch (status) {
    case 'trialing': return 'TRIALING';
    case 'active': return 'ACTIVE';
    case 'pending_payment': return 'PENDING_PAYMENT';
    case 'past_due':
    case 'grace_period': return 'PAST_DUE';
    case 'cancelled': return 'CANCELLED';
    case 'expired': return 'EXPIRED';
    case 'suspended': return 'SUSPENDED';
    case 'restricted': return 'RESTRICTED';
    default: return 'NOT_CONFIGURED';
  }
}

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

/** Transition a subscription to a new status, updating the tenant row too. */
export async function transitionSubscription(
  subscriptionId: string,
  status: SubscriptionStatus,
  opts?: { reason?: string; tenantId?: string },
): Promise<void> {
  const db = getDb();
  const now = new Date();

  const [current] = await db
    .select()
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.id, subscriptionId))
    .limit(1);
  if (!current) throw new Error('Subscription not found');

  const updates: Partial<typeof tenantSubscriptions.$inferInsert> = {
    status,
    updatedAt: now,
  };
  if (status === 'cancelled') updates.cancelledAt = now;

  await db
    .update(tenantSubscriptions)
    .set(updates)
    .where(eq(tenantSubscriptions.id, subscriptionId));

  const tenantId = opts?.tenantId ?? current.tenantId;
  await db
    .update(tenants)
    .set({
      subscriptionStatus: mapSubscriptionToTenantStatus(status),
    })
    .where(eq(tenants.id, tenantId));
}

export type ChangeSubscriptionPackageInput = {
  packageId: string;
  billingInterval: BillingInterval;
  billingPeriods: number;
};

/** Upgrade or downgrade a tenant and reset the paid period deliberately. */
export async function changeSubscriptionPackage(
  subscriptionId: string,
  input: ChangeSubscriptionPackageInput,
): Promise<SubscriptionWithDetails> {
  const db = getDb();
  const [current] = await db
    .select()
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.id, subscriptionId))
    .limit(1);
  if (!current) throw new Error('Subscription not found');

  const pkg = await getPackageById(input.packageId);
  if (!pkg || pkg.status !== 'active') throw new Error('Select an active subscription package');
  const priceCents = getPackagePrice(pkg, input.billingInterval);
  if (priceCents === null) {
    throw new Error(`Package "${pkg.name}" is not available on ${input.billingInterval} billing`);
  }
  const billingPeriods = Math.max(1, Math.min(36, Math.trunc(input.billingPeriods)));

  const exceeded = [
    ['vehicles', current.currentVehicles, pkg.maxVehicles],
    ['users', current.currentUsers, pkg.maxUsers],
    ['drivers', current.currentDrivers, pkg.maxDrivers],
    ['departments', current.currentDepartments, pkg.maxDepartments],
    ['offices', current.currentOffices, pkg.maxOffices],
  ].filter(([, used, limit]) => typeof limit === 'number' && Number(used) > Number(limit));
  if (exceeded.length) {
    throw new Error(`Downgrade blocked: current usage exceeds the new package for ${exceeded.map(([label]) => label).join(', ')}`);
  }

  const periodStart = new Date();
  const periodEnd = addBillingPeriods(input.billingInterval, periodStart, billingPeriods);
  await db
    .update(tenantSubscriptions)
    .set({
      packageId: pkg.id,
      billingInterval: input.billingInterval,
      priceCents: priceCents * billingPeriods,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      nextPaymentDueAt: periodEnd,
      trialEndsAt: null,
      gracePeriodEndsAt: null,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      updatedAt: periodStart,
      metadata: {
        ...((current.metadata ?? {}) as Record<string, unknown>),
        billingPeriods,
        unitPriceCents: priceCents,
        packageChangedAt: periodStart.toISOString(),
      },
    })
    .where(eq(tenantSubscriptions.id, subscriptionId));

  await db
    .update(tenants)
    .set({
      planCode: pkg.code,
      vehicleLimit: pkg.maxVehicles,
      userLimit: pkg.maxUsers,
      storageLimit: pkg.maxStorageGb,
      updatedAt: periodStart,
    })
    .where(eq(tenants.id, current.tenantId));

  const updated = await getTenantSubscription(current.tenantId);
  if (!updated) throw new Error('Subscription changed but could not be reloaded');
  return updated;
}

/** Evaluate and enforce subscription lifecycle (call periodically / on login). */
export async function evaluateSubscriptionLifecycle(tenantId: string): Promise<SubscriptionStatus | null> {
  const subscription = await getTenantSubscription(tenantId);
  if (!subscription) return null;

  const now = new Date();
  let newStatus: SubscriptionStatus | null = null;

  switch (subscription.status) {
    case 'trialing': {
      if (subscription.trialEndsAt && now >= subscription.trialEndsAt) {
        newStatus = 'active';
      }
      break;
    }
    case 'active':
    case 'pending_payment': {
      if (subscription.currentPeriodEnd && now >= subscription.currentPeriodEnd) {
        // Grace period check — if within grace, allow. Otherwise expired.
        const graceEnd = subscription.gracePeriodEndsAt;
        if (graceEnd && now < graceEnd) {
          newStatus = 'grace_period';
        } else {
          newStatus = 'expired';
        }
      }
      break;
    }
    case 'grace_period': {
      const graceEnd = subscription.gracePeriodEndsAt;
      if (graceEnd && now >= graceEnd) {
        newStatus = 'expired';
      }
      break;
    }
    default:
      break;
  }

  if (newStatus && newStatus !== subscription.status) {
    await transitionSubscription(subscription.id, newStatus, { tenantId });
  }
  return newStatus ?? subscription.status;
}

// ---------------------------------------------------------------------------
// Payment submissions
// ---------------------------------------------------------------------------

export type CreatePaymentSubmissionInput = {
  subscriptionId: string;
  tenantId: string;
  amountCents: number;
  currency?: string;
  paymentMethod: PaymentMethod;
  paymentReference?: string;
  paidAt: Date;
  proofFileKey: string;
  proofFileName: string;
  proofFileSize: number;
  proofMimeType: string;
  submittedByUserId: string;
};

export async function createPaymentSubmission(
  input: CreatePaymentSubmissionInput,
): Promise<typeof paymentSubmissions.$inferSelect> {
  const db = getDb();
  const [created] = await db
    .insert(paymentSubmissions)
    .values({
      ...input,
      status: 'submitted',
    })
    .returning();
  return created;
}

/** Approve a payment submission — marks subscription active. */
export async function approvePaymentSubmission(
  submissionId: string,
  reviewerUserId: string,
  notes?: string,
): Promise<void> {
  const db = getDb();
  const [submission] = await db
    .select()
    .from(paymentSubmissions)
    .where(eq(paymentSubmissions.id, submissionId))
    .limit(1);
  if (!submission) throw new Error('Payment submission not found');

  const now = new Date();
  await db
    .update(paymentSubmissions)
    .set({
      status: 'approved',
      reviewedByUserId: reviewerUserId,
      reviewedAt: now,
      reviewNotes: notes,
    })
    .where(eq(paymentSubmissions.id, submissionId));

  // Update the subscription to active, extend period by one billing cycle.
  const [subscription] = await db
    .select()
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.id, submission.subscriptionId))
    .limit(1);
  if (subscription) {
    const periodStart = new Date();
    const periodEnd = nextPeriod(subscription.billingInterval, periodStart);
    await db
      .update(tenantSubscriptions)
      .set({
        status: 'active',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        nextPaymentDueAt: periodEnd,
        gracePeriodEndsAt: addDays(periodEnd, 14),
        lastPaymentAt: now,
        paymentMethod: submission.paymentMethod,
        paymentReference: submission.paymentReference,
        updatedAt: now,
      })
      .where(eq(tenantSubscriptions.id, submission.subscriptionId));

    await db
      .update(tenants)
      .set({ subscriptionStatus: 'ACTIVE' })
      .where(eq(tenants.id, submission.tenantId));
  }
}

/** Reject a payment submission. */
export async function rejectPaymentSubmission(
  submissionId: string,
  reviewerUserId: string,
  reason: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(paymentSubmissions)
    .set({
      status: 'rejected',
      reviewedByUserId: reviewerUserId,
      reviewedAt: new Date(),
      rejectionReason: reason,
    })
    .where(eq(paymentSubmissions.id, submissionId));
}

/** List payment submissions for a tenant (or all if no tenant). */
export async function listPaymentSubmissions(tenantId?: string) {
  const db = getDb();
  const base = db.select().from(paymentSubmissions);
  if (tenantId) {
    return await base.where(eq(paymentSubmissions.tenantId, tenantId)).orderBy(desc(paymentSubmissions.createdAt));
  }
  return await base.orderBy(desc(paymentSubmissions.createdAt));
}

// ---------------------------------------------------------------------------
// Billing settings
// ---------------------------------------------------------------------------

export type UpsertBillingSettingsInput = Partial<typeof billingSettings.$inferInsert>;

export async function getBillingSettings(tenantId: string): Promise<typeof billingSettings.$inferSelect | null> {
  const db = getDb();
  const [settings] = await db
    .select()
    .from(billingSettings)
    .where(eq(billingSettings.tenantId, tenantId))
    .limit(1);
  return settings ?? null;
}

export async function upsertBillingSettings(
  tenantId: string,
  input: UpsertBillingSettingsInput,
): Promise<typeof billingSettings.$inferSelect> {
  const db = getDb();
  const { tenantId: _inputTenantId, ...rest } = input;
  void _inputTenantId;
  const [settings] = await db
    .insert(billingSettings)
    .values({ tenantId, ...rest })
    .onConflictDoUpdate({
      target: billingSettings.tenantId,
      set: { ...rest, updatedAt: new Date() },
    })
    .returning();
  return settings;
}

// ---------------------------------------------------------------------------
// Usage counters
// ---------------------------------------------------------------------------

export type UsageCounters = {
  vehicles: number;
  users: number;
  drivers: number;
  departments: number;
  offices: number;
  storageGb: number;
};

/**
 * Count live usage for a tenant across vehicles, users, drivers,
 * departments, offices, and (approximately) storage.
 */
export async function countTenantUsage(tenantId: string): Promise<UsageCounters> {
  const db = getDb();

  const [vehicleRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(vehicles)
    .where(eq(vehicles.tenantId, tenantId));
  const [membershipRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, 'active')));
  const [driverRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(driverProfiles)
    .innerJoin(employees, eq(driverProfiles.employeeId, employees.id))
    .where(and(eq(employees.tenantId, tenantId), ne(employees.employmentStatus, 'archived')));
  const [departmentRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(departments)
    .where(eq(departments.tenantId, tenantId));
  const [officeRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(offices)
    .where(eq(offices.tenantId, tenantId));

  // Storage usage — attempt to measure from R2 if configured; fall back to the
  // tenant's recorded storageLimit (an upper bound estimate) when storage is
  // not configured, so the counter remains meaningful in development.
  let storageGb = 0;
  try {
    const { isStorageConfigured, listFiles } = await import('@/lib/storage');
    if (isStorageConfigured()) {
      const tenantPrefix = `tenants/${tenantId}`;
      const files = await listFiles(tenantPrefix);
      storageGb = Math.ceil(files.reduce((sum, f) => sum + f.size, 0) / (1024 ** 3));
    } else {
      const [t] = await db
        .select({ storageLimit: tenants.storageLimit })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      storageGb = t?.storageLimit ?? 0;
    }
  } catch (err) {
    console.warn('[subscriptions] Storage usage measurement failed:', err);
  }

  return {
    vehicles: Number(vehicleRow?.count ?? 0),
    users: Number(membershipRow?.count ?? 0),
    drivers: Number(driverRow?.count ?? 0),
    departments: Number(departmentRow?.count ?? 0),
    offices: Number(officeRow?.count ?? 0),
    storageGb,
  };
}

/** Refresh the usage counters on a tenant's subscription from the live tables. */
export async function refreshUsageCounters(tenantId: string): Promise<UsageCounters> {
  const db = getDb();
  const [subscription] = await db
    .select()
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.tenantId, tenantId))
    .limit(1);
  if (!subscription) {
    throw new Error(`No subscription found for tenant ${tenantId}`);
  }

  const usage = await countTenantUsage(tenantId);

  await db
    .update(tenantSubscriptions)
    .set({
      currentVehicles: usage.vehicles,
      currentUsers: usage.users,
      currentDrivers: usage.drivers,
      currentDepartments: usage.departments,
      currentOffices: usage.offices,
      currentStorageGb: usage.storageGb,
      updatedAt: new Date(),
    })
    .where(eq(tenantSubscriptions.id, subscription.id));

  return usage;
}
