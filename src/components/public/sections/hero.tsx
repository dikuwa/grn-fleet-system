/**
 * Hero — the first impression.
 *
 * Content intentionally remains unchanged. The product preview is rendered in
 * a quiet, responsive perspective device shell so it feels like a real
 * application without letting the hardware frame dominate the message.
 */

import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { SectionContainer } from '@/components/public/section';
import { TechnicalBackdrop } from '@/components/public/technical-backdrop';
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
    <section className="relative overflow-hidden border-b border-border bg-brand-950">
      <TechnicalBackdrop className="opacity-[0.038]" />
      <SectionContainer className="relative py-14 sm:py-16 md:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:gap-12 xl:gap-16">
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
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] bg-white px-6 text-sm font-semibold text-brand-950 transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-brand-50 motion-reduce:transform-none motion-reduce:transition-none"
              >
                Request a Demo
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="#how-it-works"
                className="inline-flex h-12 items-center justify-center rounded-[8px] border border-white/25 bg-white/5 px-6 text-sm font-medium text-white transition-[background-color,border-color] duration-200 hover:border-white/35 hover:bg-white/10 motion-reduce:transition-none"
              >
                See How It Works
              </Link>
            </div>
          </div>

          <div className="mx-auto w-full max-w-[760px] px-1 sm:px-4 lg:mx-0 lg:px-0">
            <div className="relative isolate py-3 sm:py-6 lg:py-2">
              <div
                className="relative mx-auto w-full transform-gpu transition-transform duration-500 ease-out motion-reduce:transition-none sm:w-[96%] md:[transform:perspective(1500px)_rotateY(-8deg)_rotateX(1.5deg)_rotateZ(-1deg)] lg:w-full lg:[transform:perspective(1600px)_rotateY(-10deg)_rotateX(2deg)_rotateZ(-1.25deg)]"
              >
                <div className="relative rounded-[26px] border border-white/[0.16] bg-[#171a20] p-[7px] shadow-[0_28px_70px_rgba(0,0,0,0.34)] sm:rounded-[32px] sm:p-[9px]">
                  <div className="pointer-events-none absolute inset-y-[12%] -right-[6px] hidden w-[5px] rounded-r-full border border-l-0 border-white/10 bg-[#242831] opacity-75 md:block" />
                  <div className="pointer-events-none absolute right-[30%] top-[5px] hidden h-[3px] w-[34%] rounded-full bg-white/[0.08] sm:block" />
                  <div className="overflow-hidden rounded-[20px] border border-white/[0.08] bg-surface/95 sm:rounded-[24px]">
                    <ProductDashboardPreview className="border-0 shadow-none ring-0" />
                  </div>
                </div>
              </div>

              <div
                aria-hidden="true"
                className="mx-auto mt-3 h-px w-[72%] bg-white/[0.08] opacity-70 md:w-[58%]"
              />
            </div>
          </div>
        </div>
      </SectionContainer>
    </section>
  );
}
