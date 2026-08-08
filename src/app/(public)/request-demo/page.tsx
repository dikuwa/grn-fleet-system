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
import { PageHero } from '@/components/public/page-hero';
import { SectionContainer } from '@/components/public/section';
import { RequestDemoForm } from './request-demo-form';

export const metadata: Metadata = {
  title: 'Request a Demo | GovFleet Namibia',
  description:
    'See how GovFleet manages transport requests, approvals, vehicles, drivers, fuel and trip records in one accountable digital platform.',
};

const DEFAULT_INTRO =
  'Tell us about your organisation and fleet operations. Our team will review your requirements and contact you using the details provided.';

export default async function RequestDemoPage() {
  let settings: PublicSiteSettings | null = null;
  try {
    settings = await getPublicSiteSettings();
  } catch {
    // fall back to defaults
  }

  const heroSection = (settings?.heroSection as Record<string, unknown> | undefined) ?? {};
  const intro =
    typeof heroSection.demoIntro === 'string' && heroSection.demoIntro.trim()
      ? heroSection.demoIntro
      : DEFAULT_INTRO;
  const siteName = settings?.siteName || 'GovFleet Namibia';

  return (
    <>
      <PageHero
        eyebrow="Request a Demo"
        title={`See ${siteName} Working`}
        description={intro}
      />
      <section className="bg-canvas py-16 md:py-20">
        <SectionContainer>
          <div className="mx-auto max-w-2xl">
            <RequestDemoForm />
          </div>
        </SectionContainer>
      </section>
    </>
  );
}
