'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertCircle, CheckCircle2, Car, Truck, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VehicleOption {
  id: string;
  label: string;
  odometer: number | null;
  status: string;
  available: boolean;
}

interface ReplacementCandidate {
  id: string;
  make: string;
  model: string;
  licenceNumber: string;
  vehicleRegisterNumber?: string | null;
  currentOdometer?: number | null;
  status: string;
  available?: boolean;
}

type OutgoingDisposition = 'available' | 'maintenance';

export interface VehicleReplacementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allocationId: string;
  currentVehicle: {
    id: string;
    make: string;
    model: string;
    licenceNumber: string;
    currentOdometer: number | null;
  };
  midTrip: boolean;
  onSuccess: (result: {
    replacementVehicleId: string;
    originalVehicleId: string;
    handoverOdometer: number | null;
    outgoingVehicleDisposition?: OutgoingDisposition | null;
    issueReset?: boolean;
  }) => void;
}

export function VehicleReplacementDialog({
  open,
  onOpenChange,
  allocationId,
  currentVehicle,
  midTrip,
  onSuccess,
}: VehicleReplacementDialogProps) {
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [reason, setReason] = useState('');
  const [handoverOdometer, setHandoverOdometer] = useState<number | null>(null);
  const [outgoingDisposition, setOutgoingDisposition] = useState<OutgoingDisposition>('maintenance');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchVehicles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/allocations/${allocationId}/replacement-candidates`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to load replacement candidates');
      }
      const data = await res.json();
      const options = (data.vehicles || []).map((v: ReplacementCandidate) => ({
        id: v.id,
        label: `${v.make} ${v.model} (${v.licenceNumber})${v.vehicleRegisterNumber ? ` — ${v.vehicleRegisterNumber}` : ''}`,
        odometer: v.currentOdometer ?? null,
        status: v.status,
        available: v.available === true,
      }));
      setVehicles(options);
    } catch (err) {
      setVehicles([]);
      setError(err instanceof Error ? err.message : 'Failed to load replacement candidates');
    } finally {
      setLoading(false);
    }
  }, [allocationId]);

  useEffect(() => {
    if (!open) return;
    setSelectedVehicleId('');
    setReason('');
    setHandoverOdometer(currentVehicle.currentOdometer);
    setOutgoingDisposition('maintenance');
    setError('');
    void fetchVehicles();
  }, [open, fetchVehicles, currentVehicle.currentOdometer]);

  const handleSubmit = async () => {
    const cleanReason = reason.trim();
    if (!selectedVehicleId) {
      setError('Select a replacement vehicle');
      return;
    }
    if (!cleanReason) {
      setError('A reason for replacement is required');
      return;
    }
    if (cleanReason.length > 500) {
      setError('Replacement reason must be 500 characters or fewer');
      return;
    }
    if (midTrip) {
      if (handoverOdometer == null || !Number.isInteger(handoverOdometer) || handoverOdometer < 0) {
        setError('A valid whole-number handover odometer is required');
        return;
      }
      if (
        currentVehicle.currentOdometer != null &&
        handoverOdometer < currentVehicle.currentOdometer
      ) {
        setError(`Handover odometer cannot be below ${currentVehicle.currentOdometer.toLocaleString()} km`);
        return;
      }
    }

    const candidate = vehicles.find((vehicle) => vehicle.id === selectedVehicleId);
    if (!candidate?.available) {
      setError('Selected vehicle is no longer available for this period');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/allocations/${allocationId}/replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          replacementVehicleId: selectedVehicleId,
          reason: cleanReason,
          handoverOdometer: midTrip ? handoverOdometer : null,
          outgoingVehicleDisposition: midTrip ? outgoingDisposition : null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Failed to replace vehicle');
      onSuccess(payload);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to replace vehicle');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Replace Vehicle</DialogTitle>
          <DialogDescription>
            Replace the vehicle without losing the allocation, Trip Authority or kilometre history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-[10px] border border-border bg-surface p-4">
            <div className="flex items-start gap-3">
              <Car className="mt-0.5 h-5 w-5 text-ink-400" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-950">Current vehicle</p>
                <p className="text-sm text-ink-500">
                  {currentVehicle.make} {currentVehicle.model} — {currentVehicle.licenceNumber}
                </p>
                {currentVehicle.currentOdometer != null && (
                  <p className="mt-1 text-xs text-ink-400">
                    Current odometer: {currentVehicle.currentOdometer.toLocaleString()} km
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="replacement-vehicle">Replacement vehicle</Label>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-ink-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading available vehicles…
              </div>
            ) : (
              <Select value={selectedVehicleId} onValueChange={setSelectedVehicleId}>
                <SelectTrigger id="replacement-vehicle" className="w-full">
                  <SelectValue placeholder="Select an available vehicle…" />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.length === 0 ? (
                    <div className="px-3 py-4 text-center text-sm text-ink-500">
                      No replacement vehicles available
                    </div>
                  ) : (
                    vehicles.map((vehicle) => (
                      <SelectItem key={vehicle.id} value={vehicle.id} disabled={!vehicle.available}>
                        {vehicle.label}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}
          </div>

          {selectedVehicle && (
            <div className={cn(
              'flex items-start gap-3 rounded-[10px] border p-3',
              selectedVehicle.available
                ? 'border-border bg-surface'
                : 'border-status-error-border bg-status-error-bg/50',
            )}>
              {selectedVehicle.available ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-status-success-text" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 text-status-error-text" />
              )}
              <div className="text-sm">
                <p className="font-medium text-ink-950">
                  {selectedVehicle.available ? 'Available for this allocation period' : 'Not currently available'}
                </p>
                {selectedVehicle.odometer != null && (
                  <p className="text-xs text-ink-500">
                    Odometer: {selectedVehicle.odometer.toLocaleString()} km
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="replacement-reason">Reason for replacement *</Label>
            <Textarea
              id="replacement-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Explain why the vehicle is being replaced"
            />
            <p className="text-xs text-ink-400">{reason.length}/500</p>
          </div>

          {midTrip && (
            <>
              <div className="space-y-2">
                <Label htmlFor="handover-odometer">Outgoing vehicle handover odometer *</Label>
                <Input
                  id="handover-odometer"
                  type="number"
                  min={currentVehicle.currentOdometer ?? 0}
                  step="1"
                  value={handoverOdometer ?? ''}
                  onChange={(event) =>
                    setHandoverOdometer(event.target.value ? Number(event.target.value) : null)
                  }
                />
                <p className="text-xs text-ink-500">
                  Used to split trip kilometres correctly between the original and replacement vehicles.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="outgoing-disposition">Outgoing vehicle disposition *</Label>
                <Select
                  value={outgoingDisposition}
                  onValueChange={(value) => setOutgoingDisposition(value as OutgoingDisposition)}
                >
                  <SelectTrigger id="outgoing-disposition" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="maintenance">
                      Send to maintenance / keep unavailable
                    </SelectItem>
                    <SelectItem value="available">
                      Available for service
                    </SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-start gap-2 rounded-[8px] border border-border bg-canvas p-3 text-xs text-ink-500">
                  <Wrench className="mt-0.5 h-4 w-4 shrink-0" />
                  Use maintenance for breakdowns, accident damage, safety defects or any vehicle that should not return to the selectable fleet immediately.
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-[8px] border border-status-error-border bg-status-error-bg/50 p-3 text-sm text-status-error-text">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              submitting ||
              loading ||
              !selectedVehicleId ||
              !reason.trim() ||
              (midTrip && handoverOdometer == null)
            }
          >
            {submitting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Replacing…</>
            ) : (
              <><Truck className="mr-2 h-4 w-4" />Replace vehicle</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
