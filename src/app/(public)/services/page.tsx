/**
 * Services / Platform — detailed capability page.
 *
 * Uses product-led capability stories rather than a uniform wall of cards.
 * Copy may remain CMS-driven while the visual system stays controlled by code.
 */

import type { Metadata } from 'next';
import { CheckCircle2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  ClipboardCheck,
  FileText,
  Fuel,
  Smartphone,
  Truck,
  Wrench,
} from 'lucide-react';
import { getPublishedContentBySlug } from '@/lib/platform/cms-public';
import type { PublicCmsContent } from '@/lib/platform/cms-public';
import { getPublicSeoContent, publicPageMetadata } from '@/lib/platform/public-metadata';
import { PageHero } from '@/components/public/page-hero';
import { SectionContainer, SectionHeading } from '@/components/public/section';
import { FinalCta } from '@/components/public/sections/faq-final-cta';
import {
  AnalyticsPreview,
  ApprovalWorkflowPreview,
  FuelManagementPreview,
  InspectionPreview,
  MaintenancePreview,
  VehicleAllocationPreview,
} from '@/components/public/previews';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getPublicSeoContent();
  return publicPageMetadata(seo, 'services');
}

interface ServiceModule {
  title: string;
  description: string;
  icon: string;
  features: string[];
}

const ICON_MAP: Record<string, LucideIcon> = {
  FileText,
  Truck,
  ClipboardCheck,
  Fuel,
  Wrench,
  BarChart3,
  Smartphone,
};

const PREVIEW_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText: ApprovalWorkflowPreview,
  Truck: VehicleAllocationPreview,
  ClipboardCheck: InspectionPreview,
  Fuel: FuelManagementPreview,
  Wrench: MaintenancePreview,
  BarChart3: AnalyticsPreview,
  Smartphone: AnalyticsPreview,
};

const resolveIcon = (name?: string | null): LucideIcon =>
  name && name in ICON_MAP ? ICON_MAP[name] : FileText;

const resolvePreview = (name?: string | null): React.ComponentType<{ className?: string }> =>
  name && name in PREVIEW_MAP ? PREVIEW_MAP[name] : ApprovalWorkflowPreview;

const DEFAULT_MODULES: ServiceModule[] = [
  {
    title: 'Transport Requests & Approvals',
    description:
      'A guided workflow for submitting, reviewing and approving transport requests while preserving separation of duty and a complete decision trail.',
    icon: 'FileText',
    features: [
      'Programme activity selection with route calculation',
      'Passenger manifest and driver requirement entry',
      'Supervisor approval — no self-approval',
      'Transport review and vehicle allocation',
      'Emergency override with post-trip review flagging',
    ],
  },
  {
    title: 'Vehicle Allocation & Trip Management',
    description:
      'Assign the right vehicle and driver, prepare the trip authority and keep each operating stage connected through closure.',
    icon: 'Truck',
    features: [
      'Vehicle recommendation with defect and availability checks',
      'Pre-trip and return inspection records',
      'Driver logsheet and daily activity capture',
      'Active trip status and duration updates',
      'Trip closure with kilometre variance calculation',
    ],
  },
  {
    title: 'Inspections & Defect Management',
    description:
      'Standardise vehicle checks and turn failed items into tracked defects rather than disconnected paper notes.',
    icon: 'ClipboardCheck',
    features: [
      'Inspection status tied to vehicle readiness',
      'Critical items create blocking defects',
      'Defect resolution with notes and ownership',
      'Per-vehicle defect history for trends',
    ],
  },
  {
    title: 'Fuel Management & Expenses',
    description:
      'Record fuel with odometer and receipt evidence, then analyse consumption by vehicle, trip and reporting period.',
    icon: 'Fuel',
    features: [
      'Fuel transactions with odometer validation',
      'Receipt capture per transaction',
      'Consumption reports by vehicle and period',
      'Trip-linked expense tracking',
    ],
  },
  {
    title: 'Fleet Compliance & Maintenance',
    description:
      'Keep licence, insurance, roadworthy and maintenance obligations visible before they become operational blockers.',
    icon: 'Wrench',
    features: [
      '30/14/7-day expiry alerts',
      'Maintenance scheduling and cost recording',
      'Predictive maintenance using odometer patterns',
      'Vehicle lifecycle from acquisition to write-off',
    ],
  },
  {
    title: 'Reports, Analytics & Mobile Access',
    description:
      'Give management a clear operating picture while drivers capture authorised field activity from a mobile-first workspace.',
    icon: 'BarChart3',
    features: [
      'Utilisation, fuel and kilometre variance reports',
      'Approval turnaround analytics',
      'Exportable audit-ready reports',
      'Offline-capable driver self-service',
    ],
  },
];

function extractModules(content: Record<string, unknown> | null | undefined): ServiceModule[] {
  if (!content) return DEFAULT_MODULES;
  const arr = content.modules;
  if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_MODULES;
  return arr.map((m) => {
    const mod = m as Record<string, unknown>;
    return {
      title: String(mod.title ?? ''),
      description: String(mod.description ?? ''),
      icon: String(mod.icon ?? 'FileText'),
      features: Array.isArray(mod.features) ? mod.features.map(String) : [],
    };
  });
}

export default async function ServicesPage() {
  let cms: PublicCmsContent | null = null;
  try {
    cms = await getPublishedContentBySlug('services');
  } catch {
    // Safe defaults below keep the public page available.
  }

  const modules = extractModules(cms?.content);
  const intro =
    (cms?.content?.intro as string) ||
    'Connect requests, approvals, vehicles, drivers, fuel, maintenance and reporting in one accountable operating system.';

  return (
    <>
      <PageHero title="Platform Services" description={intro} />

      <section id="solutions" className="border-b border-border bg-surface py-20 md:py-24">
        <SectionContainer>
          <SectionHeading
            title="See the Work, Not Just a Feature List"
            subtitle="Each capability is part of the same operational record — from the first request to the final audit trail."
          />

          <div className="mt-16 divide-y divide-border border-y border-border">
            {modules.map((module, index) => {
              const Icon = resolveIcon(module.icon);
              const Preview = resolvePreview(module.icon);
              const reverse = index % 2 === 1;

              return (
                <article
                  key={`${module.title}-${index}`}
                  className="grid items-center gap-10 py-12 lg:grid-cols-2 lg:gap-16 lg:py-16"
                >
                  <div className={cn(reverse && 'lg:order-2')}>
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <h2 className="text-xl font-semibold tracking-tight text-ink-950 md:text-2xl">
                        {module.title}
                      </h2>
                    </div>
                    <p className="mt-5 max-w-xl text-sm leading-7 text-ink-500 md:text-base">
                      {module.description}
                    </p>
                    <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                      {module.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm text-ink-600">
                          <CheckCircle2
                            className="mt-0.5 h-4 w-4 shrink-0 text-status-success-text"
                            aria-hidden="true"
                          />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className={cn('min-w-0', reverse && 'lg:order-1')}>
                    <Preview />
                  </div>
                </article>
              );
            })}
          </div>
        </SectionContainer>
      </section>

      <FinalCta />
    </>
  );
}
