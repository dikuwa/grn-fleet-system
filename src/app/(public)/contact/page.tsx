/**
 * Contact — conversion-support page.
 *
 * Server component loads contact details from CMS site settings (never
 * hardcoded; rows are hidden when not configured). The enquiry form is a
 * client component that persists to /api/public/enquiries (cms_enquiries)
 * for Platform Admin review. Demo requests are a first-class flow at
 * /request-demo, not a buried checkbox here.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { Mail, Phone, MapPin, Clock, ArrowRight, ExternalLink } from 'lucide-react';
import { getPublicSiteSettings } from '@/lib/platform/cms-public';
import type { PublicSiteSettings } from '@/lib/platform/cms-public';
import { getPublicSeoContent, publicPageMetadata } from '@/lib/platform/public-metadata';
import { readPublicSiteContent } from '@/lib/platform/site-settings-content';
import { PageHero } from '@/components/public/page-hero';
import { SectionContainer } from '@/components/public/section';
import { ContactForm } from './contact-form';

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getPublicSeoContent();
  return publicPageMetadata(seo, 'contact');
}

export default async function ContactPage() {
  let settings: PublicSiteSettings | null = null;
  try {
    settings = await getPublicSiteSettings();
  } catch {
    // fall back to defaults
  }

  const content = readPublicSiteContent(settings);
  const contact = content.contact;

  // Never hardcode contact details — fall back to the legacy settings columns
  // (still CMS-managed) and hide any row that has no value at all.
  const email =
    contact.salesEmail || contact.supportEmail || settings?.contactEmail || '';
  const phone = contact.phone || settings?.contactPhone || '';
  const addressParts = [contact.address, contact.city, contact.country].filter(Boolean);
  const address = addressParts.join(', ') || settings?.address || '';
  const hours = contact.hours;
  const mapUrl = contact.mapUrl;
  const siteName = settings?.siteName || 'GovFleet Namibia';

  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Talk to the GovFleet Team"
        description={contact.intro}
      />

      <section className="bg-canvas py-16 md:py-20">
        <SectionContainer>
          <div className="grid gap-10 lg:grid-cols-5">
            {/* Contact details + demo CTA */}
            <div className="lg:col-span-2">
              <div className="grid gap-4">
                {email ? (
                  <a
                    href={`mailto:${email}`}
                    className="flex items-start gap-4 rounded-[10px] border border-border bg-surface p-5 transition-colors hover:border-brand-200"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                      <Mail className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-ink-950">Email</span>
                      <span className="mt-1 block break-all text-sm text-ink-500">{email}</span>
                    </span>
                  </a>
                ) : null}

                {phone ? (
                  <a
                    href={`tel:${phone.replace(/\s/g, '')}`}
                    className="flex items-start gap-4 rounded-[10px] border border-border bg-surface p-5 transition-colors hover:border-brand-200"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                      <Phone className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-ink-950">Phone</span>
                      <span className="mt-1 block text-sm text-ink-500">{phone}</span>
                    </span>
                  </a>
                ) : null}

                {address ? (
                  <div className="flex items-start gap-4 rounded-[10px] border border-border bg-surface p-5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                      <MapPin className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-ink-950">Office</span>
                      <span className="mt-1 block text-sm text-ink-500">{address}</span>
                    </span>
                  </div>
                ) : null}

                {hours ? (
                  <div className="flex items-start gap-4 rounded-[10px] border border-border bg-surface p-5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                      <Clock className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-ink-950">Hours</span>
                      <span className="mt-1 block text-sm text-ink-500">{hours}</span>
                    </span>
                  </div>
                ) : null}

                {mapUrl ? (
                  <a
                    href={mapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-4 rounded-[10px] border border-border bg-surface p-5 transition-colors hover:border-brand-200"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                      <ExternalLink className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-ink-950">Map</span>
                      <span className="mt-1 block text-sm text-ink-500">
                        View location on the map
                      </span>
                    </span>
                  </a>
                ) : null}
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
