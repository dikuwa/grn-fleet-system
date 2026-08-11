import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Tenants (regional councils, ministries, agencies)
 */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    code: text('code').notNull().unique(),
    slug: text('slug').notNull().unique(),
    type: text('type').notNull().default('regional_council'),

    // ── Subscription/entitlement status (SaaS-ready) ──
    // status: ACTIVE, SUSPENDED, TRIAL, ARCHIVED
    status: text('status').notNull().default('ACTIVE'),
    // planCode: INTERNAL_DEFAULT (billing is not implemented yet)
    planCode: text('plan_code').notNull().default('INTERNAL_DEFAULT'),
    // subscriptionStatus: NOT_CONFIGURED (no payment provider wired up)
    subscriptionStatus: text('subscription_status').notNull().default('NOT_CONFIGURED'),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    vehicleLimit: integer('vehicle_limit'),
    userLimit: integer('user_limit'),
    storageLimit: integer('storage_limit'), // in GB

    // ── Onboarding lifecycle (SaaS platform) ──
    // lifecycleStatus: DRAFT → PENDING_INVITATION → INVITATION_SENT →
    //   INVITATION_EXPIRED → SETUP_IN_PROGRESS → PENDING_PLATFORM_REVIEW →
    //   READY_FOR_ACTIVATION → ACTIVE → SUSPENDED → RESTRICTED → ARCHIVED →
    //   ONBOARDING_FAILED
    lifecycleStatus: text('lifecycle_status').notNull().default('DRAFT'),
    // Who created this tenant (Better Auth user id)
    createdByUserId: text('created_by_user_id'),
    // Name/email of the primary contact (organization lead)
    primaryContactName: text('primary_contact_name'),
    primaryContactEmail: text('primary_contact_email'),
    primaryContactPhone: text('primary_contact_phone'),
    // Invitation tracking
    invitationSentAt: timestamp('invitation_sent_at', { withTimezone: true }),
    invitationAcceptedAt: timestamp('invitation_accepted_at', { withTimezone: true }),
    // Which onboarding wizard step is in progress
    currentOnboardingStep: integer('current_onboarding_step').notNull().default(0),
    // Human-readable reason for the current lifecycle state
    lifecycleReason: text('lifecycle_reason'),
    // When the lifecycle state last changed
    lifecycleChangedAt: timestamp('lifecycle_changed_at', { withTimezone: true }),

    timezone: text('timezone').notNull().default('Africa/Windhoek'),
    locale: text('locale').notNull().default('en-NA'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('tenants_lifecycle_status_idx').on(table.lifecycleStatus)],
);

/**
 * Tenant branding configuration
 */
export const tenantBranding = pgTable('tenant_branding', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  logoUrl: text('logo_url'),
  logoDarkUrl: text('logo_dark_url'),
  primaryColor: text('primary_color').default('#1F4E8C'),
  accentColor: text('accent_color').default('#0F766E'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  address: text('address'),
  documentFooter: text('document_footer'),
  executiveSignatoryName: text('executive_signatory_name'),
  executiveSignatoryTitle: text('executive_signatory_title').default('Chief Executive Officer'),
  executiveSignatureUrl: text('executive_signature_url'),
  senderName: text('sender_name'),
  senderEmail: text('sender_email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Tenant membership linking users to tenants
 */
export const tenantMemberships = pgTable('tenant_memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(), // References Better Auth user
  status: text('status').notNull().default('active'),
  activeWorkspace: text('active_workspace'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Roles (capability-based permission groups)
 */
export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Individual permission strings
 */
export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  group: text('group').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Role-permission mapping
 */
export const rolePermissions = pgTable('role_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  roleId: uuid('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'cascade' }),
  permissionCode: text('permission_code')
    .notNull()
    .references(() => permissions.code, { onDelete: 'cascade' }),
});

/**
 * Role assignments (who has which role, when, and in what capacity)
 */
export const roleAssignments = pgTable('role_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantMembershipId: uuid('tenant_membership_id')
    .notNull()
    .references(() => tenantMemberships.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'cascade' }),
  officeId: uuid('office_id'), // Optional office scope
  startDate: timestamp('start_date', { withTimezone: true }).notNull().defaultNow(),
  endDate: timestamp('end_date', { withTimezone: true }),
  isActing: boolean('is_acting').notNull().default(false),
  delegatedByUserId: text('delegated_by_user_id'),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Tenant holidays (for business-day calendar)
 */
export const tenantHolidays = pgTable('tenant_holidays', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  holidayDate: timestamp('holiday_date', { withTimezone: true }).notNull(),
  isRecurringYearly: boolean('is_recurring_yearly').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
