'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRightLeft, CheckSquare, Clock3, KeyRound, Repeat, RotateCcw, XCircle } from 'lucide-react';
import { VehicleReplacementDialog } from '@/components/allocations/VehicleReplacementDialog';
import { DriverHandoverDialog } from './DriverHandoverDialog';
import { ExternalTripStartDialog } from './ExternalTripStartDialog';
import { ExternalTripReturnDialog } from './ExternalTripReturnDialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label, Textarea } from '@/components/ui/input';
import { useToast } from '@/lib/use-toast';

interface TripActionsProps {
  tripId: string;
  allocationId: string;
  status: string;
  /** Legacy server hint. Current issue state is resolved from readiness. */
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
type DriverKind = 'internal' | 'external' | 'unassigned';

interface ReadinessResponse {
  driver?: {
    kind: DriverKind;
    accepted: boolean;
    assignmentState?: string | null;
  };
  gates?: Array<{ key: string; status: GateStatus; label?: string; detail?: string }>;
}

interface IssueFailureResponse {
  error?: string;
  blockers?: Array<{ code?: string; message?: string }>;
  actionUrl?: string;
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
  const { toast } = useToast();
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState('');
  const [issueRecoveryUrl, setIssueRecoveryUrl] = useState<string | null>(null);
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false);
  const [handoverDialogOpen, setHandoverDialogOpen] = useState(false);
  const [externalStartDialogOpen, setExternalStartDialogOpen] = useState(false);
  const [externalReturnDialogOpen, setExternalReturnDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [departureInspectionStatus, setDepartureInspectionStatus] = useState<GateStatus | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(
    status === 'pending' || status === 'in_progress',
  );
  const [driverKind, setDriverKind] = useState<DriverKind>('unassigned');
  const [driverAccepted, setDriverAccepted] = useState(Boolean(hasAcknowledge));
  const [vehicleIssued, setVehicleIssued] = useState(Boolean(hasIssue));
  const [authorityAmendmentPending, setAuthorityAmendmentPending] = useState(false);

  const midTrip = status === 'in_progress';
  // Relief-driver handover is an internal-employee workflow. Require the
  // readiness API to positively resolve an internal driver before exposing it;
  // the default/unresolved state must never grant an employee-only action.
  const canHandOverInternalDriver =
    canManage && midTrip && driverKind === 'internal' && hasAcknowledge === true;

  const refreshReadiness = useCallback(async () => {
    if (!['pending', 'in_progress'].includes(status)) {
      setReadinessLoading(false);
      return;
    }

    setReadinessLoading(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/readiness`, { cache: 'no-store' });
      const json = (await response.json().catch(() => ({}))) as ReadinessResponse & { error?: string };
      if (!response.ok) throw new Error(json.error || 'Unable to check release readiness');
      const departureGate = json.gates?.find((gate) => gate.key === 'departure_inspection');
      const acknowledgementGate = json.gates?.find((gate) => gate.key === 'driver_acknowledged');
      const amendmentGate = json.gates?.find((gate) => gate.key === 'authority_amendment_acknowledged');
      const vehicleIssuedGate = json.gates?.find((gate) => gate.key === 'vehicle_issued');
      const fallbackAccepted = acknowledgementGate
        ? acknowledgementGate.status === 'pass'
        : Boolean(hasAcknowledge);
      setDepartureInspectionStatus(departureGate?.status ?? null);
      setAuthorityAmendmentPending(Boolean(amendmentGate && amendmentGate.status !== 'pass'));
      setDriverKind(json.driver?.kind ?? 'unassigned');
      setDriverAccepted(json.driver?.accepted ?? fallbackAccepted);
      setVehicleIssued(vehicleIssuedGate ? vehicleIssuedGate.status === 'pass' : Boolean(hasIssue));
    } catch (reason) {
      setDepartureInspectionStatus(null);
      setAuthorityAmendmentPending(false);
      setDriverKind('unassigned');
      setDriverAccepted(Boolean(hasAcknowledge));
      setVehicleIssued(Boolean(hasIssue));
      setError(reason instanceof Error ? reason.message : 'Unable to check release readiness');
    } finally {
      setReadinessLoading(false);
    }
  }, [status, tripId, hasAcknowledge, hasIssue]);

  useEffect(() => {
    void refreshReadiness();
  }, [refreshReadiness, vehicleId, hasAcknowledge, hasIssue]);

  const handleReplaceSuccess = useCallback(() => {
    setDepartureInspectionStatus(null);
    setIssueRecoveryUrl(null);
    void refreshReadiness();
    router.refresh();
  }, [refreshReadiness, router]);

  const handleHandoverSuccess = useCallback(() => {
    void refreshReadiness();
    router.refresh();
  }, [refreshReadiness, router]);

  const handleExternalStartSuccess = useCallback(() => {
    setExternalStartDialogOpen(false);
    void refreshReadiness();
    router.refresh();
  }, [refreshReadiness, router]);

  const handleExternalReturnSuccess = useCallback(() => {
    setExternalReturnDialogOpen(false);
    router.refresh();
  }, [router]);

  const handleDepartureInspection = useCallback(() => {
    setIssueRecoveryUrl(null);
    router.push(`/dashboard/inspections/new?type=departure&tripId=${tripId}&vehicleId=${vehicleId}`);
  }, [tripId, vehicleId, router]);

  const handleIssueVehicle = useCallback(async () => {
    setIsWorking(true);
    setError('');
    setIssueRecoveryUrl(null);
    try {
      const readinessResponse = await fetch(`/api/trips/${tripId}/readiness`, { cache: 'no-store' });
      const readiness = (await readinessResponse.json().catch(() => ({}))) as ReadinessResponse & { error?: string };
      if (!readinessResponse.ok) throw new Error(readiness.error || 'Unable to check release readiness');

      const departureGate = readiness.gates?.find((gate) => gate.key === 'departure_inspection');
      const acknowledgementGate = readiness.gates?.find((gate) => gate.key === 'driver_acknowledged');
      const amendmentGate = readiness.gates?.find((gate) => gate.key === 'authority_amendment_acknowledged');
      const authorityGate = readiness.gates?.find((gate) => gate.key === 'trip_authority');
      const resolvedDriverKind = readiness.driver?.kind ?? 'unassigned';
      const resolvedAccepted = readiness.driver?.accepted ?? acknowledgementGate?.status === 'pass';
      setDepartureInspectionStatus(departureGate?.status ?? null);
      setAuthorityAmendmentPending(Boolean(amendmentGate && amendmentGate.status !== 'pass'));
      setDriverKind(resolvedDriverKind);
      setDriverAccepted(Boolean(resolvedAccepted));

      if (amendmentGate && amendmentGate.status !== 'pass') {
        throw new Error(
          resolvedDriverKind === 'external'
            ? 'The replacement vehicle changed the Trip Authority. Record the external driver acceptance of the revised authority before vehicle issue.'
            : 'The replacement vehicle changed the Trip Authority. The assigned driver must accept the revised authority before vehicle issue.',
        );
      }
      if (authorityGate?.status !== 'pass') {
        throw new Error('The current Trip Authority must be formally issued before physical vehicle issue.');
      }
      if (!resolvedAccepted) {
        throw new Error(
          resolvedDriverKind === 'external'
            ? 'External driver acceptance must be recorded before vehicle issue.'
            : 'The assigned driver must acknowledge the trip before vehicle issue.',
        );
      }
      if (departureGate?.status !== 'pass') {
        throw new Error('The latest departure inspection for the current vehicle must pass before issue.');
      }
      if (resolvedDriverKind === 'unassigned') {
        throw new Error('A valid internal or external driver assignment is required before vehicle issue.');
      }

      const issueEndpoint =
        resolvedDriverKind === 'external'
          ? `/api/trips/${tripId}/external-issue`
          : `/api/trips/${tripId}/issue`;
      const res = await fetch(issueEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keysIssued: true,
          fuelCardIssued: true,
          issueOdometer: currentOdometer,
        }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as IssueFailureResponse;
        const recoveryUrl =
          typeof errData.actionUrl === 'string' && errData.actionUrl.startsWith('/dashboard/')
            ? errData.actionUrl
            : null;
        const blockerMessage = errData.blockers?.find(
          (blocker) => typeof blocker.message === 'string' && blocker.message.trim().length > 0,
        )?.message;
        setIssueRecoveryUrl(recoveryUrl);
        if (res.status === 409) {
          await refreshReadiness();
        }
        throw new Error(blockerMessage || errData.error || 'Failed to issue vehicle');
      }
      setIssueRecoveryUrl(null);
      setVehicleIssued(true);
      toast({
        title: 'Vehicle issued',
        description:
          resolvedDriverKind === 'external'
            ? 'Vehicle issue was recorded against the accepted external-driver assignment. Record the actual departure to start the trip.'
            : 'Vehicle issue was recorded against the assigned employee driver.',
        variant: 'success',
      });
      await refreshReadiness();
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to issue vehicle';
      setError(message);
      toast({ title: 'Vehicle issue failed', description: message, variant: 'error' });
    } finally {
      setIsWorking(false);
    }
  }, [tripId, currentOdometer, refreshReadiness, router, toast]);

  const handleCancelTrip = useCallback(async () => {
    const reason = cancelReason.trim();
    if (reason.length < 10) {
      setError('Enter a cancellation reason of at least 10 characters.');
      return;
    }
    setIsWorking(true);
    setError('');
    try {
      const response = await fetch(`/api/trips/${tripId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Trip could not be cancelled');
      toast({
        title: 'Trip cancelled',
        description: 'The trip, allocation and Trip Authority were cancelled and affected users were notified.',
        variant: 'success',
      });
      setCancelDialogOpen(false);
      setCancelReason('');
      router.refresh();
    } catch (reasonError) {
      const message = reasonError instanceof Error ? reasonError.message : 'Trip could not be cancelled';
      setError(message);
      toast({ title: 'Cancellation failed', description: message, variant: 'error' });
    } finally {
      setIsWorking(false);
    }
  }, [cancelReason, router, toast, tripId]);

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

  const handoverDialog = canHandOverInternalDriver ? (
    <DriverHandoverDialog
      open={handoverDialogOpen}
      onOpenChange={setHandoverDialogOpen}
      tripId={tripId}
      currentOdometer={currentOdometer}
      onSuccess={handleHandoverSuccess}
    />
  ) : null;

  const externalStartDialog = canManage && driverKind === 'external' && vehicleIssued ? (
    <ExternalTripStartDialog
      open={externalStartDialogOpen}
      onOpenChange={setExternalStartDialogOpen}
      tripId={tripId}
      minimumOdometer={currentOdometer}
      onSuccess={handleExternalStartSuccess}
    />
  ) : null;

  const externalReturnDialog = canManage && midTrip && driverKind === 'external' ? (
    <ExternalTripReturnDialog
      open={externalReturnDialogOpen}
      onOpenChange={setExternalReturnDialogOpen}
      tripId={tripId}
      minimumOdometer={currentOdometer}
      onSuccess={handleExternalReturnSuccess}
    />
  ) : null;

  const cancellationDialog = canManage ? (
    <Dialog
      open={cancelDialogOpen}
      onOpenChange={(open) => {
        setCancelDialogOpen(open);
        if (!open) {
          setCancelReason('');
          setError('');
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this trip?</DialogTitle>
          <DialogDescription>
            This stops the pre-departure trip, cancels its allocation and Trip Authority, and notifies the requester and assigned driver. This action does not delete the audit history.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`cancel-trip-${tripId}`}>Cancellation reason</Label>
          <Textarea
            id={`cancel-trip-${tripId}`}
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            placeholder="Explain why the authorised trip must be cancelled"
            rows={4}
            maxLength={500}
          />
          <p className="text-ink-500 text-xs">Required · 10–500 characters</p>
          {error && (
            <p className="text-status-error-text text-xs" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setCancelDialogOpen(false)} disabled={isWorking}>
            Keep trip
          </Button>
          <Button variant="destructive" onClick={() => void handleCancelTrip()} loading={isWorking}>
            <XCircle className="h-4 w-4" /> Cancel trip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  if (status === 'pending') {
    const inspectionPassed = departureInspectionStatus === 'pass';
    const inspectionNeedsWork =
      departureInspectionStatus === 'pending' ||
      departureInspectionStatus === 'blocking' ||
      departureInspectionStatus === 'fail';

    return (
      <div className="flex flex-wrap items-center gap-2">
        {readinessLoading && (
          <span className="text-ink-500 inline-flex items-center gap-1.5 text-xs">
            <Clock3 className="h-3.5 w-3.5" /> Checking release readiness…
          </span>
        )}
        {!readinessLoading && authorityAmendmentPending && !inspectionPassed && (
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/dashboard/trips/${tripId}/authority`}>
              <Clock3 className="h-4 w-4" />
              {driverKind === 'external'
                ? 'Record Revised Driver Acceptance'
                : 'Review Revised Authority'}
            </Link>
          </Button>
        )}
        {!readinessLoading && canInspect && !authorityAmendmentPending && !driverAccepted && !inspectionPassed && (
          <span
            className="border-status-pending-bg/40 bg-status-pending-bg/10 text-status-pending-text inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-xs"
            title={
              driverKind === 'external'
                ? 'The external driver acceptance must be recorded before the official departure inspection can begin.'
                : 'The assigned driver must accept the Trip Authority before the official departure inspection can begin.'
            }
          >
            <Clock3 className="h-3.5 w-3.5" />
            {driverKind === 'external'
              ? 'Waiting for external driver acceptance'
              : 'Waiting for driver acknowledgement'}
          </span>
        )}
        {!readinessLoading && canInspect && !authorityAmendmentPending && driverAccepted && inspectionNeedsWork && (
          <Button variant="secondary" size="sm" onClick={handleDepartureInspection}>
            <CheckSquare className="h-4 w-4" />
            {departureInspectionStatus === 'blocking' || departureInspectionStatus === 'fail'
              ? 'Repeat Departure Inspection'
              : 'Departure Inspection'}
          </Button>
        )}
        {canReplaceVehicle && allocationId && !vehicleIssued && (
          <Button variant="secondary" size="sm" onClick={() => setReplaceDialogOpen(true)}>
            <Repeat className="h-4 w-4" /> Replace Vehicle
          </Button>
        )}
        {!readinessLoading && canManage && !authorityAmendmentPending && driverAccepted && inspectionPassed && !vehicleIssued && (
          <Button variant="secondary" size="sm" loading={isWorking} onClick={handleIssueVehicle}>
            <KeyRound className="h-4 w-4" /> Issue Vehicle
          </Button>
        )}
        {canManage && !vehicleIssued && (
          <Button variant="secondary" size="sm" onClick={() => setCancelDialogOpen(true)}>
            <XCircle className="h-4 w-4" /> Cancel Trip
          </Button>
        )}
        {!readinessLoading && vehicleIssued && driverKind === 'external' && canManage && (
          <Button variant="primary" size="sm" onClick={() => setExternalStartDialogOpen(true)}>
            <CheckSquare className="h-4 w-4" /> Record Departure
          </Button>
        )}
        {!readinessLoading && vehicleIssued && driverKind === 'internal' && (
          <span className="text-status-success-text inline-flex items-center gap-1.5 text-xs">
            <CheckSquare className="h-3.5 w-3.5" /> Vehicle issued — waiting for the driver to start the trip
          </span>
        )}
        {!readinessLoading && vehicleIssued && driverKind === 'external' && !canManage && (
          <span className="text-status-success-text inline-flex items-center gap-1.5 text-xs">
            <CheckSquare className="h-3.5 w-3.5" /> Vehicle issued — Transport Office must record external-driver departure
          </span>
        )}
        {!readinessLoading && vehicleIssued && driverKind === 'unassigned' && (
          <span className="text-status-error-text inline-flex items-center gap-1.5 text-xs">
            <XCircle className="h-3.5 w-3.5" /> Driver assignment could not be resolved — refresh before departure
          </span>
        )}
        {error && !cancelDialogOpen && (
          <div className="mt-1 flex w-full flex-wrap items-center gap-2">
            <p className="text-status-error-text text-xs" role="alert">{error}</p>
            {issueRecoveryUrl && (
              <Link
                href={issueRecoveryUrl}
                className="text-brand-700 hover:text-brand-800 focus-visible:ring-brand-500 rounded-[6px] text-xs font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2"
              >
                Open blocking record
              </Link>
            )}
          </div>
        )}
        {replacementDialog}
        {externalStartDialog}
        {cancellationDialog}
      </div>
    );
  }

  if (status === 'in_progress') {
    return (
      <div>
        <div className="flex flex-wrap gap-2">
          {readinessLoading && (
            <span className="text-ink-500 inline-flex items-center gap-1.5 text-xs">
              <Clock3 className="h-3.5 w-3.5" /> Resolving active driver…
            </span>
          )}
          {!readinessLoading && canHandOverInternalDriver && (
            <Button variant="secondary" size="sm" onClick={() => setHandoverDialogOpen(true)}>
              <ArrowRightLeft className="h-4 w-4" /> Hand over Driver
            </Button>
          )}
          {!readinessLoading && canManage && driverKind === 'external' && (
            <Button variant="primary" size="sm" onClick={() => setExternalReturnDialogOpen(true)}>
              <RotateCcw className="h-4 w-4" /> Record Return
            </Button>
          )}
          {canReplaceVehicle && allocationId && driverKind !== 'unassigned' && (
            <Button variant="secondary" size="sm" onClick={() => setReplaceDialogOpen(true)}>
              <Repeat className="h-4 w-4" /> Replace Vehicle
            </Button>
          )}
          {!readinessLoading && driverKind === 'external' && !canManage && (
            <span className="text-ink-500 text-xs">
              Transport Office records the external-driver vehicle return before arrival inspection.
            </span>
          )}
        </div>
        {error && <p className="text-status-error-text mt-1 text-xs">{error}</p>}
        {handoverDialog}
        {externalReturnDialog}
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
          <span className="text-ink-500 text-xs">Waiting for the authorised return inspection.</span>
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
      <span className="text-ink-500 text-xs">Awaiting Transport Office reconciliation.</span>
    );
  }

  return null;
}