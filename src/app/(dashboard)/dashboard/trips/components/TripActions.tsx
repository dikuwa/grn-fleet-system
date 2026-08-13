'use client';

import { useEffect, useState, useCallback } from 'react';
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
  /** Legacy server hint retained for prop compatibility; release actions use the authoritative readiness API. */
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

type GateStatus = 'pass' | 'fail' | 'blocking' | 'pending';

interface ReadinessResponse {
  gates?: Array<{ key: string; status: GateStatus }>;
}

export function TripActions({
  tripId,
  allocationId,
  status,
  hasIssue,
  hasAcknowledge,
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
  const [departureInspectionStatus, setDepartureInspectionStatus] = useState<GateStatus | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(status === 'pending');

  const midTrip = status === 'in_progress';

  const refreshReadiness = useCallback(async () => {
    if (status !== 'pending') {
      setReadinessLoading(false);
      return;
    }

    setReadinessLoading(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/readiness`, { cache: 'no-store' });
      const json = (await response.json().catch(() => ({}))) as ReadinessResponse & { error?: string };
      if (!response.ok) throw new Error(json.error || 'Unable to check release readiness');
      const departureGate = json.gates?.find((gate) => gate.key === 'departure_inspection');
      setDepartureInspectionStatus(departureGate?.status ?? null);
    } catch (reason) {
      setDepartureInspectionStatus(null);
      setError(reason instanceof Error ? reason.message : 'Unable to check release readiness');
    } finally {
      setReadinessLoading(false);
    }
  }, [status, tripId]);

  useEffect(() => {
    void refreshReadiness();
  }, [refreshReadiness, vehicleId, hasAcknowledge, hasIssue]);

  const handleReplaceSuccess = useCallback(() => {
    setDepartureInspectionStatus(null);
    void refreshReadiness();
    router.refresh();
  }, [refreshReadiness, router]);

  const handleDepartureInspection = useCallback(() => {
    router.push(`/dashboard/inspections/new?type=departure&tripId=${tripId}&vehicleId=${vehicleId}`);
  }, [tripId, vehicleId, router]);

  const handleIssueVehicle = useCallback(async () => {
    setIsWorking(true);
    setError('');
    try {
      // Recheck immediately before the mutation instead of trusting the page's
      // server-rendered inspection summary. The issue API performs the same
      // safety checks atomically as the final authority.
      const readinessResponse = await fetch(`/api/trips/${tripId}/readiness`, { cache: 'no-store' });
      const readiness = (await readinessResponse.json().catch(() => ({}))) as ReadinessResponse & { error?: string };
      if (!readinessResponse.ok) throw new Error(readiness.error || 'Unable to check release readiness');
      const departureGate = readiness.gates?.find((gate) => gate.key === 'departure_inspection');
      setDepartureInspectionStatus(departureGate?.status ?? null);
      if (departureGate?.status !== 'pass') {
        throw new Error('The latest departure inspection for the current vehicle must pass before issue.');
      }

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
    const inspectionPassed = departureInspectionStatus === 'pass';
    const inspectionNeedsWork = departureInspectionStatus === 'pending' || departureInspectionStatus === 'blocking' || departureInspectionStatus === 'fail';

    return (
      <div className="flex flex-wrap items-center gap-2">
        {readinessLoading && (
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-500">
            <Clock3 className="h-3.5 w-3.5" /> Checking release readiness…
          </span>
        )}
        {!readinessLoading && canInspect && !hasAcknowledge && !inspectionPassed && (
          <span
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-status-pending-bg/40 bg-status-pending-bg/10 px-2.5 py-1.5 text-xs text-status-pending-text"
            title="The assigned driver must accept the Trip Authority before the official departure inspection can begin."
          >
            <Clock3 className="h-3.5 w-3.5" />
            Waiting for driver acknowledgement
          </span>
        )}
        {!readinessLoading && canInspect && hasAcknowledge && inspectionNeedsWork && (
          <Button variant="secondary" size="sm" onClick={handleDepartureInspection}>
            <CheckSquare className="h-4 w-4" /> {departureInspectionStatus === 'blocking' || departureInspectionStatus === 'fail' ? 'Repeat Departure Inspection' : 'Departure Inspection'}
          </Button>
        )}
        {canReplaceVehicle && allocationId && !hasIssue && (
          <Button variant="secondary" size="sm" onClick={() => setReplaceDialogOpen(true)}>
            <Repeat className="h-4 w-4" /> Replace Vehicle
          </Button>
        )}
        {!readinessLoading && canManage && hasAcknowledge && inspectionPassed && !hasIssue && (
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
