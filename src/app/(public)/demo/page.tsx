import Link from 'next/link';
import { Clock3, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getPublishedLiveDemo } from '@/lib/public-demo';
import { DemoRolePicker } from './DemoRolePicker';

export const dynamic = 'force-dynamic';

export default async function LiveDemoPage() {
  const demo = await getPublishedLiveDemo();

  return (
    <main className="bg-canvas">
      <section className="border-b border-border bg-brand-950 text-white">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-300">
            GRN Fleet live demo
          </p>
          <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
            Explore the real fleet workflow.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/75 sm:text-base">
            Choose an operational role and enter the actual GRN Fleet dashboard using synthetic
            demo data. No real organisation, employee, vehicle or payment information is used.
          </p>
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs text-white/70">
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-teal-300" /> Isolated demo tenant
            </span>
            <span className="inline-flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-teal-300" /> Sessions expire automatically
            </span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
        {demo ? (
          <>
            <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                  {demo.tenantName}
                </p>
                <h2 className="mt-1 text-xl font-semibold text-ink-950">Choose what you want to explore</h2>
                <p className="mt-1 text-sm text-ink-500">
                  Changes affect demo data only and may be reset. Each public session lasts up to two hours and never beyond the sandbox expiry.
                </p>
              </div>
            </div>
            <DemoRolePicker />
            <div className="mt-8 rounded-[10px] border border-border bg-surface p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
              <div>
                <p className="text-sm font-semibold text-ink-950">Need administration access or your own configuration?</p>
                <p className="mt-1 text-sm text-ink-500">Request a private sandbox with Tenant Administrator access and an expiry date set for your evaluation.</p>
              </div>
              <Button asChild className="mt-4 w-full sm:mt-0 sm:w-auto">
                <Link href="/request-demo">Request a private demo</Link>
              </Button>
            </div>
          </>
        ) : (
          <div className="mx-auto max-w-xl rounded-[12px] border border-border bg-surface p-7 text-center">
            <h2 className="text-xl font-semibold text-ink-950">Live demo temporarily unavailable</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">
              No active public demo sandbox is currently published. You can still request an isolated private evaluation workspace.
            </p>
            <Button asChild className="mt-5">
              <Link href="/request-demo">Request a Demo</Link>
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
