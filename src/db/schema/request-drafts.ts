import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { employees } from './people';

export interface RequestDraftPayload {
  requesterEmployeeId?: string;
  assistedReason?: string;
  purpose?: string;
  department?: string;
  scope?: 'regional' | 'national';
  specialAuthorityRequired?: boolean;
  specialAuthorityReason?: string;
  activities?: unknown[];
  passengers?: unknown[];
  drivers?: unknown[];
  routes?: unknown[];
  driverPreference?: string;
  programmeId?: string;
  [key: string]: unknown;
}

/**
 * Incomplete requester form state.
 *
 * Drafts deliberately live outside transport_requests so they can remain
 * incomplete and never consume an official GRN/TR reference or enter workflow.
 */
export const requestDrafts = pgTable(
  'request_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    requesterEmployeeId: uuid('requester_employee_id').references(() => employees.id, {
      onDelete: 'set null',
    }),
    clientDraftId: text('client_draft_id'),
    lastStep: integer('last_step').notNull().default(0),
    payload: jsonb('payload').$type<RequestDraftPayload>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_request_drafts_tenant_user_client')
      .on(table.tenantId, table.userId, table.clientDraftId),
    index('idx_request_drafts_tenant_user_updated')
      .on(table.tenantId, table.userId, table.updatedAt),
  ],
);
