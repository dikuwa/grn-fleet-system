/**
 * FleetMapPreview — lightweight, static regional route visual.
 *
 * The public hero must not initialise the authenticated Google map or expose
 * tenant coordinates. This preview therefore uses a locally bundled,
 * Namibia-focused map image with sanitised demo labels and lightweight fleet
 * status markers.
 */

import Image from 'next/image';
import { cn } from '@/lib/utils';

interface Marker {
  id: string;
  label: string;
  x: number;
  y: number;
  status: 'active' | 'idle' | 'maintenance';
}

const DEMO_MARKERS: Marker[] = [
  { id: 'v1', label: 'KD-021', x: 29, y: 46, status: 'active' },
  { id: 'v2', label: 'KD-044', x: 62, y: 42, status: 'active' },
  { id: 'v3', label: 'KD-007', x: 76, y: 60, status: 'maintenance' },
  { id: 'v4', label: 'KD-112', x: 48, y: 67, status: 'idle' },
];

const STATUS_COLOR: Record<Marker['status'], string> = {
  active: 'var(--color-status-success-text)',
  idle: 'var(--color-ink-400)',
  maintenance: 'var(--color-status-warning-text)',
};

export interface FleetMapPreviewProps {
  className?: string;
}

export function FleetMapPreview({ className }: FleetMapPreviewProps) {
  return (
    <div
      className={cn(
        'border-border bg-muted relative w-full overflow-hidden rounded-[10px] border',
        className,
      )}
    >
      <Image
        src="/images/home/fleet-route-map.webp"
        alt="Illustrative Namibia road map showing a route from Rundu to Divundu with a red start marker and green destination marker"
        fill
        sizes="(max-width: 767px) 92vw, 520px"
        className="object-fill dark:brightness-[0.78] dark:saturate-[0.9]"
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/0 via-white/0 to-white/5 dark:from-slate-950/5 dark:via-slate-950/5 dark:to-slate-950/15"
      />

      {DEMO_MARKERS.map((marker) => (
        <div
          key={marker.id}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
        >
          <div className="relative flex flex-col items-center">
            <span
              className="block h-2 w-2 rounded-full border border-[var(--color-surface)] shadow-sm"
              style={{ backgroundColor: STATUS_COLOR[marker.status] }}
              aria-hidden="true"
            />
            <span className="border-border text-ink-700 mt-1 rounded border bg-[var(--color-surface)]/92 px-1.5 py-0.5 font-mono text-[8px] shadow-sm backdrop-blur-sm">
              {marker.label}
            </span>
          </div>
        </div>
      ))}

      <div className="border-border text-ink-700 absolute top-2 left-2 rounded-[7px] border bg-[var(--color-surface)]/94 px-2 py-1 text-[9px] font-medium shadow-sm backdrop-blur-sm">
        Rundu → Divundu · active route
      </div>

      <div className="border-border absolute right-2 bottom-2 flex items-center gap-2 rounded-[7px] border bg-[var(--color-surface)]/94 px-2 py-1.5 backdrop-blur-sm">
        <LegendItem color="var(--color-status-success-text)" label="On trip" />
        <LegendItem color="var(--color-ink-400)" label="Idle" />
        <LegendItem color="var(--color-status-warning-text)" label="Service" />
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="text-ink-500 flex items-center gap-1 text-[9px]">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
