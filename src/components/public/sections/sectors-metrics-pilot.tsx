/**
 * Sector solutions + honest product facts + pilot programme.
 */

import {
  ArrowRight,
  Briefcase,
  Building2,
  ClipboardList,
  Factory,
  GitBranch,
  History,
  Landmark,
  Layers3,
  ShieldCheck,
  Smartphone,
  Ship,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { SectionContainer, SectionHeading } from '@/components/public/section';
import { REQUEST_DEMO_HREF } from '@/components/public/nav';

const SECTORS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Landmark,
    title: 'Government Ministries',
    text: 'Centralised transport, approvals and accountability across departments.',
  },
  {
    icon: Building2,
    title: 'Regional Councils & Municipalities',
    text: 'Multi-location fleet operations with regional and local workflow rules.',
  },
  {
    icon: Briefcase,
    title: 'Public Enterprises',
    text: 'Operational fleet records, compliance tracking and management reporting.',
  },
  {
    icon: Factory,
    title: 'Mining & Industrial',
    text: 'Vehicle, fuel and inspection control for demanding field operations.',
  },
  {
    icon: Ship,
    title: 'Logistics Providers',
    text: 'Trip planning, driver activity and utilisation across distributed fleets.',
  },
  {
    icon: Building2,
    title: 'Private Organisations',
    text: 'A structured, accountable way to run any business vehicle pool.',
  },
];

const METRICS: { icon: LucideIcon; label: string; detail: string }[] = [
  {
    icon: ClipboardList,
    label: '6 Core Operational Stages',
    detail: 'Request → Review → Allocate → Authorise → Operate → Close',
  },
  {
    icon: GitBranch,
    label: 'Multi-Level Approval Workflow',
    detail: 'Configurable approval chains with separation of duty',
  },
  {
    icon: ShieldCheck,
    label: 'Role-Based Access',
    detail: 'Requesters, approvers, transport, drivers, administrators, auditors',
  },
  {
    icon: Smartphone,
    label: 'Offline Driver Capture',
    detail: 'Mobile log and fuel entries that sync when connection returns',
  },
  {
    icon: Layers3,
    label: 'Multi-Tenant Architecture',
    detail: 'Each organisation operates its own isolated workspace',
  },
  {
    icon: History,
    label: 'End-to-End Audit Trail',
    detail: 'Every decision recorded with actor, timestamp and outcome',
  },
];

export interface SectorsMetricsPilotProps {
  pilotTitle?: string;
  pilotSummary?: string;
}

export function SectorsMetricsPilot({
  pilotTitle = 'Pilot Programme',
  pilotSummary = 'GovFleet is being validated through a real operational environment — the Kavango East Regional Council — to test end-to-end fleet and transport workflows before wider rollout.',
}: SectorsMetricsPilotProps) {
  return (
    <>
      <section
        id="solutions"
        className="border-border bg-surface scroll-mt-20 border-b py-20 md:py-24"
      >
        <SectionContainer>
          <SectionHeading
            title="Built for Government. Ready for Any Fleet."
            subtitle="The same accountable platform adapts to public and private fleet operations."
          />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {SECTORS.map((sector) => (
              <div
                key={sector.title}
                className="border-border bg-surface rounded-[10px] border p-6"
              >
                <sector.icon
                  className="text-brand-700 dark:text-brand-400 h-5 w-5"
                  aria-hidden="true"
                />
                <h3 className="text-ink-950 mt-3 text-sm font-semibold">{sector.title}</h3>
                <p className="text-ink-500 mt-2 text-sm leading-relaxed">{sector.text}</p>
              </div>
            ))}
          </div>
        </SectionContainer>
      </section>

      <section className="border-border bg-canvas border-b py-20 md:py-24">
        <SectionContainer>
          <SectionHeading
            title="What the Platform Provides"
            subtitle="Capabilities you can verify against the live platform — no inflated marketing numbers."
          />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {METRICS.map((metric) => (
              <div
                key={metric.label}
                className="border-border bg-surface rounded-[10px] border p-6"
              >
                <metric.icon
                  className="text-brand-700 dark:text-brand-300 h-5 w-5"
                  aria-hidden="true"
                />
                <h3 className="text-ink-950 mt-3 text-sm font-semibold">{metric.label}</h3>
                <p className="text-ink-500 mt-2 text-sm leading-relaxed">{metric.detail}</p>
              </div>
            ))}
          </div>
        </SectionContainer>
      </section>

      <section id="pilot" className="border-border bg-surface scroll-mt-20 border-b py-20 md:py-24">
        <SectionContainer>
          <div className="border-border bg-canvas mx-auto max-w-3xl rounded-[12px] border p-8 text-center md:p-12">
            <h2 className="text-ink-950 text-2xl font-[650] tracking-tight md:text-3xl">
              {pilotTitle}
            </h2>
            <p className="text-ink-500 mx-auto mt-4 max-w-xl text-base leading-relaxed">
              {pilotSummary}
            </p>
            <Link
              href={REQUEST_DEMO_HREF}
              className="bg-brand-800 hover:bg-brand-700 dark:hover:bg-brand-600 mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-[8px] px-6 text-sm font-medium text-white transition-colors"
            >
              Request a Demo
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </SectionContainer>
      </section>
    </>
  );
}
