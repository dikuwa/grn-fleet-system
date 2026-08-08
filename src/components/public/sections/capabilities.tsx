/**
 * Capabilities — product-led overview of the platform.
 *
 * Four flagship workflows get large, realistic product previews. Supporting
 * capabilities are intentionally rendered as a compact editorial list rather
 * than another wall of cards, giving the homepage more visual hierarchy.
 */

import {
  BarChart3,
  ClipboardCheck,
  FileText,
  Fuel,
  MapPinned,
  ShieldCheck,
  Smartphone,
  Truck,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SectionContainer, SectionHeading } from '@/components/public/section';
import {
  AnalyticsPreview,
  ApprovalWorkflowPreview,
  TransportRequestPreview,
  VehicleAllocationPreview,
} from '@/components/public/previews';

interface FlagshipCapability {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  features: string[];
  Preview: React.ComponentType<{ className?: string }>;
}

interface SupportingCapability {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

const FLAGSHIP_CAPABILITIES: FlagshipCapability[] = [
  {
    key: 'requests',
    title: 'Transport Requests',
    description:
      'Create structured requests with programme, route, passenger and vehicle requirements in one guided workflow.',
    icon: FileText,
    features: ['Route & distance calculation', 'Passenger manifests', 'Vehicle category recommendation'],
    Preview: TransportRequestPreview,
  },
  {
    key: 'approvals',
    title: 'Approval Workflows',
    description:
      'Move each request through the right reviewers with separation of duty and a traceable decision history.',
    icon: ShieldCheck,
    features: ['Role-matched review', 'Transport allocation review', 'Release & final authorisation'],
    Preview: ApprovalWorkflowPreview,
  },
  {
    key: 'vehicles',
    title: 'Vehicle & Trip Management',
    description:
      'Assign an eligible vehicle and driver, issue the trip authority and retain the operating record through closure.',
    icon: Truck,
    features: ['Defect & availability checks', 'Trip authority documents', 'Kilometre variance tracking'],
    Preview: VehicleAllocationPreview,
  },
  {
    key: 'analytics',
    title: 'Reports & Operational Visibility',
    description:
      'See utilisation, fuel, trips, maintenance and approval activity without rebuilding reports from spreadsheets.',
    icon: BarChart3,
    features: ['Utilisation & fuel reporting', 'Approval turnaround', 'Exportable audit outputs'],
    Preview: AnalyticsPreview,
  },
];

const SUPPORTING_CAPABILITIES: SupportingCapability[] = [
  {
    key: 'fleet-map',
    title: 'Live Fleet Visibility',
    description: 'Monitor vehicle status, active trips and availability from one operational view.',
    icon: MapPinned,
  },
  {
    key: 'inspections',
    title: 'Inspections & Defects',
    description: 'Standardise vehicle checks and turn failed critical items into tracked defects.',
    icon: ClipboardCheck,
  },
  {
    key: 'fuel',
    title: 'Fuel Management',
    description: 'Validate odometers, capture receipts and understand consumption by vehicle and trip.',
    icon: Fuel,
  },
  {
    key: 'compliance',
    title: 'Compliance & Maintenance',
    description: 'Track expiries, maintenance work and vehicle readiness before they become operational surprises.',
    icon: Wrench,
  },
  {
    key: 'driver',
    title: 'Driver Self-Service',
    description: 'Give authorised drivers a focused mobile workspace for trip logs, fuel and incident reporting.',
    icon: Smartphone,
  },
];

export interface CapabilitiesProps {
  heading?: string;
  subheading?: string;
}

export function Capabilities({
  heading = 'Complete Fleet Operations Platform',
  subheading = 'From transport request to trip closure — the work, decisions and records stay connected.',
}: CapabilitiesProps) {
  return (
    <section id="features" className="border-b border-border bg-surface py-20 md:py-24">
      <SectionContainer>
        <SectionHeading title={heading} subtitle={subheading} />

        <div className="mt-14 grid gap-6 lg:grid-cols-2">
          {FLAGSHIP_CAPABILITIES.map((cap) => {
            const Icon = cap.icon;
            return (
              <article
                key={cap.key}
                className="group overflow-hidden rounded-[12px] border border-border bg-surface"
              >
                <div className="p-6 md:p-7">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h3 className="text-base font-semibold text-ink-950">{cap.title}</h3>
                  </div>
                  <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-500">{cap.description}</p>
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
                    {cap.features.map((feature) => (
                      <span key={feature} className="flex items-center gap-2 text-xs text-ink-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-brand-600" aria-hidden="true" />
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="border-t border-border bg-canvas/50 p-4 md:p-5">
                  <cap.Preview className="transition-transform duration-200 group-hover:-translate-y-0.5" />
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-14 border-y border-border">
          <div className="grid md:grid-cols-2 lg:grid-cols-5">
            {SUPPORTING_CAPABILITIES.map((cap, index) => {
              const Icon = cap.icon;
              return (
                <div
                  key={cap.key}
                  className={`py-6 md:px-5 ${index > 0 ? 'border-t border-border md:border-t-0 md:border-l' : ''}`}
                >
                  <Icon className="h-5 w-5 text-brand-700 dark:text-brand-300" aria-hidden="true" />
                  <h3 className="mt-3 text-sm font-semibold text-ink-950">{cap.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-ink-500">{cap.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </SectionContainer>
    </section>
  );
}
