'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';

type Driver = {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  driverStatus: string;
  hasValidLicence?: boolean;
  nextExpiry?: { licenceClass?: string; expiryDate?: string } | null;
};

type AuthorisedDriver = {
  id: string;
  employeeId: string;
  driverType: string;
  firstName?: string | null;
  lastName?: string | null;
  employeeNumber?: string | null;
  reason?: string | null;
  takeoverOdometer?: number | null;
  acknowledgedAt?: string | null;
};

type TripContext = {
  trip?: {
    driverEmployeeId?: string | null;
    licenceNumber?: string | null;
    make?: string | null;
    model?: string | null;
    requestReference?: string | null;
  };
  authorisedDrivers?: AuthorisedDriver[];
};

export function DriverHandoverDialog({
  open,
  onOpenChange,
  tripId,
  currentOdometer,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: string;
  currentOdometer?: number;
  onSuccess?: () => void;
}) {
  const { toast } = useToast();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [tripContext, setTripContext] = useState<TripContext | null>(null);
  const [driverId, setDriverId] = useState('');
  const [odometer, setOdometer] = useState(currentOdometer != null ? String(currentOdometer) : '');
  const [reason, setReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError('');
    try {
      const [driversResponse, tripResponse] = await Promise.all([
        fetch('/api/drivers?status=valid&limit=100', { cache: 'no-store' }),
        fetch(`/api/trips/${tripId}`, { cache: 'no-store' }),
      ]);
      const driversJson = await driversResponse.json().catch(() => ({}));
      const tripJson = await tripResponse.json().catch(() => ({}));
      if (!driversResponse.ok) throw new Error(driversJson.error || 'Could not load eligible drivers');
      if (!tripResponse.ok) throw new Error(tripJson.error || 'Could not load the active trip');
      setDrivers(Array.isArray(driversJson.data) ? driversJson.data : []);
      setTripContext(tripJson);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load handover details');
    } finally {
      setLoading(false);
    }
  }, [open, tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (open && currentOdometer != null) setOdometer(String(currentOdometer));
    if (!open) {
      setDriverId('');
      setReason('');
      setCancelReason('');
      setError('');
    }
  }, [currentOdometer, open]);

  const pendingHandover = useMemo(
    () =>
      tripContext?.authorisedDrivers?.find(
        (driver) => driver.driverType === 'relief' && !driver.acknowledgedAt,
      ) ?? null,
    [tripContext?.authorisedDrivers],
  );

  const eligibleDrivers = useMemo(
    () =>
      drivers.filter(
        (driver) =>
          driver.id !== tripContext?.trip?.driverEmployeeId &&
          driver.driverStatus === 'authorised' &&
          driver.hasValidLicence !== false,
      ),
    [drivers, tripContext?.trip?.driverEmployeeId],
  );

  const submit = useCallback(async () => {
    const handoverOdometer = Number(odometer);
    const cleanReason = reason.trim();
    if (!driverId) {
      setError('Select the relief driver.');
      return;
    }
    if (!Number.isInteger(handoverOdometer) || handoverOdometer < 0) {
      setError('Enter the vehicle odometer at the handover point.');
      return;
    }
    if (cleanReason.length < 10) {
      setError('Explain the handover reason using at least 10 characters.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/trips/${tripId}/driver-handover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'initiate',
          newDriverEmployeeId: driverId,
          handoverOdometer,
          reason: cleanReason,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Driver handover could not be saved');
      toast({
        title: 'Driver handover prepared',
        description: `${json.newDriver || 'The relief driver'} must acknowledge before the live assignment transfers.`,
        variant: 'success',
      });
      await load();
      onSuccess?.();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Driver handover could not be saved';
      setError(message);
      toast({ title: 'Handover failed', description: message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  }, [driverId, load, odometer, onSuccess, reason, toast, tripId]);

  const cancelPending = useCallback(async () => {
    const cleanReason = cancelReason.trim();
    if (cleanReason.length < 10) {
      setError('Enter a cancellation reason of at least 10 characters.');
      return;
    }
    setCancelling(true);
    setError('');
    try {
      const response = await fetch(`/api/trips/${tripId}/driver-handover/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cleanReason }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Pending handover could not be cancelled');
      toast({
        title: 'Pending handover cancelled',
        description: `${json.reliefDriver || 'The relief driver'} was notified. The current driver remains assigned.`,
        variant: 'success',
      });
      setCancelReason('');
      await load();
      onSuccess?.();
    } catch (cancelError) {
      const message = cancelError instanceof Error ? cancelError.message : 'Pending handover could not be cancelled';
      setError(message);
      toast({ title: 'Cancellation failed', description: message, variant: 'error' });
    } finally {
      setCancelling(false);
    }
  }, [cancelReason, load, onSuccess, toast, tripId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hand over to another driver</DialogTitle>
          <DialogDescription>
            During an active trip, the current driver remains assigned until the selected relief driver reviews and accepts the handover.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-ink-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading handover details…
          </div>
        ) : pendingHandover ? (
          <div className="space-y-4">
            <div className="rounded-[8px] border border-status-warning-text/25 bg-status-warning-bg/30 p-4">
              <p className="text-sm font-semibold text-ink-950">Awaiting relief-driver acknowledgement</p>
              <p className="mt-1 text-sm text-ink-700">
                {[pendingHandover.firstName, pendingHandover.lastName].filter(Boolean).join(' ') || pendingHandover.employeeNumber || 'Relief driver'}
              </p>
              <div className="mt-3 space-y-1 text-xs text-ink-600">
                <p>Takeover odometer: {pendingHandover.takeoverOdometer?.toLocaleString() ?? '—'} km</p>
                <p>Reason: {pendingHandover.reason || 'Operational handover'}</p>
              </div>
              <p className="mt-3 text-xs text-ink-500">The current driver remains the live assigned driver until this acknowledgement completes.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cancel-handover-reason">Cancel pending handover</Label>
              <Textarea
                id="cancel-handover-reason"
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="Explain why this proposed handover is no longer required"
                rows={3}
                maxLength={500}
              />
              <p className="text-xs text-ink-500">Required to cancel · 10–500 characters · retained in the audit trail.</p>
            </div>
            {error && <p className="text-xs text-status-error-text" role="alert">{error}</p>}
          </div>
        ) : (
          <div className="space-y-4">
            {tripContext?.trip && (
              <div className="rounded-[8px] border border-border bg-muted/40 p-3 text-xs text-ink-600">
                <p className="font-medium text-ink-900">{tripContext.trip.requestReference || 'Active trip'}</p>
                <p className="mt-1">{tripContext.trip.licenceNumber || 'Vehicle'} · {[tripContext.trip.make, tripContext.trip.model].filter(Boolean).join(' ')}</p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="relief-driver">Relief driver</Label>
              <StyledSelect
                id="relief-driver"
                value={driverId}
                onChange={(event) => setDriverId(event.target.value)}
                placeholder="Select an eligible driver"
              >
                <option value="">Select an eligible driver</option>
                {eligibleDrivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.firstName} {driver.lastName} · {driver.employeeNumber}
                    {driver.nextExpiry?.licenceClass ? ` · ${driver.nextExpiry.licenceClass}` : ''}
                  </option>
                ))}
              </StyledSelect>
              {eligibleDrivers.length === 0 && (
                <p className="text-xs text-status-warning-text">No other active driver with a verified valid licence is currently available in the driver register.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="handover-odometer">Handover odometer</Label>
              <Input
                id="handover-odometer"
                type="number"
                min={0}
                step={1}
                value={odometer}
                onChange={(event) => setOdometer(event.target.value)}
                placeholder="Current vehicle odometer"
              />
              <p className="text-xs text-ink-500">This closes the outgoing driver's segment and becomes the relief driver's takeover reading once accepted.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="handover-reason">Reason</Label>
              <Textarea
                id="handover-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explain why the driver is changing during the active trip"
                rows={4}
                maxLength={500}
              />
              <p className="text-xs text-ink-500">Required · 10–500 characters · retained in the authority amendment and audit trail.</p>
            </div>

            {error && <p className="text-xs text-status-error-text" role="alert">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" disabled={saving || cancelling} onClick={() => onOpenChange(false)}>Close</Button>
          {pendingHandover ? (
            <Button variant="destructive" loading={cancelling} onClick={() => void cancelPending()}>
              <XCircle className="h-4 w-4" /> Cancel pending handover
            </Button>
          ) : (
            <Button disabled={loading || eligibleDrivers.length === 0} loading={saving} onClick={() => void submit()}>
              <ArrowRightLeft className="h-4 w-4" /> Prepare handover
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
