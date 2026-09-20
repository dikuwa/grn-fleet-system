/**
 * FleetMapPreview — lightweight regional route visual for the public homepage.
 *
 * The base is a real OpenStreetMap render centred on the Rundu–Divundu corridor.
 * Only the active route and endpoint markers are overlaid so surrounding roads,
 * towns and geographic context remain visible.
 */

import { cn } from '@/lib/utils';

export interface FleetMapPreviewProps {
  className?: string;
}

const MAP_URL =
  'https://staticmap.openstreetmap.de/staticmap.php?center=-18.02,20.64&zoom=8&size=800x340&maptype=mapnik';

export function FleetMapPreview({ className }: FleetMapPreviewProps) {
  return (
    <div
      className={cn(
        'border-border bg-muted relative w-full overflow-hidden rounded-[10px] border',
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={MAP_URL}
        alt="OpenStreetMap view of the Rundu to Divundu corridor in north-eastern Namibia"
        width={800}
        height={340}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />

      <svg
        viewBox="0 0 800 340"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <path
          d="M132 171 C 191 166, 252 163, 313 159 C 376 155, 435 151, 493 148 C 553 145, 612 146, 675 151"
          fill="none"
          stroke="rgba(255,255,255,.92)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M132 171 C 191 166, 252 163, 313 159 C 376 155, 435 151, 493 148 C 553 145, 612 146, 675 151"
          fill="none"
          stroke="#2563eb"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <g>
          <circle cx="132" cy="171" r="8.5" fill="white" opacity=".96" />
          <circle cx="132" cy="171" r="5.2" fill="#dc2626" />
          <circle cx="675" cy="151" r="8.5" fill="white" opacity=".96" />
          <circle cx="675" cy="151" r="5.2" fill="#059669" />
        </g>
      </svg>

      <div className="border-border absolute top-2 left-2 rounded-[7px] border bg-white/92 px-2.5 py-1.5 shadow-sm backdrop-blur-sm">
        <p className="text-[9px] font-semibold leading-none text-slate-800">Rundu → Divundu</p>
        <p className="mt-1 text-[8px] leading-none text-slate-500">Active route · 352 km</p>
      </div>

      <div className="border-border absolute right-2 bottom-2 flex items-center gap-2 rounded-[7px] border bg-white/92 px-2 py-1.5 shadow-sm backdrop-blur-sm">
        <LegendItem color="#dc2626" label="Start" />
        <LegendItem color="#059669" label="Destination" />
        <span className="flex items-center gap-1 text-[9px] text-slate-600">
          <span className="h-0.5 w-3 rounded-full bg-[#2563eb]" aria-hidden="true" />
          Route
        </span>
      </div>

      <span className="absolute bottom-1 left-2 text-[7px] font-medium text-slate-600/80 [text-shadow:0_1px_2px_white]">
        © OpenStreetMap contributors
      </span>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[9px] text-slate-600">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
