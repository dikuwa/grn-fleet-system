/**
 * Trust strip + value proposition strip.
 *
 * Organisation types use Lucide icons rather than fake customer logos. This
 * gives the strip enough visual presence while keeping the claims honest and
 * theme-aware.
 */

import {
  Building2,
  Factory,
  FileCheck2,
  Landmark,
  ScrollText,
  ShieldCheck,
  Ship,
  Store,
  Truck,
  Users,
  Eye,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SectionContainer } from '@/components/public/section';

const ORGANISATIONS: { label: string; icon: LucideIcon }[] = [
  { label: 'Government Ministries', icon: Landmark },
  { label: 'Regional Councils', icon: Building2 },
  { label: 'Municipalities', icon: Store },
  { label: 'Public Enterprises', icon: Building2 },
  { label: 'Mining & Industry', icon: Factory },
  { label: 'Logistics Providers', icon: Truck },
  { label: 'Private Organisations', icon: Ship },
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
  const items = orgs?.length
    ? orgs.map((label) => ({ label, icon: Building2 as LucideIcon }))
    : ORGANISATIONS;

  return (
    <>
      <section className="border-b border-border bg-surface">
        <SectionContainer className="py-10 md:py-12">
          <p className="text-center text-sm font-medium text-ink-500">
            Built for organisations that move people, services and resources
          </p>
          <ul className="mt-7 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-7">
            {items.map((org) => {
              const Icon = org.icon;
              return (
                <li key={org.label} className="flex min-w-0 flex-col items-center text-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[9px] border border-border bg-canvas text-brand-700 dark:text-brand-300">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="mt-2 text-xs font-medium leading-snug text-ink-700 sm:text-sm">
                    {org.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </SectionContainer>
      </section>

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
