import Link from 'next/link';
import { APP_NAME } from '@/lib/constants';
import { Shield, Truck, FileText, BarChart3, ArrowLeft, Users, Globe, Award } from 'lucide-react';

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-border bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-800 text-white text-sm font-bold">G</div>
            <span className="text-sm font-semibold text-ink-950">{APP_NAME}</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/services" className="text-sm text-ink-500 hover:text-ink-950 transition-colors">Services</Link>
            <Link href="/contact" className="text-sm text-ink-500 hover:text-ink-950 transition-colors">Contact</Link>
            <Link href="/" className="flex items-center gap-1 text-sm text-ink-500 hover:text-ink-950 transition-colors">
              <ArrowLeft className="h-4 w-4" /> Back to Home
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-b from-brand-950 to-brand-900 py-20">
        <div className="mx-auto max-w-[800px] px-6 text-center">
          <h1 className="text-3xl font-[650] tracking-tight text-white md:text-4xl">
            About {APP_NAME}
          </h1>
          <p className="mt-4 text-lg text-white/80">
            Modernising government fleet operations through digital workflow automation.
          </p>
        </div>
      </section>

      {/* Mission */}
      <section className="bg-white py-20">
        <div className="mx-auto max-w-[800px] px-6">
          <div className="text-center">
            <h2 className="text-2xl font-[650] tracking-tight text-ink-950">Our Mission</h2>
            <p className="mt-4 text-ink-500 leading-relaxed">
              GovFleet Namibia replaces paper-based transport requests, approvals, vehicle allocations,
              inspections, fuel records, and trip closure with one traceable digital platform. We aim to
              improve accountability, reduce administrative overhead, and provide real-time visibility into
              government fleet operations across all regions.
            </p>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="bg-canvas py-20">
        <div className="mx-auto max-w-[1000px] px-6">
          <h2 className="text-center text-2xl font-[650] tracking-tight text-ink-950">Our Values</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {values.map((v) => (
              <div key={v.title} className="rounded-[10px] border border-border bg-surface p-6 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  {v.icon}
                </div>
                <h3 className="mt-4 text-sm font-semibold text-ink-950">{v.title}</h3>
                <p className="mt-2 text-sm text-ink-500">{v.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Kavango East Pilot */}
      <section className="bg-white py-20">
        <div className="mx-auto max-w-[800px] px-6">
          <div className="rounded-[10px] border border-border bg-surface p-8">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                <Globe className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-[650] text-ink-950">Pilot Programme</h2>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-ink-500">
              The Kavango East Regional Council is serving as the pilot tenant for this platform. 
              The pilot aims to validate the digital workflow across all stages of fleet operations 
              before potential national rollout. This platform is proposed as a fleet-management 
              solution and does not imply official national adoption at this stage.
            </p>
            <div className="mt-6">
              <Link
                href="/contact"
                className="inline-flex h-10 items-center justify-center rounded-[8px] bg-brand-800 px-5 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
              >
                Enquire About the Pilot
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Platform Stats */}
      <section className="bg-brand-950 py-16">
        <div className="mx-auto max-w-[1000px] px-6">
          <div className="grid gap-8 sm:grid-cols-4">
            <div className="text-center">
              <p className="text-3xl font-[650] text-white">6</p>
              <p className="mt-1 text-sm text-white/60">Workflow Stages</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-[650] text-white">4</p>
              <p className="mt-1 text-sm text-white/60">Approval Steps</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-[650] text-white">1</p>
              <p className="mt-1 text-sm text-white/60">Pilot Region</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-[650] text-white">24/7</p>
              <p className="mt-1 text-sm text-white/60">Platform Availability</p>
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-brand-950 border-t border-white/10 py-12">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <p className="text-sm text-white/60">&copy; {new Date().getFullYear()} {APP_NAME}. All rights reserved.</p>
            <div className="flex gap-6">
              <Link href="/services" className="text-sm text-white/60 hover:text-white transition-colors">Services</Link>
              <Link href="/contact" className="text-sm text-white/60 hover:text-white transition-colors">Contact</Link>
              <Link href="/privacy" className="text-sm text-white/60 hover:text-white transition-colors">Privacy</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

const values = [
  {
    title: 'Accountability',
    description: 'Every action is logged and attributed. Full audit trail from request to trip closure.',
    icon: <Shield className="h-5 w-5" />,
  },
  {
    title: 'Efficiency',
    description: 'Digital workflows replace paper-based processes, reducing turnaround times significantly.',
    icon: <Truck className="h-5 w-5" />,
  },
  {
    title: 'Transparency',
    description: 'Real-time visibility into fleet operations, approvals, and resource utilisation across all levels.',
    icon: <BarChart3 className="h-5 w-5" />,
  },
];
