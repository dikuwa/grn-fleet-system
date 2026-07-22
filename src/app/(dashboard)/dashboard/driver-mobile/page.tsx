'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { useSession } from '@/lib/auth-client';
import { statusConfig } from '@/lib/request-status';
import {
  Gauge, ClipboardCheck, ClipboardList, Truck,
  ChevronRight, Clock, MapPin, Wifi, WifiOff,
  AlertTriangle, Camera, PenSquare, CheckCircle2,
  Loader2, RefreshCw, Car, FileText,
} from 'lucide-react';
import Link from 'next/link';

interface AssignedTrip {
  id: string;
  reference: string;
  status: string;
  vehicleLicence: string;
  purpose: string;
  startAt: string;
  endAt: string;
  vehicleId?: string;
  hasDepartureInspection: boolean;
  hasReturnInspection: boolean;
  routeSummary?: string;
}

export default function DriverMobileDashboardPage() {
  const { data: session } = useSession();
  const [trips, setTrips] = useState<AssignedTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const fetchedRef = useRef(false);

  // Monitor online/offline status
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const fetchTrips = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/trips?driver_assigned=true&limit=20');
      if (!res.ok) throw new Error('Failed to load trips');
      const json = await res.json();
      const tripsList = json.trips || json.data?.trips || json.rows || json.data || [];
      setTrips(Array.isArray(tripsList) ? tripsList : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trips');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetchTrips();
  }, [fetchTrips]);

  const activeTrips = trips.filter((t) =>
    ['pending', 'in_progress', 'issued'].includes(t.status),
  );
  const completedTrips = trips.filter((t) =>
    ['closed', 'completed', 'returned'].includes(t.status),
  );

  const statusVariant = (status: string): 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency' => {
    return statusConfig(status).variant as 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency';
  };

  const statusLabel = (status: string): string => {
    return statusConfig(status).label;
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Offline Banner */}
      {!isOnline && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>You are offline. Inspection data will be saved locally and synced when connectivity returns.</span>
        </div>
      )}

      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Driver Console' },
      ]} />

      <PageHeader
        title="Driver Console"
        description={isOnline ? 'Your assigned trips and inspections' : 'Working offline — changes will sync later'}
      >
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            isOnline ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
          }`}>
            {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {isOnline ? 'Online' : 'Offline'}
          </div>
          <Button variant="secondary" size="sm" onClick={fetchTrips} loading={loading}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </PageHeader>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link
          href="/dashboard/inspections/departure"
          className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface p-4 text-center hover:border-brand-200 hover:shadow-sm transition-all"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-700">
            <ClipboardCheck className="h-6 w-6" />
          </div>
          <span className="text-xs font-medium text-ink-700">Departure Inspection</span>
        </Link>
        <Link
          href="/dashboard/inspections/return"
          className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface p-4 text-center hover:border-brand-200 hover:shadow-sm transition-all"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-50 text-green-700">
            <ClipboardList className="h-6 w-6" />
          </div>
          <span className="text-xs font-medium text-ink-700">Return Inspection</span>
        </Link>
        <Link
          href="/dashboard/trips"
          className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface p-4 text-center hover:border-brand-200 hover:shadow-sm transition-all"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-50 text-purple-700">
            <Gauge className="h-6 w-6" />
          </div>
          <span className="text-xs font-medium text-ink-700">My Trips</span>
        </Link>
        <Link
          href="/dashboard/logs"
          className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface p-4 text-center hover:border-brand-200 hover:shadow-sm transition-all"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-700">
            <PenSquare className="h-6 w-6" />
          </div>
          <span className="text-xs font-medium text-ink-700">Daily Log</span>
        </Link>
      </div>

      {/* Active Trips */}
      <Card>
        <CardHeader>
          <CardTitle>Active Trips ({activeTrips.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
            </div>
          ) : activeTrips.length === 0 ? (
            <div className="px-5 pb-4">
              <EmptyState
                icon={<Gauge className="h-6 w-6" />}
                title="No active trips"
                description="You have no trips assigned at the moment."
              />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {activeTrips.map((trip) => (
                <Link
                  key={trip.id}
                  href={`/dashboard/trips/${trip.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-canvas/50 transition-colors md:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-ink-950 truncate">
                        {trip.reference || trip.id.slice(0, 8)}
                      </p>
                      <Badge variant={statusVariant(trip.status)} size="sm">
                        {statusLabel(trip.status)}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                      <span className="flex items-center gap-1">
                        <Car className="h-3 w-3" />
                        {trip.vehicleLicence || 'Vehicle assigned'}
                      </span>
                      {trip.startAt && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(trip.startAt).toLocaleDateString('en-NA', { weekday: 'short', day: '2-digit', month: 'short' })}
                        </span>
                      )}
                    </div>
                    {trip.purpose && (
                      <p className="mt-0.5 text-xs text-ink-400 truncate">{trip.purpose}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <div className="flex items-center gap-1.5">
                      {trip.status === 'pending' && (
                        <Link
                          href={`/dashboard/inspections/departure?tripId=${trip.id}&vehicleId=${trip.vehicleId || ''}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex h-7 items-center rounded-full bg-brand-50 px-2.5 text-[11px] font-medium text-brand-700 hover:bg-brand-100 transition-colors"
                        >
                          Start Trip
                        </Link>
                      )}
                      {trip.status === 'in_progress' && (
                        <Link
                          href={`/dashboard/inspections/return?tripId=${trip.id}&vehicleId=${trip.vehicleId || ''}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex h-7 items-center rounded-full bg-amber-50 px-2.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                        >
                          Return
                        </Link>
                      )}
                      {!trip.hasDepartureInspection && trip.status === 'issued' && (
                        <Link
                          href={`/dashboard/inspections/departure?tripId=${trip.id}&vehicleId=${trip.vehicleId || ''}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex h-7 items-center rounded-full bg-amber-50 px-2.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                        >
                          Inspect
                        </Link>
                      )}
                      <Link
                        href={`/dashboard/fuel/new`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex h-7 items-center rounded-full bg-blue-50 px-2.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                      >
                        Fuel
                      </Link>
                    </div>
                    <ChevronRight className="h-4 w-4 text-ink-300" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Trips */}
      {completedTrips.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Trips ({completedTrips.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {completedTrips.slice(0, 5).map((trip) => (
                <Link
                  key={trip.id}
                  href={`/dashboard/trips/${trip.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-canvas/50 transition-colors md:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-ink-950 truncate">
                        {trip.reference || trip.id.slice(0, 8)}
                      </p>
                      <Badge variant={statusVariant(trip.status)} size="sm">
                        {statusLabel(trip.status)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-ink-500">
                      {trip.vehicleLicence && <span>{trip.vehicleLicence}</span>}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-300 shrink-0 ml-2" />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error State */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-status-error-bg bg-status-error-bg px-4 py-3 text-sm text-status-error-text">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={fetchTrips} className="ml-auto">
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
