/**
 * Hero — the first impression.
 *
 * Left: concise positioning + proof points + standardised CTAs.
 * Right: a real product preview (sanitised dashboard visual).
 * Flat navy surface, no decorative blobs, no gradients.
 */

import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { SectionContainer } from '@/components/public/section';
import { ProductDashboardPreview } from '@/components/public/previews';
import { REQUEST_DEMO_HREF, SIGN_IN_HREF } from '@/components/public/nav';

export interface HeroProps {
  eyebrow?: string;
  title?: string;
  description?: string;
  proofPoints?: string[];
}

const DEFAULT_TITLE = 'Smarter Fleet Operations. Stronger Accountability.';
const DEFAULT_DESCRIPTION =
  'Manage transport requests, approvals, vehicles, drivers, trips, fuel, inspections and fleet records from one accountable digital platform.';
const DEFAULT_PROOF_POINTS = [
  'End-to-end workflow',
  'Role-based approvals',
  'Real-time operational visibility',
  'Traceable digital records',
];

export function Hero({
  eyebrow = 'GovFleet Namibia',
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  proofPoints,
}: HeroProps) {
  const points = proofPoints?.length ? proofPoints : DEFAULT_PROOF_POINTS;

  return (
    <section className="border-b border-border bg-brand-950">
      <SectionContainer className="py-16 md:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Copy */}
          <div>
            {eyebrow && (
              <p className="text-xs font-semibold uppercase tracking-widest text-brand-300">
                {eyebrow}
              </p>
            )}
            <h1 className="mt-4 text-4xl font-[650] leading-[1.08] tracking-tight text-white md:text-5xl">
              {title}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/80">
              {description}
            </p>

            <ul className="mt-8 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {points.map((point) => (
                <li
                  key={point}
                  className="flex items-center gap-2 text-sm font-medium text-white/90"
                >
                  <CheckCircle2
                    className="h-4 w-4 shrink-0 text-teal-400"
                    aria-hidden="true"
                  />
                  {point}
                </li>
              ))}
            </ul>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link
                href={REQUEST_DEMO_HREF}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] bg-white px-6 text-sm font-semibold text-brand-950 transition-colors hover:bg-brand-50"
              >
                Request a Demo
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="#how-it-works"
                className="inline-flex h-12 items-center justify-center rounded-[8px] border border-white/25 bg-white/5 px-6 text-sm font-medium text-white transition-colors hover:bg-white/15"
              >
                See How It Works
              </Link>
              <Link
                href={SIGN_IN_HREF}
                className="text-sm font-medium text-white/70 underline-offset-4 transition-colors hover:text-white hover:underline"
              >
                Sign In
              </Link>
            </div>
          </div>

          {/* Product preview */}
          <div className="relative">
            <ProductDashboardPreview className="shadow-2xl ring-1 ring-white/10" />
          </div>
        </div>
      </SectionContainer>
    </section>
  );
}
