import { pgTable, uuid, text, timestamp, boolean, jsonb, bigint } from 'drizzle-orm/pg-core';

/**
 * Immutable audit events with hash chain.
 *
 * Audit rows deliberately retain the historical tenant UUID without a foreign
 * key to tenants. Permanently deleting a tenant must not erase or null its
 * audit trail; the UUID remains the stable grouping key for retained history.
 *
 * The application database role may INSERT but not UPDATE or DELETE audit events.
 * Platform maintenance requires a separate restricted role and documented incident procedure.
 */
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  tenantSequence: bigint('tenant_sequence', { mode: 'number' }).notNull(),
  eventType: text('event_type').notNull(),
  actorUserId: text('actor_user_id').notNull(),
  actorEmployeeId: uuid('actor_employee_id'),
  roleAssignmentId: uuid('role_assignment_id'),
  isActing: boolean('is_acting').notNull().default(false),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  correlationId: text('correlation_id'),
  sourceChannel: text('source_channel').notNull().default('web'),
  before: jsonb('before'),
  after: jsonb('after'),
  summary: text('summary'),
  reason: text('reason'),
  previousHash: text('previous_hash'),
  eventHash: text('event_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
