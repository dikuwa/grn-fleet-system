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
import { Loader2, AlertCircle, CheckCircle2, Car, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VehicleOption {
  id: string;
  label: string;
  odometer: number | null;
  status: string;
  hasWarnings: boolean;
  available: boolean;
}

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
  midTrip: boolean; // if true, handoverOdometer is required
  onSuccess: (result: { replacementVehicleId: string; originalVehicleId: string; handoverOdometer: number | null }) => void;
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
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleOption | null>(null);

  const fetchVehicles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/allocations/${allocationId}/replacement-candidates`);
      if (!res.ok) throw new Error('Failed to load replacement candidates');
      const data = await res.json();
      const options = (data.vehicles || []).map((v: any) => ({
        id: v.id,
        label: `${v.make} ${v.model} (${v.licenceNumber})${v.vehicleRegisterNumber ? ` — ${v.vehicleRegisterNumber}` : ''}`,
        odometer: v.currentOdometer,
        status: v.status,
        hasWarnings: false,
        available: !!v.available,
      }));
      setVehicles(options);
    } catch (err) {
      console.error('Failed to fetch replacement candidates:', err);
    } finally {
      setLoading(false);
    }
  }, [allocationId]);

  const handleVehicleChange = (value: string) => {
    setSelectedVehicleId(value);
    setError('');
    if (!value) {
      setSelectedVehicle(null);
      return;
    }
    const vehicle = vehicles.find((v) => v.id === value);
    if (vehicle) {
      setSelectedVehicle({ ...vehicle });
    }
  };

  // Fetch vehicles when dialog opens
  useEffect(() => {
    if (open) {
      fetchVehicles();
    }
  }, [open, fetchVehicles]);

  const handleSubmit = async () => {
    if (!selectedVehicleId) {
      setError('Please select a replacement vehicle');
      return;
    }
    if (!reason.trim()) {
      setError('A reason for replacement is required');
      return;
    }
    if (midTrip && (handoverOdometer === null || handoverOdometer === undefined)) {
      setError('Odometer reading at handover is required for mid-trip replacements');
      return;
    }

    const vehicle = vehicles.find((v) => v.id === selectedVehicleId);
    if (!vehicle?.available) {
      setError('Selected vehicle is not available for this period');
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
          reason: reason.trim(),
          handoverOdometer: midTrip ? handoverOdometer : null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to replace vehicle');
      }

      const result = await res.json();
      onSuccess(result);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to replace vehicle');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'success' | 'warning' | 'error' | 'info'> = {
      available: 'success',
      provisional: 'info',
      allocated: 'warning',
      issued: 'warning',
      maintenance: 'error',
      out_of_service: 'error',
      written_off: 'error',
    };
    return variants[status] || 'info';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Replace Vehicle</DialogTitle>
          <DialogDescription>
            Select a replacement vehicle for the current allocation. The original
            vehicle ({currentVehicle.make} {currentVehicle.model}, {currentVehicle.licenceNumber})
            will be recorded for kilometre tracking purposes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Current vehicle display */}
          <div className="rounded-[10px] border border-border bg-surface p-4">
            <div className="flex items-center gap-3">
              <Car className="h-5 w-5 text-ink-400" />
              <div>
                <p className="text-sm font-medium text-ink-950">Current Vehicle</p>
                <p className="text-sm text-ink-500">
                  {currentVehicle.make} {currentVehicle.model} — {currentVehicle.licenceNumber}
                </p>
                {currentVehicle.currentOdometer !== null && (
                  <p className="text-xs text-ink-400">Odometer: {currentVehicle.currentOdometer.toLocaleString()} km</p>
                )}
              </div>
            </div>
          </div>

          {/* Replacement vehicle selector */}
          <div className="space-y-2">
            <Label htmlFor="replacement-vehicle">Replacement Vehicle</Label>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-ink-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading available vehicles…
              </div>
            ) : (
              <Select
                value={selectedVehicleId}
                onValueChange={handleVehicleChange}
                disabled={loading}
              >
                <SelectTrigger id="replacement-vehicle" className="w-full">
                  <SelectValue placeholder="Select a vehicle…" />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.length === 0 ? (
                    <div className="py-4 text-center text-sm text-ink-500">
                      No replacement vehicles available
                    </div>
                  ) : (
                    vehicles.map((v) => (
                      <SelectItem key={v.id} value={v.id} disabled={!v.available}>
                        <div className="flex flex-col gap-0.5 min-w-[280px]">
                          <div className="flex items-center gap-2">
                            <span className="flex-1 font-medium">{v.label}</span>
                            {v.odometer !== null && (
                              <span className="text-xs text-ink-400">{v.odometer.toLocaleString()} km</span>
                            )}
                            <span
                              className={cn(
                                'px-2 py-0.5 text-xs rounded-full',
                                getStatusBadge(v.status) === 'success' && 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
                                getStatusBadge(v.status) === 'warning' && 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
                                getStatusBadge(v.status) === 'error' && 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
                                getStatusBadge(v.status) === 'info' && 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
                              )}
                            >
                              {v.status}
                            </span>
                          </div>
                          {!v.available && (
                            <span className="text-xs text-status-error-text">
                              Not available for the selected period
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Selected vehicle details & availability warnings */}
          {selectedVehicle && (
            <div
              className={cn(
                'rounded-[10px] border p-4',
                selectedVehicle.available
                  ? 'border-border bg-surface'
                  : 'border-status-error-border/50 bg-status-error-bg/50',
              )}
            >
              <div className="flex items-start gap-3">
                {selectedVehicle.available ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-status-success-text" />
                ) : (
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-status-error-text" />
                )}
                <div className="flex-1">
                  <p className={cn('text-sm font-medium', selectedVehicle.available ? 'text-ink-950' : 'text-status-error-text')}>
                    {selectedVehicle.available ? 'Vehicle is available' : 'Vehicle has availability issues'}
                  </p>
                  {selectedVehicle.hasWarnings && (
                    <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                      Vehicle has warnings — review before confirming
                    </p>
                  )}
                  {selectedVehicle.odometer !== null && (
                    <p className="mt-1 text-sm text-ink-500">
                      Current odometer: {selectedVehicle.odometer.toLocaleString()} km
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="replacement-reason">Reason for Replacement *</Label>
            <Textarea
              id="replacement-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Mechanical breakdown, accident damage, scheduled maintenance"
              rows={3}
              className={error ? 'border-status-error-border' : ''}
            />
          </div>

          {/* Handover odometer (mid-trip only) */}
          {midTrip && (
            <div className="space-y-2">
              <Label htmlFor="handover-odometer">Handover Odometer Reading *</Label>
              <Input
                id="handover-odometer"
                type="number"
                min="0"
                value={handoverOdometer ?? ''}
                onChange={(e) => setHandoverOdometer(e.target.value ? Number(e.target.value) : null)}
                placeholder="Enter odometer reading at vehicle swap"
                className={error ? 'border-status-error-border' : ''}
              />
              <p className="text-xs text-ink-500">
                The odometer reading of the original vehicle at the moment of handover.
                This is required for per-vehicle kilometre separation at trip closure.
              </p>
              {currentVehicle.currentOdometer !== null && (
                <p className="text-xs text-ink-400">
                  Current vehicle odometer: {currentVehicle.currentOdometer.toLocaleString()} km
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-[8px] border border-status-error-border bg-status-error-bg/50 p-3 text-sm text-status-error-text">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !selectedVehicleId || !reason.trim() || (midTrip && handoverOdometer === null)}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Replacing…
              </>
            ) : (
              <>
                <Truck className="mr-2 h-4 w-4" />
                Replace Vehicle
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}