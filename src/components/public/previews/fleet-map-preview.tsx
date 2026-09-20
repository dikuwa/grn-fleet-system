/**
 * FleetMapPreview — lightweight, static regional route visual.
 *
 * The public homepage uses a local vector map instead of initializing the
 * authenticated map client. This keeps the preview fast while matching the
 * red-start / green-destination treatment used by operational route maps.
 */

import { cn } from '@/lib/utils';

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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/home/route-map-rundu-divundu.svg"
        alt="Illustrative Rundu to Divundu route map with a red start marker, green destination marker and blue route"
        width={800}
        height={340}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />

      <div className="border-border absolute right-2 bottom-2 flex items-center gap-2 rounded-[7px] border bg-white/92 px-2 py-1.5 shadow-sm backdrop-blur-sm">
        <LegendItem color="#dc2626" label="Start" />
        <LegendItem color="#059669" label="Destination" />
        <span className="flex items-center gap-1 text-[9px] text-slate-600">
          <span className="h-0.5 w-3 rounded-full bg-[#2563eb]" aria-hidden="true" />
          Route
        </span>
      </div>
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
