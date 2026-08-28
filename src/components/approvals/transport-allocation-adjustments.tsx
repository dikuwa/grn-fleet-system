'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Search,
  Settings2,
  Truck,
  UserRound,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/lib/use-toast';
import { cn } from '@/lib/utils';

interface ReplacementVehicle {
  id: string;
  make: string;
  model: string;
  licenceNumber: string;
  vehicleRegisterNumber: string | null;
  currentOdometer: number | null;
  status: string;
  requiredLicenceClass: string | null;
  professionalAuthorisationRequired: boolean;
  available: boolean;
  eligibilityNote: string;
}

interface EligibleDriver {
  employeeId: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  departmentName: string | null;
  licenceClass: string | null;
  licenceExpiry: string | null;
  eligible: boolean;
  compliance: {
    status: string;
    reasons: string[];
  };
}

type Editor = 'vehicle' | 'driver' | null;

export function TransportAllocationAdjustments({
  allocationId,
  requestId,
  requestReference,
  currentVehicle,
  currentDriverEmployeeId,
  driverSummary,
}: {
  allocationId: string;
  requestId: string;
  requestReference: string;
  currentVehicle: {
    id: string;
    make: string;
    model: string;
    licenceNumber: string;
  };
  currentDriverEmployeeId: string | null;
  driverSummary: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editor, setEditor] = useState<Editor>(null);
  const [error, setError] = useState('');

  const [vehicles, setVehicles] = useState<ReplacementVehicle[]>([]);
  const [vehicleQuery, setVehicleQuery] = useState('');
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<ReplacementVehicle | null>(null);
  const [vehicleReason, setVehicleReason] = useState('');
  const [replacingVehicle, setReplacingVehicle] = useState(false);

  const [drivers, setDrivers] = useState<EligibleDriver[]>([]);
  const [driverQuery, setDriverQuery] = useState('');
  const [driversLoading, setDriversLoading] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<EligibleDriver | null>(null);
  const [driverReason, setDriverReason] = useState('');
  const [replacingDriver, setReplacingDriver] = useState(false);

  const loadReplacementVehicles = useCallback(async () => {
    setVehiclesLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/allocations/${allocationId}/replacement-candidates`, {
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to load replacement vehicles.');
      setVehicles(Array.isArray(data.vehicles) ? data.vehicles : []);
    } catch (caught) {
      setVehicles([]);
      setError(caught instanceof Error ? caught.message : 'Unable to load replacement vehicles.');
    } finally {
      setVehiclesLoading(false);
    }
  }, [allocationId]);

  const loadDrivers = useCallback(
    async (query = '') => {
      setDriversLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          allocationId,
          requestId,
          vehicleId: currentVehicle.id,
          limit: '100',
          page: '1',
        });
        if (query.trim()) params.set('q', query.trim());
        const response = await fetch(`/api/allocations/drivers?${params.toString()}`, {
          cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Unable to load eligible drivers.');
        setDrivers(Array.isArray(data.data) ? data.data : []);
      } catch (caught) {
        setDrivers([]);
        setError(caught instanceof Error ? caught.message : 'Unable to load eligible drivers.');
      } finally {
        setDriversLoading(false);
      }
    },
    [allocationId, currentVehicle.id, requestId],
  );

  useEffect(() => {
    if (editor !== 'vehicle') return;
    void loadReplacementVehicles();
  }, [editor, loadReplacementVehicles]);

  useEffect(() => {
    if (editor !== 'driver') return;
    const timer = window.setTimeout(() => void loadDrivers(driverQuery), 250);
    return () => window.clearTimeout(timer);
  }, [driverQuery, editor, loadDrivers]);

  const visibleVehicles = useMemo(() => {
    const query = vehicleQuery.trim().toLowerCase();
    if (!query) return vehicles;
    return vehicles.filter((vehicle) =>
      [
        vehicle.licenceNumber,
        vehicle.vehicleRegisterNumber,
        vehicle.make,
        vehicle.model,
        vehicle.requiredLicenceClass,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [vehicleQuery, vehicles]);

  const visibleDrivers = useMemo(
    () => drivers.filter((driver) => driver.employeeId !== currentDriverEmployeeId),
    [currentDriverEmployeeId, drivers],
  );

  const closeEditor = useCallback(() => {
    setEditor(null);
    setError('');
    setSelectedVehicle(null);
    setVehicleQuery('');
    setVehicleReason('');
    setSelectedDriver(null);
    setDriverQuery('');
    setDriverReason('');
  }, []);

  const replaceVehicle = useCallback(async () => {
    if (!selectedVehicle?.available || !vehicleReason.trim()) return;
    setReplacingVehicle(true);
    setError('');
    try {
      const response = await fetch(`/api/allocations/${allocationId}/replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          replacementVehicleId: selectedVehicle.id,
          reason: vehicleReason.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Vehicle replacement failed.');
      toast({
        title: 'Vehicle replaced',
        description: `${selectedVehicle.licenceNumber} is now assigned to ${requestReference}.`,
        variant: 'success',
      });
      closeEditor();
      router.refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Vehicle replacement failed.';
      setError(message);
      toast({ title: 'Vehicle replacement failed', description: message, variant: 'error' });
    } finally {
      setReplacingVehicle(false);
    }
  }, [allocationId, closeEditor, requestReference, router, selectedVehicle, toast, vehicleReason]);

  const replaceDriver = useCallback(async () => {
    if (!selectedDriver?.eligible) return;
    if (currentDriverEmployeeId && !driverReason.trim()) return;
    setReplacingDriver(true);
    setError('');
    try {
      const response = await fetch(`/api/allocations/${allocationId}/driver`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driverEmployeeId: selectedDriver.employeeId,
          reason: currentDriverEmployeeId ? driverReason.trim() : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const complianceReasons = Array.isArray(data.compliance?.reasons)
          ? ` ${data.compliance.reasons.join(' · ')}`
          : '';
        throw new Error(`${data.error || 'Driver replacement failed.'}${complianceReasons}`);
      }
      toast({
        title: data.pendingApproval ? 'Driver change awaiting authorisation' : 'Driver replaced',
        description:
          data.message ||
          `${selectedDriver.firstName} ${selectedDriver.lastName} is now assigned to ${requestReference}.`,
        variant: data.pendingApproval ? undefined : 'success',
      });
      closeEditor();
      router.refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Driver replacement failed.';
      setError(message);
      toast({ title: 'Driver replacement failed', description: message, variant: 'error' });
    } finally {
      setReplacingDriver(false);
    }
  }, [allocationId, closeEditor, currentDriverEmployeeId, driverReason, requestReference, router, selectedDriver, toast]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-brand-700" aria-hidden="true" />
          Operational Assignment
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-[10px] border border-status-success-border bg-status-success-bg/15 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink-950">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success-text" aria-hidden="true" />
                {currentVehicle.make} {currentVehicle.model}
                <span className="font-normal text-ink-500">({currentVehicle.licenceNumber})</span>
              </p>
              <p className="mt-1 text-xs text-ink-500">Driver: {driverSummary}</p>
            </div>
            <Badge variant="success" size="sm">Ready for review</Badge>
          </div>
        </div>

        <p className="text-xs leading-5 text-ink-500">
          Transport Review may correct the operational assignment before release. Every replacement is revalidated against availability, licence requirements and lifecycle rules, and the reason is kept in the audit trail.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={editor === 'vehicle' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => {
              setEditor(editor === 'vehicle' ? null : 'vehicle');
              setError('');
            }}
          >
            <Truck className="h-4 w-4" aria-hidden="true" />
            Replace Vehicle
          </Button>
          <Button
            variant={editor === 'driver' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => {
              setEditor(editor === 'driver' ? null : 'driver');
              setError('');
            }}
          >
            <UserRound className="h-4 w-4" aria-hidden="true" />
            Replace Driver
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/dashboard/allocations/${allocationId}`}>Manage Allocation</Link>
          </Button>
        </div>

        {editor === 'vehicle' && (
          <div className="space-y-3 rounded-[10px] border border-border bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink-950">Choose replacement vehicle</p>
                <p className="mt-0.5 text-xs text-ink-500">Unavailable vehicles remain visible with the reason.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={closeEditor} aria-label="Close vehicle replacement">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
              <input
                type="search"
                value={vehicleQuery}
                onChange={(event) => setVehicleQuery(event.target.value)}
                placeholder="Search GRN, make, model or licence class…"
                className="h-10 w-full rounded-[8px] border border-border bg-background pl-9 pr-3 text-sm text-ink-950 outline-none placeholder:text-ink-400 focus:border-ink-400 focus:ring-2 focus:ring-ink-200"
              />
            </div>

            <div className="max-h-64 space-y-1 overflow-y-auto">
              {vehiclesLoading ? (
                <p className="flex items-center gap-2 px-2 py-6 text-sm text-ink-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading replacement candidates…
                </p>
              ) : visibleVehicles.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-ink-500">No replacement vehicles found.</p>
              ) : (
                visibleVehicles.map((vehicle) => (
                  <button
                    key={vehicle.id}
                    type="button"
                    disabled={!vehicle.available}
                    onClick={() => {
                      setSelectedVehicle(vehicle);
                      setError('');
                    }}
                    className={cn(
                      'focus-ring flex w-full items-start gap-3 rounded-[8px] border px-3 py-2.5 text-left transition-colors',
                      selectedVehicle?.id === vehicle.id
                        ? 'border-brand-300 bg-brand-50/70'
                        : 'border-transparent hover:bg-muted',
                      !vehicle.available && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <Truck className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink-950">
                        {vehicle.licenceNumber} · {vehicle.make} {vehicle.model}
                      </span>
                      <span className="mt-0.5 block text-xs leading-4 text-ink-500">{vehicle.eligibilityNote}</span>
                    </span>
                    <Badge variant={vehicle.available ? 'success' : 'error'} size="sm">
                      {vehicle.available ? 'Available' : 'Blocked'}
                    </Badge>
                  </button>
                ))
              )}
            </div>

            {selectedVehicle && (
              <div className="space-y-1.5 border-t border-border pt-3">
                <label htmlFor={`vehicle-replacement-reason-${allocationId}`} className="text-xs font-medium text-ink-700">
                  Replacement reason <span className="text-status-error-text">*</span>
                </label>
                <textarea
                  id={`vehicle-replacement-reason-${allocationId}`}
                  value={vehicleReason}
                  onChange={(event) => {
                    setVehicleReason(event.target.value);
                    setError('');
                  }}
                  maxLength={500}
                  rows={3}
                  placeholder="Record why the assigned vehicle is being replaced…"
                  className="w-full resize-y rounded-[8px] border border-border bg-background px-3 py-2 text-sm text-ink-950 outline-none placeholder:text-ink-400 focus:border-ink-400 focus:ring-2 focus:ring-ink-200"
                />
                <Button
                  variant="primary"
                  size="sm"
                  loading={replacingVehicle}
                  disabled={!vehicleReason.trim() || replacingVehicle}
                  onClick={() => void replaceVehicle()}
                >
                  Confirm Vehicle Replacement
                </Button>
              </div>
            )}
          </div>
        )}

        {editor === 'driver' && (
          <div className="space-y-3 rounded-[10px] border border-border bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink-950">Choose replacement driver</p>
                <p className="mt-0.5 text-xs text-ink-500">Only a different eligible driver can be selected.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={closeEditor} aria-label="Close driver replacement">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
              <input
                type="search"
                value={driverQuery}
                onChange={(event) => setDriverQuery(event.target.value)}
                placeholder="Search name, employee number or licence…"
                className="h-10 w-full rounded-[8px] border border-border bg-background pl-9 pr-3 text-sm text-ink-950 outline-none placeholder:text-ink-400 focus:border-ink-400 focus:ring-2 focus:ring-ink-200"
              />
            </div>

            <div className="max-h-72 space-y-1 overflow-y-auto">
              {driversLoading ? (
                <p className="flex items-center gap-2 px-2 py-6 text-sm text-ink-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking eligible drivers…
                </p>
              ) : visibleDrivers.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-ink-500">No alternative drivers found.</p>
              ) : (
                visibleDrivers.map((driver) => (
                  <button
                    key={driver.employeeId}
                    type="button"
                    disabled={!driver.eligible}
                    onClick={() => {
                      setSelectedDriver(driver);
                      setError('');
                    }}
                    className={cn(
                      'focus-ring flex w-full items-start gap-3 rounded-[8px] border px-3 py-2.5 text-left transition-colors',
                      selectedDriver?.employeeId === driver.employeeId
                        ? 'border-brand-300 bg-brand-50/70'
                        : 'border-transparent hover:bg-muted',
                      !driver.eligible && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink-950">
                        {driver.firstName} {driver.lastName} · {driver.employeeNumber}
                      </span>
                      <span className="mt-0.5 block text-xs leading-4 text-ink-500">
                        {driver.eligible
                          ? [driver.departmentName, driver.licenceClass ? `Class ${driver.licenceClass}` : null, driver.licenceExpiry ? `valid ${driver.licenceExpiry.slice(0, 10)}` : null]
                              .filter(Boolean)
                              .join(' · ')
                          : driver.compliance.reasons.join(' · ') || 'Driver is not eligible for this assignment.'}
                      </span>
                    </span>
                    <Badge variant={driver.eligible ? 'success' : 'error'} size="sm">
                      {driver.eligible ? 'Eligible' : 'Blocked'}
                    </Badge>
                  </button>
                ))
              )}
            </div>

            {selectedDriver && (
              <div className="space-y-1.5 border-t border-border pt-3">
                <label htmlFor={`driver-replacement-reason-${allocationId}`} className="text-xs font-medium text-ink-700">
                  Replacement reason <span className="text-status-error-text">*</span>
                </label>
                <textarea
                  id={`driver-replacement-reason-${allocationId}`}
                  value={driverReason}
                  onChange={(event) => {
                    setDriverReason(event.target.value);
                    setError('');
                  }}
                  maxLength={500}
                  rows={3}
                  placeholder="Record why the assigned driver is being replaced…"
                  className="w-full resize-y rounded-[8px] border border-border bg-background px-3 py-2 text-sm text-ink-950 outline-none placeholder:text-ink-400 focus:border-ink-400 focus:ring-2 focus:ring-ink-200"
                />
                <Button
                  variant="primary"
                  size="sm"
                  loading={replacingDriver}
                  disabled={Boolean(currentDriverEmployeeId && !driverReason.trim()) || replacingDriver}
                  onClick={() => void replaceDriver()}
                >
                  Confirm Driver Replacement
                </Button>
              </div>
            )}
          </div>
        )}

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-[8px] border border-status-error-border bg-status-error-bg/20 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-error-text" aria-hidden="true" />
            <p className="text-sm text-status-error-text">{error}</p>
          </div>
        )}

        {editor && (
          <p className="flex items-start gap-1.5 text-xs text-ink-500">
            <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Final eligibility is checked again when you confirm the change; discovery results never bypass compliance rules.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
