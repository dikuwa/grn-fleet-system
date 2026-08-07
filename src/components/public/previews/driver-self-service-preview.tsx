/**
 * DriverSelfServicePreview — a phone mockup of the driver mobile experience.
 *
 * Shows an active trip with log entry, fuel entry, incident reporting and
 * offline draft capability. Static demo content.
 */

import { Navigation, Droplets, AlertTriangle, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DriverSelfServicePreviewProps {
  className?: string;
}

export function DriverSelfServicePreview({
  className,
}: DriverSelfServicePreviewProps) {
  return (
    <div
      className={cn(
        'mx-auto w-[260px] rounded-[24px] border border-border bg-surface p-2 shadow-sm',
        className,
      )}
      role="img"
      aria-label="Illustrative mobile driver self-service preview"
    >
      <div className="rounded-[18px] border border-border bg-canvas/60">
        {/* Status bar */}
        <div className="flex items-center justify-between px-3 pt-2.5">
          <span className="text-[9px] font-medium text-ink-500">09:41</span>
          <span className="flex items-center gap-1 rounded-full bg-status-success-bg px-1.5 py-0.5 text-[8px] font-medium text-status-success-text">
            <span className="h-1 w-1 rounded-full bg-status-success-text" aria-hidden="true" />
            On trip
          </span>
        </div>

        {/* Active trip card */}
        <div className="m-3 rounded-[12px] border border-border bg-surface p-3">
          <p className="text-[9px] font-medium uppercase tracking-wider text-ink-400">
            Active Trip · KD-021
          </p>
          <p className="mt-1 text-[13px] font-semibold text-ink-950">
            Rundu → Divundu
          </p>
          <div className="mt-2 flex items-center justify-between rounded-[8px] bg-brand-800 px-2.5 py-1.5 text-white">
            <span className="flex items-center gap-1 text-[10px] font-medium">
              <Navigation className="h-3 w-3" aria-hidden="true" />
              Trip log
            </span>
            <span className="font-mono text-[10px]">185.4 km</span>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <QuickAction icon={<Droplets className="h-3 w-3" aria-hidden="true" />} label="Fuel entry" />
            <QuickAction icon={<AlertTriangle className="h-3 w-3" aria-hidden="true" />} label="Report incident" />
          </div>
        </div>

        {/* Offline note */}
        <div className="mx-3 mb-3 flex items-center gap-2 rounded-[10px] border border-border bg-surface px-2.5 py-2">
          <WifiOff className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden="true" />
          <div>
            <p className="text-[10px] font-medium text-ink-700">Offline draft ready</p>
            <p className="text-[8px] text-ink-400">Logs sync when connection returns</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickAction({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className="flex items-center justify-center gap-1 rounded-[8px] border border-border bg-canvas/50 px-1.5 py-1.5 text-[9px] font-medium text-ink-600"
    >
      {icon}
      {label}
    </button>
  );
}
