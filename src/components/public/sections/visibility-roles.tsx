/**
 * Real-time visibility split + role-based operation.
 *
 * The visibility section pairs benefit copy with a large analytics/map
 * preview. The roles section explains how each role uses the same system —
 * simplified public wording, no internal implementation details.
 */

import { CheckCircle2 } from 'lucide-react';
import { SectionContainer, SectionHeading } from '@/components/public/section';
import { AnalyticsPreview, FleetMapPreview } from '@/components/public/previews';

const VISIBILITY_BENEFITS = [
  'Live trip status',
  'Vehicle utilisation',
  'Maintenance alerts',
  'Fuel & expense monitoring',
  'Request and approval activity',
  'Operational reporting',
];

const ROLES = [
  {
    role: 'Requester',
    text: 'Creates transport requests with route, programme and passenger details.',
  },
  {
    role: 'Approvers',
    text: 'Review requests requiring their decision, with comments and audit trail.',
  },
  {
    role: 'Transport Officer',
    text: 'Coordinates vehicle and driver allocation and prepares trip authorities.',
  },
  {
    role: 'Driver',
    text: 'Records authorised trip activity through a mobile self-service portal.',
  },
  {
    role: 'Administrator',
    text: 'Configures users, organisational structure and platform settings.',
  },
  {
    role: 'Auditor',
    text: 'Reviews records, documents and accountability trails.',
  },
];

export function VisibilityRoles() {
  return (
    <>
      {/* Real-time visibility */}
      <section className="border-b border-border bg-surface py-20 md:py-24">
        <SectionContainer>
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <SectionHeading
                align="left"
                eyebrow="Operational visibility"
                title="Real-Time Visibility. Operational Accountability."
                subtitle="One dashboard that shows what the fleet is doing — live."
              />
              <ul className="mt-8 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                {VISIBILITY_BENEFITS.map((b) => (
                  <li key={b} className="flex items-center gap-2 text-sm text-ink-600">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success-text" aria-hidden="true" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <AnalyticsPreview className="shadow-sm" />
              <div className="mt-3">
                <FleetMapPreview className="h-48" />
              </div>
            </div>
          </div>
        </SectionContainer>
      </section>

      {/* Role-based operation */}
      <section className="border-b border-border bg-canvas py-20 md:py-24">
        <SectionContainer>
          <SectionHeading
            eyebrow="One platform, every role"
            title="Designed Around How Teams Actually Work"
            subtitle="The same system serves every role in the fleet operation — with access and actions matched to each responsibility."
          />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {ROLES.map((r) => (
              <div
                key={r.role}
                className="rounded-[10px] border border-border bg-surface p-6"
              >
                <h3 className="text-sm font-semibold text-ink-950">{r.role}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">{r.text}</p>
              </div>
            ))}
          </div>
        </SectionContainer>
      </section>
    </>
  );
}
