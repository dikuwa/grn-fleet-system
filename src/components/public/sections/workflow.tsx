/**
 * Workflow — the six-stage operational lifecycle.
 *
 * A single semantic ordered list adapts between vertical mobile/tablet and
 * horizontal desktop layouts. This avoids duplicating the workflow in the DOM
 * while preserving the responsive presentation.
 */

import { SectionContainer, SectionHeading } from '@/components/public/section';

export interface WorkflowStage {
  title: string;
  description: string;
}

const DEFAULT_STAGES: WorkflowStage[] = [
  {
    title: 'Request',
    description: 'Create a transport request with route, programme, passengers and trip requirements.',
  },
  {
    title: 'Review',
    description: 'Required approval officers review, comment and make decisions.',
  },
  {
    title: 'Allocate',
    description: 'Transport operations assign a suitable vehicle and eligible driver.',
  },
  {
    title: 'Authorise',
    description: 'Required release and trip-authority steps are completed.',
  },
  {
    title: 'Operate',
    description: 'The driver executes the trip and records operational activity.',
  },
  {
    title: 'Close',
    description: 'Trip records, inspection, fuel and completion data form the final audit trail.',
  },
];

export interface WorkflowProps {
  heading?: string;
  subheading?: string;
  stages?: WorkflowStage[];
}

export function Workflow({
  heading = 'How GovFleet Works',
  subheading = 'Six operational stages, one accountable digital trail.',
  stages,
}: WorkflowProps) {
  const items = stages?.length ? stages : DEFAULT_STAGES;

  return (
    <section id="how-it-works" className="border-b border-border bg-canvas py-20 md:py-24">
      <SectionContainer>
        <SectionHeading title={heading} subtitle={subheading} />

        <ol className="mt-12 grid gap-0 lg:mt-14 lg:grid-cols-6 lg:gap-4">
          {items.map((stage, i) => (
            <li key={stage.title} className="relative flex gap-4 pb-6 last:pb-0 lg:block lg:pb-0">
              {i < items.length - 1 && (
                <>
                  <span
                    className="absolute left-5 top-10 h-[calc(100%-2.5rem)] w-px bg-border lg:hidden"
                    aria-hidden="true"
                  />
                  <span
                    className="absolute left-[calc(50%+1.25rem)] top-6 hidden h-px w-[calc(100%-2.5rem)] bg-border lg:block"
                    aria-hidden="true"
                  />
                </>
              )}

              <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-surface text-sm font-semibold text-brand-700 dark:border-brand-800 dark:text-brand-300 lg:mx-auto lg:h-12 lg:w-12">
                {i + 1}
              </span>

              <div className="min-w-0 pt-0.5 lg:pt-0 lg:text-center">
                <h3 className="text-sm font-semibold text-ink-950 lg:mt-3">{stage.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-500 lg:mt-1.5 lg:text-xs">
                  {stage.description}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </SectionContainer>
    </section>
  );
}
