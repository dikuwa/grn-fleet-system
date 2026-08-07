/**
 * Public CMS CTA (Call to Action) section component.
 *
 * A simple centered section with a heading, optional paragraph and a
 * primary CTA button. Reusable for "Request a Demo", "Contact Sales",
 * "Start Free Trial" and similar actions.
 */

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CtaSectionProps {
  heading: string;
  description?: string;
  buttonLabel: string;
  buttonHref: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CtaSection({
  heading,
  description,
  buttonLabel,
  buttonHref,
  secondaryLabel,
  secondaryHref,
  className = '',
}: CtaSectionProps) {
  return (
    <section className={`bg-surface py-24 border-b border-border ${className}`}>
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-[650] tracking-tight text-ink-950">{heading}</h2>
          {description && <p className="mt-4 text-ink-500">{description}</p>}
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              href={buttonHref}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] bg-brand-800 px-6 text-sm font-medium text-white hover:bg-brand-700 dark:hover:bg-[#347ac3] transition-colors"
            >
              {buttonLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
            {secondaryLabel && secondaryHref && (
              <Link
                href={secondaryHref}
                className="inline-flex h-12 items-center justify-center rounded-[8px] border border-border bg-surface px-6 text-sm font-medium text-ink-700 hover:bg-muted transition-colors"
              >
                {secondaryLabel}
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}