/**
 * Request Demo — first-class prospect conversion flow.
 *
 * The page shell is a Server Component: it loads public site settings for
 * the demo-page intro copy (CMS-controlled, safe defaults otherwise). The
 * actual form is a client component that submits to /api/demo-requests,
 * which persists the lead for the Platform Admin demo queue.
 */

import type { Metadata } from 'next';
import { getPublicSiteSettings } from '@/lib/platform/cms-public';
import type { PublicSiteSettings } from '@/lib/platform/cms-public';
import { getPublicSeoContent, publicPageMetadata } from '@/lib/platform/public-metadata';
import { readPublicSiteContent } from '@/lib/platform/site-settings-content';
import { PageHero } from '@/components/public/page-hero';
import { SectionContainer } from '@/components/public/section';
import { RequestDemoForm } from './request-demo-form';

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getPublicSeoContent();
  return publicPageMetadata(seo, 'demo');
}

export default async function RequestDemoPage() {
  let settings: PublicSiteSettings | null = null;
  try {
    settings = await getPublicSiteSettings();
  } catch {
    // fall back to defaults
  }

  const demo = readPublicSiteContent(settings).demo;
  const siteName = settings?.siteName || 'GovFleet Namibia';

  return (
    <>
      <PageHero
        eyebrow={demo.pageTitle}
        title={`See ${siteName} Working`}
        description={demo.description}
      />
      <section className="bg-canvas py-16 md:py-20">
        <SectionContainer>
          <div className="mx-auto max-w-2xl">
            <RequestDemoForm
              successMessage={demo.successMessage}
              expectedResponse={demo.expectedResponse}
            />
          </div>
        </SectionContainer>
      </section>
    </>
  );
}
