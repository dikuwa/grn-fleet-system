import type { HTMLAttributes, ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ResponsivePage({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('responsive-page min-w-0 space-y-5 sm:space-y-6', className)} {...props} />
  );
}

export function ResponsiveFormGrid({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2', className)} {...props} />
  );
}

export function ResponsiveStatsGrid({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'grid min-w-0 grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-4 lg:gap-4',
        className,
      )}
      {...props}
    />
  );
}

export function ResponsiveCardGrid({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3', className)}
      {...props}
    />
  );
}

export function MobileActionBar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'mobile-action-bar border-border flex flex-wrap items-center gap-2 sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

export function ResponsiveTable({
  children,
  className,
  label = 'Scrollable data table',
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={cn('responsive-table max-w-full scrollbar-thin overflow-x-auto', className)}
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <p className="text-ink-500 mb-2 text-xs sm:hidden" aria-hidden="true">
        Swipe to view more
      </p>
      {children}
    </div>
  );
}

export function MobileRecordCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <article
      className={cn('border-border bg-surface min-w-0 rounded-[10px] border p-4', className)}
      {...props}
    />
  );
}

export function ResponsiveMapContainer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative min-h-72 w-full min-w-0 overflow-hidden rounded-[10px] sm:min-h-96',
        className,
      )}
      {...props}
    />
  );
}

export function ResponsiveUploadZone({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'border-border w-full min-w-0 rounded-[10px] border-2 border-dashed px-4 py-10 text-center sm:px-6 sm:py-16',
        className,
      )}
      {...props}
    />
  );
}

export type ResponsiveStep = { label: string };

export function ResponsiveStepper({
  steps,
  current,
  onStep,
}: {
  steps: readonly ResponsiveStep[];
  current: number;
  onStep?: (index: number) => void;
}) {
  const progress = ((current + 1) / steps.length) * 100;
  return (
    <nav
      aria-label="Progress"
      className="border-border bg-surface rounded-[10px] border p-3 sm:p-4"
    >
      <div className="sm:hidden">
        <div className="flex items-center justify-between gap-3">
          <p className="text-ink-950 text-sm font-semibold">{steps[current]?.label}</p>
          <p className="text-ink-500 shrink-0 text-xs">
            Step {current + 1} of {steps.length}
          </p>
        </div>
        <div
          className="bg-muted mt-3 h-2 overflow-hidden rounded-full"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={current + 1}
        >
          <div
            className="bg-brand-700 h-full rounded-full transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <details className="mt-2">
          <summary className="touch-target text-brand-700 inline-flex cursor-pointer text-xs font-medium">
            View all steps
          </summary>
          <ol className="mt-2 space-y-1.5">
            {steps.map((step, index) => (
              <StepItem
                key={step.label}
                label={step.label}
                index={index}
                current={current}
                onStep={onStep}
              />
            ))}
          </ol>
        </details>
      </div>
      <ol
        className="hidden items-start gap-2 sm:grid"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
        {steps.map((step, index) => (
          <StepItem
            key={step.label}
            label={step.label}
            index={index}
            current={current}
            onStep={onStep}
          />
        ))}
      </ol>
    </nav>
  );
}

function StepItem({
  label,
  index,
  current,
  onStep,
}: {
  label: string;
  index: number;
  current: number;
  onStep?: (index: number) => void;
}) {
  const complete = index < current;
  const active = index === current;
  return (
    <li>
      <button
        type="button"
        disabled={index > current || !onStep}
        onClick={() => onStep?.(index)}
        aria-current={active ? 'step' : undefined}
        className={cn(
          'focus-ring flex min-h-11 w-full items-center gap-2 rounded-[8px] px-2 py-2 text-left text-xs font-medium',
          active && 'bg-brand-800 text-white',
          complete && 'bg-brand-50 text-brand-800',
          !active && !complete && 'bg-muted text-ink-500',
        )}
      >
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current"
          aria-hidden="true"
        >
          {complete ? <Check className="h-3.5 w-3.5" /> : index + 1}
        </span>
        <span className="min-w-0 leading-tight">{label}</span>
      </button>
    </li>
  );
}
