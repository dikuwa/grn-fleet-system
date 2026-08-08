/**
 * Contact — conversion-support page.
 *
 * Server component loads contact details from CMS site settings (never
 * hardcoded). The enquiry form is a client component that persists to
 * /api/public/enquiries (cms_enquiries) for Platform Admin review.
 * Demo requests are a first-class flow at /request-demo, not a buried
 * checkbox here.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { Mail, Phone, MapPin, ArrowRight } from 'lucide-react';
import { getPublicSiteSettings } from '@/lib/platform/cms-public';
import type { PublicSiteSettings } from '@/lib/platform/cms-public';
import { PageHero } from '@/components/public/page-hero';
import { SectionContainer } from '@/components/public/section';
import { ContactForm } from './contact-form';

export const metadata: Metadata = {
  title: 'Contact | GovFleet Namibia',
  description:
    'Contact the GovFleet team for support, demonstrations or enquiries about digital fleet management.',
};

export default async function ContactPage() {
  let settings: PublicSiteSettings | null = null;
  try {
    settings = await getPublicSiteSettings();
  } catch {
    // fall back to defaults
  }

  const contactEmail = settings?.contactEmail || 'support@govfleet.gov.na';
  const contactPhone = settings?.contactPhone || '+264 61 200 7000';
  const address = settings?.address || 'Windhoek, Namibia';
  const siteName = settings?.siteName || 'GovFleet Namibia';

  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Talk to the GovFleet Team"
        description="Get in touch for support, demonstrations or enquiries about fleet operations."
      />

      <section className="bg-canvas py-16 md:py-20">
        <SectionContainer>
          <div className="grid gap-10 lg:grid-cols-5">
            {/* Contact details + demo CTA */}
            <div className="lg:col-span-2">
              <div className="grid gap-4 sm:grid-cols-1">
                <a
                  href={`mailto:${contactEmail}`}
                  className="flex items-start gap-4 rounded-[10px] border border-border bg-surface p-5 transition-colors hover:border-brand-200"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                    <Mail className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-ink-950">Email</span>
                    <span className="mt-1 block text-sm text-ink-500">{contactEmail}</span>
                  </span>
                </a>
                <a
                  href={`tel:${contactPhone.replace(/\s/g, '')}`}
                  className="flex items-start gap-4 rounded-[10px] border border-border bg-surface p-5 transition-colors hover:border-brand-200"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                    <Phone className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-ink-950">Phone</span>
                    <span className="mt-1 block text-sm text-ink-500">{contactPhone}</span>
                  </span>
                </a>
                <div className="flex items-start gap-4 rounded-[10px] border border-border bg-surface p-5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                    <MapPin className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-ink-950">Office</span>
                    <span className="mt-1 block text-sm text-ink-500">{address}</span>
                  </span>
                </div>
              </div>

              <div className="mt-6 rounded-[10px] border border-brand-200 bg-brand-50 p-6 dark:border-brand-800 dark:bg-brand-900/30">
                <h2 className="text-base font-semibold text-ink-950">Prefer a live walkthrough?</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">
                  Request a demonstration of {siteName} and our team will tailor the session to
                  your organisation&apos;s fleet operations.
                </p>
                <Link
                  href="/request-demo"
                  className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-[8px] bg-brand-800 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 dark:hover:bg-brand-600"
                >
                  Request a Demo
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </div>

            {/* Enquiry form */}
            <div className="lg:col-span-3">
              <ContactForm />
            </div>
          </div>
        </SectionContainer>
      </section>
    </>
  );
}
