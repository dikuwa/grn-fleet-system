import Link from 'next/link';
import { ArrowLeft, Globe } from 'lucide-react';
import { APP_NAME } from '@/lib/constants';
import { PublicThemeToggle } from '@/components/layout/public-theme-toggle';
import { HeroSection } from '@/components/cms/HeroSection';
import { FeaturesGrid } from '@/components/cms/FeaturesGrid';
import { FooterSection } from '@/components/cms/FooterSection';
import { getPublishedContentBySlug, getPublicSiteSettings } from '@/lib/platform/cms-public';
import type { PublicCmsContent, PublicSiteSettings } from '@/lib/platform/cms-public';
import { Shield, Truck, BarChart3 } from 'lucide-react';

interface Value {
  title: string;
  description: string;
  icon: string;
}

const DEFAULT_VALUES: Value[] = [
  {
    title: 'Accountability',
    description: 'Every action is logged and attributed. Full audit trail from request to trip closure.',
    icon: 'Shield',
  },
  {
    title: 'Efficiency',
    description: 'Digital workflows replace paper-based processes, reducing turnaround times significantly.',
    icon: 'Truck',
  },
  {
    title: 'Transparency',
    description: 'Real-time visibility into fleet operations, approvals, and resource utilisation across all levels.',
    icon: 'BarChart3',
  },
];

const ICON_MAP: Record<string, typeof Shield> = { Shield, Truck, BarChart3 };
const resolveIcon = (name?: string | null) => (name && name in ICON_MAP ? ICON_MAP[name] : Shield);

const DEFAULT_MISSION =
  'GovFleet Namibia replaces paper-based transport requests, approvals, vehicle allocations, inspections, fuel records, maintenance and trip closure with one traceable digital platform. We aim to improve accountability, reduce administrative overhead, and provide real-time visibility into fleet operations — for government institutions, regional councils, municipalities, public enterprises, mines, logistics providers, NGOs and private companies alike.';

const DEFAULT_PILOT =
  'The Kavango East Regional Council is serving as the pilot tenant for this platform. The pilot validates the digital workflow across all stages of fleet operations, and the platform is built for any organisation that manages vehicles or transport workflows.';

function extractValues(content: Record<string, unknown> | null | undefined): Value[] {
  if (!content) return DEFAULT_VALUES;
  const arr = content.values;
  if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_VALUES;
  return arr.map((v) => ({
    title: String((v as Record<string, unknown>).title ?? ''),
    description: String((v as Record<string, unknown>).description ?? ''),
    icon: String((v as Record<string, unknown>).icon ?? 'Shield'),
  }));
}

export default async function AboutPage() {
  let cms: PublicCmsContent | null = null;
  let siteSettings: PublicSiteSettings | null = null;
  try {
    [cms, siteSettings] = await Promise.all([getPublishedContentBySlug('about'), getPublicSiteSettings()]);
  } catch {
    // fall back to defaults
  }

  const siteName = siteSettings?.siteName || APP_NAME;
  const mission = (cms?.content?.mission as string) || DEFAULT_MISSION;
  const pilot = (cms?.content?.pilot as string) || DEFAULT_PILOT;
  const values = extractValues(cms?.content);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-border bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-800 text-white text-sm font-bold">G</div>
            <span className="text-sm font-semibold text-ink-950">{siteName}</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/services" className="text-sm text-ink-500 hover:text-ink-950 transition-colors">Services</Link>
            <Link href="/contact" className="text-sm text-ink-500 hover:text-ink-950 transition-colors">Contact</Link>
            <Link href="/" className="flex items-center gap-1 text-sm text-ink-500 hover:text-ink-950 transition-colors">
              <ArrowLeft className="h-4 w-4" /> Back to Home
            </Link>
            <PublicThemeToggle />
          </div>
        </div>
      </header>

      <HeroSection
        title={cms?.title || `About ${siteName}`}
        subtitle="Modernising fleet operations — public and private — through digital workflow automation."
        showSecondaryCta={false}
      />

      {/* Mission */}
      <section className="bg-surface py-20">
        <div className="mx-auto max-w-[800px] px-6">
          <div className="text-center">
            <h2 className="text-2xl font-[650] tracking-tight text-ink-950">Our Mission</h2>
            <p className="mt-4 text-ink-500 leading-relaxed">{mission}</p>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="bg-canvas py-20">
        <div className="mx-auto max-w-[1000px] px-6">
          <h2 className="text-center text-2xl font-[650] tracking-tight text-ink-950">Our Values</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {values.map((v) => {
              const Icon = resolveIcon(v.icon);
              return (
                <div key={v.title} className="rounded-[10px] border border-border bg-surface p-6 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-ink-950">{v.title}</h3>
                  <p className="mt-2 text-sm text-ink-500">{v.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pilot */}
      <section className="bg-surface py-20">
        <div className="mx-auto max-w-[800px] px-6">
          <div className="rounded-[10px] border border-border bg-surface p-8">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                <Globe className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-[650] text-ink-950">Pilot Programme</h2>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-ink-500">{pilot}</p>
            <div className="mt-6">
              <Link
                href="/contact"
                className="inline-flex h-10 items-center justify-center rounded-[8px] bg-brand-800 px-5 text-sm font-medium text-white hover:bg-brand-700 dark:hover:bg-[#347ac3] transition-colors"
              >
                Request a Demonstration
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="bg-brand-950 py-16">
        <div className="mx-auto max-w-[1000px] px-6">
          <div className="grid gap-8 sm:grid-cols-4">
            {[
              ['6', 'Workflow Stages'],
              ['4', 'Approval Steps'],
              ['10+', 'Sectors Served'],
              ['24/7', 'Platform Availability'],
            ].map(([num, label]) => (
              <div key={label} className="text-center">
                <p className="text-3xl font-[650] text-white">{num}</p>
                <p className="mt-1 text-sm text-white/60">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <FooterSection siteName={siteName} />
    </div>
  );
}