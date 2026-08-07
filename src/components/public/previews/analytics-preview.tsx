/**
 * AnalyticsPreview — a lightweight analytics visual.
 *
 * Pure div/CSS bars (no chart library, no dashboard state) showing fleet
 * utilisation, fuel consumption and trip counts with realistic demo values.
 */

import { PreviewShell } from '@/components/public/previews/preview-shell';

const UTILISATION = [
  { month: 'Mar', value: 62 },
  { month: 'Apr', value: 68 },
  { month: 'May', value: 74 },
  { month: 'Jun', value: 71 },
  { month: 'Jul', value: 82 },
  { month: 'Aug', value: 79 },
];

const FUEL = [
  { label: 'Rundu Depot', value: '4,820 L', pct: 72 },
  { label: 'Katima Depot', value: '3,145 L', pct: 58 },
  { label: 'Windhoek Office', value: '2,310 L', pct: 44 },
];

const TRIPS = [
  { label: 'Completed', value: 48, tone: 'bg-status-success-text' },
  { label: 'In Progress', value: 12, tone: 'bg-brand-600' },
  { label: 'Awaiting Closure', value: 6, tone: 'bg-status-warning-text' },
];

export interface AnalyticsPreviewProps {
  className?: string;
}

export function AnalyticsPreview({ className }: AnalyticsPreviewProps) {
  return (
    <PreviewShell title="operations analytics" className={className}>
      <div className="grid gap-3 sm:grid-cols-3">
        {/* Utilisation bars */}
        <div className="rounded-[8px] border border-border bg-surface p-2.5">
          <p className="text-[10px] font-semibold text-ink-700">Vehicle Utilisation</p>
          <div className="mt-2 flex h-16 items-end gap-1.5">
            {UTILISATION.map((u) => (
              <div key={u.month} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t-[3px] bg-brand-600/80"
                  style={{ height: `${u.value}%` }}
                  title={`${u.month}: ${u.value}%`}
                />
                <span className="text-[8px] text-ink-400">{u.month}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Fuel by depot */}
        <div className="rounded-[8px] border border-border bg-surface p-2.5">
          <p className="text-[10px] font-semibold text-ink-700">Fuel Consumption</p>
          <div className="mt-2 space-y-1.5">
            {FUEL.map((f) => (
              <div key={f.label}>
                <div className="flex items-center justify-between text-[9px]">
                  <span className="text-ink-500">{f.label}</span>
                  <span className="font-mono text-ink-700">{f.value}</span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-teal-700"
                    style={{ width: `${f.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Trip distribution */}
        <div className="rounded-[8px] border border-border bg-surface p-2.5">
          <p className="text-[10px] font-semibold text-ink-700">Trips — Last 30 Days</p>
          <div className="mt-2 space-y-1.5">
            {TRIPS.map((t) => (
              <div
                key={t.label}
                className="flex items-center justify-between rounded-[6px] border border-border/70 bg-canvas/50 px-2 py-1.5"
              >
                <span className="text-[10px] text-ink-600">{t.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold text-white ${t.tone}`}
                >
                  {t.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-ink-400">
        Utilisation · fuel · trips · maintenance · approval turnaround
      </p>
    </PreviewShell>
  );
}
