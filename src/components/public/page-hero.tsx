/**
 * PageHero — restrained hero for public sub-pages.
 *
 * The background includes a very low-contrast technical line pattern so
 * secondary public pages feel intentional without competing with the copy.
 * Eyebrow props remain accepted for backwards compatibility but are not shown.
 */

import { SectionContainer } from '@/components/public/section';

export interface PageHeroProps {
  eyebrow?: string;
  title: string;
  description?: string;
}

export function PageHero({ title, description }: PageHeroProps) {
  return (
    <section className="relative overflow-hidden border-b border-border bg-brand-950">
      <TechPattern />
      <SectionContainer className="relative py-16 md:py-20">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-[650] leading-[1.1] tracking-tight text-white md:text-5xl">
            {title}
          </h1>
          {description && (
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/80 md:text-lg">
              {description}
            </p>
          )}
        </div>
      </SectionContainer>
    </section>
  );
}

function TechPattern() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1200 260"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full text-white opacity-[0.055]"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1">
        <path d="M40 62h180l36 36h190l44-44h230l38 38h216" />
        <path d="M120 194h160l48-48h184l56 56h250l42-42h250" />
        <path d="M760 28v46l34 34v74l36 36" />
        <path d="M356 18v50l-32 32v70l-42 42" />
      </g>
      <g fill="currentColor">
        <circle cx="220" cy="62" r="3" />
        <circle cx="446" cy="98" r="3" />
        <circle cx="720" cy="54" r="3" />
        <circle cx="328" cy="146" r="3" />
        <circle cx="568" cy="202" r="3" />
        <circle cx="860" cy="160" r="3" />
      </g>
    </svg>
  );
}
