/**
 * FleetMapPreview — lightweight static route visual for the public homepage.
 *
 * Uses locally bundled WebP route maps so the homepage remains fast, reliable
 * and independent of third-party map/image hosts.
 */

import { cn } from '@/lib/utils';

export interface FleetMapPreviewProps {
  className?: string;
  variant?: 'hero' | 'visibility';
}

const MAPS = {
  hero: {
    src: '/images/home/route-map-hero.webp',
    alt: 'Route map from Rundu to Divundu in north-eastern Namibia',
    route: 'Rundu → Divundu',
  },
  visibility: {
    src: '/images/home/route-map-visibility.webp',
    alt: 'Route map from Swakopmund to Otjiwarongo in Namibia',
    route: 'Swakopmund → Otjiwarongo',
  },
} as const;

export function FleetMapPreview({
  className,
  variant = 'hero',
}: FleetMapPreviewProps) {
  const map = MAPS[variant];

  return (
    <div
      className={cn(
        'border-border bg-muted relative w-full overflow-hidden rounded-[10px] border',
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={map.src}
        alt={map.alt}
        width={640}
        height={360}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />

      <div className="absolute top-2 left-2 max-w-[72%] rounded-[6px] border border-white/60 bg-white/88 px-2 py-1 shadow-sm backdrop-blur-[2px]">
        <p className="truncate text-[8px] leading-none font-medium text-slate-800 sm:text-[9px]">
          {map.route}
        </p>
        <p className="mt-1 text-[7px] leading-none font-normal text-slate-500 sm:text-[8px]">
          Active route
        </p>
      </div>
    </div>
  );
}
