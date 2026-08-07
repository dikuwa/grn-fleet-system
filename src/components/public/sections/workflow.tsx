/**
 * Workflow — the six-stage operational lifecycle.
 *
 * Desktop: compact horizontal stepper (Request → Review → Allocate →
 * Authorise → Operate → Close). Mobile: clean vertical stepper with no
 * horizontal overflow.
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

        {/* Desktop horizontal stepper */}
        <ol className="mt-14 hidden grid-cols-6 gap-4 lg:grid">
          {items.map((stage, i) => (
            <li key={stage.title} className="relative">
              {/* Connector */}
              {i < items.length - 1 && (
                <span
                  className="absolute left-[calc(50%+1.25rem)] top-6 h-px w-[calc(100%-2.5rem)] bg-border"
                  aria-hidden="true"
                />
              )}
              <div className="flex flex-col items-center text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-brand-200 bg-surface text-sm font-semibold text-brand-700 dark:border-brand-800 dark:text-brand-300">
                  {i + 1}
                </span>
                <h3 className="mt-3 text-sm font-semibold text-ink-950">{stage.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
                  {stage.description}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {/* Mobile / tablet vertical stepper */}
        <ol className="mt-12 space-y-6 lg:hidden">
          {items.map((stage, i) => (
            <li key={stage.title} className="relative flex gap-4">
              <div className="flex flex-col items-center">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-surface text-sm font-semibold text-brand-700 dark:border-brand-800 dark:text-brand-300">
                  {i + 1}
                </span>
                {i < items.length - 1 && (
                  <span className="mt-2 w-px flex-1 bg-border" aria-hidden="true" />
                )}
              </div>
              <div className="pb-2">
                <h3 className="text-sm font-semibold text-ink-950">{stage.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-500">
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
