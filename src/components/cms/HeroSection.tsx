/**
 * Public CMS hero section component.
 *
 * Renders a responsive hero banner with a gradient background, title,
 * subtitle, description and primary CTA button. Content can be supplied
 * from CMS (jsonb `heroSection` / page content) or from hardcoded defaults
 * — the component always renders a valid page.
 */

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HeroSectionProps {
  title?: string;
  subtitle?: string;
  description?: string;
  ctaLabel?: string;
  ctaHref?: string;
  /** Render a secondary "Learn More" button that scrolls to #features */
  showSecondaryCta?: boolean;
  /** Additional classes on the outer <section> */
  className?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS: Required<
  Pick<HeroSectionProps, 'title' | 'subtitle' | 'description' | 'ctaLabel' | 'ctaHref'>
> = {
  title: 'Digital Fleet Management for Every Organisation',
  subtitle: 'Government, Municipalities, Mines, Logistics and Private Fleets',
  description:
    'GovFleet Namibia replaces paper-based transport requests, approvals, vehicle allocation, inspections, fuel records, trip logs, maintenance and trip closure with one secure and traceable digital workflow.',
  ctaLabel: 'Access Dashboard',
  ctaHref: '/login',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HeroSection({
  title = DEFAULTS.title,
  subtitle,
  description,
  ctaLabel = DEFAULTS.ctaLabel,
  ctaHref = DEFAULTS.ctaHref,
  showSecondaryCta = true,
  className = '',
}: HeroSectionProps) {
  return (
    <section
      className={`relative overflow-hidden bg-gradient-to-b from-brand-950 to-brand-900 ${className}`}
    >
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-[650] tracking-tight text-white md:text-5xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-4 text-lg font-medium text-white/90">{subtitle}</p>
          )}
          {description && (
            <p className="mt-6 text-lg leading-relaxed text-white/80">{description}</p>
          )}
          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href={ctaHref}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] bg-white px-6 text-sm font-semibold text-[#0f1f3a] hover:bg-brand-50 transition-colors"
            >
              {ctaLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
            {showSecondaryCta && (
              <Link
                href="#features"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] border border-white/20 bg-white/10 px-6 text-sm font-medium text-white hover:bg-white/20 transition-colors"
              >
                Learn More
              </Link>
            )}
          </div>
        </div>
      </div>
      {/* Decorative background shapes */}
      <div className="absolute -right-48 -top-48 h-96 w-96 rounded-full bg-brand-700/20 blur-3xl" />
      <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-teal-500/10 blur-3xl" />
    </section>
  );
}