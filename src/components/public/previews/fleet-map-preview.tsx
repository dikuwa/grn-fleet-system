/**
 * FleetMapPreview — lightweight local route visual for the public homepage.
 *
 * Marketing route imagery is bundled with the app so the homepage has no
 * third-party map/image dependency. The two variants match the routes shown
 * in the approved demo assets.
 */

import { cn } from '@/lib/utils';

export interface FleetMapPreviewProps {
  className?: string;
  variant?: 'hero' | 'visibility';
}

const MAPS = {
  hero: {
    src: '/images/home/hero-route-map.webp',
    alt: 'Map showing the active route from Rundu to Divundu in north-eastern Namibia',
    route: 'Rundu → Divundu',
  },
  visibility: {
    src: '/images/home/visibility-route-map.webp',
    alt: 'Map showing the active route from Swakopmund to Otjiwarongo in Namibia',
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
        width={560}
        height={315}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />

      <div className="border-border/70 absolute top-1.5 left-1.5 max-w-[72%] rounded-[6px] border bg-white/88 px-2 py-1 shadow-sm backdrop-blur-[1px] sm:top-2 sm:left-2">
        <p className="truncate text-[8px] leading-none font-medium text-slate-700 sm:text-[9px]">
          {map.route}
        </p>
        <p className="mt-0.5 text-[7px] leading-none font-normal text-slate-500 sm:text-[8px]">
          Active route
        </p>
      </div>
    </div>
  );
}
