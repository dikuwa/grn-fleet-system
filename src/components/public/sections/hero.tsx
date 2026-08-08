/**
 * Hero — the first impression.
 *
 * Two primary actions only: Request Demo and See How It Works. The product
 * preview sits inside a restrained device frame so the UI reads as a real
 * application without the frame becoming a visual distraction.
 */

import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { SectionContainer } from '@/components/public/section';
import { ProductDashboardPreview } from '@/components/public/previews';
import { REQUEST_DEMO_HREF } from '@/components/public/nav';

export interface HeroProps {
  /** Retained for CMS compatibility; intentionally not rendered. */
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

export function Hero({ title = DEFAULT_TITLE, description = DEFAULT_DESCRIPTION, proofPoints }: HeroProps) {
  const points = proofPoints?.length ? proofPoints : DEFAULT_PROOF_POINTS;

  return (
    <section className="border-b border-border bg-brand-950">
      <SectionContainer className="py-14 sm:py-16 md:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:gap-14 xl:gap-20">
          <div>
            <h1 className="text-4xl font-[650] leading-[1.08] tracking-tight text-white md:text-5xl">
              {title}
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-white/80 sm:text-lg">
              {description}
            </p>

            <ul className="mt-7 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {points.map((point) => (
                <li key={point} className="flex items-center gap-2 text-sm font-medium text-white/90">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-400" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
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
            </div>
          </div>

          <div className="mx-auto w-full max-w-[720px] lg:mx-0">
            <div className="rounded-[28px] border border-white/10 bg-black/20 p-2 shadow-2xl shadow-black/25">
              <div className="mb-2 flex h-5 items-center gap-1.5 px-3" aria-hidden="true">
                <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
                <span className="h-1.5 w-1.5 rounded-full bg-white/15" />
                <span className="h-1.5 w-1.5 rounded-full bg-white/10" />
              </div>
              <div className="overflow-hidden rounded-[20px] border border-white/5 bg-surface/95 opacity-[0.96]">
                <ProductDashboardPreview className="border-0 shadow-none ring-0" />
              </div>
            </div>
          </div>
        </div>
      </SectionContainer>
    </section>
  );
}
