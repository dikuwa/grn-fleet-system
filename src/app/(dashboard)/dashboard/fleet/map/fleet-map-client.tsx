'use client';

/**
 * FleetMapClient — the Leaflet map, loaded with `ssr: false` by page.tsx.
 *
 * Leaflet touches `window` at import time, so it can never be evaluated
 * during server rendering. Splitting this into a client-only dynamic import
 * fixes the SSR crash ("window is not defined") that made the map page
 * return 500 while keeping the exact same map experience.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FilterTabs } from '@/components/ui/filter-tabs';
import { Badge } from '@/components/ui/badge';
import { Car, AlertTriangle, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ResponsiveMapContainer, ResponsiveStatsGrid } from '@/components/ui/responsive';
import { fetchWithRetry } from '@/lib/fetch-with-retry';

interface VehicleMarker {
  id: string;
  licenceNumber: string;
  make: string;
  model: string;
  colour: string | null;
  status: string;
  currentOdometer: number;
  fuelType: string;
  office: { id: string | null; name: string; address: string | null };
  location: { lat: number; lng: number } | null;
  openDefects: number;
  markerColor: string;
}

const STATUS_FILTERS = [
  { value: 'all', label: 'All', dotClass: 'bg-ink-500' },
  { value: 'available', label: 'Available', dotClass: 'bg-status-success-text' },
  { value: 'issued', label: 'On Trip', dotClass: 'bg-status-info-text' },
  { value: 'maintenance', label: 'Maintenance', dotClass: 'bg-status-warning-text' },
  { value: 'out_of_service', label: 'Out of Service', dotClass: 'bg-status-error-text' },
] as const;

function statusBadgeVariant(status: string): 'success' | 'info' | 'warning' | 'error' | 'default' {
  switch (status) {
    case 'available':
      return 'success';
    case 'issued':
    case 'allocated':
      return 'info';
    case 'maintenance':
      return 'warning';
    case 'out_of_service':
    case 'written_off':
      return 'error';
    default:
      return 'default';
  }
}

/**
 * Build Leaflet popup content with DOM nodes instead of interpolated HTML.
 * Vehicle and office values are tenant data, so using textContent prevents
 * accidental HTML/script injection while preserving the same popup behavior.
 */
function createVehiclePopupContent(vehicle: VehicleMarker) {
  const container = document.createElement('div');
  container.style.minWidth = '200px';
  container.style.fontFamily = 'system-ui, sans-serif';

  const title = document.createElement('p');
  title.textContent = `${vehicle.make} ${vehicle.model}`;
  title.style.fontWeight = '600';
  title.style.margin = '0 0 4px';
  title.style.fontSize = '14px';
  container.appendChild(title);

  const addMeta = (label: string, value: string) => {
    const row = document.createElement('p');
    row.style.margin = '0 0 2px';
    row.style.fontSize = '12px';
    row.style.color = '#667085';
    row.textContent = label ? `${label}: ${value}` : value;
    container.appendChild(row);
  };

  addMeta('', vehicle.licenceNumber);
  addMeta('Status', vehicle.status.replace(/_/g, ' '));
  addMeta('Office', vehicle.office.name);

  if (vehicle.openDefects > 0) {
    const warning = document.createElement('p');
    warning.style.margin = '4px 0 0';
    warning.style.fontSize = '12px';
    warning.style.color = '#b42318';
    warning.style.fontWeight = '600';
    warning.textContent = `${vehicle.openDefects} open defect${vehicle.openDefects === 1 ? '' : 's'}`;
    container.appendChild(warning);
  }

  const link = document.createElement('a');
  link.href = `/dashboard/fleet/${encodeURIComponent(vehicle.id)}`;
  link.textContent = 'View Details';
  link.style.display = 'inline-block';
  link.style.marginTop = '8px';
  link.style.padding = '5px 10px';
  link.style.background = '#1F4E8C';
  link.style.color = '#ffffff';
  link.style.textDecoration = 'none';
  link.style.borderRadius = '6px';
  link.style.fontSize = '12px';
  link.style.fontWeight = '600';
  container.appendChild(link);

  return container;
}

export default function FleetMapClient() {
  const [vehicles, setVehicles] = useState<VehicleMarker[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    available: 0,
    onTrip: 0,
    maintenance: 0,
    outOfService: 0,
    withDefects: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleMarker | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);
  const fetched = useRef(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithRetry('/api/fleet/map');
      if (!res.ok) throw new Error('Failed to load map data');
      const json = await res.json();
      setVehicles(json.vehicles || []);
      setSummary(
        json.summary || {
          total: 0,
          available: 0,
          onTrip: 0,
          maintenance: 0,
          outOfService: 0,
          withDefects: 0,
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    void fetchData();
  }, [fetchData]);

  const renderMarkers = useCallback(
    (map: L.Map, vehiclesList: VehicleMarker[], statusFilter: string) => {
      markersRef.current.forEach((marker) => map.removeLayer(marker));
      markersRef.current = [];

      const filtered =
        statusFilter === 'all'
          ? vehiclesList
          : vehiclesList.filter((vehicle) => vehicle.status === statusFilter);

      filtered.forEach((vehicle) => {
        if (!vehicle.location) return;

        const marker = L.circleMarker([vehicle.location.lat, vehicle.location.lng], {
          radius: 10,
          fillColor: vehicle.markerColor,
          color: '#ffffff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.8,
        });

        marker.bindPopup(createVehiclePopupContent(vehicle));
        marker.on('click', () => setSelectedVehicle(vehicle));
        marker.addTo(map);
        markersRef.current.push(marker);
      });
    },
    [],
  );

  useEffect(() => {
    if (!mapRef.current) return;
    const resize = () =>
      window.requestAnimationFrame(() => mapInstanceRef.current?.invalidateSize());
    const observer = new ResizeObserver(resize);
    observer.observe(mapRef.current);
    window.addEventListener('orientationchange', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('orientationchange', resize);
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [-22.0, 17.0],
      zoom: 6,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || vehicles.length === 0) return;
    renderMarkers(map, vehicles, filterStatus);
  }, [vehicles, filterStatus, renderMarkers]);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Fleet', href: '/dashboard/fleet' },
          { label: 'Fleet Map' },
        ]}
      />
      <PageHeader
        title="Fleet Map"
        description="Vehicle positions by office and operational status"
      >
        <Badge variant="warning" size="sm" className="gap-1.5">
          <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
          Static positions — GPS is outside v1 scope
        </Badge>
        <Button variant="secondary" size="sm" onClick={() => void fetchData()} loading={loading}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh map
        </Button>
      </PageHeader>

      {loading ? (
        <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
          <Loader2
            className="text-ink-400 h-8 w-8 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span className="sr-only">Loading fleet map</span>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-16" role="alert">
          <AlertTriangle className="text-status-error-text h-8 w-8" aria-hidden="true" />
          <p className="text-ink-500 text-sm">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => void fetchData()}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <ResponsiveStatsGrid className="lg:grid-cols-5">
            <Card>
              <CardContent className="pt-3 text-center">
                <p className="text-ink-950 text-lg font-semibold tabular-nums">{summary.total}</p>
                <p className="text-ink-500 text-xs">Total</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 text-center">
                <p className="text-status-success-text text-lg font-semibold tabular-nums">
                  {summary.available}
                </p>
                <p className="text-ink-500 text-xs">Available</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 text-center">
                <p className="text-status-info-text text-lg font-semibold tabular-nums">
                  {summary.onTrip}
                </p>
                <p className="text-ink-500 text-xs">On Trip</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 text-center">
                <p className="text-status-warning-text text-lg font-semibold tabular-nums">
                  {summary.maintenance}
                </p>
                <p className="text-ink-500 text-xs">Maintenance</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 text-center">
                <p className="text-status-error-text text-lg font-semibold tabular-nums">
                  {summary.outOfService}
                </p>
                <p className="text-ink-500 text-xs">Out of Service</p>
              </CardContent>
            </Card>
          </ResponsiveStatsGrid>

          <div className="flex flex-col gap-4 lg:flex-row">
            <div className="min-w-0 flex-1">
              <ResponsiveMapContainer className="border-border h-[360px] border sm:h-[440px] lg:h-[500px]">
                <div ref={mapRef} className="h-full w-full" aria-label="Fleet vehicle map" />
              </ResponsiveMapContainer>
              {!vehicles.some((vehicle) => vehicle.location) && (
                <p
                  className="bg-muted text-ink-500 mt-2 rounded-[8px] px-3 py-2 text-sm"
                  role="status"
                >
                  No static or GPS positions are available for the current vehicles.
                </p>
              )}
            </div>

            <aside
              className="w-full space-y-3 lg:w-72"
              aria-label="Fleet map controls and selected vehicle"
            >
              <Card>
                <CardContent className="pt-3">
                  <FilterTabs
                    items={STATUS_FILTERS.map((option) => ({
                      value: option.value,
                      label: option.label,
                      icon: (
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${option.dotClass}`}
                          aria-hidden="true"
                        />
                      ),
                    }))}
                    value={filterStatus}
                    onValueChange={setFilterStatus}
                    label="Filter vehicles by status"
                  />
                </CardContent>
              </Card>

              {selectedVehicle && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Car className="h-4 w-4" aria-hidden="true" />
                      {selectedVehicle.make} {selectedVehicle.model}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      <p className="text-ink-500">{selectedVehicle.licenceNumber}</p>
                      <Badge variant={statusBadgeVariant(selectedVehicle.status)} size="sm">
                        {selectedVehicle.status.replace(/_/g, ' ')}
                      </Badge>
                      <p className="text-ink-500">Office: {selectedVehicle.office.name}</p>
                      <p className="text-ink-500">
                        Odometer: {selectedVehicle.currentOdometer.toLocaleString()} km
                      </p>
                      {selectedVehicle.openDefects > 0 && (
                        <p className="text-status-error-text flex items-center gap-1">
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                          {selectedVehicle.openDefects} open defect
                          {selectedVehicle.openDefects === 1 ? '' : 's'}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Legend</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-ink-500 space-y-1.5 text-xs">
                    {STATUS_FILTERS.slice(1).map((option) => (
                      <div key={option.value} className="flex items-center gap-2">
                        <span
                          className={`h-3 w-3 rounded-full ${option.dotClass}`}
                          aria-hidden="true"
                        />
                        {option.label}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
