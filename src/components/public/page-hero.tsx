/**
 * PageHero — restrained hero for public sub-pages.
 *
 * The background includes quiet technical linework so secondary public pages
 * feel intentional without competing with the copy. Public sub-page heroes
 * begin directly with their title and do not support eyebrow labels.
 */

import { SectionContainer } from '@/components/public/section';
import { TechnicalBackdrop } from '@/components/public/technical-backdrop';

export interface PageHeroProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export function PageHero({ title, description, children }: PageHeroProps) {
  return (
    <section className="border-border bg-brand-950 relative overflow-hidden border-b">
      <TechnicalBackdrop />
      <SectionContainer className="relative py-16 md:py-20">
        <div className="max-w-3xl">
          <h1 className="text-3xl leading-[1.1] font-[650] tracking-tight text-white md:text-5xl">
            {title}
          </h1>
          {description && (
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/80 md:text-lg">
              {description}
            </p>
          )}
          {children && <div className="mt-7">{children}</div>}
        </div>
      </SectionContainer>
    </section>
  );
}
