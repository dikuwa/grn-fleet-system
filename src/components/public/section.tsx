/**
 * Shared public section primitives.
 *
 * SectionContainer standardises the max-width / vertical rhythm used across
 * every public page; SectionHeading provides the eyebrow + title + subtitle
 * pattern so sections stay visually consistent without repeating markup.
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
    <div id={id} className={cn('mx-auto w-full max-w-[1200px] px-6', className)}>
      {children}
    </div>
  );
}

export interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  align?: 'center' | 'left';
  className?: string;
}

export function SectionHeading({
  eyebrow,
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
      {eyebrow && (
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-700 dark:text-brand-400">
          {eyebrow}
        </p>
      )}
      <h2 className="mt-3 text-3xl font-[650] tracking-tight text-ink-950 md:text-4xl">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-4 text-base leading-relaxed text-ink-500">{subtitle}</p>
      )}
    </div>
  );
}
