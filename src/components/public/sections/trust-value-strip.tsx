/**
 * Trust strip + value proposition strip.
 *
 * Immediately below the hero: who the platform is built for (organisation
 * types, not fake customer logos) and a compact set of restrained trust
 * signals.
 */

import { ShieldCheck, Users, Eye, FileCheck2, ScrollText } from 'lucide-react';
import { SectionContainer } from '@/components/public/section';

const ORGANISATIONS = [
  'Government Ministries',
  'Regional Councils',
  'Municipalities',
  'Public Enterprises',
  'Mining & Industry',
  'Logistics Providers',
  'Private Organisations',
];

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
  const items = orgs?.length ? orgs : ORGANISATIONS;

  return (
    <>
      {/* Trust / organisation types */}
      <section className="border-b border-border bg-surface">
        <SectionContainer className="py-10">
          <p className="text-center text-sm font-medium text-ink-500">
            Built for organisations that move people, services and resources
          </p>
          <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
            {items.map((org) => (
              <li
                key={org}
                className="text-sm font-medium text-ink-800 dark:text-ink-600"
              >
                {org}
              </li>
            ))}
          </ul>
        </SectionContainer>
      </section>

      {/* Value strip */}
      <section className="border-b border-border bg-canvas">
        <SectionContainer className="py-12">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {VALUES.map((v) => (
              <div key={v.title} className="flex flex-col gap-2.5">
                <v.icon className="h-5 w-5 text-brand-700 dark:text-brand-400" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold text-ink-950">{v.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-ink-500">{v.text}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionContainer>
      </section>
    </>
  );
}
