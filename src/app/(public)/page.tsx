/**
 * Homepage — the commercial face of GovFleet.
 *
 * Composes the public section components in the story order defined by the
 * public-site spec. Every section falls back to safe defaults when CMS
 * content is missing, so the page never renders empty or crashes.
 *
 * Sections:
 *   01 Hero + real product preview
 *   02 Trust / supported organisation types + value strip
 *   03 Core capabilities + product thumbnails
 *   04 How GovFleet works (six-stage lifecycle)
 *   05 Live operational visibility + roles
 *   06 Sector solutions + honest product facts + pilot
 *   07 FAQ + final conversion CTA
 */

import type { Metadata } from 'next';
import {
  getPublishedContentBySlug,
  getPublishedFaqs,
  getPublicSiteSettings,
} from '@/lib/platform/cms-public';
import type {
  PublicCmsContent,
  PublicSiteSettings,
} from '@/lib/platform/cms-public';
import { getPublicSeoContent, publicPageMetadata } from '@/lib/platform/public-metadata';
import { readPublicSiteContent } from '@/lib/platform/site-settings-content';
import { JsonLd } from '@/components/public/json-ld';
import { Hero } from '@/components/public/sections/hero';
import { TrustValueStrip } from '@/components/public/sections/trust-value-strip';
import { Capabilities } from '@/components/public/sections/capabilities';
import { Workflow } from '@/components/public/sections/workflow';
import { VisibilityRoles } from '@/components/public/sections/visibility-roles';
import { SectorsMetricsPilot } from '@/components/public/sections/sectors-metrics-pilot';
import { FaqSection, FinalCta } from '@/components/public/sections/faq-final-cta';

// ---------------------------------------------------------------------------
// Metadata (CMS-driven SEO)
// ---------------------------------------------------------------------------

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getPublicSeoContent();
  return publicPageMetadata(seo, 'homepage');
}

// ---------------------------------------------------------------------------
// CMS extraction helpers (all with safe defaults)
// ---------------------------------------------------------------------------

function heroFrom(
  content: PublicCmsContent | null,
  settings: PublicSiteSettings | null,
) {
  const s = (settings?.heroSection as Record<string, unknown> | undefined) ?? {};
  const c = content?.content ?? {};

  const str = (source: Record<string, unknown>, key: string): string | undefined =>
    typeof source[key] === 'string' ? String(source[key]) : undefined;

  const proofPoints = Array.isArray(s.proofPoints)
    ? s.proofPoints.filter((p): p is string => typeof p === 'string')
    : undefined;

  return {
    eyebrow: str(s, 'eyebrow') ?? str(c, 'eyebrow'),
    title: str(s, 'title') ?? str(c, 'heroTitle'),
    description: str(s, 'description') ?? str(c, 'heroDescription'),
    proofPoints,
  };
}

function workflowFrom(content: PublicCmsContent | null) {
  const c = content?.content ?? {};
  return {
    heading: typeof c.workflowHeading === 'string' ? c.workflowHeading : undefined,
    subheading:
      typeof c.workflowSubheading === 'string' ? c.workflowSubheading : undefined,
  };
}

function pilotFrom(content: PublicCmsContent | null) {
  const c = content?.content ?? {};
  return {
    pilotTitle: typeof c.pilotTitle === 'string' ? c.pilotTitle : undefined,
    pilotSummary: typeof c.pilotSummary === 'string' ? c.pilotSummary : undefined,
  };
}

function faqHeadingFrom(content: PublicCmsContent | null) {
  const c = content?.content ?? {};
  return {
    heading: typeof c.faqHeading === 'string' ? c.faqHeading : undefined,
    subheading: typeof c.faqSubheading === 'string' ? c.faqSubheading : undefined,
  };
}

// ---------------------------------------------------------------------------
// Page component (Server Component)
// ---------------------------------------------------------------------------

export default async function HomePage() {
  let settings: PublicSiteSettings | null = null;
  let homepage: PublicCmsContent | null = null;
  let faqs: Awaited<ReturnType<typeof getPublishedFaqs>> = [];

  try {
    [settings, homepage, faqs] = await Promise.all([
      getPublicSiteSettings(),
      getPublishedContentBySlug('homepage'),
      getPublishedFaqs(),
    ]);
  } catch {
    // CMS unreachable or empty — sections fall back to defaults below.
  }

  const hero = heroFrom(homepage, settings);
  const workflow = workflowFrom(homepage);
  const pilot = pilotFrom(homepage);
  const faq = faqHeadingFrom(homepage);
  const publicContent = readPublicSiteContent(settings);
  const siteName = settings?.siteName || 'GovFleet Namibia';

  const organizationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: siteName,
    description: publicContent.hero.description,
    url: process.env.NEXT_PUBLIC_SITE_URL ?? undefined,
    email: publicContent.contact.salesEmail || undefined,
    telephone: publicContent.contact.phone || undefined,
    address: publicContent.contact.address
      ? {
          '@type': 'PostalAddress',
          streetAddress: publicContent.contact.address || undefined,
          addressLocality: publicContent.contact.city || undefined,
          addressCountry: publicContent.contact.country || undefined,
        }
      : undefined,
  };

  return (
    <>
      <JsonLd data={organizationJsonLd} />
      <Hero
        eyebrow={hero.eyebrow}
        title={hero.title}
        description={hero.description}
        proofPoints={hero.proofPoints}
      />
      <TrustValueStrip />
      <Capabilities />
      <Workflow
        heading={workflow.heading}
        subheading={workflow.subheading}
      />
      <VisibilityRoles />
      <SectorsMetricsPilot
        pilotTitle={pilot.pilotTitle}
        pilotSummary={pilot.pilotSummary}
      />
      <FaqSection
        faqs={faqs}
        heading={faq.heading}
        subheading={faq.subheading}
      />
      <FinalCta />
    </>
  );
}
