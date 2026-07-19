'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

import { saveDraft, listDrafts, deleteDraft, countUnsyncedDrafts } from '@/lib/offline-drafts';
import {
  ClipboardList, Save, WifiOff, CheckCircle2, Clock, MapPin,
  Gauge, X,
} from 'lucide-react';

interface Trip {
  id: string;
  status: string;
  make: string | null;
  model: string | null;
  licenceNumber: string | null;
  vehicleRegisterNumber: string | null;
  requestReference: string | null;
}

interface LogFormData {
  tripId: string;
  logDate: string;
  odometerOut: string;
  odometerIn: string;
  departureTime: string;
  arrivalTime: string;
  origin: string;
  destination: string;
  distanceKm: string;
  remarks: string;
}

const emptyForm: LogFormData = {
  tripId: '',
  logDate: new Date().toISOString().slice(0, 10),
  odometerOut: '',
  odometerIn: '',
  departureTime: '',
  arrivalTime: '',
  origin: '',
  destination: '',
  distanceKm: '',
  remarks: '',
};

export default function DailyLogsPage() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [draftId, setDraftId] = useState<string | null>(null);
  const [formData, setFormData] = useState<LogFormData>(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [showDrafts, setShowDrafts] = useState(false);

  // Online status — initialize from navigator.onLine via lazy state, then listen for changes
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

  // Check unsynced drafts count
  useEffect(() => {
    const check = async () => {
      const count = await countUnsyncedDrafts();
      setUnsyncedCount(count);
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch trips for dropdown
  const { data: tripsData } = useQuery({
    queryKey: ['driver-trips'],
    queryFn: async () => {
      const res = await fetch('/api/trips?limit=50');
      if (!res.ok) throw new Error('Failed to load trips');
      const json = await res.json();
      return (json.rows || []) as Trip[];
    },
    enabled: isOnline,
  });

  const trips: Trip[] = tripsData || [];

  // Draft management
  const saveDraftLocally = useCallback(async () => {
    const draft = await saveDraft({
      id: draftId || undefined,
      draftType: 'request',
      formData: formData as unknown as Record<string, unknown>,
      userId: null,
      tenantId: null,
      syncStatus: 'pending',
    });
    setDraftId(draft.id);
    setSubmitMessage('Draft saved locally');
    setTimeout(() => setSubmitMessage(null), 3000);
  }, [formData, draftId]);



  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.tripId) {
      setSubmitMessage('Please select a trip');
      setTimeout(() => setSubmitMessage(null), 3000);
      return;
    }

    if (!isOnline) {
      await saveDraftLocally();
      return;
    }

    setIsSubmitting(true);
    setSubmitMessage(null);

    try {
      // POST to trip log entries API
      const res = await fetch('/api/trip-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripId: formData.tripId,
          logDate: formData.logDate,
          odometerOut: formData.odometerOut ? Number(formData.odometerOut) : null,
          odometerIn: formData.odometerIn ? Number(formData.odometerIn) : null,
          departureTime: formData.departureTime || null,
          arrivalTime: formData.arrivalTime || null,
          origin: formData.origin || null,
          destination: formData.destination || null,
          distanceKm: formData.distanceKm ? Number(formData.distanceKm) : null,
          remarks: formData.remarks || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to submit' }));
        throw new Error(err.error || 'Failed to submit log entry');
      }

      // Clear form on success
      setFormData(emptyForm);
      setDraftId(null);
      setSubmitMessage('Log entry recorded successfully');
      setTimeout(() => setSubmitMessage(null), 3000);

      // If this was a synced draft, clean it up
      if (draftId) {
        await deleteDraft(draftId);
        setDraftId(null);
      }
    } catch (err) {
      setSubmitMessage(err instanceof Error ? err.message : 'Failed to submit');
      setTimeout(() => setSubmitMessage(null), 5000);
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, isOnline, saveDraftLocally, draftId]);

  const updateField = useCallback(<K extends keyof LogFormData>(key: K, value: LogFormData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Daily Logs' },
      ]} />
      <PageHeader
        title="Daily Driver Log"
        description="Record your daily trip activities and vehicle readings"
      >
        <div className="flex items-center gap-2">
          {!isOnline && (
            <span className="flex items-center gap-1 rounded-full bg-status-error-bg px-3 py-1 text-xs font-medium text-status-error-text">
              <WifiOff className="h-3 w-3" /> Offline
            </span>
          )}
          {unsyncedCount > 0 && (
            <Badge variant="pending" size="sm">
              {unsyncedCount} draft{unsyncedCount > 1 ? 's' : ''} pending sync
            </Badge>
          )}
          <Button variant="secondary" size="compact" onClick={saveDraftLocally}>
            <Save className="h-3.5 w-3.5" /> Save Draft
          </Button>
        </div>
      </PageHeader>

      {submitMessage && (
        <div className={`rounded-[8px] p-3 text-sm ${
          submitMessage.includes('successfully') || submitMessage.includes('saved')
            ? 'bg-status-success-bg text-status-success-text'
            : submitMessage.includes('Draft')
              ? 'bg-status-pending-bg text-status-pending-text'
              : 'bg-status-error-bg text-status-error-text'
        }`}>
          {submitMessage}
        </div>
      )}

      {/* Offline Banner */}
      {!isOnline && (
        <Card className="border-status-error-border bg-status-error-bg/30">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <WifiOff className="h-5 w-5 text-status-error-text" />
              <div>
                <p className="text-sm font-medium text-status-error-text">You are offline</p>
                <p className="text-xs text-status-error-text/80">
                  Your log entry will be saved as a draft and submitted automatically when connectivity returns.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 text-center">
            <Gauge className="h-5 w-5 mx-auto mb-1 text-brand-600" />
            <p className="text-lg font-semibold tabular-nums">{formData.odometerOut || '—'}</p>
            <p className="text-[10px] text-ink-500">Odometer Out</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <MapPin className="h-5 w-5 mx-auto mb-1 text-teal-600" />
            <p className="text-sm font-medium truncate max-w-[80px] mx-auto">{formData.origin ? formData.origin.split(',')[0] : '—'}</p>
            <p className="text-[10px] text-ink-500">Origin</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <Clock className="h-5 w-5 mx-auto mb-1 text-amber-600" />
            <p className="text-lg font-semibold">{formData.distanceKm || '—'}</p>
            <p className="text-[10px] text-ink-500">Distance (km)</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Form */}
      <Card>
        <CardHeader>
          <CardTitle>Log Entry</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Trip Selection */}
            <div className="space-y-1.5">
              <Label required>Trip / Vehicle</Label>
              <select
                className="h-11 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200 appearance-none"
                value={formData.tripId}
                onChange={(e) => updateField('tripId', e.target.value)}
              >
                <option value="">Select a trip...</option>
                {trips
                  .filter((t) => t.status !== 'closed')
                  .map((trip) => (
                    <option key={trip.id} value={trip.id}>
                      {trip.make} {trip.model} ({trip.licenceNumber}) — {trip.requestReference || 'No ref'}
                    </option>
                  ))}
              </select>
            </div>

            {/* Date */}
            <div className="space-y-1.5">
              <Label required>Log Date</Label>
              <Input
                type="date"
                value={formData.logDate}
                onChange={(e) => updateField('logDate', e.target.value)}
                className="h-11"
              />
            </div>

            {/* Odometer Readings */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Odometer Out</Label>
                <div className="relative">
                  <Gauge className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                  <Input
                    type="number"
                    placeholder="e.g. 45230"
                    value={formData.odometerOut}
                    onChange={(e) => updateField('odometerOut', e.target.value)}
                    className="pl-9 h-11"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Odometer In</Label>
                <div className="relative">
                  <Gauge className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                  <Input
                    type="number"
                    placeholder="e.g. 45480"
                    value={formData.odometerIn}
                    onChange={(e) => updateField('odometerIn', e.target.value)}
                    className="pl-9 h-11"
                  />
                </div>
              </div>
            </div>

            {/* Times */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Departure Time</Label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                  <Input
                    type="time"
                    value={formData.departureTime}
                    onChange={(e) => updateField('departureTime', e.target.value)}
                    className="pl-9 h-11"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Arrival Time</Label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                  <Input
                    type="time"
                    value={formData.arrivalTime}
                    onChange={(e) => updateField('arrivalTime', e.target.value)}
                    className="pl-9 h-11"
                  />
                </div>
              </div>
            </div>

            {/* Route */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Origin</Label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                  <Input
                    placeholder="e.g. Rundu"
                    value={formData.origin}
                    onChange={(e) => updateField('origin', e.target.value)}
                    className="pl-9 h-11"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Destination</Label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                  <Input
                    placeholder="e.g. Divundu"
                    value={formData.destination}
                    onChange={(e) => updateField('destination', e.target.value)}
                    className="pl-9 h-11"
                  />
                </div>
              </div>
            </div>

            {/* Distance */}
            <div className="space-y-1.5">
              <Label>Distance (km)</Label>
              <Input
                type="number"
                placeholder="e.g. 120"
                value={formData.distanceKm}
                onChange={(e) => updateField('distanceKm', e.target.value)}
                className="h-11"
              />
            </div>

            {/* Remarks */}
            <div className="space-y-1.5">
              <Label>Remarks / Notes</Label>
              <textarea
                className="min-h-[80px] w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200 resize-y"
                placeholder="Any issues, incidents, or observations..."
                value={formData.remarks}
                onChange={(e) => updateField('remarks', e.target.value)}
              />
            </div>

            {/* Submit */}
            <div className="flex gap-2 pt-2">
              <Button
                variant="primary"
                size="default"
                type="submit"
                loading={isSubmitting}
                className="flex-1 h-11"
              >
                {!isOnline ? (
                  <><Save className="h-4 w-4" /> Save Draft Locally</>
                ) : (
                  <><CheckCircle2 className="h-4 w-4" /> Record Log Entry</>
                )}
              </Button>
              <Button
                variant="tertiary"
                size="default"
                type="button"
                className="h-11"
                onClick={() => {
                  setFormData(emptyForm);
                  setDraftId(null);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Trip Quick Reference (mobile-friendly cards) */}
      {trips.filter((t) => t.status === 'in_progress' || t.status === 'pending').length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Active Trips</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {trips
              .filter((t) => t.status === 'in_progress' || t.status === 'pending')
              .slice(0, 5)
              .map((trip) => (
                <div
                  key={trip.id}
                  className="flex items-center gap-3 rounded-[8px] border border-border p-3 hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => updateField('tripId', trip.id)}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700 shrink-0">
                    <Gauge className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-950">
                      {trip.make} {trip.model}
                    </p>
                    <p className="text-xs text-ink-500">
                      {trip.licenceNumber}
                      {trip.requestReference && ` · ${trip.requestReference}`}
                    </p>
                  </div>
                  <Badge variant={trip.status === 'in_progress' ? 'info' : 'pending'} size="sm">
                    {trip.status === 'in_progress' ? 'In Progress' : 'Pending'}
                  </Badge>
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {/* Drafts List */}
      <DraftListSection
        show={showDrafts}
        onToggle={() => setShowDrafts(!showDrafts)}
        onLoadDraft={(draft) => {
          setFormData(draft.formData as unknown as LogFormData);
          setDraftId(draft.id);
          setShowDrafts(false);
        }}
      />

      {/* Mobile-friendly tips */}
      <Card className="bg-brand-50/30 border-brand-100">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-brand-700 shrink-0">
              <ClipboardList className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-brand-900">Driver Tips</p>
              <ul className="mt-1 text-xs text-brand-700 space-y-1">
                <li>• Record odometer readings at the start and end of each trip leg</li>
                <li>• Log entries are saved as drafts when you&apos;re offline</li>
                <li>• Drafts sync automatically when connectivity returns</li>
                <li>• Tap an active trip above to auto-select it</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draft List Section
// ---------------------------------------------------------------------------

function DraftListSection({
  show,
  onToggle,
  onLoadDraft,
}: {
  show: boolean;
  onToggle: () => void;
  onLoadDraft: (draft: { id: string; formData: Record<string, unknown> }) => void;
}) {
  const [drafts, setDrafts] = useState<
    Array<{ id: string; formData: Record<string, unknown>; updatedAt: string }>
  >([]);

  useEffect(() => {
    if (!show) return;
    listDrafts({ draftType: 'request' }).then(setDrafts);
  }, [show]);

  if (!show) {
    return (
      <button
        onClick={onToggle}
        className="w-full text-center text-sm text-ink-500 hover:text-ink-700 py-2 transition-colors"
      >
        View Saved Drafts
      </button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Saved Drafts</CardTitle>
      </CardHeader>
      <CardContent>
        {drafts.length === 0 ? (
          <p className="text-sm text-ink-500 text-center py-4">No saved drafts</p>
        ) : (
          <div className="space-y-2">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="flex items-center justify-between rounded-[8px] border border-border p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-950 truncate">
                    {String(draft.formData?.origin || '')} → {String(draft.formData?.destination || '')}
                  </p>
                  <p className="text-xs text-ink-500">
                    {new Date(draft.updatedAt).toLocaleDateString()} at{' '}
                    {new Date(draft.updatedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <button
                  onClick={() => onLoadDraft(draft)}
                  className="text-xs font-medium text-brand-700 hover:text-brand-800 px-2 py-1"
                >
                  Load
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
