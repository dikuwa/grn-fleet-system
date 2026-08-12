'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  EmployeeCombobox,
  type EmployeeSearchOption,
} from '@/components/ui/employee-combobox';
import { AlertTriangle, CheckCircle2, Loader2, User, UserPlus } from 'lucide-react';

interface DriverCompliance {
  status:
    | 'eligible'
    | 'eligible_expiring_soon'
    | 'not_eligible'
    | 'missing_information'
    | 'awaiting_verification'
    | 'temporarily_unavailable';
  reasons: string[];
}

interface DriverEligibility {
  employeeId: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  jobTitle: string | null;
  departmentName: string | null;
  officeName: string | null;
  employmentStatus: string;
  availabilityStatus: string;
  driverStatus: string;
  licenceNumber: string | null;
  licenceClass: string | null;
  licenceExpiry: string | null;
  licenceVerificationStatus: string | null;
  licenceClassCompatible: boolean;
  eligible: boolean;
  compliance: DriverCompliance;
}

interface DriverAssignmentProps {
  allocationId: string;
  currentDriverId: string | null;
}

function toEmployeeOption(driver: DriverEligibility): EmployeeSearchOption {
  return {
    id: driver.employeeId,
    fullName: `${driver.firstName} ${driver.lastName}`,
    firstName: driver.firstName,
    lastName: driver.lastName,
    employeeNumber: driver.employeeNumber,
    email: null,
    jobTitle: driver.jobTitle,
    departmentName: driver.departmentName,
    officeName: driver.officeName,
    driverStatus: driver.driverStatus,
    availabilityStatus: driver.availabilityStatus,
  };
}

function complianceBadge(driver: DriverEligibility) {
  if (driver.compliance.status === 'eligible') {
    return { variant: 'success' as const, label: 'Eligible' };
  }
  if (driver.compliance.status === 'eligible_expiring_soon') {
    return { variant: 'pending' as const, label: 'Eligible · expiring soon' };
  }
  if (driver.compliance.status === 'awaiting_verification') {
    return { variant: 'pending' as const, label: 'Licence review pending' };
  }
  if (driver.compliance.status === 'temporarily_unavailable') {
    return { variant: 'emergency' as const, label: 'Unavailable' };
  }
  return { variant: 'error' as const, label: 'Not eligible' };
}

export function DriverAssignment({ allocationId, currentDriverId }: DriverAssignmentProps) {
  const router = useRouter();
  const [selectedDriverId, setSelectedDriverId] = useState(currentDriverId || '');
  const [selectedOption, setSelectedOption] = useState<EmployeeSearchOption | null>(null);
  const [currentEligibility, setCurrentEligibility] = useState<DriverEligibility | null>(null);
  const [selectedEligibility, setSelectedEligibility] = useState<DriverEligibility | null>(null);
  const [replacementReason, setReplacementReason] = useState('');
  const [unassignmentReason, setUnassignmentReason] = useState('');
  const [isLoadingCurrent, setIsLoadingCurrent] = useState(Boolean(currentDriverId));
  const [isCheckingEligibility, setIsCheckingEligibility] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchEligibility = useCallback(async (employeeId: string) => {
    const params = new URLSearchParams({
      allocationId,
      employeeId,
      limit: '1',
    });
    const response = await fetch(`/api/allocations/drivers?${params}`, { cache: 'no-store' });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || 'Unable to validate driver eligibility');
    const driver = Array.isArray(json.data) ? (json.data[0] as DriverEligibility | undefined) : undefined;
    if (!driver) throw new Error('This employee is not configured as a driver for your organisation.');
    return driver;
  }, [allocationId]);

  useEffect(() => {
    let cancelled = false;
    if (!currentDriverId) {
      setCurrentEligibility(null);
      setSelectedEligibility(null);
      setSelectedOption(null);
      setIsLoadingCurrent(false);
      return;
    }

    setIsLoadingCurrent(true);
    fetchEligibility(currentDriverId)
      .then((driver) => {
        if (cancelled) return;
        setCurrentEligibility(driver);
        setSelectedEligibility(driver);
        setSelectedOption(toEmployeeOption(driver));
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load current driver');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingCurrent(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentDriverId, fetchEligibility]);

  const isReplacement = Boolean(
    currentDriverId && selectedDriverId && selectedDriverId !== currentDriverId,
  );

  const handleSelection = useCallback(async (employee: EmployeeSearchOption | null) => {
    setError('');
    setReplacementReason('');
    setSelectedOption(employee);
    const employeeId = employee?.id || '';
    setSelectedDriverId(employeeId);

    if (!employeeId) {
      setSelectedEligibility(null);
      return;
    }
    if (employeeId === currentDriverId && currentEligibility) {
      setSelectedEligibility(currentEligibility);
      return;
    }

    setSelectedEligibility(null);
    setIsCheckingEligibility(true);
    try {
      const driver = await fetchEligibility(employeeId);
      setSelectedEligibility(driver);
      setSelectedOption(toEmployeeOption(driver));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to validate driver eligibility');
    } finally {
      setIsCheckingEligibility(false);
    }
  }, [currentDriverId, currentEligibility, fetchEligibility]);

  const handleAssign = useCallback(async () => {
    if (!selectedDriverId || !selectedEligibility?.eligible) return;
    if (currentDriverId && selectedDriverId === currentDriverId) {
      setError('Choose a different driver before replacing the current assignment.');
      return;
    }
    if (currentDriverId && !replacementReason.trim()) {
      setError('Enter a reason for replacing the currently assigned driver.');
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/allocations/${allocationId}/driver`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driverEmployeeId: selectedDriverId,
          reason: currentDriverId ? replacementReason.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to assign driver');
      setReplacementReason('');
      setUnassignmentReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign driver');
    } finally {
      setIsSaving(false);
    }
  }, [allocationId, currentDriverId, replacementReason, selectedDriverId, selectedEligibility, router]);

  const handleUnassign = useCallback(async () => {
    if (!unassignmentReason.trim()) {
      setError('Enter a reason before removing the assigned driver.');
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/allocations/${allocationId}/driver`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: unassignmentReason.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to unassign driver');
      setSelectedDriverId('');
      setSelectedOption(null);
      setSelectedEligibility(null);
      setReplacementReason('');
      setUnassignmentReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unassign driver');
    } finally {
      setIsSaving(false);
    }
  }, [allocationId, router, unassignmentReason]);

  const assignmentBlocked = Boolean(
    !selectedDriverId ||
      !selectedEligibility?.eligible ||
      isCheckingEligibility ||
      (currentDriverId && selectedDriverId === currentDriverId) ||
      (isReplacement && !replacementReason.trim()),
  );

  const selectedBadge = selectedEligibility ? complianceBadge(selectedEligibility) : null;
  const currentBadge = currentEligibility ? complianceBadge(currentEligibility) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <User className="h-4 w-4 text-ink-500" />
        <span className="text-sm font-medium text-ink-700">Driver Assignment</span>
      </div>

      {currentDriverId && isLoadingCurrent && (
        <div className="flex items-center gap-2 rounded-[8px] border border-border bg-muted/30 p-3 text-xs text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking current driver compliance…
        </div>
      )}

      {currentDriverId && currentEligibility && (
        <div className="space-y-3 rounded-[8px] border border-status-success-border bg-status-success-bg/30 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-status-success-bg text-status-success-text">
                <User className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-950">
                  {currentEligibility.firstName} {currentEligibility.lastName}
                </p>
                <p className="text-xs text-ink-500">
                  {currentEligibility.jobTitle || 'Driver'} · {currentEligibility.employeeNumber}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {currentBadge && <Badge variant={currentBadge.variant} size="sm">{currentBadge.label}</Badge>}
                  {currentEligibility.licenceNumber && (
                    <span className="text-xs text-ink-400">
                      {currentEligibility.licenceClass ? `Class ${currentEligibility.licenceClass} · ` : ''}
                      {currentEligibility.licenceNumber}
                      {currentEligibility.licenceExpiry ? ` · expires ${new Date(currentEligibility.licenceExpiry).toLocaleDateString()}` : ''}
                    </span>
                  )}
                </div>
                {!currentEligibility.eligible && currentEligibility.compliance.reasons.length > 0 && (
                  <p className="mt-1.5 text-xs text-status-error-text">
                    Current compliance: {currentEligibility.compliance.reasons.join(' · ')}
                  </p>
                )}
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={isSaving}
              disabled={!unassignmentReason.trim()}
              onClick={handleUnassign}
              className="self-start"
            >
              Remove
            </Button>
          </div>
          <div className="space-y-1.5 border-t border-status-success-border/70 pt-3">
            <label htmlFor={`driver-unassignment-reason-${allocationId}`} className="text-xs font-medium text-ink-700">
              Removal reason <span className="text-status-error-text">*</span>
            </label>
            <textarea
              id={`driver-unassignment-reason-${allocationId}`}
              value={unassignmentReason}
              onChange={(event) => {
                setUnassignmentReason(event.target.value);
                setError('');
              }}
              rows={2}
              maxLength={500}
              placeholder="Record why this driver assignment is being removed…"
              className="w-full resize-y rounded-[8px] border border-border bg-background px-3 py-2 text-sm text-ink-950 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-400 focus:ring-2 focus:ring-ink-200"
            />
            <p className="text-xs text-ink-500">
              The reason is saved to the audit trail and shared with the affected driver.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <EmployeeCombobox
          kind="driver"
          value={selectedDriverId}
          selectedOption={selectedOption}
          onSelect={handleSelection}
          placeholder={currentDriverId ? 'Search for a replacement driver…' : 'Search available drivers…'}
        />

        {currentDriverId && selectedDriverId === currentDriverId && (
          <p className="text-xs text-ink-500">
            Search and select a different eligible driver to make a replacement.
          </p>
        )}

        {isCheckingEligibility && (
          <div className="flex items-center gap-2 rounded-[8px] border border-border bg-muted/30 p-3 text-xs text-ink-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking licence, availability, vehicle class and schedule…
          </div>
        )}

        {isReplacement && (
          <div className="space-y-1.5 rounded-[8px] border border-border bg-muted/30 p-3">
            <label htmlFor={`driver-replacement-reason-${allocationId}`} className="text-xs font-medium text-ink-700">
              Replacement reason <span className="text-status-error-text">*</span>
            </label>
            <textarea
              id={`driver-replacement-reason-${allocationId}`}
              value={replacementReason}
              onChange={(event) => {
                setReplacementReason(event.target.value);
                setError('');
              }}
              rows={3}
              maxLength={500}
              placeholder="Record why the current driver is being replaced…"
              className="w-full resize-y rounded-[8px] border border-border bg-background px-3 py-2 text-sm text-ink-950 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-400 focus:ring-2 focus:ring-ink-200"
            />
            <p className="text-xs text-ink-500">
              This reason is recorded in the audit trail and shared with the affected driver.
            </p>
          </div>
        )}

        {selectedEligibility && selectedDriverId !== currentDriverId && (
          <div className={`rounded-[8px] border p-3 ${selectedEligibility.eligible ? 'border-status-success-border bg-status-success-bg/20' : 'border-status-error-border bg-status-error-bg/10'}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  {selectedEligibility.eligible ? <CheckCircle2 className="h-4 w-4 text-status-success-text" /> : <AlertTriangle className="h-4 w-4 text-status-error-text" />}
                  <p className="text-sm font-medium text-ink-950">
                    {selectedEligibility.firstName} {selectedEligibility.lastName}
                  </p>
                  {selectedBadge && <Badge variant={selectedBadge.variant} size="sm">{selectedBadge.label}</Badge>}
                </div>
                <p className="text-xs text-ink-500">
                  {selectedEligibility.employeeNumber}
                  {selectedEligibility.licenceClass ? ` · Class ${selectedEligibility.licenceClass}` : ''}
                  {selectedEligibility.licenceNumber ? ` · ${selectedEligibility.licenceNumber}` : ''}
                </p>
                {selectedEligibility.compliance.reasons.length > 0 && (
                  <div className="space-y-1">
                    {selectedEligibility.compliance.reasons.map((reason) => (
                      <p key={reason} className={`text-xs ${selectedEligibility.eligible ? 'text-status-pending-text' : 'text-status-error-text'}`}>
                        {reason}
                      </p>
                    ))}
                  </div>
                )}
              </div>
              <Button
                variant="primary"
                size="sm"
                loading={isSaving}
                disabled={assignmentBlocked}
                onClick={handleAssign}
                className="self-start"
              >
                <UserPlus className="h-3.5 w-3.5" />
                {currentDriverId ? 'Replace Driver' : 'Assign'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-status-error-text">{error}</p>}
    </div>
  );
}
