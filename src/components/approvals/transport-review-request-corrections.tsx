'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, ChevronDown, ChevronUp, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { useToast } from '@/lib/use-toast';

type Activity = {
  id: string;
  title: string;
  description: string;
  venue: string;
  startDate: string;
  endDate: string;
  estimatedKilometres: number;
};

type Props = {
  requestId: string;
  requestReference: string;
  purpose: string;
  specialRequirements: string;
  activities: Array<{
    id: string;
    title: string;
    description: string | null;
    venue: string | null;
    startDate: Date;
    endDate: Date;
    estimatedKilometres: number | null;
  }>;
  allocationId?: string | null;
};

let localId = 0;
function nextId() {
  localId += 1;
  return `transport-review-activity-${Date.now()}-${localId}`;
}

function dateOnly(value: Date | string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

const fieldClass =
  'border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-600 min-h-11 w-full rounded-[8px] border px-3 py-2 text-sm focus:ring-2 focus:outline-none';

export function TransportReviewRequestCorrections({
  requestId,
  requestReference,
  purpose: initialPurpose,
  specialRequirements: initialSpecialRequirements,
  activities: initialActivities,
  allocationId,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState(initialPurpose);
  const [specialRequirements, setSpecialRequirements] = useState(initialSpecialRequirements);
  const [reason, setReason] = useState('');
  const [activities, setActivities] = useState<Activity[]>(() =>
    initialActivities.map((activity) => ({
      id: activity.id,
      title: activity.title,
      description: activity.description || '',
      venue: activity.venue || '',
      startDate: dateOnly(activity.startDate),
      endDate: dateOnly(activity.endDate),
      estimatedKilometres: Number(activity.estimatedKilometres || 0),
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const initialSchedule = useMemo(
    () =>
      JSON.stringify(
        initialActivities.map((activity) => ({
          title: activity.title.trim(),
          description: activity.description?.trim() || '',
          venue: activity.venue?.trim() || '',
          startDate: dateOnly(activity.startDate),
          endDate: dateOnly(activity.endDate),
          estimatedKilometres: Number(activity.estimatedKilometres || 0),
        })),
      ),
    [initialActivities],
  );
  const scheduleChanged =
    JSON.stringify(
      activities.map((activity) => ({
        title: activity.title.trim(),
        description: activity.description.trim(),
        venue: activity.venue.trim(),
        startDate: activity.startDate,
        endDate: activity.endDate,
        estimatedKilometres: Number(activity.estimatedKilometres || 0),
      })),
    ) !== initialSchedule;

  function patchActivity(id: string, patch: Partial<Activity>) {
    setActivities((current) =>
      current.map((activity) => (activity.id === id ? { ...activity, ...patch } : activity)),
    );
    setError('');
  }

  async function save() {
    if (saving) return;
    setError('');
    if (!purpose.trim()) {
      setError('Purpose is required.');
      return;
    }
    if (activities.length === 0) {
      setError('At least one activity is required.');
      return;
    }
    if (
      activities.some(
        (activity) =>
          !activity.title.trim() ||
          !activity.startDate ||
          !activity.endDate ||
          new Date(activity.endDate) < new Date(activity.startDate),
      )
    ) {
      setError('Each activity needs a title and a valid start/end date range.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Record a short reason for the correction.');
      return;
    }
    if (scheduleChanged && allocationId) {
      setError(
        'The schedule changed while a vehicle/driver allocation is active. Cancel that allocation first, then save the corrected dates and reassign resources.',
      );
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(
        `/api/transport-requests/${requestId}/transport-review-correction`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            purpose: purpose.trim(),
            specialRequirements: specialRequirements.trim() || null,
            reason: reason.trim(),
            activities: activities.map((activity) => ({
              title: activity.title.trim(),
              description: activity.description.trim(),
              venue: activity.venue.trim(),
              startDate: activity.startDate,
              endDate: activity.endDate,
              estimatedKilometres: Number(activity.estimatedKilometres || 0),
            })),
          }),
        },
      );
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Unable to save Transport Review corrections.');

      setReason('');
      toast({
        title: 'Transport Review corrections saved',
        description: `${requestReference} remains in Transport Review. The active approval route was not restarted.`,
        variant: 'success',
      });
      setOpen(false);
      router.refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to save corrections.';
      setError(message);
      toast({ title: 'Correction failed', description: message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="text-brand-700 h-5 w-5" aria-hidden="true" />
              Request &amp; Schedule Corrections
            </CardTitle>
            <p className="text-ink-500 mt-1 text-xs leading-5">
              Correct request details or dates during Transport Review without restarting the approval route.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setOpen((current) => !current);
              setError('');
            }}
            aria-expanded={open}
          >
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {open ? 'Close Corrections' : 'Review Corrections'}
          </Button>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="space-y-5 border-t border-border pt-5">
          {allocationId && (
            <div className="border-status-pending-border bg-status-pending-bg text-status-pending-text rounded-[8px] border px-4 py-3 text-xs leading-5">
              A live vehicle/driver allocation already exists. You can still correct descriptive details. If the dates must change, cancel the current allocation first so availability and driver compliance can be checked again against the new schedule.{' '}
              <Link href={`/dashboard/allocations/${allocationId}`} className="font-semibold underline underline-offset-2">
                Manage allocation
              </Link>
            </div>
          )}

          <div className="grid gap-4">
            <label className="text-ink-500 text-xs font-medium">
              Purpose / reason for travel *
              <textarea
                value={purpose}
                onChange={(event) => {
                  setPurpose(event.target.value);
                  setError('');
                }}
                rows={3}
                maxLength={2000}
                className={`${fieldClass} mt-1`}
              />
            </label>
            <label className="text-ink-500 text-xs font-medium">
              Special requirements
              <textarea
                value={specialRequirements}
                onChange={(event) => {
                  setSpecialRequirements(event.target.value);
                  setError('');
                }}
                rows={2}
                maxLength={2000}
                placeholder="Operational requirements, access needs, equipment or other reviewer notes…"
                className={`${fieldClass} mt-1`}
              />
            </label>
          </div>

          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-ink-950 text-sm font-semibold">Activities &amp; schedule</p>
                <p className="text-ink-500 mt-0.5 text-xs">
                  Dates remain subject to the linked programme boundary and operational availability.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setActivities((current) => [
                    ...current,
                    {
                      id: nextId(),
                      title: '',
                      description: '',
                      venue: '',
                      startDate: '',
                      endDate: '',
                      estimatedKilometres: 0,
                    },
                  ])
                }
              >
                <Plus className="h-4 w-4" /> Add Activity
              </Button>
            </div>

            {activities.map((activity, index) => (
              <div key={activity.id} className="border-border rounded-[10px] border p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-ink-500 text-xs font-semibold">Activity {index + 1}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove activity ${index + 1}`}
                    onClick={() => {
                      setActivities((current) => current.filter((item) => item.id !== activity.id));
                      setError('');
                    }}
                  >
                    <Trash2 className="text-status-error-text h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-ink-500 text-xs font-medium sm:col-span-2">
                    Title *
                    <input
                      value={activity.title}
                      onChange={(event) => patchActivity(activity.id, { title: event.target.value })}
                      className={`${fieldClass} mt-1`}
                    />
                  </label>
                  <label className="text-ink-500 text-xs font-medium">
                    Venue
                    <input
                      value={activity.venue}
                      onChange={(event) => patchActivity(activity.id, { venue: event.target.value })}
                      className={`${fieldClass} mt-1`}
                    />
                  </label>
                  <label className="text-ink-500 text-xs font-medium">
                    Estimated km
                    <input
                      type="number"
                      min="0"
                      value={activity.estimatedKilometres || ''}
                      onChange={(event) =>
                        patchActivity(activity.id, {
                          estimatedKilometres: Number(event.target.value || 0),
                        })
                      }
                      className={`${fieldClass} mt-1`}
                    />
                  </label>
                  <div>
                    <label className="text-ink-500 mb-1 block text-xs font-medium">Start date *</label>
                    <DatePicker
                      value={activity.startDate}
                      onChange={(value) => patchActivity(activity.id, { startDate: value })}
                    />
                  </div>
                  <div>
                    <label className="text-ink-500 mb-1 block text-xs font-medium">End date *</label>
                    <DatePicker
                      value={activity.endDate}
                      min={activity.startDate || undefined}
                      onChange={(value) => patchActivity(activity.id, { endDate: value })}
                    />
                  </div>
                  <label className="text-ink-500 text-xs font-medium sm:col-span-2">
                    Description
                    <textarea
                      value={activity.description}
                      onChange={(event) => patchActivity(activity.id, { description: event.target.value })}
                      rows={2}
                      className={`${fieldClass} mt-1`}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>

          <label className="text-ink-500 block text-xs font-medium">
            Correction reason *
            <textarea
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setError('');
              }}
              rows={3}
              maxLength={500}
              placeholder="Explain what you corrected and why…"
              className={`${fieldClass} mt-1`}
            />
            <span className="mt-1.5 block font-normal">
              This reason is written to the audit trail. The final Transport Review decision can still carry its own approval comment.
            </span>
          </label>

          {error && (
            <div
              role="alert"
              className="border-status-error-border bg-status-error-bg text-status-error-text rounded-[8px] border px-4 py-3 text-sm"
            >
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => void save()} loading={saving} disabled={saving}>
              <Save className="h-4 w-4" /> Save Corrections
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setError('');
              }}
              disabled={saving}
            >
              Close
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
