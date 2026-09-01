'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, CheckCircle2, Loader2, MapPin, PencilLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/lib/use-toast';

interface ActivityDraft {
  id: string;
  title: string;
  description: string;
  venue: string;
  startDate: string;
  endDate: string;
  estimatedKilometres: string;
}

interface RouteDraft {
  id: string;
  originName: string;
  destinationName: string;
  totalKilometres: string;
  wasVerified: boolean;
}

interface TransportRequestCorrectionsProps {
  requestId: string;
  initialPurpose: string | null;
  initialSpecialRequirements: string | null;
  initialVehicleRequirements: Record<string, unknown> | null;
  activities: Array<{
    id: string;
    title: string;
    description: string | null;
    venue: string | null;
    startDate: string;
    endDate: string;
    estimatedKilometres: number | null;
  }>;
  routes: Array<{
    id: string;
    originName: string | null;
    destinationName: string | null;
    totalKilometres: number;
    isVerified: boolean;
  }>;
}

function toLocalDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function TransportRequestCorrections({
  requestId,
  initialPurpose,
  initialSpecialRequirements,
  initialVehicleRequirements,
  activities,
  routes,
}: TransportRequestCorrectionsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [purpose, setPurpose] = useState(initialPurpose ?? '');
  const [specialRequirements, setSpecialRequirements] = useState(initialSpecialRequirements ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [draftActivities, setDraftActivities] = useState<ActivityDraft[]>(() =>
    activities.map((activity) => ({
      id: activity.id,
      title: activity.title,
      description: activity.description ?? '',
      venue: activity.venue ?? '',
      startDate: toLocalDateTime(activity.startDate),
      endDate: toLocalDateTime(activity.endDate),
      estimatedKilometres:
        activity.estimatedKilometres == null ? '' : String(activity.estimatedKilometres),
    })),
  );
  const [draftRoutes, setDraftRoutes] = useState<RouteDraft[]>(() =>
    routes.map((route) => ({
      id: route.id,
      originName: route.originName ?? '',
      destinationName: route.destinationName ?? '',
      totalKilometres: String(route.totalKilometres ?? 0),
      wasVerified: route.isVerified,
    })),
  );

  const hasInvalidSchedule = useMemo(
    () =>
      draftActivities.some((activity) => {
        if (!activity.title.trim() || !activity.startDate || !activity.endDate) return true;
        const start = new Date(activity.startDate);
        const end = new Date(activity.endDate);
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
          return true;
        }
        if (activity.estimatedKilometres.trim()) {
          const kilometres = Number(activity.estimatedKilometres);
          if (!Number.isInteger(kilometres) || kilometres < 0) return true;
        }
        return false;
      }),
    [draftActivities],
  );

  const hasInvalidRoutes = useMemo(
    () =>
      draftRoutes.some((route) => {
        const kilometres = Number(route.totalKilometres);
        return (
          !route.originName.trim() ||
          !route.destinationName.trim() ||
          !Number.isInteger(kilometres) ||
          kilometres < 0
        );
      }),
    [draftRoutes],
  );

  const updateActivity = (id: string, field: keyof ActivityDraft, value: string) => {
    setDraftActivities((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
    setError('');
  };

  const updateRoute = (id: string, field: 'originName' | 'destinationName' | 'totalKilometres', value: string) => {
    setDraftRoutes((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
    setError('');
  };

  const resetForm = () => {
    setPurpose(initialPurpose ?? '');
    setSpecialRequirements(initialSpecialRequirements ?? '');
    setReason('');
    setError('');
    setDraftActivities(
      activities.map((activity) => ({
        id: activity.id,
        title: activity.title,
        description: activity.description ?? '',
        venue: activity.venue ?? '',
        startDate: toLocalDateTime(activity.startDate),
        endDate: toLocalDateTime(activity.endDate),
        estimatedKilometres:
          activity.estimatedKilometres == null ? '' : String(activity.estimatedKilometres),
      })),
    );
    setDraftRoutes(
      routes.map((route) => ({
        id: route.id,
        originName: route.originName ?? '',
        destinationName: route.destinationName ?? '',
        totalKilometres: String(route.totalKilometres ?? 0),
        wasVerified: route.isVerified,
      })),
    );
  };

  const saveCorrections = async () => {
    if (!reason.trim()) {
      setError('Record a short correction note before saving.');
      return;
    }
    if (hasInvalidSchedule) {
      setError('Check each activity title, date range and kilometre value before saving.');
      return;
    }
    if (hasInvalidRoutes) {
      setError('Check each journey origin, destination and kilometre value before saving.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/requests/${requestId}/transport-review-correction`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose: purpose.trim() || null,
          specialRequirements: specialRequirements.trim() || null,
          vehicleRequirements: initialVehicleRequirements ?? {},
          reason: reason.trim(),
          activities: draftActivities.map((activity) => ({
            id: activity.id,
            title: activity.title.trim(),
            description: activity.description.trim() || null,
            venue: activity.venue.trim() || null,
            startDate: new Date(activity.startDate).toISOString(),
            endDate: new Date(activity.endDate).toISOString(),
            estimatedKilometres: activity.estimatedKilometres.trim()
              ? Number(activity.estimatedKilometres)
              : null,
          })),
          routes: draftRoutes.map((route) => ({
            id: route.id,
            originName: route.originName.trim(),
            destinationName: route.destinationName.trim(),
            totalKilometres: Number(route.totalKilometres),
          })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to save Transport Review corrections.');

      toast({
        title: data.changed ? 'Transport Review corrections saved' : 'No changes to save',
        description: data.changed
          ? data.scheduleChanged
            ? 'Request details, journey routes and the live allocation window were updated with an audit revision.'
            : 'Request details and journey routes were updated with an audit revision.'
          : 'The request already matches these details.',
        variant: 'success',
      });
      setReason('');
      setIsOpen(false);
      router.refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to save corrections.';
      setError(message);
      toast({ title: 'Correction not saved', description: message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="text-brand-700 h-5 w-5" aria-hidden="true" />
              Request Details, Journey &amp; Schedule
            </CardTitle>
            <p className="text-ink-500 mt-1 text-xs leading-5">
              Correct operational details before release. The governed request origin, approval route and requester identity remain locked.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (isOpen) resetForm();
              setIsOpen((current) => !current);
            }}
          >
            <PencilLine className="h-4 w-4" aria-hidden="true" />
            {isOpen ? 'Close' : 'Correct Details'}
          </Button>
        </div>
      </CardHeader>

      {isOpen ? (
        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor={`transport-purpose-${requestId}`} className="text-ink-700 text-xs font-medium">
                Purpose
              </label>
              <textarea
                id={`transport-purpose-${requestId}`}
                value={purpose}
                onChange={(event) => {
                  setPurpose(event.target.value);
                  setError('');
                }}
                rows={3}
                maxLength={2000}
                className="border-border bg-background text-ink-950 focus:border-ink-400 focus:ring-ink-200 w-full resize-y rounded-[8px] border px-3 py-2 text-sm outline-none transition-colors focus:ring-2"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`transport-requirements-${requestId}`} className="text-ink-700 text-xs font-medium">
                Special requirements
              </label>
              <textarea
                id={`transport-requirements-${requestId}`}
                value={specialRequirements}
                onChange={(event) => {
                  setSpecialRequirements(event.target.value);
                  setError('');
                }}
                rows={3}
                maxLength={2000}
                placeholder="Accessibility, loading or operational requirements…"
                className="border-border bg-background text-ink-950 placeholder:text-ink-400 focus:border-ink-400 focus:ring-ink-200 w-full resize-y rounded-[8px] border px-3 py-2 text-sm outline-none transition-colors focus:ring-2"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-ink-950 text-sm font-semibold">Journey routes</p>
              <p className="text-ink-500 mt-0.5 text-xs">
                Correct the submitted origin, destination and total distance. Editing a route turns any earlier mapped verification into an explicit Transport Review override recorded with your correction note.
              </p>
            </div>
            {draftRoutes.length === 0 ? (
              <p className="border-border bg-muted/20 text-ink-500 rounded-[8px] border px-3 py-4 text-sm">
                This request has no journey route rows to adjust.
              </p>
            ) : (
              draftRoutes.map((route, index) => (
                <div key={route.id} className="border-border bg-muted/15 space-y-3 rounded-[10px] border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <MapPin className="text-ink-400 h-4 w-4" aria-hidden="true" />
                      <span className="text-ink-700 text-xs font-semibold uppercase tracking-wide">
                        Journey {index + 1}
                      </span>
                    </div>
                    {route.wasVerified && (
                      <span className="text-ink-500 text-xs">Mapped when submitted</span>
                    )}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1.5 text-xs font-medium text-ink-700">
                      Origin
                      <input
                        type="text"
                        value={route.originName}
                        maxLength={500}
                        onChange={(event) => updateRoute(route.id, 'originName', event.target.value)}
                        className="border-border bg-background text-ink-950 focus:ring-ink-200 mt-1 w-full rounded-[8px] border px-3 py-2 text-sm font-normal outline-none focus:ring-2"
                      />
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-ink-700">
                      Destination
                      <input
                        type="text"
                        value={route.destinationName}
                        maxLength={500}
                        onChange={(event) => updateRoute(route.id, 'destinationName', event.target.value)}
                        className="border-border bg-background text-ink-950 focus:ring-ink-200 mt-1 w-full rounded-[8px] border px-3 py-2 text-sm font-normal outline-none focus:ring-2"
                      />
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-ink-700 md:col-span-2">
                      Total kilometres
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={route.totalKilometres}
                        onChange={(event) => updateRoute(route.id, 'totalKilometres', event.target.value)}
                        className="border-border bg-background text-ink-950 focus:ring-ink-200 mt-1 w-full rounded-[8px] border px-3 py-2 text-sm font-normal outline-none focus:ring-2"
                      />
                    </label>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-ink-950 text-sm font-semibold">Activities</p>
              <p className="text-ink-500 mt-0.5 text-xs">
                Adjust dates, venue and activity details. Existing activities cannot be added or removed during Transport Review.
              </p>
            </div>
            {draftActivities.length === 0 ? (
              <p className="border-border bg-muted/20 text-ink-500 rounded-[8px] border px-3 py-4 text-sm">
                This request has no activity rows to adjust.
              </p>
            ) : (
              draftActivities.map((activity, index) => (
                <div key={activity.id} className="border-border bg-muted/15 space-y-3 rounded-[10px] border p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="text-ink-400 h-4 w-4" aria-hidden="true" />
                    <span className="text-ink-700 text-xs font-semibold uppercase tracking-wide">
                      Activity {index + 1}
                    </span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1.5 text-xs font-medium text-ink-700 md:col-span-2">
                      Title
                      <input
                        type="text"
                        value={activity.title}
                        maxLength={500}
                        onChange={(event) => updateActivity(activity.id, 'title', event.target.value)}
                        className="border-border bg-background text-ink-950 focus:ring-ink-200 mt-1 w-full rounded-[8px] border px-3 py-2 text-sm font-normal outline-none focus:ring-2"
                      />
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-ink-700">
                      Start
                      <input
                        type="datetime-local"
                        value={activity.startDate}
                        onChange={(event) => updateActivity(activity.id, 'startDate', event.target.value)}
                        className="border-border bg-background text-ink-950 focus:ring-ink-200 mt-1 w-full rounded-[8px] border px-3 py-2 text-sm font-normal outline-none focus:ring-2"
                      />
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-ink-700">
                      End
                      <input
                        type="datetime-local"
                        value={activity.endDate}
                        onChange={(event) => updateActivity(activity.id, 'endDate', event.target.value)}
                        className="border-border bg-background text-ink-950 focus:ring-ink-200 mt-1 w-full rounded-[8px] border px-3 py-2 text-sm font-normal outline-none focus:ring-2"
                      />
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-ink-700">
                      Venue
                      <input
                        type="text"
                        value={activity.venue}
                        maxLength={500}
                        onChange={(event) => updateActivity(activity.id, 'venue', event.target.value)}
                        className="border-border bg-background text-ink-950 focus:ring-ink-200 mt-1 w-full rounded-[8px] border px-3 py-2 text-sm font-normal outline-none focus:ring-2"
                      />
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-ink-700">
                      Estimated kilometres
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={activity.estimatedKilometres}
                        onChange={(event) => updateActivity(activity.id, 'estimatedKilometres', event.target.value)}
                        className="border-border bg-background text-ink-950 focus:ring-ink-200 mt-1 w-full rounded-[8px] border px-3 py-2 text-sm font-normal outline-none focus:ring-2"
                      />
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-ink-700 md:col-span-2">
                      Description
                      <textarea
                        value={activity.description}
                        rows={2}
                        maxLength={2000}
                        onChange={(event) => updateActivity(activity.id, 'description', event.target.value)}
                        className="border-border bg-background text-ink-950 focus:ring-ink-200 mt-1 w-full resize-y rounded-[8px] border px-3 py-2 text-sm font-normal outline-none focus:ring-2"
                      />
                    </label>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`transport-correction-note-${requestId}`} className="text-ink-700 text-xs font-medium">
              Correction note <span className="text-status-error-text">*</span>
            </label>
            <textarea
              id={`transport-correction-note-${requestId}`}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setError('');
              }}
              rows={3}
              maxLength={500}
              placeholder="Record why these operational details are being corrected…"
              className="border-border bg-background text-ink-950 placeholder:text-ink-400 focus:border-ink-400 focus:ring-ink-200 w-full resize-y rounded-[8px] border px-3 py-2 text-sm outline-none transition-colors focus:ring-2"
            />
            <p className="text-ink-500 text-xs">
              This note is stored with the request revision and audit record.
            </p>
          </div>

          {error && <p role="alert" className="text-status-error-text text-sm">{error}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              onClick={() => void saveCorrections()}
              disabled={saving || !reason.trim() || hasInvalidSchedule || hasInvalidRoutes}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {saving ? 'Saving…' : 'Save Corrections'}
            </Button>
            <Button variant="secondary" onClick={resetForm} disabled={saving}>
              Reset
            </Button>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
