import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { employees } from './people';

/**
 * Bearer links that allow a genuine external party to submit a transport
 * request into one tenant's normal workflow without becoming a tenant user.
 *
 * The public URL token is never stored in plaintext. Each link is permanently
 * bound to an internal sponsor employee and trip scope so public callers can
 * never choose tenant, routing, approvers, vehicles or drivers.
 */
export const requestIntakeLinks = pgTable(
  'request_intake_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sponsorEmployeeId: uuid('sponsor_employee_id')
      .notNull()
      .references(() => employees.id),
    tokenHash: text('token_hash').notNull(),
    label: text('label'),
    tripScope: text('trip_scope').notNull().default('regional'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    maxSubmissions: integer('max_submissions').notNull().default(1),
    submissionCount: integer('submission_count').notNull().default(0),
    lastSubmittedAt: timestamp('last_submitted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: text('revoked_by_user_id'),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_request_intake_links_token_hash').on(table.tokenHash),
    index('idx_request_intake_links_tenant_created').on(table.tenantId, table.createdAt),
    index('idx_request_intake_links_sponsor').on(table.tenantId, table.sponsorEmployeeId),
  ],
);
