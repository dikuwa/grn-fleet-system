import { date, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const legalPolicyRegister = pgTable(
  'legal_policy_register',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    instrumentType: text('instrument_type').notNull(),
    citation: text('citation').notNull(),
    sourceUrl: text('source_url'),
    status: text('status').notNull().default('in_force'),
    effectiveDate: date('effective_date'),
    applicability: text('applicability').notNull(),
    responsibleOffice: text('responsible_office'),
    reviewDueDate: date('review_due_date'),
    notes: text('notes'),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('legal_policy_register_tenant_citation_unique').on(
      table.tenantId,
      table.citation,
    ),
    index('legal_policy_register_tenant_status_idx').on(table.tenantId, table.status),
    index('legal_policy_register_review_due_idx').on(table.tenantId, table.reviewDueDate),
  ],
);
