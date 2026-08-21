import Link from 'next/link';
import { Clock3, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHero } from '@/components/public/page-hero';
import { SectionContainer } from '@/components/public/section';
import { getPublishedLiveDemo } from '@/lib/public-demo';
import { DemoRolePicker } from './DemoRolePicker';

export const dynamic = 'force-dynamic';

export default async function LiveDemoPage() {
  let demo: Awaited<ReturnType<typeof getPublishedLiveDemo>> | null = null;
  try {
    demo = await getPublishedLiveDemo();
  } catch (error) {
    console.error('[Public Demo] Could not load the published sandbox:', error);
  }

  return (
    <main>
      <PageHero
        title="Explore the real fleet workflow."
        description="Choose an operational role and enter the actual GRN Fleet dashboard using synthetic demo data. No real organisation, employee, vehicle or payment information is used."
      />

      <section className="border-border bg-canvas border-b py-5">
        <SectionContainer>
          <div className="text-ink-600 flex flex-col gap-3 text-sm sm:flex-row sm:flex-wrap sm:gap-x-8">
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="text-brand-700 h-4 w-4" aria-hidden="true" />
              Isolated demo tenant
            </span>
            <span className="inline-flex items-center gap-2">
              <Clock3 className="text-brand-700 h-4 w-4" aria-hidden="true" />
              Sessions expire automatically
            </span>
          </div>
        </SectionContainer>
      </section>

      <section className="bg-canvas py-12 md:py-16">
        <SectionContainer>
          {demo ? (
            <>
              <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-brand-700 text-xs font-semibold tracking-wide uppercase">
                    {demo.tenantName}
                  </p>
                  <h2 className="text-ink-950 mt-1 text-xl font-semibold">
                    Choose what you want to explore
                  </h2>
                  <p className="text-ink-500 mt-1 text-sm">
                    Changes affect demo data only and may be reset. Each public session lasts up to
                    two hours and never beyond the sandbox expiry.
                  </p>
                </div>
              </div>
              <DemoRolePicker />
              <div className="border-border bg-surface mt-8 rounded-[10px] border p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
                <div>
                  <p className="text-ink-950 text-sm font-semibold">
                    Need administration access or your own configuration?
                  </p>
                  <p className="text-ink-500 mt-1 text-sm">
                    Request a private sandbox with Tenant Administrator access and an expiry date
                    set for your evaluation.
                  </p>
                </div>
                <Button asChild className="mt-4 w-full sm:mt-0 sm:w-auto">
                  <Link href="/request-demo">Request a private demo</Link>
                </Button>
              </div>
            </>
          ) : (
            <div className="border-border bg-surface max-w-2xl rounded-[10px] border p-6 sm:p-8">
              <h2 className="text-ink-950 text-2xl font-semibold tracking-tight">
                Live demo temporarily unavailable
              </h2>
              <p className="text-ink-500 mt-3 max-w-xl text-sm leading-relaxed sm:text-base">
                No active public demo sandbox is currently published. You can still request an
                isolated private evaluation workspace.
              </p>
              <Button asChild className="mt-6">
                <Link href="/request-demo">Request a Demo</Link>
              </Button>
            </div>
          )}
        </SectionContainer>
      </section>
    </main>
  );
}
