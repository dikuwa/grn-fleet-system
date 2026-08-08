import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { tenantResetRequests } from './reset-requests';

/**
 * Durable logical recovery points stored outside Postgres (R2/S3-compatible storage).
 * The database stores metadata only so a database incident does not destroy the archive itself.
 */
export const platformBackups = pgTable('platform_backups', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  resetRequestId: uuid('reset_request_id').references(() => tenantResetRequests.id, { onDelete: 'set null' }),
  scope: text('scope').notNull().default('tenant_operational'),
  source: text('source').notNull().default('manual'), // manual, scheduled, pre_reset
  reason: text('reason'),
  status: text('status').notNull().default('creating'), // creating, ready, failed, expired, deleted
  storageKey: text('storage_key'),
  checksum: text('checksum'),
  sizeBytes: integer('size_bytes'),
  recordCount: integer('record_count').notNull().default(0),
  retentionDays: integer('retention_days').notNull().default(30),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  isProtected: boolean('is_protected').notNull().default(false),
  createdByUserId: text('created_by_user_id'),
  restoredAt: timestamp('restored_at', { withTimezone: true }),
  restoredByUserId: text('restored_by_user_id'),
  failureReason: text('failure_reason'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('platform_backups_tenant_idx').on(table.tenantId),
  index('platform_backups_status_created_idx').on(table.status, table.createdAt),
  index('platform_backups_reset_request_idx').on(table.resetRequestId),
]);

/**
 * Backup policy. A null tenantId means the policy applies to every active non-demo tenant.
 * Vercel cron checks these policies daily and only runs schedules that are due.
 */
export const platformBackupSchedules = pgTable('platform_backup_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  frequency: text('frequency').notNull().default('monthly'), // daily, weekly, monthly
  retentionDays: integer('retention_days').notNull().default(90),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
  createdByUserId: text('created_by_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('platform_backup_schedules_due_idx').on(table.enabled, table.nextRunAt),
  index('platform_backup_schedules_tenant_idx').on(table.tenantId),
]);
