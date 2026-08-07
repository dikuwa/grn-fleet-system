/**
 * Public CMS read service.
 *
 * Read-only accessors for published CMS content that the public website
 * renders. No auth required — only `published` rows, and only the latest
 * version of each page, are ever returned. All calls are safe against empty
 * CMS stores and return `null`/`[]` so consumers can fall back to defaults.
 */

import { getDb } from '@/db';
import {
  cmsContent,
  cmsFaqs,
  cmsSiteSettings,
} from '@/db/schema/cms-content';
import { and, eq, asc, desc } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PublicCmsContent = typeof cmsContent.$inferSelect;
export type PublicFaq = typeof cmsFaqs.$inferSelect;
export type PublicSiteSettings = typeof cmsSiteSettings.$inferSelect;

// ---------------------------------------------------------------------------
// Content pages
// ---------------------------------------------------------------------------

/** Get the latest published CMS page by its unique slug. Returns null if none. */
export async function getPublishedContentBySlug(
  slug: string,
): Promise<PublicCmsContent | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(cmsContent)
    .where(
      and(
        eq(cmsContent.slug, slug),
        eq(cmsContent.status, 'published'),
        eq(cmsContent.isLatest, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Get the latest published pages for a given page type, ordered by nav/sort
 * order. Returns an empty array when nothing is published yet.
 */
export async function getPublishedContentByPageType(
  pageType: string,
): Promise<PublicCmsContent[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(cmsContent)
    .where(
      and(
        eq(cmsContent.pageType, pageType as never),
        eq(cmsContent.status, 'published'),
        eq(cmsContent.isLatest, true),
      ),
    )
    .orderBy(asc(cmsContent.navOrder), asc(cmsContent.sortOrder));
  return rows;
}

/**
 * Get all published CMS pages that should appear in navigation. Useful for
 * building the public site nav from CMS rather than hardcoded links.
 */
export async function getPublishedNavItems(): Promise<PublicCmsContent[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(cmsContent)
    .where(
      and(
        eq(cmsContent.status, 'published'),
        eq(cmsContent.isLatest, true),
        eq(cmsContent.isListed, true),
      ),
    )
    .orderBy(asc(cmsContent.navOrder), asc(cmsContent.sortOrder));
  return rows;
}

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

/** Get all published FAQs, optionally filtered by category. */
export async function getPublishedFaqs(
  category?: string,
): Promise<PublicFaq[]> {
  const db = getDb();
  if (category) {
    return await db
      .select()
      .from(cmsFaqs)
      .where(and(eq(cmsFaqs.isPublished, true), eq(cmsFaqs.category, category)))
      .orderBy(asc(cmsFaqs.sortOrder));
  }
  return await db
    .select()
    .from(cmsFaqs)
    .where(eq(cmsFaqs.isPublished, true))
    .orderBy(asc(cmsFaqs.sortOrder));
}

/** Get the distinct published FAQ categories in display order. */
export async function getPublishedFaqCategories(): Promise<string[]> {
  const faqs = await getPublishedFaqs();
  const seen = new Set<string>();
  const categories: string[] = [];
  for (const faq of faqs) {
    const cat = faq.category || 'general';
    if (!seen.has(cat)) {
      seen.add(cat);
      categories.push(cat);
    }
  }
  return categories;
}

// ---------------------------------------------------------------------------
// Site settings
// ---------------------------------------------------------------------------

/** Get the (single) site settings record, or null when not configured. */
export async function getPublicSiteSettings(): Promise<PublicSiteSettings | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(cmsSiteSettings)
    .orderBy(desc(cmsSiteSettings.updatedAt))
    .limit(1);
  return row ?? null;
}