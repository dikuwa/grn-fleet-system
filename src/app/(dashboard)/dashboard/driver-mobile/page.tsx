'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label, Textarea } from '@/components/ui/input';
import { statusConfig } from '@/lib/request-status';
import { fetchWithRetry } from '@/lib/fetch-with-retry';
import { useToast } from '@/lib/use-toast';
import {
  AlertTriangle,
  ArrowRight,
  Car,
  Clock,
  Fuel,
  Gauge,
  Loader2,
  MapPin,
  PenSquare,
  RefreshCw,
  UserRound,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';

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
  routeKm?: number;
  canDeclineAssignment?: boolean;
}

export default function DriverMobileDashboardPage() {
  const { toast } = useToast();
  const [trips, setTrips] = useState<AssignedTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [declineTrip, setDeclineTrip] = useState<AssignedTrip | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [declining, setDeclining] = useState(false);
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine,
  );
  const fetchedRef = useRef(false);

  useEffect(() => {
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
      const res = await fetchWithRetry('/api/trips?driver_assigned=true&limit=20');
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
    void fetchTrips();
  }, [fetchTrips]);

  const submitDecline = useCallback(async () => {
    if (!declineTrip) return;
    const reason = declineReason.trim();
    if (reason.length < 10) {
      setError('Explain why you cannot perform the trip using at least 10 characters.');
      return;
    }
    if (!isOnline) {
      setError('Trip reassignment requires an online connection so Transport Administration is notified immediately.');
      return;
    }

    setDeclining(true);
    setError(null);
    try {
      const response = await fetch(`/api/trips/${declineTrip.id}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Could not notify Transport Administration');
      toast({
        title: 'Transport notified',
        description: 'Your assignment was released and another compliant driver can now be assigned.',
        variant: 'success',
      });
      setDeclineTrip(null);
      setDeclineReason('');
      await fetchTrips();
    } catch (reasonError) {
      const message = reasonError instanceof Error ? reasonError.message : 'Could not notify Transport Administration';
      setError(message);
      toast({ title: 'Reassignment request failed', description: message, variant: 'error' });
    } finally {
      setDeclining(false);
    }
  }, [declineReason, declineTrip, fetchTrips, isOnline, toast]);

  const activeTrips = trips.filter((trip) => ['pending', 'in_progress', 'issued'].includes(trip.status));
  const completedTrips = trips.filter((trip) => ['closed', 'completed', 'returned'].includes(trip.status));
  const variantFor = (status: string) => statusConfig(status).variant as 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency';

  const quickActions = [
    { href: '/dashboard/trips', label: 'My Trips', description: 'Assigned journeys', icon: Gauge },
    { href: '/dashboard/logs', label: 'Daily Log', description: 'Odometer and trip log', icon: PenSquare },
    { href: '/dashboard/fuel/new', label: 'Fuel Entry', description: 'Record a fuel stop', icon: Fuel },
    { href: '/dashboard/driver-self-service', label: 'Self-Service', description: 'Licence and driver reports', icon: UserRound },
  ];

  return (
    <div className="space-y-5 md:space-y-6">
      {!isOnline && (
        <div className="bg-status-warning-bg text-status-warning-text border-status-warning-text/20 flex items-start gap-2 rounded-[8px] border px-4 py-3 text-sm">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>You are offline. Supported drafts remain available and will sync when connectivity returns.</span>
        </div>
      )}

      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Driver Console' }]} />
      <PageHeader
        title="Driver Console"
        description={isOnline ? 'Assigned trips and driver actions' : 'Working offline — supported changes will sync later'}
      >
        <div className="flex items-center gap-2">
          <span className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${isOnline ? 'bg-status-success-bg text-status-success-text' : 'bg-status-warning-bg text-status-warning-text'}`}>
            {isOnline ? <Wifi className="h-3.5 w-3.5" aria-hidden="true" /> : <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />}
            {isOnline ? 'Online' : 'Offline'}
          </span>
          <Button variant="secondary" size="sm" onClick={() => void fetchTrips()} loading={loading} aria-label="Refresh assigned trips">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </PageHeader>

      <section aria-labelledby="driver-actions-heading">
        <h2 id="driver-actions-heading" className="text-ink-950 mb-3 text-sm font-semibold">Driver actions</h2>
        <div className="border-border grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border bg-border lg:grid-cols-4">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href}
                href={action.href}
                className="focus-ring bg-surface hover:bg-muted/50 group min-w-0 p-4 transition-colors motion-reduce:transition-none"
              >
                <Icon className="text-brand-700 h-5 w-5" aria-hidden="true" />
                <p className="text-ink-900 mt-3 text-sm font-medium">{action.label}</p>
                <p className="text-ink-500 mt-0.5 text-xs">{action.description}</p>
              </Link>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="active-trips-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="active-trips-heading" className="text-ink-950 text-sm font-semibold">Active Trips ({activeTrips.length})</h2>
          <Link href="/dashboard/trips" className="text-brand-700 focus-ring rounded text-xs font-medium hover:underline">View all</Link>
        </div>

        {loading ? (
          <div className="text-ink-500 flex items-center justify-center gap-2 py-10 text-sm">
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading trips…
          </div>
        ) : activeTrips.length === 0 ? (
          <EmptyState icon={<Gauge className="h-6 w-6" />} title="No active trips" description="You have no trips assigned at the moment." />
        ) : (
          <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
            {activeTrips.map((trip) => (
              <article key={trip.id} className="border-border border-b p-4 last:border-b-0 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/trips/${trip.id}`} className="text-ink-950 focus-ring truncate rounded text-sm font-semibold hover:text-brand-700">
                        {trip.reference || trip.id.slice(0, 8)}
                      </Link>
                      <Badge variant={variantFor(trip.status)} size="sm">{statusConfig(trip.status).label}</Badge>
                    </div>
                    <div className="text-ink-500 mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      <span className="flex items-center gap-1"><Car className="h-3 w-3" aria-hidden="true" />{trip.vehicleLicence || 'Vehicle assigned'}</span>
                      {trip.startAt && <span className="flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden="true" />{new Date(trip.startAt).toLocaleDateString('en-NA', { weekday: 'short', day: '2-digit', month: 'short' })}</span>}
                      {trip.routeKm != null && trip.routeKm > 0 && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden="true" />{Math.round(trip.routeKm).toLocaleString()} km</span>}
                    </div>
                    {trip.purpose && <p className="text-ink-400 mt-1 line-clamp-2 text-xs">{trip.purpose}</p>}
                  </div>

                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <Button variant="secondary" size="sm" asChild>
                      <Link href={`/dashboard/trips/${trip.id}`}>Trip Details</Link>
                    </Button>
                    {trip.canDeclineAssignment && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setError(null);
                          setDeclineReason('');
                          setDeclineTrip(trip);
                        }}
                      >
                        <XCircle className="h-4 w-4" aria-hidden="true" /> Cannot perform
                      </Button>
                    )}
                    <Button variant="secondary" size="sm" asChild>
                      <Link href="/dashboard/fuel/new"><Fuel className="h-4 w-4" aria-hidden="true" />Fuel</Link>
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {completedTrips.length > 0 && (
        <section aria-labelledby="recent-trips-heading" className="border-border border-t pt-5">
          <h2 id="recent-trips-heading" className="text-ink-950 mb-2 text-sm font-semibold">Recent Trips</h2>
          <div className="divide-border divide-y">
            {completedTrips.slice(0, 5).map((trip) => (
              <Link
                key={trip.id}
                href={`/dashboard/trips/${trip.id}`}
                className="focus-ring group flex min-h-12 items-center justify-between gap-3 rounded py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-ink-900 truncate text-sm font-medium">{trip.reference || trip.id.slice(0, 8)}</span>
                    <Badge variant={variantFor(trip.status)} size="sm">{statusConfig(trip.status).label}</Badge>
                  </div>
                  {trip.vehicleLicence && <p className="text-ink-500 mt-0.5 text-xs">{trip.vehicleLicence}</p>}
                </div>
                <ArrowRight className="text-ink-400 group-hover:text-brand-700 h-4 w-4 shrink-0" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {error && !declineTrip && (
        <div className="bg-status-error-bg text-status-error-text flex items-start gap-2 rounded-[8px] px-4 py-3 text-sm" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{error}</span>
          <Button variant="secondary" size="sm" onClick={() => void fetchTrips()}>Retry</Button>
        </div>
      )}

      <Dialog open={!!declineTrip} onOpenChange={(open) => {
        if (!open) {
          setDeclineTrip(null);
          setDeclineReason('');
          setError(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cannot perform this trip?</DialogTitle>
            <DialogDescription>
              Use this when you cannot carry out the assigned trip. The trip itself will not be cancelled; Transport Administration will be asked to assign another compliant driver.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="driver-decline-reason">Reason</Label>
            <Textarea
              id="driver-decline-reason"
              value={declineReason}
              onChange={(event) => setDeclineReason(event.target.value)}
              placeholder="For example: medical unavailability, licence restriction, duty conflict, or another operational reason"
              rows={4}
              maxLength={500}
            />
            <p className="text-xs text-ink-500">Required · 10–500 characters · Transport Administration will see this reason.</p>
            {error && <p className="text-xs text-status-error-text" role="alert">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={declining} onClick={() => setDeclineTrip(null)}>Keep assignment</Button>
            <Button variant="destructive" loading={declining} onClick={() => void submitDecline()}>
              <XCircle className="h-4 w-4" aria-hidden="true" /> Request reassignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
