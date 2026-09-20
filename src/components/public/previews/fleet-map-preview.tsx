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
        'border-border relative w-full overflow-hidden rounded-[10px] border bg-[#eef0e8] dark:bg-[#151b1f]',
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
        <rect
          width="100"
          height="70"
          fill="currentColor"
          className="text-[#eef0e8] dark:text-[#151b1f]"
        />

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
          d="M10 40 C 23 37, 30 38, 41 36 C 53 34, 59 29, 69 29 C 78 29, 84 32, 94 34"
          fill="none"
          stroke="var(--color-surface)"
          strokeWidth="3.4"
          opacity="0.95"
        />
        <path
          d="M10 40 C 23 37, 30 38, 41 36 C 53 34, 59 29, 69 29 C 78 29, 84 32, 94 34"
          fill="none"
          stroke="var(--color-ink-400)"
          strokeWidth="1"
          opacity="0.75"
        />

        {/* Active route: a fine, outlined road treatment keeps the trip path
            legible at both hero and section-preview sizes without looking like
            a blunt connector. */}
        <path
          d="M18 38 C 27 37, 34 38, 43 36 C 52 34, 58 30, 67 30 C 75 30, 80 32, 86 33"
          fill="none"
          stroke="var(--color-surface)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M18 38 C 27 37, 34 38, 43 36 C 52 34, 58 30, 67 30 C 75 30, 80 32, 86 33"
          fill="none"
          stroke="var(--color-brand-700)"
          strokeWidth="1.15"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Origin marker */}
        <circle
          cx="18"
          cy="38"
          r="3"
          fill="var(--color-surface)"
          stroke="var(--color-brand-700)"
          strokeWidth="0.7"
        />
        <circle cx="18" cy="38" r="1.25" fill="var(--color-brand-700)" />

        {/* Destination pin */}
        <path
          d="M86 27.3c-2.15 0-3.65 1.55-3.65 3.55 0 2.45 3.65 6.3 3.65 6.3s3.65-3.85 3.65-6.3c0-2-1.5-3.55-3.65-3.55Z"
          fill="var(--color-brand-800)"
          stroke="var(--color-surface)"
          strokeWidth="0.65"
        />
        <circle cx="86" cy="30.85" r="1.05" fill="var(--color-surface)" />

        {/* Labels */}
        <g fontFamily="var(--font-sans)" fill="var(--color-ink-600)">
          <text x="12" y="33" fontSize="4" fontWeight="600">
            Rundu
          </text>
          <text x="78" y="23" fontSize="4" fontWeight="600">
            Divundu
          </text>
          <text x="53" y="26" fontSize="2.7">
            B8
          </text>
          <text x="39" y="8" fontSize="2.4" opacity="0.75">
            Kavango River
          </text>
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
            <span className="border-border text-ink-700 mt-1 rounded border bg-[var(--color-surface)]/95 px-1.5 py-0.5 font-mono text-[9px] shadow-sm backdrop-blur-sm">
              {m.label}
            </span>
          </div>
        </div>
      ))}

      <div className="border-border text-ink-600 absolute top-2 left-2 rounded-[7px] border bg-[var(--color-surface)]/92 px-2 py-1 text-[9px] font-medium shadow-sm backdrop-blur-sm">
        Rundu → Divundu · active route
      </div>

      <div className="border-border absolute right-2 bottom-2 flex items-center gap-2 rounded-[7px] border bg-[var(--color-surface)]/92 px-2 py-1.5 backdrop-blur-sm">
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
