'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  MapPin, Car, AlertTriangle, Loader2,
  RefreshCw, WifiOff,
} from 'lucide-react';
import Link from 'next/link';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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

export default function FleetMapPage() {
  const [vehicles, setVehicles] = useState<VehicleMarker[]>([]);
  const [summary, setSummary] = useState({ total: 0, available: 0, onTrip: 0, maintenance: 0, outOfService: 0, withDefects: 0 });
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
      const res = await fetch('/api/fleet/map');
      if (!res.ok) throw new Error('Failed to load map data');
      const json = await res.json();
      setVehicles(json.vehicles || []);
      setSummary(json.summary || { total: 0, available: 0, onTrip: 0, maintenance: 0, outOfService: 0, withDefects: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    fetchData();
  }, [fetchData]);

  const renderMarkers = useCallback((map: L.Map, vehiclesList: VehicleMarker[], statusFilter: string) => {
    // Clear old markers
    markersRef.current.forEach((m) => map.removeLayer(m));
    markersRef.current = [];

    const filtered = statusFilter === 'all'
      ? vehiclesList
      : vehiclesList.filter((v) => v.status === statusFilter);

    filtered.forEach((v) => {
      if (!v.location) return;

      const marker = L.circleMarker([v.location.lat, v.location.lng], {
        radius: 10,
        fillColor: v.markerColor,
        color: '#ffffff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.8,
      });

      marker.bindPopup(`
        <div style="font-family: system-ui, sans-serif; min-width: 200px;">
          <p style="font-weight: 600; margin: 0 0 4px; font-size: 14px;">
            ${v.make} ${v.model}
          </p>
          <p style="margin: 0 0 2px; font-size: 12px; color: #666;">
            ${v.licenceNumber}
          </p>
          <p style="margin: 0 0 2px; font-size: 12px; color: #666;">
            Status: <strong>${v.status.replace(/_/g, ' ')}</strong>
          </p>
          <p style="margin: 0 0 2px; font-size: 12px; color: #666;">
            Office: ${v.office.name}
          </p>
          ${v.openDefects > 0 ? `<p style="margin: 0; font-size: 12px; color: #dc2626;">⚠ ${v.openDefects} open defect(s)</p>` : ''}
          <a href="/dashboard/fleet/${v.id}" style="display: inline-block; margin-top: 8px; padding: 4px 12px; background: #1F4E8C; color: white; text-decoration: none; border-radius: 6px; font-size: 12px;">
            View Details
          </a>
        </div>
      `);

      marker.on('click', () => {
        setSelectedVehicle(v);
      });

      marker.addTo(map);
      markersRef.current.push(marker);
    });
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [-22.0, 17.0],
      zoom: 6,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Render markers when vehicles or filter change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || vehicles.length === 0) return;
    renderMarkers(map, vehicles, filterStatus);
  }, [vehicles, filterStatus, renderMarkers]);

  const statusColor = (s: string): string => {
    switch (s) {
      case 'available': return 'bg-green-500';
      case 'issued': case 'allocated': return 'bg-blue-500';
      case 'maintenance': return 'bg-amber-500';
      case 'out_of_service': case 'written_off': return 'bg-red-500';
      default: return 'bg-gray-300';
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Fleet', href: '/dashboard/fleet' },
        { label: 'Fleet Map' },
      ]} />
      <PageHeader
        title="Fleet Map"
        description="Live view of vehicle positions by office and status"
      >
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
          <WifiOff className="h-3 w-3" />
          Static positions (GPS out of scope for v1)
        </span>
        <Button variant="secondary" size="sm" onClick={fetchData} loading={loading}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </PageHeader>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-ink-400" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <AlertTriangle className="h-8 w-8 text-status-error-text" />
          <p className="text-sm text-ink-500">{error}</p>
          <Button variant="secondary" size="sm" onClick={fetchData}>Retry</Button>
        </div>
      ) : (
        <>
          {/* Status Summary */}
          <div className="grid gap-3 sm:grid-cols-5">
            <Card><CardContent className="pt-3">
              <div className="text-center"><p className="text-lg font-[650]">{summary.total}</p><p className="text-xs text-ink-500">Total</p></div>
            </CardContent></Card>
            <Card><CardContent className="pt-3">
              <div className="text-center"><p className="text-lg font-[650] text-green-600">{summary.available}</p><p className="text-xs text-ink-500">Available</p></div>
            </CardContent></Card>
            <Card><CardContent className="pt-3">
              <div className="text-center"><p className="text-lg font-[650] text-blue-600">{summary.onTrip}</p><p className="text-xs text-ink-500">On Trip</p></div>
            </CardContent></Card>
            <Card><CardContent className="pt-3">
              <div className="text-center"><p className="text-lg font-[650] text-amber-600">{summary.maintenance}</p><p className="text-xs text-ink-500">Maintenance</p></div>
            </CardContent></Card>
            <Card><CardContent className="pt-3">
              <div className="text-center"><p className="text-lg font-[650] text-red-600">{summary.outOfService}</p><p className="text-xs text-ink-500">Out of Service</p></div>
            </CardContent></Card>
          </div>

          {/* Map + Sidebar */}
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Map */}
            <div className="flex-1">
              <div ref={mapRef} className="h-[500px] rounded-[10px] border border-border overflow-hidden" style={{ minHeight: '400px' }} />
            </div>

            {/* Sidebar */}
            <div className="w-full lg:w-72 space-y-3">
              {/* Status Filter */}
              <Card>
                <CardContent className="pt-3">
                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: 'all', label: 'All', color: 'bg-gray-500' },
                      { value: 'available', label: 'Available', color: 'bg-green-500' },
                      { value: 'issued', label: 'On Trip', color: 'bg-blue-500' },
                      { value: 'maintenance', label: 'Maintenance', color: 'bg-amber-500' },
                      { value: 'out_of_service', label: 'Out of Service', color: 'bg-red-500' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setFilterStatus(opt.value)}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                          filterStatus === opt.value
                            ? 'bg-ink-950 text-white'
                            : 'bg-canvas text-ink-500 hover:bg-ink-100'
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${opt.color}`} />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Selected Vehicle Info */}
              {selectedVehicle && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Car className="h-4 w-4" />
                      {selectedVehicle.make} {selectedVehicle.model}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      <p className="text-ink-500">{selectedVehicle.licenceNumber}</p>
                      <p className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium text-white ${statusColor(selectedVehicle.status)}`}>
                        {selectedVehicle.status.replace(/_/g, ' ')}
                      </p>
                      <p className="text-ink-500">Office: {selectedVehicle.office.name}</p>
                      <p className="text-ink-500">Odometer: {selectedVehicle.currentOdometer.toLocaleString()} km</p>
                      {selectedVehicle.openDefects > 0 && (
                        <p className="text-red-600 flex items-center gap-1">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {selectedVehicle.openDefects} open defect(s)
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Legend */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Legend</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5 text-xs text-ink-500">
                    <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-green-500" />Available</div>
                    <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-blue-500" />On Trip / Allocated</div>
                    <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-amber-500" />In Maintenance</div>
                    <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-red-500" />Out of Service</div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
