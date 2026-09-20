/**
 * Trust strip + value proposition strip.
 *
 * Organisation imagery is bundled locally as individual optimized WebP assets.
 * Each image is full-bleed inside its tile so no remote dependency or
 * broken-image placeholder can leak into the public page.
 */

import { Eye, FileCheck2, ScrollText, ShieldCheck, Users } from 'lucide-react';
import { SectionContainer } from '@/components/public/section';

const ORGANISATIONS = [
  {
    image: '/images/home/sectors/government-ministries.webp',
    label: 'Government Ministries',
    alt: 'Namibian government ministry office building',
    position: '50% 50%',
  },
  {
    image: '/images/home/sectors/regional-councils.webp',
    label: 'Regional Councils',
    alt: 'Namibian regional council office building',
    position: '50% 50%',
  },
  {
    image: '/images/home/sectors/municipalities.webp',
    label: 'Municipalities',
    alt: 'Namibian municipal civic building',
    position: '50% 50%',
  },
  {
    image: '/images/home/sectors/public-enterprises.webp',
    label: 'Public Enterprises',
    alt: 'Port and public enterprise logistics operations',
    position: '50% 50%',
  },
  {
    image: '/images/home/sectors/mining-industry.webp',
    label: 'Mining & Industry',
    alt: 'Large mining haul truck at an open-pit mine',
    position: '50% 50%',
  },
  {
    image: '/images/home/sectors/logistics-providers.webp',
    label: 'Logistics Providers',
    alt: 'Freight truck travelling on a Namibian highway',
    position: '50% 50%',
  },
  {
    image: '/images/home/sectors/private-organisations.webp',
    label: 'Private Organisations',
    alt: 'Modern corporate office campus',
    position: '50% 50%',
  },
] as const;

const VALUES = [
  {
    icon: ShieldCheck,
    title: 'Secure & Traceable',
    text: 'Every action is logged and attributed to a user.',
  },
  {
    icon: Users,
    title: 'Role-Based Access',
    text: 'Each role sees only what it must act on.',
  },
  {
    icon: Eye,
    title: 'Real-Time Visibility',
    text: 'Live status of requests, trips and fleet activity.',
  },
  {
    icon: FileCheck2,
    title: 'Paperless Operations',
    text: 'Digital forms replace paper transport records.',
  },
  {
    icon: ScrollText,
    title: 'Audit-Ready Records',
    text: 'A complete digital trail from request to closure.',
  },
];

export interface TrustValueStripProps {
  orgs?: string[];
}

export function TrustValueStrip({ orgs }: TrustValueStripProps) {
  const items = orgs?.length
    ? orgs.map((label, index) => ({ ...ORGANISATIONS[index % ORGANISATIONS.length], label }))
    : ORGANISATIONS;

  return (
    <>
      <section className="border-border bg-surface border-b">
        <SectionContainer className="py-10 md:py-12">
          <p className="text-ink-500 text-center text-sm font-medium">
            Built for organisations that move people, services and resources
          </p>

          <ul className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-7">
            {items.map((org) => (
              <li
                key={org.label}
                className="group border-border bg-canvas hover:border-brand-300 dark:hover:border-brand-800 min-w-0 overflow-hidden rounded-[10px] border transition-[border-color,transform] duration-200 hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:transition-none"
              >
                <div className="bg-muted relative aspect-[16/9] overflow-hidden">
                  {/* Local WebP assets avoid third-party image failures and remain lightweight. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={org.image}
                    alt={org.alt}
                    width={640}
                    height={360}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.015] motion-reduce:transform-none motion-reduce:transition-none"
                    style={{ objectPosition: org.position }}
                  />
                </div>
                <div className="flex min-h-14 items-center px-3 py-3">
                  <span className="text-ink-800 text-xs leading-snug font-semibold sm:text-sm">
                    {org.label}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </SectionContainer>
      </section>

      <section className="border-border bg-canvas border-b">
        <SectionContainer className="py-12">
          <div className="border-border bg-surface rounded-[12px] border px-5 py-6 sm:px-6">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5 lg:gap-0">
              {VALUES.map((v, index) => (
                <div
                  key={v.title}
                  className={`flex gap-3 lg:px-5 ${index > 0 ? 'lg:border-border lg:border-l' : ''}`}
                >
                  <v.icon
                    className="text-brand-700 dark:text-brand-400 mt-0.5 h-5 w-5 shrink-0"
                    aria-hidden="true"
                  />
                  <div>
                    <h3 className="text-ink-950 text-sm font-semibold">{v.title}</h3>
                    <p className="text-ink-500 mt-1 text-xs leading-relaxed">{v.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SectionContainer>
      </section>
    </>
  );
}
