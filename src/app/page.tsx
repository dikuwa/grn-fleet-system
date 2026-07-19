import Link from 'next/link';
import { ArrowRight, Shield, Truck, FileText, BarChart3 } from 'lucide-react';
import { APP_NAME } from '@/lib/constants';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-800 text-white text-sm font-bold">
              G
            </div>
            <span className="text-sm font-semibold text-ink-950">{APP_NAME}</span>
          </div>
          <nav className="hidden items-center gap-6 md:flex">
            <Link href="/about" className="text-sm text-ink-500 hover:text-ink-950 transition-colors">About</Link>
            <Link href="/services" className="text-sm text-ink-500 hover:text-ink-950 transition-colors">Services</Link>
            <Link href="#features" className="text-sm text-ink-500 hover:text-ink-950 transition-colors">
              Features
            </Link>
            <Link href="#how-it-works" className="text-sm text-ink-500 hover:text-ink-950 transition-colors">
              How It Works
            </Link>
            <Link href="#pilot" className="text-sm text-ink-500 hover:text-ink-950 transition-colors">
              Pilot
            </Link>
            <Link
              href="/login"
              className="inline-flex h-10 items-center justify-center rounded-[8px] bg-brand-800 px-5 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
            >
              Login
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-950 to-brand-900">
        <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-[650] tracking-tight text-white md:text-5xl">
              Digital Fleet Management for{' '}
              <span className="text-brand-100">Namibia&apos;s Government</span>
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-white/80">
              GovFleet Namibia replaces paper-based transport requests, approvals, vehicle allocation,
              inspections, logs, fuel records and trip closure with one traceable digital workflow.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/login"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] bg-white px-6 text-sm font-semibold text-brand-900 hover:bg-brand-50 transition-colors"
              >
                Access Dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="#features"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] border border-white/20 bg-white/10 px-6 text-sm font-medium text-white hover:bg-white/20 transition-colors"
              >
                Learn More
              </Link>
            </div>
          </div>
        </div>
        <div className="absolute -right-48 -top-48 h-96 w-96 rounded-full bg-brand-700/20 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-teal-500/10 blur-3xl" />
      </section>

      {/* Features */}
      <section id="features" className="border-b border-border bg-white py-24">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-[650] tracking-tight text-ink-950">
              Complete Fleet Operations Platform
            </h2>
            <p className="mt-4 text-ink-500">
              From transport requests to trip closure — every stage is tracked, accountable, and paperless.
            </p>
          </div>
          <div className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group rounded-[10px] border border-border bg-white p-6 transition-all hover:border-brand-100 hover:shadow-sm"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  {feature.icon}
                </div>
                <h3 className="mt-4 text-sm font-semibold text-ink-950">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="bg-canvas py-24">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-[650] tracking-tight text-ink-950">
              How It Works
            </h2>
            <p className="mt-4 text-ink-500">
              A guided workflow that normally completes approvals within approximately 30 minutes.
            </p>
          </div>
          <div className="mt-16 space-y-12">
            {steps.map((step, i) => (
              <div key={i} className="relative flex gap-6">
                <div className="flex flex-col items-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-800 text-sm font-semibold text-white">
                    {i + 1}
                  </div>
                  {i < steps.length - 1 && (
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

      {/* Pilot Section */}
      <section id="pilot" className="border-b border-border bg-white py-24">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-[650] tracking-tight text-ink-950">
              Kavango East Pilot
            </h2>
            <p className="mt-4 text-ink-500">
              The Kavango East Regional Council is the pilot tenant. This platform is proposed as a
              fleet-management solution and does not imply official national adoption.
            </p>
            <Link
              href="/contact"
              className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-[8px] bg-brand-800 px-6 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
            >
              Request a Demonstration
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-brand-950 py-12">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <p className="text-sm text-white/60">
              &copy; {new Date().getFullYear()} {APP_NAME}. All rights reserved.
            </p>
            <div className="flex gap-6">
              <Link href="/about" className="text-sm text-white/60 hover:text-white transition-colors">About</Link>
              <Link href="/services" className="text-sm text-white/60 hover:text-white transition-colors">Services</Link>
              <Link href="/privacy" className="text-sm text-white/60 hover:text-white transition-colors">Privacy</Link>
              <Link href="/contact" className="text-sm text-white/60 hover:text-white transition-colors">Contact</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

const features = [
  {
    title: 'Transport Requests',
    description: 'Complete multi-step request wizard with programme activity, route calculation, passengers and driver requirements.',
    icon: <FileText className="h-5 w-5" />,
  },
  {
    title: 'Approval Workflow',
    description: 'Regional and national approval chains with supervisor review, transport allocation, release and final authorisation.',
    icon: <Shield className="h-5 w-5" />,
  },
  {
    title: 'Vehicle & Trip Management',
    description: 'Allocation, inspections, driver logsheets, fuel records, defect tracking and trip closure with full audit history.',
    icon: <Truck className="h-5 w-5" />,
  },
  {
    title: 'Reports & Analytics',
    description: 'Fleet utilisation, fuel consumption, approval turnaround, kilometre variance and comprehensive audit reports.',
    icon: <BarChart3 className="h-5 w-5" />,
  },
];

const steps = [
  {
    title: 'Submit Transport Request',
    description: 'The requester creates a transport request with programme activity, route, passengers and driver needs. The system recommends a vehicle category.',
  },
  {
    title: 'Supervisor Approves',
    description: 'The immediate supervisor reviews, comments and approves the request. The requester cannot approve their own request.',
  },
  {
    title: 'Transport Administrator Allocates',
    description: 'The Transport Administrator validates the route, allocates an exact vehicle and prepares the Trip Authority.',
  },
  {
    title: 'Release and Authorise',
    description: 'Administrative release and departure inspection are completed, followed by final authorisation by the designated officer.',
  },
  {
    title: 'Driver Operations',
    description: 'The driver acknowledges, receives the vehicle, records daily logs and fuel entries — including offline drafts on a mobile phone.',
  },
  {
    title: 'Return and Close',
    description: 'Return inspection, fuel verification, variance calculation and Transport Administrator closure. Vehicle returns to availability.',
  },
];
