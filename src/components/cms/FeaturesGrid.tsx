/**
 * Public CMS features grid component.
 *
 * Renders a responsive grid of feature cards. Content can come from CMS
 * (homepage content.json.features or standalone feature blocks) or from
 * the hardcoded defaults when CMS is empty.
 *
 * The icon name is resolved at render time against a fixed map of supported
 * lucide-react icons, so CMS authors never need to touch component code.
 */

import type { LucideIcon } from 'lucide-react';
import {
  FileText,
  Shield,
  Truck,
  BarChart3,
  Zap,
  Lock,
  Users,
  MapPin,
  Wrench,
  CheckCircle2,
  ClipboardCheck,
  Fuel,
  AlertTriangle,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Feature {
  title: string;
  description: string;
  icon?: string;
}

export interface FeaturesGridProps {
  features?: Feature[];
  heading?: string;
  subheading?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Icon mapping
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, LucideIcon> = {
  FileText,
  Shield,
  Truck,
  BarChart3,
  Zap,
  Lock,
  Users,
  MapPin,
  Wrench,
  CheckCircle2,
  ClipboardCheck,
  Fuel,
  AlertTriangle,
};

function resolveIcon(name?: string | null): LucideIcon {
  if (name && name in ICON_MAP) return ICON_MAP[name];
  return FileText;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_FEATURES: Feature[] = [
  {
    title: 'Transport Requests',
    description: 'Complete multi-step request wizard with programme activity, route calculation, passengers and driver requirements.',
    icon: 'FileText',
  },
  {
    title: 'Approval Workflow',
    description: 'Regional and national approval chains with supervisor review, transport allocation, release and final authorisation.',
    icon: 'Shield',
  },
  {
    title: 'Vehicle & Trip Management',
    description: 'Allocation, inspections, driver logsheets, fuel records, defect tracking and trip closure with full audit history.',
    icon: 'Truck',
  },
  {
    title: 'Reports & Analytics',
    description: 'Fleet utilisation, fuel consumption, approval turnaround, kilometre variance and comprehensive audit reports.',
    icon: 'BarChart3',
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FeaturesGrid({
  features,
  heading = 'Complete Fleet Operations Platform',
  subheading = 'From transport requests to trip closure — every stage is tracked, accountable, and paperless.',
  className = '',
}: FeaturesGridProps) {
  const items = features?.length ? features : DEFAULT_FEATURES;

  return (
    <section id="features" className={`border-b border-border bg-surface py-24 ${className}`}>
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-[650] tracking-tight text-ink-950">{heading}</h2>
          {subheading && <p className="mt-4 text-ink-500">{subheading}</p>}
        </div>
        <div className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {items.map((feature) => {
            const Icon = resolveIcon(feature.icon);
            return (
              <div
                key={feature.title}
                className="group rounded-[10px] border border-border bg-surface p-6 transition-all hover:border-brand-100 hover:shadow-sm"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-sm font-semibold text-ink-950">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">{feature.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}