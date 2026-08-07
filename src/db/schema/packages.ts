import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Subscription package tiers
 */
export const packageTierEnum = pgEnum('package_tier', [
  'trial',
  'starter',
  'professional',
  'enterprise',
  'custom_institutional',
]);

/**
 * Subscription package status
 */
export const packageStatusEnum = pgEnum('package_status', [
  'active',
  'deprecated',
  'archived',
]);

/**
 * Billing interval for packages
 */
export const billingIntervalEnum = pgEnum('billing_interval', [
  'monthly',
  'quarterly',
  'annually',
]);

/**
 * Subscription packages — defines available tiers, pricing, and entitlements.
 * Platform Admins manage these; Tenant Admins select from available packages.
 */
export const subscriptionPackages = pgTable('subscription_packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(), // e.g., 'TRIAL', 'STARTER', 'PRO', 'ENT', 'CUSTOM_INST'
  name: text('name').notNull(),
  description: text('description'),
  tier: packageTierEnum('tier').notNull(),
  status: packageStatusEnum('status').notNull().default('active'),

  // Pricing (stored in NAD cents to avoid floating point)
  priceMonthlyCents: integer('price_monthly_cents'), // null = not available monthly
  priceQuarterlyCents: integer('price_quarterly_cents'),
  priceAnnuallyCents: integer('price_annually_cents'),

  // Default billing interval
  defaultBillingInterval: billingIntervalEnum('default_billing_interval').notNull().default('annually'),

  // Entitlements (null = unlimited)
  maxVehicles: integer('max_vehicles'),
  maxUsers: integer('max_users'),
  maxStorageGb: integer('max_storage_gb'),
  maxDrivers: integer('max_drivers'),
  maxDepartments: integer('max_departments'),
  maxOffices: integer('max_offices'),
  maxApiCallsPerMonth: integer('max_api_calls_per_month'),

  // Feature flags
  features: jsonb('features').$type<Record<string, boolean>>().notNull().default({}),

  // Trial configuration
  trialDays: integer('trial_days').notNull().default(0),
  trialRequiresPaymentMethod: boolean('trial_requires_payment_method').notNull().default(false),

  // Sort order for display
  sortOrder: integer('sort_order').notNull().default(0),

  // Metadata for custom packages
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('subscription_packages_code_idx').on(table.code),
]);

/**
 * Package entitlements — for fine-grained feature access control
 */
export const packageEntitlements = pgTable('package_entitlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  packageId: uuid('package_id')
    .notNull()
    .references(() => subscriptionPackages.id, { onDelete: 'cascade' }),
  permissionCode: text('permission_code').notNull(), // References permissions.code
  isIncluded: boolean('is_included').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Package add-ons (optional extras that can be purchased)
 */
export const packageAddons = pgTable('package_addons', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  priceMonthlyCents: integer('price_monthly_cents'),
  priceAnnuallyCents: integer('price_annually_cents'),
  maxQuantity: integer('max_quantity'), // null = unlimited
  isActive: boolean('is_active').notNull().default(true),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});