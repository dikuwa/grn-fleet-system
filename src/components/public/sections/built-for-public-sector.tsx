/**
 * Public-sector readiness section.
 *
 * This is intentionally a static, illustrative preview. It communicates the
 * product's workflow and accountability model without claiming certification,
 * national adoption or a live tenant deployment.
 */

import Image from 'next/image';
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
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)] lg:gap-16">
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

          <figure className="border-border bg-surface overflow-hidden rounded-[12px] border shadow-sm">
            <Image
              src="/images/home/public-sector-civic.webp"
              alt="Illustrative Namibia public-sector civic building with an on-image message about an efficient, accountable and sustainable fleet"
              width={1190}
              height={550}
              sizes="(max-width: 1023px) 100vw, 52vw"
              className="block h-auto w-full object-cover"
            />
          </figure>
        </div>
      </SectionContainer>
    </section>
  );
}
