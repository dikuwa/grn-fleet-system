/**
 * FleetMapPreview — a lightweight, static fleet-map visual.
 *
 * Pure SVG with demo coordinates and sanitised markers — never initialises
 * the real dashboard map and never touches tenant data. Uses theme tokens so
 * it stays legible in both light and dark mode.
 */

import { cn } from '@/lib/utils';

interface Marker {
  id: string;
  label: string;
  x: number;
  y: number;
  status: 'active' | 'idle' | 'maintenance';
}

const DEMO_MARKERS: Marker[] = [
  { id: 'v1', label: 'KD-021', x: 24, y: 38, status: 'active' },
  { id: 'v2', label: 'KD-044', x: 58, y: 24, status: 'active' },
  { id: 'v3', label: 'KD-007', x: 74, y: 52, status: 'maintenance' },
  { id: 'v4', label: 'KD-112', x: 40, y: 66, status: 'idle' },
  { id: 'v5', label: 'KD-050', x: 86, y: 30, status: 'active' },
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
        'relative w-full overflow-hidden rounded-[10px] border border-border bg-[var(--color-canvas)]',
        className,
      )}
    >
      {/* Road-grid backdrop */}
      <svg
        viewBox="0 0 100 70"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label="Illustrative fleet map with vehicle markers"
      >
        {/* Grid lines */}
        <g stroke="var(--color-border)" strokeWidth="0.25" opacity="0.6">
          {[0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100].map((x) => (
            <line key={`v${x}`} x1={x} y1="0" x2={x} y2="70" />
          ))}
          {[0, 10, 20, 30, 40, 50, 60, 70].map((y) => (
            <line key={`h${y}`} x1="0" y1={y} x2="100" y2={y} />
          ))}
        </g>
        {/* Road arcs */}
        <g fill="none" stroke="var(--color-brand-300)" strokeWidth="1.6" strokeLinecap="round">
          <path d="M8 62 C 30 55, 40 30, 66 26" />
          <path d="M18 8 C 26 24, 50 40, 88 44" />
          <path d="M2 18 C 20 12, 40 14, 52 6" />
        </g>
        {/* Active route path */}
        <path
          d="M24 38 C 36 34, 48 30, 58 24"
          fill="none"
          stroke="var(--color-brand-600)"
          strokeWidth="1.4"
          strokeDasharray="2.5 1.8"
        />
        {/* Region label */}
        <text
          x="50"
          y="64"
          textAnchor="middle"
          fontSize="2.6"
          fill="var(--color-ink-400)"
          fontFamily="var(--font-family-document)"
        >
          KAVANGO EAST · OPERATIONS
        </text>
      </svg>

      {/* Marker layer (HTML for crisp labels) */}
      {DEMO_MARKERS.map((m) => (
        <div
          key={m.id}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${m.x}%`, top: `${m.y}%` }}
        >
          <div className="relative flex flex-col items-center">
            <span
              className="block h-2.5 w-2.5 rounded-full border-2 border-[var(--color-surface)] shadow-sm"
              style={{ backgroundColor: STATUS_COLOR[m.status] }}
            />
            <span className="mt-1 rounded border border-border bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[10px] text-ink-700 shadow-sm">
              {m.label}
            </span>
          </div>
        </div>
      ))}

      {/* Legend */}
      <div className="absolute bottom-2 right-2 flex items-center gap-3 rounded-[8px] border border-border bg-[var(--color-surface)]/95 px-2.5 py-1.5">
        <LegendItem color="var(--color-status-success-text)" label="On trip" />
        <LegendItem color="var(--color-ink-400)" label="Idle" />
        <LegendItem color="var(--color-status-warning-text)" label="Service" />
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-ink-500">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
