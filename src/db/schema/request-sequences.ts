import { integer, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * Tenant/year-scoped sequence for official transport request references.
 *
 * Sequence gaps are acceptable (for example, if a later submission step fails),
 * but a value must never be reused. The database unique key makes concurrent
 * increments safe when used through INSERT ... ON CONFLICT DO UPDATE.
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
