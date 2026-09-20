/**
 * Trust strip + value proposition strip.
 *
 * Organisation imagery is bundled locally as individual optimized SVG assets.
 * Each image is full-bleed inside its tile so no contact-sheet whitespace,
 * remote image dependency or broken-image placeholder can leak into the public page.
 */

import { Eye, FileCheck2, ScrollText, ShieldCheck, Users } from 'lucide-react';
import { SectionContainer } from '@/components/public/section';

const ORGANISATIONS = [
  {
    image: '/images/home/sectors/government-ministries.svg',
    label: 'Government Ministries',
    alt: 'Illustrative Namibian government ministry building with a national flag',
  },
  {
    image: '/images/home/sectors/regional-councils.svg',
    label: 'Regional Councils',
    alt: 'Illustrative contemporary regional council administration building',
  },
  {
    image: '/images/home/sectors/municipalities.svg',
    label: 'Municipalities',
    alt: 'Illustrative municipal civic centre in a landscaped local setting',
  },
  {
    image: '/images/home/sectors/public-enterprises.svg',
    label: 'Public Enterprises',
    alt: 'Illustrative public enterprise operations and utility campus',
  },
  {
    image: '/images/home/sectors/mining-industry.svg',
    label: 'Mining & Industry',
    alt: 'Illustrative heavy mining truck operating in an open quarry',
  },
  {
    image: '/images/home/sectors/logistics-providers.svg',
    label: 'Logistics Providers',
    alt: 'Illustrative commercial freight truck on a long-distance road',
  },
  {
    image: '/images/home/sectors/private-organisations.svg',
    label: 'Private Organisations',
    alt: 'Illustrative modern private-sector office campus',
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
                  {/* Local SVGs are already optimized and render sharply at all responsive sizes. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={org.image}
                    alt={org.alt}
                    width={640}
                    height={360}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.015] motion-reduce:transform-none motion-reduce:transition-none"
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
