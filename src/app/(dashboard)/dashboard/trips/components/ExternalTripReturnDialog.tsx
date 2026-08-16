'use client';

import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
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
import { useToast } from '@/lib/use-toast';

interface ExternalTripReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: string;
  minimumOdometer?: number;
  onSuccess?: () => void;
}

export function ExternalTripReturnDialog({
  open,
  onOpenChange,
  tripId,
  minimumOdometer,
  onSuccess,
}: ExternalTripReturnDialogProps) {
  const { toast } = useToast();
  const [endingOdometer, setEndingOdometer] = useState(
    minimumOdometer == null ? '' : String(minimumOdometer),
  );
  const [fuelLevel, setFuelLevel] = useState('');
  const [returnLocation, setReturnLocation] = useState('');
  const [incidentDeclared, setIncidentDeclared] = useState(false);
  const [outstandingReceiptsDeclared, setOutstandingReceiptsDeclared] = useState(false);
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setEndingOdometer(minimumOdometer == null ? '' : String(minimumOdometer));
    setFuelLevel('');
    setReturnLocation('');
    setIncidentDeclared(false);
    setOutstandingReceiptsDeclared(false);
    setComments('');
    setError('');
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen && !submitting) reset();
  };

  const handleSubmit = async () => {
    const odometer = Number(endingOdometer);
    if (!Number.isInteger(odometer) || odometer < 0) {
      setError('Enter a valid whole-number ending odometer reading.');
      return;
    }
    if (minimumOdometer != null && odometer < minimumOdometer) {
      setError(`Ending odometer cannot be lower than ${minimumOdometer.toLocaleString()} km.`);
      return;
    }
    if (!fuelLevel.trim() || !returnLocation.trim()) {
      setError('Fuel level and physical return location are required.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/trips/${tripId}/external-return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endingOdometer: odometer,
          fuelLevel: fuelLevel.trim(),
          returnLocation: returnLocation.trim(),
          incidentDeclared,
          outstandingReceiptsDeclared,
          comments: comments.trim() || undefined,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json.error || 'External-driver return could not be recorded.');
      }

      toast({
        title: 'External-driver return recorded',
        description: 'The trip is now waiting for the authorised arrival inspection.',
        variant: 'success',
      });
      onOpenChange(false);
      reset();
      onSuccess?.();
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : 'External-driver return could not be recorded.';
      setError(message);
      toast({ title: 'Return could not be recorded', description: message, variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record external-driver return</DialogTitle>
          <DialogDescription>
            Confirm the physical vehicle return. This moves the trip to arrival inspection; it does not close or reconcile the trip.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`external-return-odometer-${tripId}`} required>
              Ending odometer
            </Label>
            <Input
              id={`external-return-odometer-${tripId}`}
              type="number"
              min={minimumOdometer ?? 0}
              step={1}
              inputMode="numeric"
              value={endingOdometer}
              onChange={(event) => setEndingOdometer(event.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`external-return-fuel-${tripId}`} required>
              Fuel level on return
            </Label>
            <Input
              id={`external-return-fuel-${tripId}`}
              value={fuelLevel}
              onChange={(event) => setFuelLevel(event.target.value)}
              placeholder="e.g. Half, 1/4, 40%"
              maxLength={40}
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`external-return-location-${tripId}`} required>
              Physical return location
            </Label>
            <Input
              id={`external-return-location-${tripId}`}
              value={returnLocation}
              onChange={(event) => setReturnLocation(event.target.value)}
              placeholder="Fleet yard, office or handover point"
              maxLength={240}
              disabled={submitting}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              aria-pressed={incidentDeclared}
              onClick={() => setIncidentDeclared((value) => !value)}
              disabled={submitting}
              className={`focus-ring rounded-[8px] border p-3 text-left text-sm transition-colors disabled:opacity-60 ${
                incidentDeclared
                  ? 'border-status-warning-border bg-status-warning-bg/30 text-ink-950'
                  : 'border-border bg-surface text-ink-700 hover:bg-muted/40'
              }`}
            >
              <span className="font-medium">Incident or damage declared</span>
              <span className="text-ink-500 mt-1 block text-xs">Select when an incident, damage or defect must be reconciled.</span>
            </button>
            <button
              type="button"
              aria-pressed={outstandingReceiptsDeclared}
              onClick={() => setOutstandingReceiptsDeclared((value) => !value)}
              disabled={submitting}
              className={`focus-ring rounded-[8px] border p-3 text-left text-sm transition-colors disabled:opacity-60 ${
                outstandingReceiptsDeclared
                  ? 'border-status-warning-border bg-status-warning-bg/30 text-ink-950'
                  : 'border-border bg-surface text-ink-700 hover:bg-muted/40'
              }`}
            >
              <span className="font-medium">Outstanding receipts declared</span>
              <span className="text-ink-500 mt-1 block text-xs">Select when fuel or trip evidence is still outstanding.</span>
            </button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`external-return-comments-${tripId}`}>Return comments</Label>
            <Textarea
              id={`external-return-comments-${tripId}`}
              value={comments}
              onChange={(event) => setComments(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Optional handover or return notes"
              disabled={submitting}
            />
          </div>

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
            <RotateCcw className="h-4 w-4" /> Record return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
