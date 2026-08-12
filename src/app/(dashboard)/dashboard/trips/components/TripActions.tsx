'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { CheckSquare, KeyRound, Repeat, Clock3 } from 'lucide-react';
import Link from 'next/link';
import { VehicleReplacementDialog } from '@/components/allocations/VehicleReplacementDialog';

interface TripActionsProps {
  tripId: string;
  allocationId: string;
  status: string;
  hasIssue?: boolean;
  hasAcknowledge?: boolean;
  hasDepartureInspection?: boolean;
  vehicleId: string;
  vehicle?: {
    id: string;
    make: string;
    model: string;
    licenceNumber: string;
    currentOdometer: number | null;
  };
  canManage: boolean;
  canDrive: boolean;
  canInspect: boolean;
  canReplaceVehicle: boolean;
  currentOdometer?: number;
}

export function TripActions({
  tripId,
  allocationId,
  status,
  hasIssue,
  hasAcknowledge,
  hasDepartureInspection,
  vehicleId,
  vehicle,
  canManage,
  canInspect,
  canReplaceVehicle = false,
  currentOdometer,
}: TripActionsProps) {
  const router = useRouter();
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState('');
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false);

  const midTrip = status === 'in_progress';

  const handleReplaceSuccess = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleDepartureInspection = useCallback(() => {
    router.push(`/dashboard/inspections/new?type=departure&tripId=${tripId}&vehicleId=${vehicleId}`);
  }, [tripId, vehicleId, router]);

  const handleIssueVehicle = useCallback(async () => {
    setIsWorking(true);
    setError('');
    try {
      const res = await fetch(`/api/trips/${tripId}/issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keysIssued: true,
          fuelCardIssued: true,
          issueOdometer: currentOdometer,
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to issue vehicle');
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue vehicle');
    } finally {
      setIsWorking(false);
    }
  }, [tripId, currentOdometer, router]);

  const replacementDialog = canReplaceVehicle && allocationId && vehicle ? (
    <VehicleReplacementDialog
      open={replaceDialogOpen}
      onOpenChange={setReplaceDialogOpen}
      allocationId={allocationId}
      currentVehicle={vehicle}
      midTrip={midTrip}
      onSuccess={handleReplaceSuccess}
    />
  ) : null;

  if (status === 'pending') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {canInspect && !hasAcknowledge && !hasDepartureInspection && (
          <span
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-status-pending-bg/40 bg-status-pending-bg/10 px-2.5 py-1.5 text-xs text-status-pending-text"
            title="The assigned driver must accept the Trip Authority before the official departure inspection can begin."
          >
            <Clock3 className="h-3.5 w-3.5" />
            Waiting for driver acknowledgement
          </span>
        )}
        {canInspect && hasAcknowledge && !hasDepartureInspection && (
          <Button variant="secondary" size="sm" onClick={handleDepartureInspection}>
            <CheckSquare className="h-4 w-4" /> Departure Inspection
          </Button>
        )}
        {canReplaceVehicle && allocationId && !hasIssue && (
          <Button variant="secondary" size="sm" onClick={() => setReplaceDialogOpen(true)}>
            <Repeat className="h-4 w-4" /> Replace Vehicle
          </Button>
        )}
        {canManage && hasAcknowledge && hasDepartureInspection && !hasIssue && (
          <Button variant="secondary" size="sm" loading={isWorking} onClick={handleIssueVehicle}>
            <KeyRound className="h-4 w-4" /> Issue Vehicle
          </Button>
        )}
        {hasIssue && (
          <span className="inline-flex items-center gap-1.5 text-xs text-status-success-text">
            <CheckSquare className="h-3.5 w-3.5" /> Vehicle issued — waiting for the driver to start the trip
          </span>
        )}
        {error && <p className="mt-1 w-full text-xs text-status-error-text">{error}</p>}
        {replacementDialog}
      </div>
    );
  }

  if (status === 'in_progress') {
    return (
      <div>
        <div className="flex flex-wrap gap-2">
          {canReplaceVehicle && allocationId && (
            <Button variant="secondary" size="sm" onClick={() => setReplaceDialogOpen(true)}>
              <Repeat className="h-4 w-4" /> Replace Vehicle
            </Button>
          )}
        </div>
        {error && <p className="mt-1 text-xs text-status-error-text">{error}</p>}
        {replacementDialog}
      </div>
    );
  }

  if (status === 'return_inspection') {
    return (
      <div className="flex flex-wrap gap-2">
        {canInspect ? (
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/dashboard/inspections/new?type=return&tripId=${tripId}&vehicleId=${vehicleId}`}>
              <CheckSquare className="h-4 w-4" /> Complete Return Inspection
            </Link>
          </Button>
        ) : (
          <span className="text-xs text-ink-500">Waiting for the authorised return inspection.</span>
        )}
      </div>
    );
  }

  if (status === 'closure_review') {
    return canManage ? (
      <Button variant="primary" size="sm" asChild>
        <Link href="/dashboard/trips/closure-review">
          <CheckSquare className="h-4 w-4" /> Open Closure Review
        </Link>
      </Button>
    ) : (
      <span className="text-xs text-ink-500">Awaiting Transport Office reconciliation.</span>
    );
  }

  return null;
}
