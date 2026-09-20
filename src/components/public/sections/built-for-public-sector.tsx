/**
 * Public-sector readiness section.
 *
 * This is intentionally a static, illustrative preview. It communicates the
 * product's workflow and accountability model without claiming certification,
 * national adoption or a live tenant deployment.
 */

import { ClipboardCheck, GitBranch, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SectionContainer, SectionHeading } from '@/components/public/section';
import { SECTOR_IMAGE_DATA } from '@/components/public/sector-image-data';

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

          <figure className="border-border bg-surface overflow-hidden rounded-[12px] border p-3 shadow-sm sm:p-4">
            <div className="bg-muted border-border overflow-hidden rounded-[9px] border">
              {/* Bundled local imagery keeps the public page independent from remote image hosts. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={SECTOR_IMAGE_DATA['government-ministries']}
                alt="Namibian public-sector civic building with the national flag"
                width={160}
                height={100}
                loading="lazy"
                decoding="async"
                className="aspect-[16/10] h-full w-full object-cover"
                style={{ objectPosition: '50% 48%' }}
              />
            </div>
            <figcaption className="text-ink-500 mt-3 text-xs leading-relaxed">
              Namibia-focused civic context for organisations that coordinate public services and
              fleet operations.
            </figcaption>
          </figure>
        </div>
      </SectionContainer>
    </section>
  );
}
