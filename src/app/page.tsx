import Link from 'next/link';
import {
  ArrowRight,
  Shield,
  Truck,
  FileText,
  BarChart3,
  Zap,
  Lock,
  Users,
  MapPin,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { APP_NAME } from '@/lib/constants';
import { PublicThemeToggle } from '@/components/layout/public-theme-toggle';
import {
  getPublishedContentBySlug,
  getPublicSiteSettings,
} from '@/lib/platform/cms-public';
import type { PublicCmsContent, PublicSiteSettings } from '@/lib/platform/cms-public';

// ---------------------------------------------------------------------------
// Icon mapping (CMS content stores icon names as strings)
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, LucideIcon> = {
  FileText,
  Shield,
  Truck,
  BarChart3,
  Zap,
  Lock,
  Users,
  MapPin,
};

function resolveIcon(name?: string | null): LucideIcon {
  if (name && name in ICON_MAP) return ICON_MAP[name];
  return FileText;
}

// ---------------------------------------------------------------------------
// Default content (hardcoded fallback when CMS is empty)
// ---------------------------------------------------------------------------

interface Feature {
  title: string;
  description: string;
  icon: string;
}

interface Step {
  title: string;
  description: string;
}

const DEFAULT_FEATURES: Feature[] = [
  {
    title: 'Transport Requests',
    description: 'Complete multi-step request wizard with programme activity, route calculation, passengers and driver requirements.',
    icon: 'FileText',
  },
  {
    title: 'Approval Workflow',
    description: 'Regional and national approval chains with supervisor review, transport allocation, release and final authorisation.',
    icon: 'Shield',
  },
  {
    title: 'Vehicle & Trip Management',
    description: 'Allocation, inspections, driver logsheets, fuel records, defect tracking and trip closure with full audit history.',
    icon: 'Truck',
  },
  {
    title: 'Reports & Analytics',
    description: 'Fleet utilisation, fuel consumption, approval turnaround, kilometre variance and comprehensive audit reports.',
    icon: 'BarChart3',
  },
];

const DEFAULT_STEPS: Step[] = [
  {
    title: 'Submit Transport Request',
    description: 'The requester creates a transport request with programme activity, route, passengers and driver needs. The system recommends a vehicle category.',
  },
  {
    title: 'Supervisor Approves',
    description: 'The immediate supervisor reviews, comments and approves the request. The requester cannot approve their own request.',
  },
  {
    title: 'Transport Administrator Allocates',
    description: 'The Transport Administrator validates the route, allocates an exact vehicle and prepares the Trip Authority.',
  },
  {
    title: 'Release and Authorise',
    description: 'Administrative release and departure inspection are completed, followed by final authorisation by the designated officer.',
  },
  {
    title: 'Driver Operations',
    description: 'The driver acknowledges, receives the vehicle, records daily logs and fuel entries — including offline drafts on a mobile phone.',
  },
  {
    title: 'Return and Close',
    description: 'Return inspection, fuel verification, variance calculation and Transport Administrator closure. Vehicle returns to availability.',
  },
];

// ---------------------------------------------------------------------------
// Extract structured content from CMS jsonb
// ---------------------------------------------------------------------------

function extractFeatures(content: Record<string, unknown> | null | undefined): Feature[] {
  if (!content) return DEFAULT_FEATURES;
  const arr = content.features;
  if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_FEATURES;
  return arr.map((f: Record<string, unknown>) => ({
    title: String(f.title ?? ''),
    description: String(f.description ?? ''),
    icon: String(f.icon ?? 'FileText'),
  }));
}

function extractSteps(content: Record<string, unknown> | null | undefined): Step[] {
  if (!content) return DEFAULT_STEPS;
  const arr = content.steps;
  if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_STEPS;
  return arr.map((s: Record<string, unknown>) => ({
    title: String(s.title ?? ''),
    description: String(s.description ?? ''),
  }));
}

interface HeroContent {
  title: string;
  subtitle: string;
  description: string;
  ctaLabel: string;
}

const DEFAULT_HERO: HeroContent = {
  title: 'Digital Fleet Management for Every Organisation',
  subtitle: 'Government, Municipalities, Mines, Logistics and Private Fleets',
  description:
    'GovFleet Namibia replaces paper-based transport requests, approvals, vehicle allocation, inspections, fuel records, trip logs, maintenance and trip closure with one secure and traceable digital workflow.',
  ctaLabel: 'Access Dashboard',
};

function extractHero(
  content: Record<string, unknown> | null | undefined,
  siteSettings: PublicSiteSettings | null,
): HeroContent {
  const heroSection = (siteSettings?.heroSection as Record<string, unknown>) || {};
  const fromSettings: Partial<HeroContent> = {};
  if (heroSection.title) fromSettings.title = String(heroSection.title);
  if (heroSection.subtitle) fromSettings.subtitle = String(heroSection.subtitle);
  if (heroSection.description) fromSettings.description = String(heroSection.description);
  if (heroSection.ctaLabel) fromSettings.ctaLabel = String(heroSection.ctaLabel);

  const fromCms: Partial<HeroContent> = {};
  if (content) {
    if (content.heroTitle) fromCms.title = String(content.heroTitle);
    if (content.heroSubtitle) fromCms.subtitle = String(content.heroSubtitle);
    if (content.heroDescription) fromCms.description = String(content.heroDescription);
    if (content.heroCtaLabel) fromCms.ctaLabel = String(content.heroCtaLabel);
  }

  return { ...DEFAULT_HERO, ...fromSettings, ...fromCms };
}

// ---------------------------------------------------------------------------
// Page component (Server Component)
// ---------------------------------------------------------------------------

export default async function HomePage() {
  let siteSettings: PublicSiteSettings | null = null;
  let homepageContent: PublicCmsContent | null = null;

  try {
    [siteSettings, homepageContent] = await Promise.all([
      getPublicSiteSettings(),
      getPublishedContentBySlug('homepage'),
    ]);
  } catch {
    // CMS is empty or unreachable — render with defaults below.
  }

  const hero = extractHero(homepageContent?.content, siteSettings);
  const features = extractFeatures(homepageContent?.content);
  const steps = extractSteps(homepageContent?.content);

  const siteName = siteSettings?.siteName || APP_NAME;
  const tagline = siteSettings?.siteTagline;

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
          <div className="flex items-center gap-2">
            {siteSettings?.logoUrl ? (
              <img
                src={siteSettings.logoUrl}
                alt={siteName}
                className="h-8 w-8 rounded-lg object-contain"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-800 text-white text-sm font-bold">
                G
              </div>
            )}
            <span className="text-sm font-semibold text-ink-950">{siteName}</span>
          </div>
          <nav className="hidden items-center gap-6 md:flex">
            <Link href="/about" className="text-sm text-ink-500 hover:text-ink-950 transition-colors">About</Link>
            <Link href="/services" className="text-sm text-ink-500 hover:text-ink-950 transition-colors">Services</Link>
            <Link href="#features" className="text-sm text-ink-500 hover:text-ink-950 transition-colors">Features</Link>
            <Link href="#how-it-works" className="text-sm text-ink-500 hover:text-ink-950 transition-colors">How It Works</Link>
            <Link href="#pilot" className="text-sm text-ink-500 hover:text-ink-950 transition-colors">Pilot</Link>
            <PublicThemeToggle />
            <Link
              href="/login"
              className="inline-flex h-10 items-center justify-center rounded-[8px] bg-brand-800 px-5 text-sm font-medium text-white hover:bg-brand-700 dark:hover:bg-[#347ac3] transition-colors"
            >
              Login
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-950 to-brand-900">
        <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-[650] tracking-tight text-white md:text-5xl">
              {hero.title.split(/(\bfor\b|\bby\b)/).map((part, i) =>
                part === 'for' || part === 'by' ? (
                  <span key={i} className="text-brand-100 dark:text-brand-600"> {part} </span>
                ) : (
                  <span key={i}>{part}</span>
                ),
              )}
            </h1>
            <p className="mt-4 text-lg font-medium text-white/90">
              {hero.subtitle || tagline}
            </p>
            <p className="mt-6 text-lg leading-relaxed text-white/80">
              {hero.description}
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/login"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] bg-white px-6 text-sm font-semibold text-[#0f1f3a] hover:bg-brand-50 transition-colors"
              >
                {hero.ctaLabel || 'Access Dashboard'}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="#features"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] border border-white/20 bg-white/10 px-6 text-sm font-medium text-white hover:bg-white/20 transition-colors"
              >
                Learn More
              </Link>
            </div>
          </div>
        </div>
        <div className="absolute -right-48 -top-48 h-96 w-96 rounded-full bg-brand-700/20 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-teal-500/10 blur-3xl" />
      </section>

      {/* Features */}
      <section id="features" className="border-b border-border bg-surface py-24">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-[650] tracking-tight text-ink-950">
              Complete Fleet Operations Platform
            </h2>
            <p className="mt-4 text-ink-500">
              From transport requests to trip closure — every stage is tracked, accountable, and paperless.
            </p>
          </div>
          <div className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => {
              const Icon = resolveIcon(feature.icon);
              return (
                <div
                  key={feature.title}
                  className="group rounded-[10px] border border-border bg-surface p-6 transition-all hover:border-brand-100 hover:shadow-sm"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-ink-950">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-500">{feature.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="bg-canvas py-24">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-[650] tracking-tight text-ink-950">
              How It Works
            </h2>
            <p className="mt-4 text-ink-500">
              A guided workflow that normally completes approvals within approximately 30 minutes.
            </p>
          </div>
          <div className="mt-16 space-y-12">
            {steps.map((step, i) => (
              <div key={i} className="relative flex gap-6">
                <div className="flex flex-col items-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-800 text-sm font-semibold text-white">
                    {i + 1}
                  </div>
                  {i < steps.length - 1 && (
                    <div className="mt-2 w-px flex-1 bg-border" />
                  )}
                </div>
                <div className="pb-12">
                  <h3 className="text-base font-semibold text-ink-950">{step.title}</h3>
                  <p className="mt-1 text-sm text-ink-500">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pilot Section */}
      <section id="pilot" className="border-b border-border bg-surface py-24">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-[650] tracking-tight text-ink-950">
              Proven in Government, Built for Any Fleet
            </h2>
            <p className="mt-4 text-ink-500">
              The platform launched with the Kavango East Regional Council as the pilot tenant and is
              designed for any organisation that manages vehicles or transport workflows — public
              institutions, regional councils, municipalities, public enterprises, mines, logistics
              providers, NGOs and private companies.
            </p>
            <Link
              href="/contact"
              className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-[8px] bg-brand-800 px-6 text-sm font-medium text-white hover:bg-brand-700 dark:hover:bg-[#347ac3] transition-colors"
            >
              Request a Demonstration
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-brand-950 py-12">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <p className="text-sm text-white/60">
              &copy; {new Date().getFullYear()} {siteName}. All rights reserved.
            </p>
            <div className="flex gap-6">
              <Link href="/about" className="text-sm text-white/60 hover:text-white transition-colors">About</Link>
              <Link href="/services" className="text-sm text-white/60 hover:text-white transition-colors">Services</Link>
              <Link href="/privacy" className="text-sm text-white/60 hover:text-white transition-colors">Privacy</Link>
              <Link href="/contact" className="text-sm text-white/60 hover:text-white transition-colors">Contact</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}