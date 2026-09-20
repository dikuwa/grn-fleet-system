/**
 * Public-sector readiness section.
 *
 * The right-hand visual is a local WebP asset with a quiet HTML overlay so
 * the message remains responsive, selectable and accessible.
 */

import { ClipboardCheck, GitBranch, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SectionContainer, SectionHeading } from '@/components/public/section';

const PRINCIPLES: {
  icon: LucideIcon;
  title: string;
  text: string;
}[] = [
  {
    icon: GitBranch,
    title: 'Structured approvals',
    text: 'Route each transport request through clear decision points before a trip is authorised.',
  },
  {
    icon: ClipboardCheck,
    title: 'Audit-ready records',
    text: 'Keep actors, timestamps and outcomes connected from request to closure.',
  },
  {
    icon: ShieldCheck,
    title: 'Role-based accountability',
    text: 'Give requesters, transport teams, drivers and auditors the right view for the work.',
  },
];

export function BuiltForPublicSector() {
  return (
    <section
      id="public-sector"
      className="border-border bg-canvas scroll-mt-20 border-b py-20 md:py-24"
    >
      <SectionContainer>
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
          <div>
            <SectionHeading
              align="left"
              title="Built for the Public Sector"
              subtitle="Public fleet operations need more than a vehicle list. GovFleet keeps requests, decisions and trip records connected in one accountable workflow."
            />

            <div className="mt-8 grid gap-5">
              {PRINCIPLES.map((principle) => {
                const Icon = principle.icon;
                return (
                  <div key={principle.title} className="flex gap-3">
                    <span className="border-brand-100 bg-brand-50 text-brand-800 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-300 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="text-ink-950 text-sm font-semibold">{principle.title}</h3>
                      <p className="text-ink-500 mt-1 text-sm leading-relaxed">{principle.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <figure className="border-border bg-surface relative isolate overflow-hidden rounded-[12px] border shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/home/public-office.webp"
              alt="Namibian public office building with the national flag"
              width={480}
              height={360}
              loading="lazy"
              decoding="async"
              className="block aspect-[16/9] w-full object-cover sm:aspect-[12/5] lg:aspect-[16/10]"
            />
            <div className="absolute right-3 bottom-3 max-w-[76%] sm:right-4 sm:bottom-4 sm:max-w-[56%]">
              <div className="rounded-[8px] border border-white/70 bg-white/92 px-3 py-2 shadow-sm backdrop-blur-[2px] sm:px-3.5 sm:py-2.5">
                <p className="text-[10px] leading-snug font-normal text-slate-700 sm:text-xs">
                  A more efficient, accountable and sustainable fleet for a better tomorrow.
                </p>
              </div>
            </div>
          </figure>
        </div>
      </SectionContainer>
    </section>
  );
}
