'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

import { saveDraft, listDrafts, deleteDraft, countUnsyncedDrafts } from '@/lib/offline-drafts';
import { StyledDateInput, StyledSelect } from '@/components/ui/styled-select';
import {
  AlertTriangle,
  ClipboardList,
  Save,
  WifiOff,
  CheckCircle2,
  Clock,
  MapPin,
  Gauge,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { fetchUserProfile, userProfileQueryKey } from '@/lib/user-profile';

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
  const { data: profile } = useQuery({
    queryKey: userProfileQueryKey,
    queryFn: ({ signal }) => fetchUserProfile(signal),
  });

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
    if (!profile) return;
    const check = async () => {
      const count = await countUnsyncedDrafts({ userId: profile.id, tenantId: profile.tenantId });
      setUnsyncedCount(count);
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [profile]);

  // Fetch trips for dropdown — prioritize active/in-progress trips
  const { data: tripsData } = useQuery({
    queryKey: ['driver-trips-log'],
    queryFn: async () => {
      const res = await fetch('/api/trips?limit=50');
      if (!res.ok) throw new Error('Failed to load trips');
      const json = await res.json();
      return (json.rows || json.data || []) as Trip[];
    },
    enabled: isOnline,
  });

  const trips: Trip[] = tripsData || [];

  // Draft management
  const saveDraftLocally = useCallback(async () => {
    const draft = await saveDraft({
      id: draftId || undefined,
      draftType: 'trip_log',
      formData: formData as unknown as Record<string, unknown>,
      userId: profile?.id || null,
      tenantId: profile?.tenantId || null,
      syncStatus: 'pending',
    });
    setDraftId(draft.id);
    setSubmitMessage('Draft saved locally');
    setTimeout(() => setSubmitMessage(null), 3000);
  }, [formData, draftId, profile]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
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
        // POST to trip log entries API. If the form came from a saved local draft,
        // reuse that draft UUID as the server idempotency token. This makes a manual
        // online submit and an automatic reconnect sync the same logical operation.
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
            clientSyncId: draftId || undefined,
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
    },
    [formData, isOnline, saveDraftLocally, draftId],
  );

  const updateField = useCallback(<K extends keyof LogFormData>(key: K, value: LogFormData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Auto-select the single in-progress trip on load
  useEffect(() => {
    if (!tripsData || formData.tripId) return;
    const active = tripsData.filter(
      (t: Trip) => t.status === 'in_progress' || t.status === 'issued',
    );
    if (active.length !== 1) return;
    const autoTimer = setTimeout(() => updateField('tripId', active[0].id), 0);
    return () => clearTimeout(autoTimer);
  }, [tripsData, formData.tripId, updateField]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Daily Logs' }]} />
      <PageHeader
        title="Daily Driver Log"
        description="Record your daily trip activities and vehicle readings"
      >
        <div className="flex items-center gap-2">
          {!isOnline && (
            <span className="bg-status-error-bg text-status-error-text flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium">
              <WifiOff className="h-3 w-3" /> Offline
            </span>
          )}
          {unsyncedCount > 0 && (
            <Badge variant="pending" size="sm">
              {unsyncedCount} draft{unsyncedCount > 1 ? 's' : ''} pending sync
            </Badge>
          )}
          <Button variant="secondary" size="compact" onClick={saveDraftLocally}>
            <Save className="h-3.5 w-3.5" aria-hidden="true" /> Save Draft
          </Button>
        </div>
      </PageHeader>

      {submitMessage && (
        <div
          className={`rounded-[8px] p-3 text-sm ${
            submitMessage.includes('successfully') || submitMessage.includes('saved')
              ? 'bg-status-success-bg text-status-success-text'
              : submitMessage.includes('Draft')
                ? 'bg-status-pending-bg text-status-pending-text'
                : 'bg-status-error-bg text-status-error-text'
          }`}
        >
          {submitMessage}
        </div>
      )}

      {!isOnline && (
        <Card className="border-status-error-border bg-status-error-bg/30">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <WifiOff className="text-status-error-text h-5 w-5" />
              <div>
                <p className="text-status-error-text text-sm font-medium">You are offline</p>
                <p className="text-status-error-text/80 text-xs">
                  Your log entry will be saved as a draft and submitted automatically when
                  connectivity returns.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 text-center">
            <Gauge className="text-brand-600 mx-auto mb-1 h-5 w-5" />
            <p className="text-lg font-semibold tabular-nums">{formData.odometerOut || '—'}</p>
            <p className="text-ink-500 text-[10px]">Odometer Out</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <MapPin className="mx-auto mb-1 h-5 w-5 text-teal-600" />
            <p className="mx-auto max-w-[80px] truncate text-sm font-medium">
              {formData.origin ? formData.origin.split(',')[0] : '—'}
            </p>
            <p className="text-ink-500 text-[10px]">Origin</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <Clock className="mx-auto mb-1 h-5 w-5 text-amber-600 dark:text-amber-400" />
            <p className="text-lg font-semibold">{formData.distanceKm || '—'}</p>
            <p className="text-ink-500 text-[10px]">Distance (km)</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Log Entry</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label required>Trip / Vehicle</Label>
              <StyledSelect
                className="h-11"
                value={formData.tripId}
                onChange={(e) => updateField('tripId', e.target.value)}
              >
                <option value="">Select a trip...</option>
                {trips
                  .filter((t) => t.status !== 'closed')
                  .map((trip) => (
                    <option key={trip.id} value={trip.id}>
                      {trip.make} {trip.model} ({trip.licenceNumber}) —{' '}
                      {trip.requestReference || 'No ref'}
                    </option>
                  ))}
              </StyledSelect>
            </div>

            <div className="space-y-1.5">
              <Label required>Log Date</Label>
              <StyledDateInput
                type="date"
                value={formData.logDate}
                onChange={(e) => updateField('logDate', e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Odometer Out</Label>
                <div className="relative">
                  <Gauge className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                  <Input
                    type="number"
                    placeholder="e.g. 45230"
                    value={formData.odometerOut}
                    onChange={(e) => updateField('odometerOut', e.target.value)}
                    className="h-11 pl-9"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Odometer In</Label>
                <div className="relative">
                  <Gauge className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                  <Input
                    type="number"
                    placeholder="e.g. 45480"
                    value={formData.odometerIn}
                    onChange={(e) => updateField('odometerIn', e.target.value)}
                    className="h-11 pl-9"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Departure Time</Label>
                <StyledDateInput
                  type="time"
                  value={formData.departureTime}
                  onChange={(e) => updateField('departureTime', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Arrival Time</Label>
                <StyledDateInput
                  type="time"
                  value={formData.arrivalTime}
                  onChange={(e) => updateField('arrivalTime', e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Origin</Label>
                <div className="relative">
                  <MapPin className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                  <Input
                    placeholder="e.g. Rundu"
                    value={formData.origin}
                    onChange={(e) => updateField('origin', e.target.value)}
                    className="h-11 pl-9"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Destination</Label>
                <div className="relative">
                  <MapPin className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                  <Input
                    placeholder="e.g. Divundu"
                    value={formData.destination}
                    onChange={(e) => updateField('destination', e.target.value)}
                    className="h-11 pl-9"
                  />
                </div>
              </div>
            </div>

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

            <div className="space-y-1.5">
              <Label>Remarks / Notes</Label>
              <textarea
                className="border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-600 min-h-[80px] w-full resize-y rounded-[8px] border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                placeholder="Any issues, incidents, or observations..."
                value={formData.remarks}
                onChange={(e) => updateField('remarks', e.target.value)}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="primary"
                size="default"
                type="submit"
                loading={isSubmitting}
                className="h-11 flex-1"
              >
                {!isOnline ? (
                  <>
                    <Save className="h-4 w-4" aria-hidden="true" /> Save Draft Locally
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" /> Record Log Entry
                  </>
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
            {formData.tripId && (
              <Button type="button" variant="emergency" className="w-full" asChild>
                <Link href={`/dashboard/trips/${formData.tripId}`}>
                  <AlertTriangle className="h-4 w-4" /> Report incident, damage or defect
                </Link>
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

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
                  className="border-border hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-[8px] border p-3 transition-colors"
                  onClick={() => updateField('tripId', trip.id)}
                >
                  <div className="bg-brand-50 text-brand-700 flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]">
                    <Gauge className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-ink-950 text-sm font-medium">
                      {trip.make} {trip.model}
                    </p>
                    <p className="text-ink-500 text-xs">
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

      <DraftListSection
        show={showDrafts}
        userId={profile?.id}
        tenantId={profile?.tenantId}
        onToggle={() => setShowDrafts(!showDrafts)}
        onLoadDraft={(draft) => {
          setFormData(draft.formData as unknown as LogFormData);
          setDraftId(draft.id);
          setShowDrafts(false);
        }}
      />

      <Card className="bg-brand-50/30 border-brand-100">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <div className="bg-brand-100 text-brand-700 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
              <ClipboardList className="h-4 w-4" />
            </div>
            <div>
              <p className="text-brand-900 dark:text-brand-700 text-sm font-medium">Driver Tips</p>
              <ul className="text-brand-700 mt-1 space-y-1 text-xs">
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

function DraftListSection({
  show,
  userId,
  tenantId,
  onToggle,
  onLoadDraft,
}: {
  show: boolean;
  userId?: string;
  tenantId?: string;
  onToggle: () => void;
  onLoadDraft: (draft: { id: string; formData: Record<string, unknown> }) => void;
}) {
  const [drafts, setDrafts] = useState<
    Array<{ id: string; formData: Record<string, unknown>; updatedAt: string }>
  >([]);

  useEffect(() => {
    if (!show || !userId || !tenantId) return;
    listDrafts({ draftType: 'trip_log', userId, tenantId }).then(setDrafts);
  }, [show, tenantId, userId]);

  if (!show) {
    return (
      <button
        onClick={onToggle}
        className="text-ink-500 hover:text-ink-700 w-full py-2 text-center text-sm transition-colors"
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
          <p className="text-ink-500 py-4 text-center text-sm">No saved drafts</p>
        ) : (
          <div className="space-y-2">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="border-border hover:bg-muted/50 flex items-center justify-between rounded-[8px] border p-3 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-ink-950 truncate text-sm">
                    {String(draft.formData?.origin || '')} →{' '}
                    {String(draft.formData?.destination || '')}
                  </p>
                  <p className="text-ink-500 text-xs">
                    {new Date(draft.updatedAt).toLocaleDateString()} at{' '}
                    {new Date(draft.updatedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <button
                  onClick={() => onLoadDraft(draft)}
                  className="text-brand-700 hover:text-brand-800 px-2 py-1 text-xs font-medium"
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
