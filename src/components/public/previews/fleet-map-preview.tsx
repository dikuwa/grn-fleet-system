/**
 * FleetMapPreview — lightweight, static regional route visual.
 *
 * The public hero must not initialise the authenticated Leaflet map or expose
 * tenant coordinates. This SVG therefore uses sanitised demo data but is drawn
 * like a real regional map: roads, the Kavango river, town labels, a route and
 * live fleet markers instead of an abstract grid.
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
  { id: 'v1', label: 'KD-021', x: 27, y: 48, status: 'active' },
  { id: 'v2', label: 'KD-044', x: 63, y: 38, status: 'active' },
  { id: 'v3', label: 'KD-007', x: 76, y: 57, status: 'maintenance' },
  { id: 'v4', label: 'KD-112', x: 45, y: 67, status: 'idle' },
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
        'relative w-full overflow-hidden rounded-[10px] border border-border bg-[#eef0e8] dark:bg-[#151b1f]',
        className,
      )}
    >
      <svg
        viewBox="0 0 100 70"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label="Illustrative Kavango East regional fleet route between Rundu and Divundu"
      >
        <rect width="100" height="70" fill="currentColor" className="text-[#eef0e8] dark:text-[#151b1f]" />

        {/* River / terrain */}
        <path
          d="M-5 12 C 12 7, 28 16, 43 11 S 70 5, 108 12"
          fill="none"
          stroke="var(--color-brand-300)"
          strokeWidth="3"
          opacity="0.55"
        />
        <path
          d="M-5 13 C 12 8, 28 17, 43 12 S 70 6, 108 13"
          fill="none"
          stroke="var(--color-surface)"
          strokeWidth="0.8"
          opacity="0.7"
        />

        {/* Secondary road network */}
        <g fill="none" stroke="var(--color-ink-300)" strokeWidth="0.45" opacity="0.65">
          <path d="M8 61 C 20 53, 22 41, 27 31 C 31 24, 39 21, 48 18" />
          <path d="M18 69 C 28 60, 39 54, 51 51 C 63 48, 80 49, 94 42" />
          <path d="M33 69 C 38 56, 44 47, 54 38 C 65 28, 76 24, 95 24" />
          <path d="M2 44 C 18 41, 29 43, 39 48 C 50 53, 62 60, 98 61" />
          <path d="M53 16 C 50 26, 53 35, 62 42 C 72 50, 80 57, 82 69" />
        </g>

        {/* Major B8 corridor */}
        <path
          d="M12 36 C 27 34, 39 35, 51 33 C 64 31, 74 30, 91 32"
          fill="none"
          stroke="var(--color-surface)"
          strokeWidth="3.3"
          opacity="0.95"
        />
        <path
          d="M12 36 C 27 34, 39 35, 51 33 C 64 31, 74 30, 91 32"
          fill="none"
          stroke="var(--color-ink-400)"
          strokeWidth="1.2"
          opacity="0.75"
        />

        {/* Active route */}
        <path
          d="M18 36 C 31 35, 43 35, 54 33 C 66 31, 76 30, 86 31"
          fill="none"
          stroke="var(--color-brand-700)"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <circle cx="18" cy="36" r="2.2" fill="var(--color-brand-700)" />
        <circle cx="86" cy="31" r="2.2" fill="var(--color-brand-700)" />

        {/* Labels */}
        <g fontFamily="var(--font-sans)" fill="var(--color-ink-600)">
          <text x="13" y="31" fontSize="4" fontWeight="600">Rundu</text>
          <text x="79" y="26" fontSize="4" fontWeight="600">Divundu</text>
          <text x="50" y="29" fontSize="2.7">B8</text>
          <text x="39" y="8" fontSize="2.4" opacity="0.75">Kavango River</text>
        </g>
      </svg>

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
            <span className="mt-1 rounded border border-border bg-[var(--color-surface)]/95 px-1.5 py-0.5 font-mono text-[9px] text-ink-700 shadow-sm backdrop-blur-sm">
              {m.label}
            </span>
          </div>
        </div>
      ))}

      <div className="absolute left-2 top-2 rounded-[7px] border border-border bg-[var(--color-surface)]/92 px-2 py-1 text-[9px] font-medium text-ink-600 shadow-sm backdrop-blur-sm">
        Rundu → Divundu · active route
      </div>

      <div className="absolute bottom-2 right-2 flex items-center gap-2 rounded-[7px] border border-border bg-[var(--color-surface)]/92 px-2 py-1.5 backdrop-blur-sm">
        <LegendItem color="var(--color-status-success-text)" label="On trip" />
        <LegendItem color="var(--color-ink-400)" label="Idle" />
        <LegendItem color="var(--color-status-warning-text)" label="Service" />
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[9px] text-ink-500">
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      {label}
    </span>
  );
}
