'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  EmployeeCombobox,
  type EmployeeSearchOption,
} from '@/components/ui/employee-combobox';
import { User, XCircle, UserPlus } from 'lucide-react';

interface LicenceInfo {
  id: string;
  licenceNumber: string;
  licenceClass: string;
  expiryDate: string;
  verificationStatus: string;
}

interface DriverInfo {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  jobTitle: string | null;
  driverStatus: string;
  licenceCount: number;
  activeLicenceCount: number;
  licences: LicenceInfo[];
}

interface DriverAssignmentProps {
  allocationId: string;
  currentDriverId: string | null;
}

function getLicenceStatus(expiryDate: string): { label: string; variant: 'success' | 'emergency' | 'error' | 'pending' } {
  const today = new Date();
  const expiry = new Date(expiryDate);
  const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry < 0) return { label: `Expired ${Math.abs(daysUntilExpiry)}d ago`, variant: 'error' };
  if (daysUntilExpiry <= 30) return { label: `Expires in ${daysUntilExpiry}d`, variant: 'emergency' };
  if (daysUntilExpiry <= 90) return { label: `Expires in ${daysUntilExpiry}d`, variant: 'pending' };
  return { label: `Valid until ${expiry.toLocaleDateString()}`, variant: 'success' };
}

export function DriverAssignment({ allocationId, currentDriverId }: DriverAssignmentProps) {
  const router = useRouter();
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState(currentDriverId || '');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadDrivers() {
      try {
        const res = await fetch('/api/drivers');
        const json = await res.json();
        if (json.success) {
          setDrivers(json.data);
        }
      } catch {
        // Silent fail
      } finally {
        setIsLoading(false);
      }
    }
    loadDrivers();
  }, []);

  const handleAssign = useCallback(async () => {
    if (!selectedDriverId) return;
    setIsSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/allocations/${allocationId}/driver`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverEmployeeId: selectedDriverId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to assign driver');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign driver');
    } finally {
      setIsSaving(false);
    }
  }, [allocationId, selectedDriverId, router]);

  const handleUnassign = useCallback(async () => {
    setIsSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/allocations/${allocationId}/driver`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to unassign driver');
      setSelectedDriverId('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unassign driver');
    } finally {
      setIsSaving(false);
    }
  }, [allocationId, router]);

  const selectedDriver = drivers.find((d) => d.id === selectedDriverId);
  const currentDriver = drivers.find((d) => d.id === currentDriverId);

  // Get the best licence for the selected driver
  const bestLicence = selectedDriver?.licences
    .filter((l) => l.verificationStatus !== 'expired')
    .sort((a, b) => {
      const aExpiry = new Date(a.expiryDate).getTime();
      const bExpiry = new Date(b.expiryDate).getTime();
      return bExpiry - aExpiry;
    })[0];

  const currentBestLicence = currentDriver?.licences
    .filter((licence) => licence.verificationStatus !== 'expired')
    .sort((a, b) => new Date(b.expiryDate).getTime() - new Date(a.expiryDate).getTime())[0];

  const selectedEmployeeOption: EmployeeSearchOption | null = selectedDriver ? {
    id: selectedDriver.id,
    fullName: `${selectedDriver.firstName} ${selectedDriver.lastName}`,
    firstName: selectedDriver.firstName,
    lastName: selectedDriver.lastName,
    employeeNumber: selectedDriver.employeeNumber,
    email: null,
    jobTitle: selectedDriver.jobTitle,
    departmentName: null,
    officeName: null,
    driverStatus: selectedDriver.driverStatus,
    availabilityStatus: null,
  } : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <User className="h-4 w-4 text-ink-500" />
        <span className="text-sm font-medium text-ink-700">Driver Assignment</span>
      </div>

      {currentDriverId && currentDriver && (
        <div className="rounded-[8px] border border-status-success-border bg-status-success-bg/30 p-3">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-status-success-bg text-status-success-text">
                <User className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-ink-950">
                  {currentDriver.firstName} {currentDriver.lastName}
                </p>
                <p className="text-xs text-ink-500">
                  {currentDriver.jobTitle || 'Driver'} · {currentDriver.employeeNumber}
                </p>
                {currentBestLicence && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <Badge variant={getLicenceStatus(currentBestLicence.expiryDate).variant} size="sm">
                      {getLicenceStatus(currentBestLicence.expiryDate).label}
                    </Badge>
                    <span className="text-xs text-ink-400">
                      Class {currentBestLicence.licenceClass} · {currentBestLicence.licenceNumber}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <Button variant="secondary" size="sm" loading={isSaving} onClick={handleUnassign}>
              Remove
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
          {isLoading ? (
            <div className="animate-pulse rounded-[8px] bg-muted p-3">
              <div className="h-4 w-3/4 rounded bg-ink-200" />
            </div>
          ) : (
            <>
              <EmployeeCombobox
                kind="driver"
                value={selectedDriverId}
                selectedOption={selectedEmployeeOption}
                onSelect={(employee) => setSelectedDriverId(employee?.id || '')}
                placeholder={currentDriverId ? 'Search for a replacement driver…' : 'Search available drivers…'}
              />

              {selectedDriver && (
                <div className="rounded-[8px] border border-border bg-muted/50 p-2.5">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-ink-700">
                        Licence: {selectedDriver.activeLicenceCount} valid / {selectedDriver.licenceCount} total
                      </p>
                      {bestLicence && (
                        <div className="flex items-center gap-2">
                          <Badge variant={getLicenceStatus(bestLicence.expiryDate).variant} size="sm">
                            {getLicenceStatus(bestLicence.expiryDate).label}
                          </Badge>
                          <span className="text-xs text-ink-400">
                            Class {bestLicence.licenceClass}
                          </span>
                        </div>
                      )}
                    </div>
                    <Button variant="primary" size="sm" loading={isSaving} onClick={handleAssign}>
                      <UserPlus className="h-3.5 w-3.5" />
                      {currentDriverId ? 'Replace Driver' : 'Assign'}
                    </Button>
                  </div>
                </div>
              )}

              {selectedDriver && selectedDriver.activeLicenceCount === 0 && (
                <div className="flex items-center gap-1.5 rounded-[6px] bg-status-error-bg px-2.5 py-1.5">
                  <XCircle className="h-3.5 w-3.5 text-status-error-text" />
                  <span className="text-xs text-status-error-text font-medium">
                    No valid licences — driver cannot be assigned
                  </span>
                </div>
              )}
            </>
          )}
      </div>

      {error && (
        <p className="text-xs text-status-error-text">{error}</p>
      )}
    </div>
  );
}
