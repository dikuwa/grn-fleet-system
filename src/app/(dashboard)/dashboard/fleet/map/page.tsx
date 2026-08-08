'use client';

/**
 * Fleet Map page — client shell.
 *
 * The map itself imports Leaflet, which reads `window` at import time. It is
 * loaded via `next/dynamic` with `ssr: false` (legal inside this Client
 * Component) so Leaflet only ever executes in the browser — fixing the
 * "window is not defined" crash that previously returned a 500 for this page.
 */

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

const FleetMapClient = dynamic(() => import('./fleet-map-client'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-8 w-8 animate-spin text-ink-400" />
    </div>
  ),
});

export default function FleetMapPage() {
  return <FleetMapClient />;
}
