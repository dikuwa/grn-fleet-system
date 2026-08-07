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
  subscriptionAddons,
  type tenantSubscriptions as tenantSubscriptionsType,
} from '@/db/schema/subscriptions';
import { tenants } from '@/db/schema/tenants';
import { subscriptionPackages } from '@/db/schema/packages';
import { eq, and, desc, or } from 'drizzle-orm';
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

export interface SubscriptionWithDetails extends tenantSubscriptionsType.$inferSelect {
  packageName: string;
  packageCode: string;
  tenantName: string;
}

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
  let periodStart = now;
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

  const [subscription] = await db
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

/** Evaluate and enforce subscription lifecycle (call periodically / on login). */
export async function evaluateSubscriptionLifecycle(tenantId: string): Promise<SubscriptionStatus | null> {
  const db = getDb();
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
  const { tenantId: _excluded, ...rest } = input;
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

/** Refresh the usage counters on a tenant's subscription from the live tables. */
export async function refreshUsageCounters(tenantId: string): Promise<void> {
  const db = getDb();
  const [subscription] = await db
    .select()
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.tenantId, tenantId))
    .limit(1);
  if (!subscription) return;

  // Vehicles, users, drivers, departments, offices are counted from their tables.
  // Storage is approximated from the storage usage; kept simple here.
  // TODO: wire to real counts when schema queries are available.
}