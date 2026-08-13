'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LocateFixed, MapPinned, RotateCcw } from 'lucide-react';

interface RouteData {
  id: string;
  originName: string | null;
  destinationName: string | null;
  originCoordinates: { lat: number; lng: number } | null;
  destinationCoordinates: { lat: number; lng: number } | null;
  routePolyline: string | null;
  mappedDistanceKm: number | null;
  mappedDurationMinutes: number | null;
  totalKilometres: number;
}

interface RouteMapProps {
  routes: RouteData[];
}

type LatLngLiteral = { lat: number; lng: number };

type GoogleMap = {
  fitBounds: (bounds: GoogleBounds, padding?: number | { top: number; right: number; bottom: number; left: number }) => void;
  setCenter: (center: LatLngLiteral) => void;
  setZoom: (zoom: number) => void;
};

type GoogleBounds = {
  extend: (point: LatLngLiteral) => GoogleBounds;
  isEmpty: () => boolean;
};

type GoogleMarker = {
  addListener: (eventName: string, handler: () => void) => unknown;
  setMap: (map: GoogleMap | null) => void;
};

type GooglePolyline = {
  setMap: (map: GoogleMap | null) => void;
};

type GoogleInfoWindow = {
  open: (options: { map: GoogleMap; anchor: GoogleMarker }) => void;
  close: () => void;
};

type GoogleMapsApi = {
  Map: new (
    element: HTMLElement,
    options: {
      center: LatLngLiteral;
      zoom: number;
      mapId?: string;
      mapTypeControl: boolean;
      streetViewControl: boolean;
      fullscreenControl: boolean;
      zoomControl: boolean;
      scaleControl: boolean;
      clickableIcons: boolean;
      gestureHandling: 'cooperative';
      backgroundColor: string;
    },
  ) => GoogleMap;
  LatLngBounds: new () => GoogleBounds;
  Marker: new (options: {
    map: GoogleMap;
    position: LatLngLiteral;
    title: string;
    label?: { text: string; color: string; fontWeight: string; fontSize: string };
    zIndex?: number;
  }) => GoogleMarker;
  Polyline: new (options: {
    map: GoogleMap;
    path: LatLngLiteral[];
    strokeColor: string;
    strokeOpacity: number;
    strokeWeight: number;
    geodesic: boolean;
  }) => GooglePolyline;
  InfoWindow: new (options: { content: string }) => GoogleInfoWindow;
};

declare global {
  interface Window {
    google?: {
      maps?: GoogleMapsApi & Record<string, unknown>;
    };
  }
}

let googleMapsPromise: Promise<GoogleMapsApi> | null = null;

function waitForGoogleMaps(timeoutMs = 12_000): Promise<GoogleMapsApi> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      const maps = window.google?.maps;
      if (maps?.Map && maps.LatLngBounds && maps.Marker && maps.Polyline && maps.InfoWindow) {
        resolve(maps);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('Google Maps did not become ready in time.'));
        return;
      }
      window.setTimeout(check, 50);
    };
    check();
  });
}

function loadGoogleMaps(): Promise<GoogleMapsApi> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps is only available in the browser.'));
  }

  const readyMaps = window.google?.maps;
  if (readyMaps?.Map && readyMaps.LatLngBounds && readyMaps.Marker && readyMaps.Polyline && readyMaps.InfoWindow) {
    return Promise.resolve(readyMaps);
  }
  if (googleMapsPromise) return googleMapsPromise;

  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  if (!key) {
    return Promise.reject(new Error('Google Maps browser key is not configured.'));
  }

  googleMapsPromise = new Promise<GoogleMapsApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-maps-js-api]');
    if (existing) {
      waitForGoogleMaps().then(resolve).catch(reject);
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&v=weekly&language=en&region=NA`;
    script.async = true;
    script.defer = true;
    script.dataset.mapsJsApi = 'true';
    script.addEventListener('load', () => {
      waitForGoogleMaps().then(resolve).catch(reject);
    });
    script.addEventListener('error', () => {
      googleMapsPromise = null;
      script.remove();
      reject(new Error('Google Maps script failed to load.'));
    });
    document.head.appendChild(script);
  }).catch((error) => {
    googleMapsPromise = null;
    throw error;
  });

  return googleMapsPromise;
}

function decodePolyline(polyline: string): LatLngLiteral[] {
  const coordinates: LatLngLiteral[] = [];
  let cursor = 0;
  let latitude = 0;
  let longitude = 0;

  while (cursor < polyline.length) {
    let byte: number;
    let shift = 0;
    let result = 0;

    do {
      byte = polyline.charCodeAt(cursor++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && cursor <= polyline.length);

    latitude += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;

    do {
      byte = polyline.charCodeAt(cursor++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && cursor <= polyline.length);

    longitude += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    coordinates.push({ lat: latitude / 1e5, lng: longitude / 1e5 });
  }

  return coordinates;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDuration(minutes: number | null): string {
  if (!minutes) return '';
  const hours = Math.floor(minutes / 60);
  const remaining = Math.round(minutes % 60);
  if (!hours) return `~${remaining}m`;
  return `~${hours}h${remaining ? ` ${remaining}m` : ''}`;
}

const ROUTE_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];
const NAMIBIA_CENTER = { lat: -22.5609, lng: 17.0658 };

export default function RouteMap({ routes }: RouteMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<GoogleMap | null>(null);
  const boundsRef = useRef<GoogleBounds | null>(null);
  const overlaysRef = useRef<Array<GoogleMarker | GooglePolyline>>([]);
  const infoWindowsRef = useRef<GoogleInfoWindow[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retryKey, setRetryKey] = useState(0);

  const fitRoute = useCallback(() => {
    const map = mapInstanceRef.current;
    const bounds = boundsRef.current;
    if (!map || !bounds || bounds.isEmpty()) return;
    map.fitBounds(bounds, { top: 56, right: 56, bottom: 56, left: 56 });
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    let cancelled = false;

    setLoadState('loading');
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !mapRef.current) return;
        const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;
        mapInstanceRef.current = new maps.Map(mapRef.current, {
          center: NAMIBIA_CENTER,
          zoom: 6,
          ...(mapId ? { mapId } : {}),
          mapTypeControl: true,
          streetViewControl: true,
          fullscreenControl: true,
          zoomControl: true,
          scaleControl: true,
          clickableIcons: true,
          gestureHandling: 'cooperative',
          backgroundColor: '#e5e7eb',
        });
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });

    return () => {
      cancelled = true;
      for (const overlay of overlaysRef.current) overlay.setMap(null);
      for (const infoWindow of infoWindowsRef.current) infoWindow.close();
      overlaysRef.current = [];
      infoWindowsRef.current = [];
      boundsRef.current = null;
      mapInstanceRef.current = null;
    };
  }, [retryKey]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || loadState !== 'ready') return;

    let disposed = false;

    loadGoogleMaps().then((maps) => {
      if (disposed || !mapInstanceRef.current) return;

      for (const overlay of overlaysRef.current) overlay.setMap(null);
      for (const infoWindow of infoWindowsRef.current) infoWindow.close();
      overlaysRef.current = [];
      infoWindowsRef.current = [];

      const bounds = new maps.LatLngBounds();
      boundsRef.current = bounds;

      routes.forEach((route, routeIndex) => {
        const color = ROUTE_COLORS[routeIndex % ROUTE_COLORS.length];
        const path = route.routePolyline ? decodePolyline(route.routePolyline) : [];

        if (path.length > 1) {
          const polyline = new maps.Polyline({
            map,
            path,
            strokeColor: color,
            strokeOpacity: 0.92,
            strokeWeight: 5,
            geodesic: true,
          });
          overlaysRef.current.push(polyline);
          path.forEach((point) => bounds.extend(point));
        }

        const endpoints: Array<{
          kind: 'Origin' | 'Destination';
          name: string;
          coordinates: LatLngLiteral | null;
          label: string;
        }> = [
          {
            kind: 'Origin',
            name: route.originName || 'Origin',
            coordinates: route.originCoordinates,
            label: 'A',
          },
          {
            kind: 'Destination',
            name: route.destinationName || 'Destination',
            coordinates: route.destinationCoordinates,
            label: 'B',
          },
        ];

        endpoints.forEach((endpoint) => {
          if (!endpoint.coordinates) return;
          const marker = new maps.Marker({
            map,
            position: endpoint.coordinates,
            title: `${endpoint.kind}: ${endpoint.name}`,
            label: {
              text: endpoint.label,
              color: '#ffffff',
              fontWeight: '700',
              fontSize: '12px',
            },
            zIndex: endpoint.kind === 'Origin' ? 20 : 21,
          });

          const detailBits = [
            route.mappedDistanceKm ? `${Math.round(route.mappedDistanceKm)} km` : '',
            formatDuration(route.mappedDurationMinutes),
          ].filter(Boolean);
          const infoWindow = new maps.InfoWindow({
            content: `<div style="min-width:190px;padding:4px 2px;font-family:system-ui,-apple-system,sans-serif;color:#111827"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:3px">${endpoint.kind}</div><div style="font-size:14px;font-weight:700;line-height:1.25">${escapeHtml(endpoint.name)}</div>${detailBits.length ? `<div style="margin-top:6px;font-size:12px;color:#4b5563">${detailBits.join(' · ')}</div>` : ''}</div>`,
          });
          marker.addListener('click', () => {
            for (const openWindow of infoWindowsRef.current) openWindow.close();
            infoWindow.open({ map, anchor: marker });
          });
          overlaysRef.current.push(marker);
          infoWindowsRef.current.push(infoWindow);
          bounds.extend(endpoint.coordinates);
        });

        if (path.length < 2 && route.originCoordinates && route.destinationCoordinates) {
          const fallbackLine = new maps.Polyline({
            map,
            path: [route.originCoordinates, route.destinationCoordinates],
            strokeColor: color,
            strokeOpacity: 0.55,
            strokeWeight: 3,
            geodesic: true,
          });
          overlaysRef.current.push(fallbackLine);
          bounds.extend(route.originCoordinates);
          bounds.extend(route.destinationCoordinates);
        }
      });

      if (!bounds.isEmpty()) {
        window.requestAnimationFrame(fitRoute);
      } else {
        map.setCenter(NAMIBIA_CENTER);
        map.setZoom(6);
      }
    });

    return () => {
      disposed = true;
    };
  }, [fitRoute, loadState, routes]);

  return (
    <div className="relative h-[350px] min-h-[250px] w-full overflow-hidden rounded-[8px] border border-border bg-muted/40 sm:h-[420px]">
      <div ref={mapRef} className="absolute inset-0" aria-label="Interactive route map" />

      {loadState === 'loading' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/90 backdrop-blur-sm">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
            <MapPinned className="h-4 w-4 animate-pulse" />
            Loading interactive map…
          </div>
        </div>
      )}

      {loadState === 'error' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted/70 p-6">
          <div className="max-w-sm rounded-xl border border-border bg-card p-5 text-center shadow-sm">
            <MapPinned className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Interactive map unavailable</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              The route data is still available below. Check the Google Maps browser key or network connection.
            </p>
            <button
              type="button"
              onClick={() => setRetryKey((value) => value + 1)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Retry map
            </button>
          </div>
        </div>
      )}

      {loadState === 'ready' && routes.length > 0 && (
        <button
          type="button"
          onClick={fitRoute}
          className="absolute bottom-6 left-3 z-[1] inline-flex items-center gap-1.5 rounded-md border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-md transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:left-4"
          aria-label="Fit the complete route on the map"
        >
          <LocateFixed className="h-4 w-4" />
          Fit route
        </button>
      )}
    </div>
  );
}
