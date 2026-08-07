/**
 * ProductDashboardPreview — the hero product visual.
 *
 * A realistic, sanitised preview of the GovFleet operations dashboard:
 * KPI cards, pending requests, a compact fleet map and recent activity.
 * All data is static demo content — no tenant queries, no real coordinates.
 */

import { PreviewShell } from '@/components/public/previews/preview-shell';
import { FleetMapPreview } from '@/components/public/previews/fleet-map-preview';

const KPIS = [
  { label: 'Active Trips', value: '12', tone: 'text-brand-700 dark:text-brand-400' },
  { label: 'Pending Approvals', value: '7', tone: 'text-status-warning-text' },
  { label: 'Vehicles Available', value: '34', tone: 'text-status-success-text' },
  { label: 'Open Defects', value: '3', tone: 'text-status-error-text' },
];

const REQUESTS = [
  {
    ref: 'TR-2026-0412',
    route: 'Rundu → Divundu',
    programme: 'Community Outreach',
    status: 'Awaiting Approval',
    tone: 'bg-status-pending-bg text-status-pending-text',
  },
  {
    ref: 'TR-2026-0411',
    route: 'Windhoek → Okahandja',
    programme: 'Workshop Logistics',
    status: 'Authorised',
    tone: 'bg-status-success-bg text-status-success-text',
  },
  {
    ref: 'TR-2026-0408',
    route: 'Katima Mulilo → Kongola',
    programme: 'Field Inspection',
    status: 'In Progress',
    tone: 'bg-status-info-bg text-status-info-text',
  },
];

const ACTIVITY = [
  { time: '09:42', text: 'TR-2026-0412 approved by supervisor' },
  { time: '09:15', text: 'Vehicle KD-021 allocated to TR-2026-0411' },
  { time: '08:58', text: 'Driver log submitted — Trip 6, KD-044' },
  { time: '08:30', text: 'Fuel entry validated · 45.2 L @ Ondangwa' },
];

export interface ProductDashboardPreviewProps {
  className?: string;
}

export function ProductDashboardPreview({
  className,
}: ProductDashboardPreviewProps) {
  return (
    <PreviewShell
      title="govfleet — operations dashboard"
      eyebrow="Live demo"
      className={className}
    >
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {KPIS.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-[8px] border border-border bg-surface p-2.5"
          >
            <p className="text-[10px] font-medium text-ink-500">{kpi.label}</p>
            <p className={`mt-0.5 text-lg font-[650] tabular-nums ${kpi.tone}`}>
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* Body: requests + map */}
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <div className="rounded-[8px] border border-border bg-surface p-2.5">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-semibold text-ink-700">
              Pending Requests
            </h4>
            <span className="text-[10px] text-brand-700 dark:text-brand-400">
              View all →
            </span>
          </div>
          <ul className="mt-2 space-y-1.5">
            {REQUESTS.map((r) => (
              <li
                key={r.ref}
                className="rounded-[6px] border border-border/70 bg-canvas/50 p-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-ink-500">{r.ref}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${r.tone}`}
                  >
                    {r.status}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] font-medium text-ink-800">
                  {r.route}
                </p>
                <p className="truncate text-[10px] text-ink-400">{r.programme}</p>
              </li>
            ))}
          </ul>
        </div>

        {/* Map */}
        <div className="rounded-[8px] border border-border bg-surface p-2.5">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-semibold text-ink-700">Fleet Position</h4>
            <span className="text-[10px] text-ink-400">live</span>
          </div>
          <div className="mt-2 h-40">
            <FleetMapPreview className="h-full" />
          </div>
        </div>
      </div>

      {/* Activity */}
      <div className="mt-2 rounded-[8px] border border-border bg-surface p-2.5">
        <h4 className="text-[11px] font-semibold text-ink-700">Recent Activity</h4>
        <ul className="mt-1.5 space-y-1">
          {ACTIVITY.map((a) => (
            <li
              key={`${a.time}-${a.text}`}
              className="flex items-baseline gap-2 text-[11px]"
            >
              <span className="shrink-0 font-mono text-[10px] text-ink-400">
                {a.time}
              </span>
              <span className="truncate text-ink-600">{a.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </PreviewShell>
  );
}
