import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants';

/**
 * Generated documents (snapshots)
 */
export const generatedDocuments = pgTable(
  'generated_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentType: text('document_type').notNull(),
    documentVersion: integer('document_version').notNull().default(1),
    templateVersion: text('template_version'),
    entityType: text('entity_type').notNull(), // transport_request, trip, inspection, etc.
    entityId: uuid('entity_id').notNull(),
    snapshotData: jsonb('snapshot_data').$type<Record<string, unknown>>().notNull(),
    fileKey: text('file_key'),
    hash: text('hash'),
    /** Stable, non-expiring public verification identity for official records. */
    verificationSlug: text('verification_slug')
      .notNull()
      .default(sql`'d-' || lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))`),
    verificationCode: text('verification_code')
      .notNull()
      .default(sql`upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))`),
    status: text('status').notNull().default('draft'), // draft, issued, superseded
    redactionProfile: text('redaction_profile').default('internal'), // internal, external_standard, external_minimal
    reason: text('reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    generatedByUserId: text('generated_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_generated_documents_verification_slug').on(table.verificationSlug),
    uniqueIndex('uq_generated_documents_verification_code').on(table.verificationCode),
    // Document versions are scoped by tenant + source entity + document family.
    // This closes the read-then-increment race at the database boundary even if
    // two application requests attempt to generate the same next version.
    uniqueIndex('uq_generated_documents_entity_version').on(
      table.tenantId,
      table.entityType,
      table.entityId,
      table.documentType,
      table.documentVersion,
    ),
    // There may be many historical/superseded versions but exactly one current
    // issued version for an entity/document family.
    uniqueIndex('uq_generated_documents_current_issued')
      .on(table.tenantId, table.entityType, table.entityId, table.documentType)
      .where(sql`${table.status} = 'issued'`),
    index('idx_generated_documents_tenant_entity').on(
      table.tenantId,
      table.entityType,
      table.entityId,
      table.documentType,
    ),
  ],
);

/**
 * Secure share links
 */
export const shareLinks = pgTable(
  'share_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => generatedDocuments.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    shortSlug: text('short_slug'),
    verificationCode: text('verification_code'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    isRevoked: boolean('is_revoked').notNull().default(false),
    maxViews: integer('max_views'),
    currentViews: integer('current_views').notNull().default(0),
    redactionProfile: text('redaction_profile').notNull().default('external_standard'),
    accessPolicy: jsonb('access_policy')
      .$type<{ allowPreview?: boolean; allowDownload?: boolean }>()
      .default({ allowPreview: true, allowDownload: false }),
    createdByUserId: text('created_by_user_id').notNull(),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_share_links_short_slug').on(table.shortSlug),
    index('idx_share_links_tenant_document').on(table.tenantId, table.documentId),
  ],
);

/**
 * Share access events (audit log for external link access)
 */
export const shareAccessEvents = pgTable('share_access_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  shareLinkId: uuid('share_link_id')
    .notNull()
    .references(() => shareLinks.id, { onDelete: 'cascade' }),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  result: text('result').notNull(), // granted, expired, revoked, not_found
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
