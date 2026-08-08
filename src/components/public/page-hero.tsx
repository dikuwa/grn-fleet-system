/**
 * PageHero — restrained hero for public sub-pages.
 *
 * The background includes quiet technical linework so secondary public pages
 * feel intentional without competing with the copy. Eyebrow props remain
 * accepted for backwards compatibility but are not shown.
 */

import { SectionContainer } from '@/components/public/section';
import { TechnicalBackdrop } from '@/components/public/technical-backdrop';

export interface PageHeroProps {
  eyebrow?: string;
  title: string;
  description?: string;
}

export function PageHero({ title, description }: PageHeroProps) {
  return (
    <section className="relative overflow-hidden border-b border-border bg-brand-950">
      <TechnicalBackdrop />
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
