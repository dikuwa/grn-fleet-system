/**
 * Capabilities — grouped capability cards with real product thumbnails.
 *
 * Replaces the four text-only cards with eight grouped capability areas,
 * each pairing copy with a small real product preview so the section shows
 * the platform rather than only describing it.
 */

import {
  FileText,
  ShieldCheck,
  Truck,
  ClipboardCheck,
  Fuel,
  Wrench,
  BarChart3,
  Smartphone,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SectionContainer, SectionHeading } from '@/components/public/section';
import {
  TransportRequestPreview,
  ApprovalWorkflowPreview,
  VehicleAllocationPreview,
  FleetMapPreview,
  DriverSelfServicePreview,
  AnalyticsPreview,
} from '@/components/public/previews';

interface Capability {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  features: string[];
  Preview?: React.ComponentType<{ className?: string }>;
}

const CAPABILITIES: Capability[] = [
  {
    key: 'requests',
    title: 'Transport Requests',
    description: 'A guided multi-step request wizard with programme, route, passengers and driver requirements.',
    icon: FileText,
    features: ['Route & distance calculation', 'Passenger manifests', 'Vehicle category recommendation'],
    Preview: TransportRequestPreview,
  },
  {
    key: 'approvals',
    title: 'Approval Workflows',
    description: 'Multi-level, configurable approval chains with full separation of duty and a logged decision trail.',
    icon: ShieldCheck,
    features: ['Supervisor review', 'Transport allocation review', 'Release & final authorisation'],
    Preview: ApprovalWorkflowPreview,
  },
  {
    key: 'vehicles',
    title: 'Vehicle & Trip Management',
    description: 'Allocation, pre-trip inspection, trip authority, driver acknowledgement and trip closure.',
    icon: Truck,
    features: ['Defect & availability checks', 'Trip authority documents', 'Kilometre variance tracking'],
    Preview: VehicleAllocationPreview,
  },
  {
    key: 'fleet-map',
    title: 'Live Fleet Visibility',
    description: 'A real-time operational view of vehicles, active trips and availability across the organisation.',
    icon: Truck,
    features: ['Vehicle positions & status', 'Active trip tracking', 'Status filtering'],
    Preview: FleetMapPreview,
  },
  {
    key: 'inspections',
    title: 'Inspections & Defects',
    description: 'Standardised pre-trip and return checklists with automatic defect creation on failed items.',
    icon: ClipboardCheck,
    features: ['Blocking defects on critical items', 'Resolution tracking', 'Per-vehicle history'],
  },
  {
    key: 'fuel',
    title: 'Fuel Management',
    description: 'Fuel transactions with odometer validation, receipt capture and consumption reporting.',
    icon: Fuel,
    features: ['Odometer validation', 'Receipt capture', 'Consumption by vehicle & period'],
  },
  {
    key: 'compliance',
    title: 'Compliance & Maintenance',
    description: 'Licence, insurance and roadworthy tracking with expiry alerts and maintenance scheduling.',
    icon: Wrench,
    features: ['30/14/7-day expiry alerts', 'Predictive maintenance', 'Lifetime cost tracking'],
  },
  {
    key: 'analytics',
    title: 'Reports & Analytics',
    description: 'Fleet utilisation, fuel, trip and approval-turnaround reporting with exportable audit outputs.',
    icon: BarChart3,
    features: ['Utilisation & fuel reports', 'Approval turnaround', 'Exportable audit trails'],
    Preview: AnalyticsPreview,
  },
  {
    key: 'driver',
    title: 'Driver Self-Service',
    description: 'A mobile portal for authorised drivers to run trips, log fuel and report incidents — offline included.',
    icon: Smartphone,
    features: ['Trip acknowledgement', 'Fuel & log entries', 'Offline drafts that sync'],
    Preview: DriverSelfServicePreview,
  },
];

export interface CapabilitiesProps {
  heading?: string;
  subheading?: string;
}

export function Capabilities({
  heading = 'Complete Fleet Operations Platform',
  subheading = 'From transport request to trip closure — every stage is tracked, accountable and paperless.',
}: CapabilitiesProps) {
  return (
    <section id="features" className="border-b border-border bg-surface py-20 md:py-24">
      <SectionContainer>
        <SectionHeading title={heading} subtitle={subheading} />
        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((cap) => {
            const Icon = cap.icon;
            return (
              <article
                key={cap.key}
                className="group flex flex-col rounded-[10px] border border-border bg-surface p-6 transition-all hover:border-brand-200 hover:shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="text-sm font-semibold text-ink-950">{cap.title}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-ink-500">
                  {cap.description}
                </p>
                <ul className="mt-4 space-y-1.5">
                  {cap.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-ink-600">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-600" aria-hidden="true" />
                      {f}
                    </li>
                  ))}
                </ul>
                {cap.Preview && (
                  <div className="mt-5 flex-1">
                    <cap.Preview className="transition-transform duration-200 group-hover:-translate-y-0.5" />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </SectionContainer>
    </section>
  );
}
