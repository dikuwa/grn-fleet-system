/**
 * Services / Platform — detailed capability page.
 *
 * CMS-driven module list rendered as a responsive capability grid (no long
 * alternating layout / excessive whitespace). Uses the flat PageHero and the
 * shared FinalCta for the conversion path.
 */

import type { Metadata } from 'next';
import { CheckCircle2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { FileText, Truck, ClipboardCheck, Fuel, Wrench, BarChart3, ShieldCheck, Smartphone } from 'lucide-react';
import { getPublishedContentBySlug } from '@/lib/platform/cms-public';
import type { PublicCmsContent } from '@/lib/platform/cms-public';
import { getPublicSeoContent, publicPageMetadata } from '@/lib/platform/public-metadata';
import { PageHero } from '@/components/public/page-hero';
import { SectionContainer, SectionHeading } from '@/components/public/section';
import { FinalCta } from '@/components/public/sections/faq-final-cta';

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getPublicSeoContent();
  return publicPageMetadata(seo, 'services');
}

// ---------------------------------------------------------------------------
// Types & defaults
// ---------------------------------------------------------------------------

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
  ShieldCheck,
  Smartphone,
};
const resolveIcon = (name?: string | null): LucideIcon =>
  (name && name in ICON_MAP ? ICON_MAP[name] : FileText);

const DEFAULT_MODULES: ServiceModule[] = [
  {
    title: 'Transport Requests & Approvals',
    description:
      'A guided multi-step workflow for submitting, reviewing and approving transport requests, with configurable approval chains and separation of duty.',
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
      'Vehicle assignment, pre-trip inspection, trip authority and driver acknowledgment with real-time status tracking.',
    icon: 'Truck',
    features: [
      'Vehicle recommender with defect and availability checks',
      'Pre-trip and return inspection checklists',
      'Driver logsheet and daily log recording',
      'Active trip tracking with duration updates',
      'Trip closure with kilometre variance calculation',
    ],
  },
  {
    title: 'Inspections & Defect Management',
    description:
      'Standardised inspection checklists with automatic defect creation for failed items and resolution tracking.',
    icon: 'ClipboardCheck',
    features: [
      'Pre-trip inspection tied to vehicle release',
      'Critical items create blocking defects',
      'Inline defect resolution with notes',
      'Per-vehicle defect history for trends',
    ],
  },
  {
    title: 'Fuel Management & Expenses',
    description:
      'Fuel transaction recording with odometer validation, receipt capture and consumption reporting.',
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
      'Licence, insurance and roadworthy tracking with expiry alerts and maintenance scheduling.',
    icon: 'Wrench',
    features: [
      '30/14/7-day expiry alerts',
      'Maintenance event scheduling and cost recording',
      'Predictive maintenance using odometer patterns',
      'Vehicle lifecycle from acquisition to write-off',
    ],
  },
  {
    title: 'Reports, Analytics & Mobile Access',
    description:
      'Fleet utilisation, fuel, trip and approval-turnaround reporting, plus a mobile driver portal that works offline.',
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
    // fall back to defaults
  }

  const modules = extractModules(cms?.content);
  const intro =
    (cms?.content?.intro as string) ||
    'End-to-end digital fleet management for any organisation — government, municipalities, mines, logistics and private fleets.';

  return (
    <>
      <PageHero
        eyebrow="Platform"
        title="Platform Services"
        description={intro}
      />

      <section id="solutions" className="border-b border-border bg-surface py-20 md:py-24">
        <SectionContainer>
          <SectionHeading
            title="Complete Fleet Operations"
            subtitle="Every capability a fleet operation needs — from request to close."
          />
          <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {modules.map((module) => {
              const Icon = resolveIcon(module.icon);
              return (
                <article
                  key={module.title}
                  className="flex flex-col rounded-[10px] border border-border bg-surface p-6 transition-all hover:border-brand-200 hover:shadow-sm"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h2 className="mt-4 text-base font-semibold text-ink-950">{module.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-ink-500">{module.description}</p>
                  <ul className="mt-4 space-y-2">
                    {module.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-xs text-ink-600">
                        <CheckCircle2
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-success-text"
                          aria-hidden="true"
                        />
                        {f}
                      </li>
                    ))}
                  </ul>
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
