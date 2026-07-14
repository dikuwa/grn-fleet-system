import { pgTable, uuid, text, timestamp, boolean, integer, jsonb } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * In-app notifications
 */
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  recipientUserId: text('recipient_user_id').notNull(),
  type: text('type').notNull(), // awareness, action_required, outcome, reminder, escalation, operational, risk, emergency
  title: text('title').notNull(),
  body: text('body'),
  entityType: text('entity_type'), // transport_request, trip, vehicle, etc.
  entityId: uuid('entity_id'),
  actionUrl: text('action_url'),
  priority: text('priority').notNull().default('normal'), // low, normal, high, emergency
  isRead: boolean('is_read').notNull().default(false),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Notification delivery tracking
 */
export const notificationDeliveries = pgTable('notification_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  notificationId: uuid('notification_id')
    .notNull()
    .references(() => notifications.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(), // in_app, email, manual_whatsapp
  providerId: text('provider_id'),
  attempt: integer('attempt').notNull().default(1),
  status: text('status').notNull().default('pending'), // pending, sent, delivered, failed, skipped
  errorSummary: text('error_summary'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Notification preferences (tenant/user configurable)
 */
export const notificationPreferences = pgTable('notification_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  emailNotifications: boolean('email_notifications').notNull().default(true),
  inAppNotifications: boolean('in_app_notifications').notNull().default(true),
  quietHoursStart: text('quiet_hours_start'), // HH:mm format
  quietHoursEnd: text('quiet_hours_end'),
  emergencyBypassQuietHours: boolean('emergency_bypass_quiet_hours').notNull().default(true),
  preferences: jsonb('preferences').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Import batches
 */
export const importBatches = pgTable('import_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  importType: text('import_type').notNull(), // staff, vehicles, offices
  fileName: text('file_name').notNull(),
  fileKey: text('file_key').notNull(),
  columnMapping: jsonb('column_mapping').$type<Record<string, string>>(),
  status: text('status').notNull().default('uploaded'), // uploaded, mapping, validated, committed, partially_committed, failed
  totalRows: integer('total_rows').default(0),
  validRows: integer('valid_rows').default(0),
  errorRows: integer('error_rows').default(0),
  committedRows: integer('committed_rows').default(0),
  importedByUserId: text('imported_by_user_id').notNull(),
  committedAt: timestamp('committed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const importRows = pgTable('import_rows', {
  id: uuid('id').primaryKey().defaultRandom(),
  batchId: uuid('batch_id')
    .notNull()
    .references(() => importBatches.id, { onDelete: 'cascade' }),
  rowNumber: integer('row_number').notNull(),
  rawData: jsonb('raw_data').$type<Record<string, unknown>>().notNull(),
  normalizedData: jsonb('normalized_data').$type<Record<string, unknown>>(),
  validationErrors: jsonb('validation_errors').$type<string[]>(),
  duplicateMatchId: uuid('duplicate_match_id'),
  isCommitted: boolean('is_committed').notNull().default(false),
  commitEntityId: uuid('commit_entity_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
