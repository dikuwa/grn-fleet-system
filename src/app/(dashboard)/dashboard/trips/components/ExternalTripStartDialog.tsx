'use client';

import { useState } from 'react';
import { Play, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/lib/use-toast';

interface ExternalTripStartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: string;
  minimumOdometer?: number;
  onSuccess?: () => void;
}

export function ExternalTripStartDialog({
  open,
  onOpenChange,
  tripId,
  minimumOdometer,
  onSuccess,
}: ExternalTripStartDialogProps) {
  const { toast } = useToast();
  const [beginningOdometer, setBeginningOdometer] = useState(
    minimumOdometer == null ? '' : String(minimumOdometer),
  );
  const [fuelLevel, setFuelLevel] = useState('');
  const [passengersConfirmed, setPassengersConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setBeginningOdometer(minimumOdometer == null ? '' : String(minimumOdometer));
    setFuelLevel('');
    setPassengersConfirmed(false);
    setError('');
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen && !submitting) reset();
  };

  const handleSubmit = async () => {
    const odometer = Number(beginningOdometer);
    if (!Number.isInteger(odometer) || odometer < 0) {
      setError('Enter a valid whole-number beginning odometer reading.');
      return;
    }
    if (minimumOdometer != null && odometer < minimumOdometer) {
      setError(`Beginning odometer cannot be lower than ${minimumOdometer.toLocaleString()} km.`);
      return;
    }
    if (!fuelLevel.trim()) {
      setError('Record the vehicle fuel level before departure.');
      return;
    }
    if (!passengersConfirmed) {
      setError('Confirm the actual passengers before recording departure.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/trips/${tripId}/external-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          beginningOdometer: odometer,
          fuelLevel: fuelLevel.trim(),
          passengersConfirmed: true,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json.error || 'External-driver departure could not be recorded.');
      }

      toast({
        title: 'External-driver trip started',
        description: 'Transport Office recorded the authorised departure and the trip is now in progress.',
        variant: 'success',
      });
      onOpenChange(false);
      reset();
      onSuccess?.();
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : 'External-driver departure could not be recorded.';
      setError(message);
      toast({ title: 'Departure could not be recorded', description: message, variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record external-driver departure</DialogTitle>
          <DialogDescription>
            The vehicle has already been physically issued. Confirm the actual departure details before moving this trip into progress.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`external-start-odometer-${tripId}`} required>
              Beginning odometer
            </Label>
            <Input
              id={`external-start-odometer-${tripId}`}
              type="number"
              min={minimumOdometer ?? 0}
              step={1}
              inputMode="numeric"
              value={beginningOdometer}
              onChange={(event) => setBeginningOdometer(event.target.value)}
              placeholder="Current verified odometer"
              disabled={submitting}
            />
            {minimumOdometer != null && (
              <p className="text-ink-500 text-xs">
                Must be at least {minimumOdometer.toLocaleString()} km.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`external-start-fuel-${tripId}`} required>
              Fuel level at departure
            </Label>
            <Input
              id={`external-start-fuel-${tripId}`}
              value={fuelLevel}
              onChange={(event) => setFuelLevel(event.target.value)}
              placeholder="e.g. Full, 3/4, 75%"
              maxLength={40}
              disabled={submitting}
            />
          </div>

          <button
            type="button"
            aria-pressed={passengersConfirmed}
            onClick={() => setPassengersConfirmed((value) => !value)}
            disabled={submitting}
            className={`focus-ring flex w-full items-start gap-3 rounded-[10px] border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              passengersConfirmed
                ? 'border-status-success-border bg-status-success-bg/30'
                : 'border-border bg-surface hover:bg-muted/40'
            }`}
          >
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs font-bold ${
                passengersConfirmed
                  ? 'border-status-success-text bg-status-success-text text-white'
                  : 'border-ink-300 bg-surface text-transparent'
              }`}
              aria-hidden="true"
            >
              ✓
            </span>
            <span>
              <span className="text-ink-950 flex items-center gap-1.5 text-sm font-medium">
                <Users className="h-4 w-4" /> Actual passengers confirmed
              </span>
              <span className="text-ink-500 mt-0.5 block text-xs leading-5">
                Confirm that the passengers physically departing match the authorised trip record, including any approved changes.
              </span>
            </span>
          </button>

          {error && (
            <p className="text-status-error-text text-xs" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSubmit()} loading={submitting}>
            <Play className="h-4 w-4" /> Start trip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
