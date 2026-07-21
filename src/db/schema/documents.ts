import { pgTable, uuid, text, timestamp, boolean, integer, jsonb } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * Generated documents (snapshots)
 */
export const generatedDocuments = pgTable('generated_documents', {
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
  status: text('status').notNull().default('draft'), // draft, issued, superseded
  redactionProfile: text('redaction_profile').default('internal'), // internal, external_standard, external_minimal
  reason: text('reason'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  generatedByUserId: text('generated_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Secure share links
 */
export const shareLinks = pgTable('share_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id')
    .notNull()
    .references(() => generatedDocuments.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  isRevoked: boolean('is_revoked').notNull().default(false),
  maxViews: integer('max_views'),
  currentViews: integer('current_views').notNull().default(0),
  redactionProfile: text('redaction_profile').notNull().default('external_standard'),
  createdByUserId: text('created_by_user_id').notNull(),
  lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
