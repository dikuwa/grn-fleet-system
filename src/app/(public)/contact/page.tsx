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
import {
  ArrowRight,
  CircleCheck,
  Clock,
  ExternalLink,
  HelpCircle,
  LayoutDashboard,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  Presentation,
} from 'lucide-react';
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

const CONTACT_STEPS = [
  {
    title: 'Send your enquiry',
    description: 'Tell us what you need help with or what you would like to understand about GovFleet.',
    icon: MessageSquareText,
  },
  {
    title: 'We review the requirement',
    description: 'The platform team reviews the organisation, fleet context and the area of the system involved.',
    icon: LayoutDashboard,
  },
  {
    title: 'We respond with the right next step',
    description: 'That may be an answer, implementation guidance or a product walkthrough where appropriate.',
    icon: CircleCheck,
  },
];

const RELATED_LINKS = [
  {
    href: '/request-demo',
    title: 'Request a Demo',
    description: 'Arrange a focused product walkthrough.',
    icon: Presentation,
  },
  {
    href: '/faq',
    title: 'Browse FAQs',
    description: 'Find answers about operations, access and onboarding.',
    icon: HelpCircle,
  },
  {
    href: '/#platform',
    title: 'Explore the Platform',
    description: 'Review the main fleet-management capabilities.',
    icon: LayoutDashboard,
  },
];

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
        title="Talk to the GovFleet Team"
        description={contact.intro}
      />

      <section className="border-b border-border bg-canvas py-16 md:py-20">
        <SectionContainer>
          <div className="grid gap-10 lg:grid-cols-5">
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
                      <span className="mt-1 block text-sm text-ink-500">View location on the map</span>
                    </span>
                  </a>
                ) : null}
              </div>

              <div className="mt-6 rounded-[10px] border border-brand-200 bg-brand-50 p-6 dark:border-brand-800 dark:bg-brand-900/30">
                <h2 className="text-base font-semibold text-ink-950">Prefer a live walkthrough?</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">
                  Request a demonstration of {siteName} and our team will tailor the session to your organisation&apos;s fleet operations.
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

            <div className="lg:col-span-3">
              <ContactForm />
            </div>
          </div>
        </SectionContainer>
      </section>

      <section className="border-b border-border bg-surface py-14 md:py-18">
        <SectionContainer>
          <div className="mx-auto max-w-6xl">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-[650] tracking-tight text-ink-950">What happens next</h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-500">
                Enquiries are reviewed in context so the response is useful to your organisation rather than a generic sales reply.
              </p>
            </div>

            <ol className="mt-8 grid border-y border-border md:grid-cols-3">
              {CONTACT_STEPS.map((step, index) => {
                const Icon = step.icon;
                return (
                  <li
                    key={step.title}
                    className={`py-6 md:px-6 ${index > 0 ? 'border-t border-border md:border-l md:border-t-0' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                      </span>
                      <span className="text-xs font-semibold tabular-nums text-ink-400">0{index + 1}</span>
                    </div>
                    <h3 className="mt-5 text-sm font-semibold text-ink-950">{step.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-ink-500">{step.description}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </SectionContainer>
      </section>

      <section className="bg-canvas py-14 md:py-20">
        <SectionContainer>
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div className="max-w-xl">
                <h2 className="text-xl font-[650] tracking-tight text-ink-950">Looking for something specific?</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">
                  Use the most direct route for product evaluation, common questions or platform information.
                </p>
              </div>
            </div>

            <div className="mt-7 grid gap-3 md:grid-cols-3">
              {RELATED_LINKS.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group flex items-start gap-4 rounded-[10px] border border-border bg-surface p-5 transition-[border-color,background-color] hover:border-brand-300 hover:bg-muted/40 motion-reduce:transition-none dark:hover:border-brand-800"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-semibold text-ink-950">
                        {item.title}
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
                      </span>
                      <span className="mt-1.5 block text-sm leading-relaxed text-ink-500">{item.description}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </SectionContainer>
      </section>
    </>
  );
}
