/**
 * Shared public section primitives.
 *
 * Public sections intentionally avoid eyebrow labels. Titles and supporting
 * copy provide the hierarchy, keeping the visual language cleaner and more
 * consistent across the marketing site.
 */

import { cn } from '@/lib/utils';

export function SectionContainer({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div id={id} className={cn('mx-auto w-full max-w-[1200px] px-4 sm:px-6', className)}>
      {children}
    </div>
  );
}

export interface SectionHeadingProps {
  /** Retained for CMS/backwards compatibility; intentionally not rendered. */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  align?: 'center' | 'left';
  className?: string;
}

export function SectionHeading({
  title,
  subtitle,
  align = 'center',
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        'max-w-2xl',
        align === 'center' && 'mx-auto text-center',
        className,
      )}
    >
      <h2 className="text-3xl font-[650] tracking-tight text-ink-950 md:text-4xl">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-4 text-base leading-relaxed text-ink-500">{subtitle}</p>
      )}
    </div>
  );
}
