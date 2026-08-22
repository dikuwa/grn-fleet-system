import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, pgEnum, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * Reset request status
 */
export const resetRequestStatusEnum = pgEnum('reset_request_status', [
  'draft',         // Started but not submitted
  'pending_review',// Submitted, awaiting platform admin approval
  'approved',      // Approved, ready to execute
  'in_progress',   // Currently executing
  'completed',     // Executed successfully
  'failed',        // Execution failed
  'cancelled',     // Cancelled by requester or admin
  'rejected',      // Rejected by platform admin
]);

/**
 * Reset scope — what gets reset
 */
export const resetScopeEnum = pgEnum('reset_scope', [
  'temporary_data',     // Session data, drafts, ephemeral records
  'operational',        // Requests, trips, fuel, inspections (all operational)
  'fleet',              // Vehicles, driver profiles, maintenance
  'user_access',        // Users, role assignments, memberships (NOT the tenant admin)
  'full',               // Everything except tenant config and the tenant admin
]);

/**
 * Tenant reset requests — managed data reset with approval workflow
 */
export const tenantResetRequests = pgTable('tenant_reset_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),

  // Request details
  scope: resetScopeEnum('scope').notNull(),
  reason: text('reason').notNull(),
  confirmationPhrase: text('confirmation_phrase').notNull(), // User-typed confirmation
  requestedByUserId: text('requested_by_user_id').notNull(),

  // Status
  status: resetRequestStatusEnum('status').notNull().default('draft'),

  // Backup
  backupRequired: boolean('backup_required').notNull().default(true),
  backupCreated: boolean('backup_created').notNull().default(false),
  backupLocation: text('backup_location'), // R2/Storage key or URI
  backupSizeBytes: integer('backup_size_bytes'),
  backupRecordCount: integer('backup_record_count'),

  // Execution tracking
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  executionTimeMs: integer('execution_time_ms'),

  // Review workflow
  reviewedByUserId: text('reviewed_by_user_id'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNotes: text('review_notes'),
  approvalToken: text('approval_token'), // For admin approval

  // Results
  results: jsonb('results').$type<Record<string, unknown>>().default({}), // What was deleted/kept
  validationResults: jsonb('validation_results').$type<Record<string, unknown>>().default({}),
  failureReason: text('failure_reason'),

  // Rollback
  rollbackPossible: boolean('rollback_possible').notNull().default(true),
  rollbackPerformed: boolean('rollback_performed').notNull().default(false),
  rollbackCompletedAt: timestamp('rollback_completed_at', { withTimezone: true }),

  // Metadata
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('tenant_reset_requests_tenant_idx').on(table.tenantId),
  index('tenant_reset_requests_status_idx').on(table.status),
  // Database-backed creation slot. Approved rows are intentionally excluded:
  // approvals expire and remain renewable/history-visible while a new request
  // may be created after expiry. Application checks continue to block a fresh,
  // unexpired approval; this index closes simultaneous draft/pending/in-progress
  // creation races for both tenant and platform request paths.
  uniqueIndex('tenant_reset_requests_creation_slot_uidx')
    .on(table.tenantId)
    .where(sql`${table.status} in ('draft', 'pending_review', 'in_progress')`),
]);

/**
 * Reset step execution log — per-step record of what happened
 */
export const resetRequestSteps = pgTable('reset_request_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  resetRequestId: uuid('reset_request_id')
    .notNull()
    .references(() => tenantResetRequests.id, { onDelete: 'cascade' }),
  stepOrder: integer('step_order').notNull(),
  stepName: text('step_name').notNull(),
  tableName: text('table_name').notNull(),
  recordsDeleted: integer('records_deleted').notNull().default(0),
  recordsPreserved: integer('records_preserved').notNull().default(0),
  filesCleaned: integer('files_cleaned').notNull().default(0),
  status: text('status').notNull().default('pending'), // pending, running, completed, failed
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  error: text('error'),
  details: jsonb('details').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});