/**
 * About — concise but visually connected to the homepage.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Eye, Gauge, Globe, ScrollText, Shield, Workflow } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getPublishedContentBySlug, getPublicSiteSettings } from '@/lib/platform/cms-public';
import type { PublicCmsContent, PublicSiteSettings } from '@/lib/platform/cms-public';
import { getPublicSeoContent, publicPageMetadata } from '@/lib/platform/public-metadata';
import { PageHero } from '@/components/public/page-hero';
import { SectionContainer, SectionHeading } from '@/components/public/section';

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getPublicSeoContent();
  return publicPageMetadata(seo, 'about');
}

interface Value {
  title: string;
  description: string;
  icon: string;
}

const ICON_MAP: Record<string, LucideIcon> = { Shield, Gauge, Eye, ScrollText, Workflow };
const resolveIcon = (name?: string | null): LucideIcon =>
  (name && name in ICON_MAP ? ICON_MAP[name] : Shield);

const DEFAULT_VALUES: Value[] = [
  {
    title: 'Accountability',
    description: 'Every action is logged and attributed — a full audit trail from request to trip closure.',
    icon: 'Shield',
  },
  {
    title: 'Efficiency',
    description: 'Digital workflows replace paper-based processes, reducing administrative overhead.',
    icon: 'Gauge',
  },
  {
    title: 'Transparency',
    description: 'Real-time visibility into fleet operations, approvals and resource utilisation.',
    icon: 'Eye',
  },
  {
    title: 'Traceability',
    description: 'Official documents and records are generated, versioned and kept for review.',
    icon: 'ScrollText',
  },
  {
    title: 'Operational Visibility',
    description: 'Live status of requests, trips, vehicles and fuel across the organisation.',
    icon: 'Workflow',
  },
];

const DEFAULT_MISSION =
  'GovFleet Namibia replaces paper-based transport requests, approvals, vehicle allocations, inspections, fuel records, maintenance and trip closure with one traceable digital platform. We aim to improve accountability, reduce administrative overhead and provide real-time visibility into fleet operations — for government institutions, regional councils, municipalities, public enterprises, mines, logistics providers, NGOs and private companies alike.';

const DEFAULT_PILOT =
  'The Kavango East Regional Council is serving as the pilot tenant for this platform. The pilot validates the digital workflow across all stages of fleet operations, and the platform is built for any organisation that manages vehicles or transport workflows.';

const PRODUCT_FACTS = [
  { value: '6', label: 'Core Operational Stages' },
  { value: 'Multi-level', label: 'Approval Workflows' },
  { value: 'Role-based', label: 'Access & Separation of Duty' },
  { value: 'End-to-end', label: 'Digital Audit Trail' },
];

function extractValues(content: Record<string, unknown> | null | undefined): Value[] {
  if (!content) return DEFAULT_VALUES;
  const arr = content.values;
  if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_VALUES;
  return arr.map((v) => {
    const item = v as Record<string, unknown>;
    return {
      title: String(item.title ?? ''),
      description: String(item.description ?? ''),
      icon: String(item.icon ?? 'Shield'),
    };
  });
}

export default async function AboutPage() {
  let cms: PublicCmsContent | null = null;
  let siteSettings: PublicSiteSettings | null = null;
  try {
    [cms, siteSettings] = await Promise.all([
      getPublishedContentBySlug('about'),
      getPublicSiteSettings(),
    ]);
  } catch {
    // fall back to defaults
  }

  const siteName = siteSettings?.siteName || 'GovFleet Namibia';
  const mission = (cms?.content?.mission as string) || DEFAULT_MISSION;
  const pilot = (cms?.content?.pilot as string) || DEFAULT_PILOT;
  const values = extractValues(cms?.content);

  return (
    <>
      <PageHero
        title={`About ${siteName}`}
        description="Modernising fleet operations — public and private — through digital workflow automation."
      />

      <section className="border-b border-border bg-surface py-20 md:py-24">
        <SectionContainer>
          <div className="mx-auto max-w-[800px] text-center">
            <SectionHeading title="Why GovFleet Exists" />
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-ink-500">{mission}</p>
          </div>
        </SectionContainer>
      </section>

      <section className="border-b border-border bg-canvas py-20 md:py-24">
        <SectionContainer>
          <SectionHeading
            title="Our Values"
            subtitle="The principles behind every workflow we build."
          />
          <div className="mx-auto mt-14 flex max-w-5xl flex-wrap justify-center gap-5">
            {values.map((v) => {
              const Icon = resolveIcon(v.icon);
              return (
                <div
                  key={v.title}
                  className="w-full rounded-[10px] border border-border bg-surface p-6 sm:basis-[48%] lg:basis-[31%]"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 text-sm font-semibold text-ink-950">{v.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-ink-500">{v.description}</p>
                </div>
              );
            })}
          </div>
        </SectionContainer>
      </section>

      <section className="border-b border-border bg-surface py-20 md:py-24">
        <SectionContainer>
          <SectionHeading
            title="What the Platform Provides"
            subtitle="Capabilities you can verify against the live platform."
          />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PRODUCT_FACTS.map((fact) => (
              <div key={fact.label} className="rounded-[10px] border border-border bg-surface p-6 text-center">
                <p className="text-2xl font-[650] tracking-tight text-brand-800 dark:text-brand-300">{fact.value}</p>
                <p className="mt-1.5 text-xs font-medium uppercase tracking-wider text-ink-500">{fact.label}</p>
              </div>
            ))}
          </div>
        </SectionContainer>
      </section>

      <section id="pilot" className="scroll-mt-20 border-b border-border bg-canvas py-20 md:py-24">
        <SectionContainer>
          <div className="mx-auto max-w-3xl rounded-[12px] border border-border bg-surface p-8 md:p-12">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                <Globe className="h-5 w-5" aria-hidden="true" />
              </span>
              <h2 className="text-xl font-[650] tracking-tight text-ink-950">Pilot Programme</h2>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-ink-500">{pilot}</p>
            <Link
              href="/request-demo"
              className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-[8px] bg-brand-800 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 dark:hover:bg-brand-600"
            >
              Request a Demonstration
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </SectionContainer>
      </section>
    </>
  );
}
