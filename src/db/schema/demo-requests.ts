import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { subscriptionPackages } from './packages';

/**
 * Demo request status
 */
export const demoRequestStatusEnum = pgEnum('demo_request_status', [
  'new',
  'qualified',
  'scheduled',
  'completed',
  'converted',
  'cancelled',
]);

/**
 * Demo sandbox status
 */
export const demoSandboxStatusEnum = pgEnum('demo_sandbox_status', [
  'active',
  'expired',
  'converted',
  'revoked',
  'deleted',
]);

/**
 * Demo request — lead capture for platform demos
 */
export const demoRequests = pgTable('demo_requests', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Requester info (essential)
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),

  // Organization context
  company: text('company').notNull(),
  jobTitle: text('job_title').notNull(),
  role: text('role').notNull(), // platform_admin, tenant_admin, inspector, driver, other

  // Qualification criteria
  industry: text('industry'),
  userCount: integer('user_count'), // Expected concurrent users
  vehicleCount: integer('vehicle_count'), // Expected vehicles to manage
  monthlyCost: integer('monthly_cost_cents'), // Budget in NAD cents

  // Technical requirements
  technicalRequirements: text('technical_requirements'),
  integrationNeeds: text('integration_needs'),

  // Scheduling
  preferredDate: timestamp('preferred_date', { withTimezone: true }),
  preferredTime: text('preferred_time'), // e.g., 'morning', 'afternoon', 'flexible'
  timezone: text('timezone'),

  // Contact preferences
  contactMethod: text('contact_method').notNull().default('email'),
  notes: text('notes'),

  // Qualification workflow
  status: demoRequestStatusEnum('status').notNull().default('new'),
  qualifiedByUserId: text('qualified_by_user_id'), // Platform Admin who qualified
  qualifiedAt: timestamp('qualified_at', { withTimezone: true }),
  scheduledDemoAt: timestamp('scheduled_demo_at', { withTimezone: true }),
  scheduledDemoLink: text('scheduled_demo_link'),

  // Follow-up tracking
  lastContactAt: timestamp('last_contact_at', { withTimezone: true }),
  nextContactAt: timestamp('next_contact_at', { withTimezone: true }),
  contactNotes: text('contact_notes'),

  // Source tracking
  source: text('source'), // e.g., 'website', 'referral', 'ad', 'partner'
  sourceDetails: text('source_details'),

  // Metadata for extensibility
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('demo_requests_email_idx').on(table.email),
]);

/**
 * Demo sandbox tenants — isolated, time-limited environments for platform demos
 * Each demo request can have exactly one sandbox tenant.
 */
export const demoSandboxes = pgTable('demo_sandboxes', {
  id: uuid('id').primaryKey().defaultRandom(),
  demoRequestId: uuid('demo_request_id')
    .notNull()
    .unique()
    .references(() => demoRequests.id, { onDelete: 'cascade' }),

  // Sandbox tenant reference
  tenantId: uuid('tenant_id')
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: 'cascade' }),

  // Sandbox package (always from predefined tier for demos)
  packageId: uuid('package_id')
    .notNull()
    .references(() => subscriptionPackages.id, { onDelete: 'restrict' }),

  // Demo admin user (created for the sandbox)
  adminUserId: text('admin_user_id').notNull(),
  adminEmail: text('admin_email').notNull(),

  // Access credentials (hashed)
  passwordHash: text('password_hash'), // bcrypt hash
  accessCode: text('access_code'), // One-time access code
  isPasswordTemporary: boolean('is_password_temporary').notNull().default(true),

  // Status and lifecycle
  status: demoSandboxStatusEnum('status').notNull().default('active'),
  isActive: boolean('is_active').notNull().default(true),

  // Expiration controls
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
  convertedToPaidTenantId: uuid('converted_to_paid_tenant_id'), // If demo became paid tenant

  // Usage metrics (for sandbox management)
  demoViews: integer('demo_views').notNull().default(0),
  demoCompletions: integer('demo_completions').notNull().default(0),

  // Conversion tracking
  conversionNotes: text('conversion_notes'),

  // Metadata
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
}, (table) => [
  uniqueIndex('demo_sandboxes_tenant_idx').on(table.tenantId),
]);

/**
 * Tenant readiness checks — tracks which critical setup steps have been completed
 */
export const tenantReadinessChecks = pgTable('tenant_readiness_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),

  // Critical path items from the onboarding specification
  // Each item: { stepNumber, stepName, isCompleted, dependencies, notes }
  checks: jsonb('checks').$type<Record<string, unknown>>().notNull().default({}),

  // Overall readiness metrics
  completionPercentage: integer('completion_percentage').notNull().default(0),
  isReady: boolean('is_ready').notNull().default(false),
  canActivate: boolean('can_activate').notNull().default(false),

  // Blocking issues
  blockingIssues: jsonb('blocking_issues').$type<Record<string, unknown>>().default({}),

  // Validation results
  validationPassed: boolean('validation_passed').notNull().default(false),
  validationNotes: text('validation_notes'),

  // Last update
  lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }).notNull().defaultNow(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});