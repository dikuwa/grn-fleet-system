/**
 * Public page metadata helper.
 *
 * Builds a Next.js `Metadata` object from the Platform Admin's SEO settings
 * (stored in `cms_site_settings.metadata.publicSite.seo`), falling back to the
 * default SEO copy when nothing has been configured. Uses `title.absolute` so
 * CMS-provided titles are used verbatim (they already include the brand).
 */

import type { Metadata } from 'next';
import { getPublicSiteSettings } from '@/lib/platform/cms-public';
import { readPublicSiteContent } from '@/lib/platform/site-settings-content';
import {
  DEFAULT_PUBLIC_SITE_CONTENT,
  type PublicSeoContent,
} from '@/lib/platform/site-settings-content';

export type SeoPageKey =
  | 'homepage'
  | 'about'
  | 'services'
  | 'contact'
  | 'demo'
  | 'faq';

const DEFAULT_TITLES: Record<SeoPageKey, string> = {
  homepage: 'GovFleet Namibia | Fleet Operations Platform',
  about: 'About | GovFleet Namibia',
  services: 'Platform & Services | GovFleet Namibia',
  contact: 'Contact | GovFleet Namibia',
  demo: 'Request a Demo | GovFleet Namibia',
  faq: 'FAQ | GovFleet Namibia',
};

const DEFAULT_DESCRIPTIONS: Record<SeoPageKey, string> = {
  homepage:
    'Manage transport requests, approvals, vehicles, drivers, trips, fuel and maintenance from one accountable digital platform for government and public-sector fleets.',
  about:
    'Why GovFleet exists — accountability, efficiency and operational visibility for government and public-sector fleet operations in Namibia.',
  services:
    'Transport requests, approvals, vehicle allocation, inspections, fuel, compliance, maintenance, reports, mobile access and administration.',
  contact:
    'Get in touch with the GovFleet team — request a demonstration or ask a question about the platform.',
  demo:
    'See how GovFleet manages transport requests, approvals, vehicles, drivers, fuel and trip records in one accountable platform.',
  faq: 'Frequently asked questions about GovFleet — what it is, who can use it, and how to request a demonstration.',
};

const TITLE_KEY: Record<SeoPageKey, keyof PublicSeoContent> = {
  homepage: 'homepageTitle',
  about: 'aboutTitle',
  services: 'servicesTitle',
  contact: 'contactTitle',
  demo: 'demoTitle',
  faq: 'faqTitle',
};

const DESCRIPTION_KEY: Record<SeoPageKey, keyof PublicSeoContent> = {
  homepage: 'homepageDescription',
  about: 'aboutDescription',
  services: 'servicesDescription',
  contact: 'contactDescription',
  demo: 'demoDescription',
  faq: 'faqDescription',
};

/**
 * Build metadata for a public page from the CMS SEO settings.
 * `seo` should already be merged over defaults (see `readPublicSiteContent`),
 * so every field is a non-empty string.
 */
export function publicPageMetadata(
  seo: PublicSeoContent,
  page: SeoPageKey,
): Metadata {
  const title = seo[TITLE_KEY[page]] || DEFAULT_TITLES[page];
  const description = seo[DESCRIPTION_KEY[page]] || DEFAULT_DESCRIPTIONS[page];
  const socialImage = seo.socialImageUrl || null;

  const metadata: Metadata = {
    title: { absolute: title },
    description,
  };

  const openGraph: Metadata['openGraph'] = {
    title,
    description,
    type: 'website',
  };
  const twitter: Metadata['twitter'] = {
    card: 'summary_large_image',
    title,
    description,
  };

  if (socialImage) {
    openGraph.images = [{ url: socialImage, width: 1200, height: 630, alt: title }];
    twitter.images = [socialImage];
  }

  metadata.openGraph = openGraph;
  metadata.twitter = twitter;
  return metadata;
}

/** SEO defaults for settings not yet saved (used by generateMetadata fallback). */
export function defaultSeoContent(): PublicSeoContent {
  return structuredClone(DEFAULT_PUBLIC_SITE_CONTENT.seo);
}

/**
 * Load the CMS SEO content for a public page, with safe defaults when the
 * settings row is missing or the CMS is unreachable.
 */
export async function getPublicSeoContent(): Promise<PublicSeoContent> {
  try {
    const settings = await getPublicSiteSettings();
    return readPublicSiteContent(settings).seo;
  } catch {
    return defaultSeoContent();
  }
}
