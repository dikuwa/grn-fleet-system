/**
 * Trust strip + value proposition strip.
 *
 * Organisation types use approved local generated imagery rather than remote
 * image providers. The tiny WebP assets are embedded as data URIs so this
 * marketing strip cannot fail because a third-party image endpoint changes or
 * blocks a request.
 */

import {
  Eye,
  FileCheck2,
  ScrollText,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { SectionContainer } from '@/components/public/section';
import { SECTOR_IMAGE_DATA } from '@/components/public/sector-image-data';

const ORGANISATIONS = [
  {
    key: 'government-ministries',
    label: 'Government Ministries',
    alt: 'Namibian public-sector civic building',
    position: '50% 48%',
  },
  {
    key: 'regional-councils',
    label: 'Regional Councils',
    alt: 'Contemporary regional administration building',
    position: '50% 50%',
  },
  {
    // Reuse a verified local civic-office asset until the original municipality
    // data URI is regenerated. This removes the broken-image state without
    // introducing any network dependency.
    key: 'public-enterprises',
    label: 'Municipalities',
    alt: 'Modern civic building in a municipal setting',
    position: '50% 52%',
  },
  {
    key: 'public-enterprises',
    label: 'Public Enterprises',
    alt: 'Modern institutional office building',
    position: '50% 50%',
  },
  {
    key: 'mining-industry',
    label: 'Mining & Industry',
    alt: 'Heavy mining equipment operating in a quarry',
    position: '50% 54%',
  },
  {
    key: 'logistics-providers',
    label: 'Logistics Providers',
    alt: 'Commercial freight truck travelling on a highway',
    position: '50% 55%',
  },
  {
    key: 'private-organisations',
    label: 'Private Organisations',
    alt: 'Modern private-sector office building',
    position: '50% 48%',
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
      <section className="border-b border-border bg-surface">
        <SectionContainer className="py-10 md:py-12">
          <p className="text-center text-sm font-medium text-ink-500">
            Built for organisations that move people, services and resources
          </p>

          <ul className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-7">
            {items.map((org) => (
              <li
                key={org.label}
                className="group min-w-0 overflow-hidden rounded-[10px] border border-border bg-canvas transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-brand-300 motion-reduce:transform-none motion-reduce:transition-none dark:hover:border-brand-800"
              >
                <div className="relative aspect-[8/5] overflow-hidden bg-muted">
                  {/* The source is an approved local data URI, so no network dependency exists. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={SECTOR_IMAGE_DATA[org.key]}
                    alt={org.alt}
                    width={160}
                    height={100}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover opacity-90 transition-[transform,opacity] duration-300 group-hover:scale-[1.02] group-hover:opacity-100 motion-reduce:transform-none motion-reduce:transition-none"
                    style={{ objectPosition: org.position }}
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/10"
                  />
                </div>
                <div className="flex min-h-14 items-center px-3 py-3">
                  <span className="text-xs font-semibold leading-snug text-ink-800 sm:text-sm">
                    {org.label}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </SectionContainer>
      </section>

      <section className="border-b border-border bg-canvas">
        <SectionContainer className="py-12">
          <div className="rounded-[12px] border border-border bg-surface px-5 py-6 sm:px-6">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5 lg:gap-0">
              {VALUES.map((v, index) => (
                <div
                  key={v.title}
                  className={`flex gap-3 lg:px-5 ${index > 0 ? 'lg:border-l lg:border-border' : ''}`}
                >
                  <v.icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-700 dark:text-brand-400" aria-hidden="true" />
                  <div>
                    <h3 className="text-sm font-semibold text-ink-950">{v.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-ink-500">{v.text}</p>
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
