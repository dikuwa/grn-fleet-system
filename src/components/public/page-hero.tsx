/**
 * PageHero — flat, restrained hero for public sub-pages (About, Services,
 * Contact, FAQ, Request Demo).
 *
 * Same navy surface as the homepage hero but without the product preview —
 * keeps sub-pages consistent with the design system and the spec's
 * "no gradients / no decorative blobs" rule.
 */

import { SectionContainer } from '@/components/public/section';

export interface PageHeroProps {
  eyebrow?: string;
  title: string;
  description?: string;
}

export function PageHero({ eyebrow, title, description }: PageHeroProps) {
  return (
    <section className="border-b border-border bg-brand-950">
      <SectionContainer className="py-16 md:py-20">
        <div className="max-w-3xl">
          {eyebrow && (
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-300">
              {eyebrow}
            </p>
          )}
          <h1 className="mt-4 text-3xl font-[650] leading-[1.1] tracking-tight text-white md:text-5xl">
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
