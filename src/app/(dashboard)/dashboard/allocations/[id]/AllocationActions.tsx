'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Truck, XCircle, Info } from 'lucide-react';

interface AllocationActionsProps {
  allocationId: string;
  requestId: string;
  vehicleId: string;
  hasTrip: boolean;
}

export function AllocationActions({ allocationId, hasTrip }: AllocationActionsProps) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancellation, setShowCancellation] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');
  const [manualAuthorityNumber, setManualAuthorityNumber] = useState('');
  const [error, setError] = useState('');

  const handleCreateTrip = useCallback(async () => {
    setIsCreating(true);
    setError('');
    try {
      const confirmRes = await fetch(`/api/allocations/${allocationId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionType: 'confirm' }),
      });
      if (!confirmRes.ok) {
        const confirmData = await confirmRes.json();
        throw new Error(confirmData.error || 'Failed to confirm allocation');
      }

      const tripRes = await fetch('/api/trips/create-from-allocation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allocationId,
          manualAuthorityNumber: manualAuthorityNumber.trim() || undefined,
        }),
      });
      const tripData = await tripRes.json();
      if (!tripRes.ok) throw new Error(tripData.error || 'Failed to create trip');

      setManualAuthorityNumber('');
      router.push(`/dashboard/trips/${tripData.trip.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create trip');
    } finally {
      setIsCreating(false);
    }
  }, [allocationId, manualAuthorityNumber, router]);

  const handleCancelAllocation = useCallback(async () => {
    const reason = cancellationReason.trim();
    if (!reason) {
      setError('Enter a reason before cancelling this allocation.');
      return;
    }

    setIsCancelling(true);
    setError('');
    try {
      const response = await fetch(`/api/allocations/${allocationId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionType: 'cancel', reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to cancel allocation');

      setCancellationReason('');
      setShowCancellation(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel allocation');
    } finally {
      setIsCancelling(false);
    }
  }, [allocationId, cancellationReason, router]);

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex w-full flex-col items-end gap-2">
        {!hasTrip && (
          <div className="border-border bg-surface w-full max-w-sm min-w-[260px] rounded-[8px] border p-3 text-left shadow-sm">
            <label
              htmlFor={`manual-authority-number-${allocationId}`}
              className="text-ink-700 mb-1.5 block text-xs font-medium"
            >
              Physical Trip Authority Number{' '}
              <span className="text-ink-400 font-normal">(optional)</span>
            </label>
            <input
              id={`manual-authority-number-${allocationId}`}
              type="text"
              value={manualAuthorityNumber}
              onChange={(event) => setManualAuthorityNumber(event.target.value)}
              maxLength={60}
              placeholder="e.g. 5886775 or KERC/TA/00451/26"
              className="border-border bg-background text-ink-950 placeholder:text-ink-400 focus:border-ink-400 focus:ring-ink-200 w-full rounded-[8px] border px-3 py-2 text-sm transition-colors outline-none focus:ring-2"
            />
            <p className="text-ink-500 mt-1.5 flex items-start gap-1.5 text-xs">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Use the number printed on the physical authority book if you need the digital record
              to match the paper copy. It will be reserved for this request and applied when final
              authorisation is completed. Leave it blank and GRN FLEET will generate a unique
              number automatically.
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {!hasTrip && (
            <Button variant="primary" size="sm" loading={isCreating} onClick={handleCreateTrip}>
              <Truck className="h-4 w-4" /> Create Trip
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setShowCancellation((current) => !current);
              setError('');
            }}
            disabled={isCreating || isCancelling}
          >
            <XCircle className="h-4 w-4" />
            Cancel Allocation
          </Button>
        </div>
      </div>

      {showCancellation && (
        <div className="border-border bg-surface w-full max-w-sm min-w-[260px] rounded-[8px] border p-3 text-left shadow-sm">
          <label
            htmlFor={`allocation-cancel-reason-${allocationId}`}
            className="text-ink-700 mb-1.5 block text-xs font-medium"
          >
            Cancellation reason <span className="text-status-error-text">*</span>
          </label>
          <textarea
            id={`allocation-cancel-reason-${allocationId}`}
            value={cancellationReason}
            onChange={(event) => setCancellationReason(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Explain why this allocation is being cancelled…"
            className="border-border bg-background text-ink-950 placeholder:text-ink-400 focus:border-ink-400 focus:ring-ink-200 w-full resize-y rounded-[8px] border px-3 py-2 text-sm transition-colors outline-none focus:ring-2"
          />
          <p className="text-ink-500 mt-1.5 text-xs">
            The request will return to Transport Review if the trip has not entered operations.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={isCancelling}
              disabled={!cancellationReason.trim()}
              onClick={handleCancelAllocation}
            >
              Confirm Cancellation
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={isCancelling}
              onClick={() => {
                setShowCancellation(false);
                setCancellationReason('');
                setError('');
              }}
            >
              Keep Allocation
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-status-error-text max-w-sm text-xs">{error}</p>}
    </div>
  );
}
