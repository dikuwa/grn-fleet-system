'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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

export default function RouteMap({ routes }: RouteMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current, {
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);

    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || routes.length === 0) return;

    // Clear existing layers except the base tile layer
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.Polyline || layer instanceof L.CircleMarker) {
        map.removeLayer(layer);
      }
    });

    const bounds = L.latLngBounds([]);
    const colors = ['#1F4E8C', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0891B2'];

    routes.forEach((route, index) => {
      const color = colors[index % colors.length];

      // Decode polyline if available
      if (route.routePolyline) {
        try {
          const polylineCoords: [number, number][] = [];
          let index = 0;
          let lat = 0;
          let lng = 0;
          const polyline = route.routePolyline;

          while (index < polyline.length) {
            let b: number;
            let shift = 0;
            let result = 0;

            do {
              b = polyline.charCodeAt(index++) - 63;
              result |= (b & 0x1f) << shift;
              shift += 5;
            } while (b >= 0x20);

            const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
            lat += dlat;

            shift = 0;
            result = 0;
            do {
              b = polyline.charCodeAt(index++) - 63;
              result |= (b & 0x1f) << shift;
              shift += 5;
            } while (b >= 0x20);

            const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
            lng += dlng;

            polylineCoords.push([lat / 1e5, lng / 1e5]);
          }

          if (polylineCoords.length > 0) {
            const polylineLayer = L.polyline(polylineCoords, {
              color,
              weight: 3,
              opacity: 0.8,
            }).addTo(map);
            polylineCoords.forEach((c) => bounds.extend(c));
          }
        } catch {
          // Polyline decoding failed — fall back to marker-only
        }
      }

      // Origin marker
      const origCoords = route.originCoordinates;
      if (origCoords && typeof origCoords.lat === 'number' && typeof origCoords.lng === 'number') {
        const originMarker = L.circleMarker([origCoords.lat, origCoords.lng], {
          radius: 8,
          fillColor: color,
          color: '#ffffff',
          weight: 2,
          fillOpacity: 0.9,
        }).addTo(map);

        originMarker.bindPopup(`
          <div style="font-family: system-ui, sans-serif; min-width: 160px;">
            <p style="font-weight:600;margin:0 0 2px;font-size:13px;">Origin</p>
            <p style="margin:0 0 4px;font-size:12px;color:#666;">${route.originName || 'Unknown'}</p>
            <p style="margin:0;font-size:11px;color:#999;">${route.mappedDistanceKm ? `${route.mappedDistanceKm} km` : ''}${route.mappedDurationMinutes ? ` · ~${Math.round(route.mappedDurationMinutes / 60)}h${route.mappedDurationMinutes % 60}m` : ''}</p>
          </div>
        `);

        bounds.extend([origCoords.lat, origCoords.lng]);
      }

      // Destination marker
      const destCoords = route.destinationCoordinates;
      if (destCoords && typeof destCoords.lat === 'number' && typeof destCoords.lng === 'number') {
        const destMarker = L.circleMarker([destCoords.lat, destCoords.lng], {
          radius: 8,
          fillColor: color,
          color: '#ffffff',
          weight: 2,
          fillOpacity: 0.9,
          dashArray: '4',
        }).addTo(map);

        destMarker.bindPopup(`
          <div style="font-family: system-ui, sans-serif; min-width: 160px;">
            <p style="font-weight:600;margin:0 0 2px;font-size:13px;">Destination</p>
            <p style="margin:0;font-size:12px;color:#666;">${route.destinationName || 'Unknown'}</p>
          </div>
        `);

        bounds.extend([destCoords.lat, destCoords.lng]);
      }

      // Connect origin to destination with dashed line if no polyline
      if (!route.routePolyline && origCoords && destCoords &&
          typeof origCoords.lat === 'number' && typeof destCoords.lat === 'number') {
        L.polyline(
          [[origCoords.lat, origCoords.lng], [destCoords.lat, destCoords.lng]],
          { color, weight: 2, opacity: 0.5, dashArray: '6, 8' },
        ).addTo(map);
      }
    });

    // Fit bounds with padding
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    } else {
      // Default to Namibia
      map.setView([-22.0, 17.0], 6);
    }
  }, [routes]);

  return (
    <div
      ref={mapRef}
      className="h-[350px] w-full rounded-[8px] border border-border overflow-hidden"
      style={{ minHeight: '250px' }}
    />
  );
}
