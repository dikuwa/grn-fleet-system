import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, pgEnum, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { subscriptionPackages, packageAddons } from './packages';

/**
 * Subscription status lifecycle
 */
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'pending_payment',   // Awaiting first payment (manual)
  'trialing',          // Active trial
  'active',            // Paid and active
  'past_due',          // Payment overdue
  'grace_period',      // Within grace period after expiry
  'cancelled',         // Cancelled by user/admin
  'expired',           // Expired without renewal
  'suspended',         // Suspended by platform admin
  'restricted',        // Limited functionality (over limits)
  'not_configured',    // No subscription configured (legacy/internal)
]);

/**
 * Billing interval for subscription
 */
export const subscriptionBillingIntervalEnum = pgEnum('subscription_billing_interval', [
  'monthly',
  'quarterly',
  'annually',
]);

/**
 * Payment method types
 */
export const paymentMethodEnum = pgEnum('payment_method', [
  'bank_transfer',
  'mobile_payment',
  'card',
  'invoice',
  'other',
]);

/**
 * Payment submission status
 */
export const paymentSubmissionStatusEnum = pgEnum('payment_submission_status', [
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'requires_more_info',
]);

/**
 * Tenant subscriptions — links a tenant to a package with lifecycle state
 */
export const tenantSubscriptions = pgTable('tenant_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  packageId: uuid('package_id')
    .notNull()
    .references(() => subscriptionPackages.id, { onDelete: 'restrict' }),

  // Status lifecycle
  status: subscriptionStatusEnum('status').notNull().default('not_configured'),

  // Billing
  billingInterval: subscriptionBillingIntervalEnum('billing_interval').notNull().default('annually'),
  priceCents: integer('price_cents').notNull(), // Locked at purchase time
  currency: text('currency').notNull().default('NAD'),

  // Date tracking
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  gracePeriodEndsAt: timestamp('grace_period_ends_at', { withTimezone: true }),

  // Auto-renewal
  autoRenew: boolean('auto_renew').notNull().default(true),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),

  // Payment tracking
  lastPaymentAt: timestamp('last_payment_at', { withTimezone: true }),
  nextPaymentDueAt: timestamp('next_payment_due_at', { withTimezone: true }),
  paymentMethod: paymentMethodEnum('payment_method'),
  paymentReference: text('payment_reference'), // Bank ref, mobile txn ID, etc.

  // Usage tracking (for enforcement)
  currentVehicles: integer('current_vehicles').notNull().default(0),
  currentUsers: integer('current_users').notNull().default(0),
  currentStorageGb: integer('current_storage_gb').notNull().default(0),
  currentDrivers: integer('current_drivers').notNull().default(0),
  currentDepartments: integer('current_departments').notNull().default(0),
  currentOffices: integer('current_offices').notNull().default(0),

  // Metadata
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('tenant_subscriptions_tenant_idx').on(table.tenantId),
]);

/**
 * Payment submissions — manual payment proof uploads for review
 */
export const paymentSubmissions = pgTable('payment_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  subscriptionId: uuid('subscription_id')
    .notNull()
    .references(() => tenantSubscriptions.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),

  // Payment details
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('NAD'),
  paymentMethod: paymentMethodEnum('payment_method').notNull(),
  paymentReference: text('payment_reference'), // Bank ref, mobile txn ID, etc.
  paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),

  // Proof of payment
  proofFileKey: text('proof_file_key').notNull(), // R2 object key
  proofFileName: text('proof_file_name').notNull(),
  proofFileSize: integer('proof_file_size').notNull(),
  proofMimeType: text('proof_mime_type').notNull(),

  // Submitter info
  submittedByUserId: text('submitted_by_user_id').notNull(), // Better Auth user ID

  // Review workflow
  status: paymentSubmissionStatusEnum('status').notNull().default('submitted'),
  reviewedByUserId: text('reviewed_by_user_id'), // Platform Admin who reviewed
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNotes: text('review_notes'),
  rejectionReason: text('rejection_reason'),

  // Metadata
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('payment_submissions_subscription_idx').on(table.subscriptionId),
  uniqueIndex('payment_submissions_tenant_idx').on(table.tenantId),
]);

/**
 * Billing settings — tenant-specific billing configuration
 */
export const billingSettings = pgTable('billing_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: 'cascade' }),

  // Contact
  billingContactName: text('billing_contact_name'),
  billingContactEmail: text('billing_contact_email'),
  billingContactPhone: text('billing_contact_phone'),

  // Address
  billingAddressLine1: text('billing_address_line1'),
  billingAddressLine2: text('billing_address_line2'),
  billingCity: text('billing_city'),
  billingRegion: text('billing_region'),
  billingPostalCode: text('billing_postal_code'),
  billingCountry: text('billing_country').notNull().default('Namibia'),

  // Tax
  taxId: text('tax_id'), // VAT number
  taxExempt: boolean('tax_exempt').notNull().default(false),
  taxExemptCertificateUrl: text('tax_exempt_certificate_url'),

  // Payment preferences
  preferredPaymentMethod: paymentMethodEnum('preferred_payment_method'),
  paymentInstructions: text('payment_instructions'), // Custom instructions for tenant

  // Bank details (for tenant to pay platform)
  bankAccountName: text('bank_account_name'),
  bankName: text('bank_name'),
  bankBranchCode: text('bank_branch_code'),
  bankAccountNumber: text('bank_account_number'),
  bankSwiftCode: text('bank_swift_code'),
  bankReferenceTemplate: text('bank_reference_template'), // e.g., "GRNFL-{TENANT_CODE}-{INVOICE_NO}"

  // Mobile payment (Namibia: MTC M-Pesa, eWallet, etc.)
  mobilePaymentProvider: text('mobile_payment_provider'),
  mobilePaymentNumber: text('mobile_payment_number'),
  mobilePaymentReferenceTemplate: text('mobile_payment_reference_template'),

  // Notifications
  notifyOnPaymentDue: boolean('notify_on_payment_due').notNull().default(true),
  notifyOnPaymentReceived: boolean('notify_on_payment_received').notNull().default(true),
  notifyOnPaymentOverdue: boolean('notify_on_payment_overdue').notNull().default(true),
  notifyOnSubscriptionChanges: boolean('notify_on_subscription_changes').notNull().default(true),

  // Grace period (days after period end before suspension)
  gracePeriodDays: integer('grace_period_days').notNull().default(14),

  // Metadata
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Subscription add-on instances (tenant-specific add-on purchases)
 */
export const subscriptionAddons = pgTable('subscription_addons', {
  id: uuid('id').primaryKey().defaultRandom(),
  subscriptionId: uuid('subscription_id')
    .notNull()
    .references(() => tenantSubscriptions.id, { onDelete: 'cascade' }),
  addonId: uuid('addon_id')
    .notNull()
    .references(() => packageAddons.id, { onDelete: 'restrict' }),
  quantity: integer('quantity').notNull().default(1),
  priceCents: integer('price_cents').notNull(), // Locked at purchase
  status: text('status').notNull().default('active'), // active, cancelled, expired
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('subscription_addons_subscription_addon_idx').on(table.subscriptionId, table.addonId),
]);