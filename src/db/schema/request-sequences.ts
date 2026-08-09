import { integer, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * Tenant/year-scoped sequence for official transport request references.
 * Sequence gaps are acceptable, but values are never reused.
 */
export const requestReferenceSequences = pgTable(
  'request_reference_sequences',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sequenceYear: integer('sequence_year').notNull(),
    currentValue: integer('current_value').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_request_reference_sequence_tenant_year').on(
      table.tenantId,
      table.sequenceYear,
    ),
  ],
);

/** Tenant/year-scoped sequence for official Programme references. */
export const programmeReferenceSequences = pgTable(
  'programme_reference_sequences',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sequenceYear: integer('sequence_year').notNull(),
    currentValue: integer('current_value').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_programme_reference_sequence_tenant_year').on(
      table.tenantId,
      table.sequenceYear,
    ),
  ],
);
