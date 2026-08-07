import { pgTable, uuid, text, timestamp, integer, jsonb, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * Invitation status lifecycle
 */
export const invitationStatusEnum = pgEnum('invitation_status', [
  'pending',
  'sent',
  'accepted',
  'declined',
  'expired',
  'cancelled',
]);

/**
 * Invitation type
 */
export const invitationTypeEnum = pgEnum('invitation_type', [
  'tenant_admin',
  'department_admin',
  'driver',
  'inspector',
  'custom',
]);

/**
 * Tenant invitations — secure single-use tokens for adding users
 */
export const tenantInvitations = pgTable('tenant_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),

  // Target user (by email)
  email: text('email').notNull(),

  // Invitation details
  name: text('name'), // Invited person's name
  type: invitationTypeEnum('type').notNull().default('tenant_admin'),
  message: text('message'), // Custom invitation message

  // Token for acceptance (cryptographic random)
  token: text('token').notNull().unique(),

  // Status
  status: invitationStatusEnum('status').notNull().default('pending'),

  // Expiration
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),

  // Tracking
  invitedByUserId: text('invited_by_user_id').notNull(), // Platform Admin (or Tenant Admin)
  invitedByTenantId: uuid('invited_by_tenant_id'), // For isolation tracking

  // Metadata
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('tenant_invitations_token_idx').on(table.token),
  uniqueIndex('tenant_invitations_email_status_idx').on(table.email, table.status),
]);

/**
 * Invitation role assignments (what roles the invited person gets)
 */
export const invitationRoles = pgTable('invitation_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  invitationId: uuid('invitation_id')
    .notNull()
    .references(() => tenantInvitations.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull(), // references roles.id
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Tenant setup progress — tracks wizard completion for tenants
 */
export const tenantSetupProgress = pgTable('tenant_setup_progress', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: 'cascade' }),

  // Step completion tracking (versioned)
  stepStatus: jsonb('step_status').$type<Record<string, unknown>>().default({}),

  // Overall progress
  completedSteps: integer('completed_steps').notNull().default(0),
  totalSteps: integer('total_steps').notNull().default(11), // From specification: 11 steps
  currentStep: integer('current_step').notNull().default(0),

  // Save-and-resume support
  lastSavedAt: timestamp('last_saved_at', { withTimezone: true }).notNull().defaultNow(),
  resumedFromStep: integer('resumed_from_step'),

  // Progress snapshot
  stepData: jsonb('step_data').$type<Record<string, unknown>>().default({}),

  // Readiness checks
  readinessScore: integer('readiness_score').notNull().default(0),
  isReady: boolean('is_ready').notNull().default(false),

  // Metadata
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});