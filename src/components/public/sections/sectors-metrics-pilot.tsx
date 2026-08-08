/**
 * Sector solutions + honest product facts + pilot programme.
 */

import { Building2, Landmark, Factory, Ship, Briefcase, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { SectionContainer, SectionHeading } from '@/components/public/section';
import { REQUEST_DEMO_HREF } from '@/components/public/nav';

const SECTORS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Landmark, title: 'Government Ministries', text: 'Centralised transport, approvals and accountability across departments.' },
  { icon: Building2, title: 'Regional Councils & Municipalities', text: 'Multi-location fleet operations with regional and local workflow rules.' },
  { icon: Briefcase, title: 'Public Enterprises', text: 'Operational fleet records, compliance tracking and management reporting.' },
  { icon: Factory, title: 'Mining & Industrial', text: 'Vehicle, fuel and inspection control for demanding field operations.' },
  { icon: Ship, title: 'Logistics Providers', text: 'Trip planning, driver activity and utilisation across distributed fleets.' },
  { icon: Building2, title: 'Private Organisations', text: 'A structured, accountable way to run any business vehicle pool.' },
];

const METRICS = [
  { label: '6 Core Operational Stages', detail: 'Request → Review → Allocate → Authorise → Operate → Close' },
  { label: 'Multi-Level Approval Workflow', detail: 'Configurable approval chains with separation of duty' },
  { label: 'Role-Based Access', detail: 'Requesters, approvers, transport, drivers, administrators, auditors' },
  { label: 'Offline Driver Capture', detail: 'Mobile log and fuel entries that sync when connection returns' },
  { label: 'Multi-Tenant Architecture', detail: 'Each organisation operates its own isolated workspace' },
  { label: 'End-to-End Audit Trail', detail: 'Every decision recorded with actor, timestamp and outcome' },
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
      <section id="solutions" className="scroll-mt-20 border-b border-border bg-surface py-20 md:py-24">
        <SectionContainer>
          <SectionHeading
            title="Built for Government. Ready for Any Fleet."
            subtitle="The same accountable platform adapts to public and private fleet operations."
          />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {SECTORS.map((sector) => (
              <div key={sector.title} className="rounded-[10px] border border-border bg-surface p-6">
                <sector.icon className="h-5 w-5 text-brand-700 dark:text-brand-400" aria-hidden="true" />
                <h3 className="mt-3 text-sm font-semibold text-ink-950">{sector.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">{sector.text}</p>
              </div>
            ))}
          </div>
        </SectionContainer>
      </section>

      <section className="border-b border-border bg-canvas py-20 md:py-24">
        <SectionContainer>
          <SectionHeading
            title="What the Platform Provides"
            subtitle="Capabilities you can verify against the live platform — no inflated marketing numbers."
          />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {METRICS.map((metric) => (
              <div key={metric.label} className="rounded-[10px] border border-border bg-surface p-6">
                <h3 className="text-sm font-semibold text-ink-950">{metric.label}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">{metric.detail}</p>
              </div>
            ))}
          </div>
        </SectionContainer>
      </section>

      <section id="pilot" className="scroll-mt-20 border-b border-border bg-surface py-20 md:py-24">
        <SectionContainer>
          <div className="mx-auto max-w-3xl rounded-[12px] border border-border bg-canvas p-8 text-center md:p-12">
            <h2 className="text-2xl font-[650] tracking-tight text-ink-950 md:text-3xl">{pilotTitle}</h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-ink-500">{pilotSummary}</p>
            <Link
              href={REQUEST_DEMO_HREF}
              className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-[8px] bg-brand-800 px-6 text-sm font-medium text-white transition-colors hover:bg-brand-700 dark:hover:bg-brand-600"
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
