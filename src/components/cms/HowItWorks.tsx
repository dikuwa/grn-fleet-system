/**
 * Public CMS "How It Works" component.
 *
 * Renders a numbered vertical step list with connecting lines. Content can
 * be provided via CMS (homepage content.json.steps) or falls back to the
 * platform's hardcoded defaults.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Step {
  title: string;
  description: string;
}

export interface HowItWorksProps {
  steps?: Step[];
  heading?: string;
  subheading?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_STEPS: Step[] = [
  { title: 'Submit Transport Request', description: 'The requester creates a transport request with programme activity, route, passengers and driver needs. The system recommends a vehicle category.' },
  { title: 'Supervisor Approves', description: 'The immediate supervisor reviews, comments and approves the request. The requester cannot approve their own request.' },
  { title: 'Transport Administrator Allocates', description: 'The Transport Administrator validates the route, allocates an exact vehicle and prepares the Trip Authority.' },
  { title: 'Release and Authorise', description: 'Administrative release and departure inspection are completed, followed by final authorisation by the designated officer.' },
  { title: 'Driver Operations', description: 'The driver acknowledges, receives the vehicle, records daily logs and fuel entries — including offline drafts on a mobile phone.' },
  { title: 'Return and Close', description: 'Return inspection, fuel verification, variance calculation and Transport Administrator closure. Vehicle returns to availability.' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HowItWorks({
  steps,
  heading = 'How It Works',
  subheading = 'A guided workflow that normally completes approvals within approximately 30 minutes.',
  className = '',
}: HowItWorksProps) {
  const items = steps?.length ? steps : DEFAULT_STEPS;

  return (
    <section id="how-it-works" className={`bg-canvas py-24 ${className}`}>
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-[650] tracking-tight text-ink-950">{heading}</h2>
          {subheading && <p className="mt-4 text-ink-500">{subheading}</p>}
        </div>
        <div className="mt-16 space-y-12">
          {items.map((step, i) => (
            <div key={i} className="relative flex gap-6">
              <div className="flex flex-col items-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-800 text-sm font-semibold text-white">
                  {i + 1}
                </div>
                {i < items.length - 1 && (
                  <div className="mt-2 w-px flex-1 bg-border" />
                )}
              </div>
              <div className="pb-12">
                <h3 className="text-base font-semibold text-ink-950">{step.title}</h3>
                <p className="mt-1 text-sm text-ink-500">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}