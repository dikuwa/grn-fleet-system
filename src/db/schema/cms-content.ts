import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, pgEnum, uniqueIndex, index } from 'drizzle-orm/pg-core';

/**
 * CMS content status
 */
export const cmsContentStatusEnum = pgEnum('cms_content_status', [
  'draft',
  'published',
  'archived',
  'scheduled',
]);

/**
 * CMS page type
 */
export const cmsPageTypeEnum = pgEnum('cms_page_type', [
  'homepage',
  'about',
  'services',
  'how_it_works',
  'pricing',
  'faqs',
  'contact',
  'legal',
  'announcements',
  'media_library',
  'custom',
]);

/**
 * CMS content — public website pages with structured content and version control
 */
export const cmsContent = pgTable('cms_content', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Page identity
  pageType: cmsPageTypeEnum('page_type').notNull(),
  slug: text('slug').notNull().unique(), // e.g., 'about', 'services', 'legal/privacy'
  title: text('title').notNull(),
  description: text('description'),
  featuredImage: text('featured_image'), // R2/Storage key

  // Structured content
  content: jsonb('content').$type<Record<string, unknown>>().notNull().default({}), // Blocks/sections
  metaData: jsonb('meta_data').$type<Record<string, unknown>>().default({}), // SEO metadata

  // Status
  status: cmsContentStatusEnum('status').notNull().default('draft'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),

  // Version control
  version: integer('version').notNull().default(1),
  isLatest: boolean('is_latest').notNull().default(true),

  // Authoring
  createdByUserId: text('created_by_user_id'),
  updatedByUserId: text('updated_by_user_id'),
  publishedByUserId: text('published_by_user_id'),

  // Publishing
  isListed: boolean('is_listed').notNull().default(true), // Shown in nav/sitemap
  navOrder: integer('nav_order').notNull().default(0),

  // Nested/related
  parentId: uuid('parent_id'), // For hierarchical pages (legal subpages)
  sortOrder: integer('sort_order').notNull().default(0),

  // Metadata
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('cms_content_slug_idx').on(table.slug),
  index('cms_content_page_type_idx').on(table.pageType),
  index('cms_content_status_idx').on(table.status),
]);

/**
 * CMS page history — version snapshots for rollback
 */
export const cmsContentVersions = pgTable('cms_content_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  contentId: uuid('content_id')
    .notNull()
    .references(() => cmsContent.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  title: text('title').notNull(),
  content: jsonb('content').$type<Record<string, unknown>>().notNull().default({}),
  metaData: jsonb('meta_data').$type<Record<string, unknown>>().default({}),
  status: cmsContentStatusEnum('status').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedByUserId: text('published_by_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('cms_content_versions_content_version_idx').on(table.contentId, table.version),
]);

/**
 * CMS media — uploaded assets for the public site
 */
export const cmsMedia = pgTable('cms_media', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileName: text('file_name').notNull(),
  fileKey: text('file_key').notNull().unique(), // R2 object key
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size').notNull(), // bytes
  width: integer('width'),
  height: integer('height'),
  alt: text('alt'),
  caption: text('caption'),
  type: text('type').notNull().default('image'), // image, video, document
  uploadedByUserId: text('uploaded_by_user_id'),
  isPublic: boolean('is_public').notNull().default(true),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * CMS FAQ entries
 */
export const cmsFaqs = pgTable('cms_faqs', {
  id: uuid('id').primaryKey().defaultRandom(),
  category: text('category').notNull().default('general'),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isPublished: boolean('is_published').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * CMS enquiries — public contact form submissions
 */
export const cmsEnquiries = pgTable('cms_enquiries', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  subject: text('subject').notNull(),
  message: text('message').notNull(),
  category: text('category').notNull().default('general'),
  status: text('status').notNull().default('new'), // new, in_progress, resolved, closed
  assignedToUserId: text('assigned_to_user_id'),
  assignedAt: timestamp('assigned_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolution: text('resolution'),
  source: text('source').notNull().default('contact_form'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * CMS announcements — platform-wide news/updates
 */
export const cmsAnnouncements = pgTable('cms_announcements', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  excerpt: text('excerpt'),
  body: text('body').notNull(),
  authorName: text('author_name').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  isPublished: boolean('is_published').notNull().default(false),
  isFeatured: boolean('is_featured').notNull().default(false),
  featuredImage: text('featured_image'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * CMS legal versions — for terms/privacy policies with version history
 */
export const cmsLegalVersions = pgTable('cms_legal_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  pageSlug: text('page_slug').notNull().unique(), // 'legal/terms', 'legal/privacy', etc.
  title: text('title').notNull(),
  body: text('body').notNull(),
  version: integer('version').notNull().default(1),
  status: text('status').notNull().default('draft'), // draft, published, superseded
  publishedAt: timestamp('published_at', { withTimezone: true }),
  supersededAt: timestamp('superseded_at', { withTimezone: true }),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }),
  createdByUserId: text('created_by_user_id'),
  publishedByUserId: text('published_by_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('cms_legal_versions_slug_idx').on(table.pageSlug),
]);

/**
 * Site settings — public website configuration
 */
export const cmsSiteSettings = pgTable('cms_site_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteName: text('site_name').notNull(),
  siteTagline: text('site_tagline'),
  logoUrl: text('logo_url'),
  faviconUrl: text('favicon_url'),
  primaryColor: text('primary_color').notNull().default('#1F4E8C'),
  accentColor: text('accent_color').notNull().default('#0F766E'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  address: text('address'),
  socialLinks: jsonb('social_links').$type<Record<string, string>>().default({}),
  heroSection: jsonb('hero_section').$type<Record<string, unknown>>().default({}),
  isUnderMaintenance: boolean('is_under_maintenance').notNull().default(false),
  maintenanceMessage: text('maintenance_message'),
  analyticsId: text('analytics_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});