import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  jsonb,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * People who use a tenant's transport service without becoming members of the
 * tenant employee directory. External identity is deliberately isolated from
 * staff identity so a ministry/municipality/contractor visitor never appears
 * in Staff Management merely because they requested transport or may drive.
 */
export const externalParties = pgTable(
  'external_parties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    organisationName: text('organisation_name').notNull(),
    organisationType: text('organisation_type').notNull().default('other'),
    idReference: text('id_reference'),
    email: text('email'),
    phone: text('phone'),
    status: text('status').notNull().default('active'),
    notes: text('notes'),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_external_parties_tenant_name').on(table.tenantId, table.lastName, table.firstName),
    index('idx_external_parties_tenant_organisation').on(table.tenantId, table.organisationName),
    index('idx_external_parties_tenant_status').on(table.tenantId, table.status),
  ],
);

/**
 * Versioned licence evidence for an external party. Uploading evidence never
 * makes the person assignment-eligible: Transport Administration must review
 * and explicitly verify a version first.
 */
export const externalDriverLicences = pgTable(
  'external_driver_licences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    externalPartyId: uuid('external_party_id')
      .notNull()
      .references(() => externalParties.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    licenceNumber: text('licence_number').notNull(),
    licenceClass: text('licence_class').notNull(),
    issueDate: date('issue_date'),
    expiryDate: date('expiry_date').notNull(),
    frontImageKey: text('front_image_key').notNull(),
    backImageKey: text('back_image_key').notNull(),
    verificationStatus: text('verification_status').notNull().default('awaiting_review'),
    reviewNotes: text('review_notes'),
    extractedData: jsonb('extracted_data').$type<Record<string, unknown>>().default({}),
    verifiedByUserId: text('verified_by_user_id'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_external_driver_licence_number').on(table.tenantId, table.licenceNumber),
    index('idx_external_driver_licence_party').on(table.externalPartyId, table.version),
    index('idx_external_driver_licence_review').on(table.tenantId, table.verificationStatus),
  ],
);
