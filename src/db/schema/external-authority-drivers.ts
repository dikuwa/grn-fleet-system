import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { tripAuthorities } from './trips';
import { externalDriverLicences, externalParties } from './external-parties';

/**
 * Canonical external-driver identity attached to a Trip Authority.
 *
 * External drivers deliberately remain outside the employee directory. Their
 * accepted assignment and verified licence are snapshotted here instead of
 * fabricating an employee record just to satisfy the authority lifecycle.
 */
export const tripAuthorisedExternalDrivers = pgTable(
  'trip_authorised_external_drivers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorityId: uuid('authority_id')
      .notNull()
      .references(() => tripAuthorities.id, { onDelete: 'cascade' }),
    externalPartyId: uuid('external_party_id')
      .notNull()
      .references(() => externalParties.id),
    externalDriverLicenceId: uuid('external_driver_licence_id')
      .notNull()
      .references(() => externalDriverLicences.id),
    driverType: text('driver_type').notNull().default('primary'),
    licenceNumberMasked: text('licence_number_masked'),
    licenceClass: text('licence_class'),
    licenceExpiry: timestamp('licence_expiry', { withTimezone: true }),
    acceptanceMethod: text('acceptance_method'),
    acceptanceNote: text('acceptance_note'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    authorisedByUserId: text('authorised_by_user_id'),
    authorisedAt: timestamp('authorised_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_trip_authorised_external_authority_party').on(
      table.authorityId,
      table.externalPartyId,
    ),
    index('idx_trip_authorised_external_party').on(table.externalPartyId),
  ],
);
