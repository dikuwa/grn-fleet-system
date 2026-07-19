import Link from 'next/link';
import { APP_NAME } from '@/lib/constants';
import {
  ArrowLeft,
  FileText,
  Shield,
  Truck,
  ClipboardCheck,
  Fuel,
  Wrench,
  BarChart3,
  Bell,
  Smartphone,
  CheckCircle2,
} from 'lucide-react';

export default function ServicesPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-border bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-800 text-white text-sm font-bold">G</div>
            <span className="text-sm font-semibold text-ink-950">{APP_NAME}</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/about" className="text-sm text-ink-500 hover:text-ink-950 transition-colors">About</Link>
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
            Platform Services
          </h1>
          <p className="mt-4 text-lg text-white/80">
            End-to-end digital fleet management capabilities for government operations.
          </p>
        </div>
      </section>

      {/* Service Modules */}
      <section className="bg-white py-20">
        <div className="mx-auto max-w-[1000px] px-6">
          <div className="space-y-16">
            {serviceModules.map((module, i) => (
              <div key={module.title} className="grid items-start gap-8 md:grid-cols-2">
                <div className={i % 2 === 1 ? 'md:order-2' : ''}>
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                    {module.icon}
                  </div>
                  <h2 className="mt-4 text-xl font-[650] text-ink-950">{module.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-ink-500">{module.description}</p>
                  <ul className="mt-4 space-y-2">
                    {module.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-ink-600">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-success-text" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={i % 2 === 1 ? 'md:order-1' : ''}>
                  <div className="rounded-[10px] border border-border bg-surface p-6">
                    <h3 className="text-sm font-semibold text-ink-950">Key Outcomes</h3>
                    <ul className="mt-3 space-y-2">
                      {module.outcomes.map((o) => (
                        <li key={o} className="flex items-start gap-2 text-xs text-ink-500">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                          {o}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-canvas py-20">
        <div className="mx-auto max-w-[600px] px-6 text-center">
          <h2 className="text-2xl font-[650] tracking-tight text-ink-950">Ready to Get Started?</h2>
          <p className="mt-4 text-sm text-ink-500">
            Contact the GovFleet team to discuss how the platform can support your organisation&apos;s fleet operations.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              href="/contact"
              className="inline-flex h-12 items-center justify-center rounded-[8px] bg-brand-800 px-6 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
            >
              Contact Us
            </Link>
            <Link
              href="/"
              className="inline-flex h-12 items-center justify-center rounded-[8px] border border-border bg-surface px-6 text-sm font-medium text-ink-700 hover:bg-muted transition-colors"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </section>

      <footer className="bg-brand-950 py-12">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <p className="text-sm text-white/60">&copy; {new Date().getFullYear()} {APP_NAME}. All rights reserved.</p>
            <div className="flex gap-6">
              <Link href="/about" className="text-sm text-white/60 hover:text-white transition-colors">About</Link>
              <Link href="/contact" className="text-sm text-white/60 hover:text-white transition-colors">Contact</Link>
              <Link href="/privacy" className="text-sm text-white/60 hover:text-white transition-colors">Privacy</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

const serviceModules = [
  {
    title: 'Transport Requests & Approvals',
    description: 'A guided multi-step workflow for submitting, reviewing, and approving transport requests. Supports regional and national trip scopes with configurable approval chains.',
    icon: <FileText className="h-6 w-6" />,
    features: [
      'Programme activity selection with route calculation',
      'Passenger manifest and driver requirement entry',
      'Supervisor approval with separation of duty',
      'Transport review and vehicle allocation',
      'Emergency override with post-trip review flagging',
    ],
    outcomes: [
      'Paperless request submission reduces turnaround time',
      'Clear audit trail for every approval decision',
      'Separation of duty prevents self-approval',
      'Emergency path available for urgent operations',
    ],
  },
  {
    title: 'Vehicle Allocation & Trip Management',
    description: 'End-to-end vehicle assignment, pre-trip inspection, trip authorisation, and driver acknowledgment with real-time status tracking.',
    icon: <Truck className="h-6 w-6" />,
    features: [
      'Vehicle recommender with defect and availability checks',
      'Pre-trip and return inspection checklists',
      'Driver logsheet and daily log recording',
      'Active trip tracking with real-time duration updates',
      'Trip closure workflow with kilometre variance calculation',
    ],
    outcomes: [
      'Right-sized vehicle allocation reduces fuel waste',
      'Real-time trip visibility improves coordination',
      'Automated variance detection flags discrepancies',
      'Structured closure ensures complete trip records',
    ],
  },
  {
    title: 'Inspections & Defect Management',
    description: 'Standardised pre-trip and return inspection checklists with automatic defect creation for failed items. Defect resolution tracking and vehicle compliance monitoring.',
    icon: <ClipboardCheck className="h-6 w-6" />,
    features: [
      'Pre-trip inspection checklist tied to vehicle release',
      'Return inspection with defect auto-creation on failure',
      'Critical items create blocking defects automatically',
      'Inline defect resolution with notes and status tracking',
      'Defect history per vehicle for trend analysis',
    ],
    outcomes: [
      'Failed inspections prevent unsafe vehicles from being used',
      'Defect trends identify recurring maintenance needs',
      'Digital records replace paper inspection forms',
      'Accountability for vehicle condition at handover',
    ],
  },
  {
    title: 'Fuel Management & Expenses',
    description: 'Fuel transaction recording with odometer validation, receipt OCR, fuel consumption reports, and trip expense tracking.',
    icon: <Fuel className="h-6 w-6" />,
    features: [
      'Fuel transaction entry with odometer and receipt capture',
      'OCR-based receipt processing for expense extraction',
      'Fuel consumption variance between pump and allocated',
      'Trip-linked expense recording and reimbursement tracking',
      'Fuel usage reports by vehicle, period, and driver',
    ],
    outcomes: [
      'Fuel consumption monitoring reduces unauthorised usage',
      'Odometer-based validation prevents discrepancies',
      'OCR eliminates manual data entry from receipts',
      'Per-trip expense visibility supports budgeting',
    ],
  },
  {
    title: 'Fleet Compliance & Maintenance',
    description: 'Vehicle compliance tracking, licence and insurance expiry alerts, predictive maintenance, and maintenance event scheduling.',
    icon: <Wrench className="h-6 w-6" />,
    features: [
      'Vehicle compliance with licence, insurance, and roadworthy tracking',
      'Expiry alerts dashboard with 30/14/7-day warnings',
      'Predictive maintenance using odometer and usage patterns',
      'Maintenance event creation, scheduling, and cost recording',
      'Vehicle lifecycle management from acquisition to write-off',
    ],
    outcomes: [
      'Proactive compliance reduces legal and safety risks',
      'Predictive alerts prevent unexpected breakdowns',
      'Maintenance costs tracked per vehicle over lifetime',
      'Centralised compliance documents for audit readiness',
    ],
  },
  {
    title: 'Reports, Analytics & Mobile Access',
    description: 'Comprehensive reporting suite and mobile-optimised driver self-service portal for field operations.',
    icon: <BarChart3 className="h-6 w-6" />,
    features: [
      'Fleet utilisation, fuel consumption, and kilometre variance reports',
      'Approval turnaround and trip completion analytics',
      'Exportable reports for audit and management review',
      'Driver self-service portal for trip and log access',
      'Offline-capable mobile interface for remote field operations',
    ],
    outcomes: [
      'Data-driven decisions improve fleet efficiency',
      'Self-service reduces administrative burden on transport office',
      'Mobile access enables field staff to participate digitally',
      'Audit-ready reports support compliance requirements',
    ],
  },
];
