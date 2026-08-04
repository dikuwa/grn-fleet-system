'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  Search,
  Truck,
  UserRound,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/lib/use-toast';
import { cn } from '@/lib/utils';

interface EligibleVehicle {
  id: string;
  licenceNumber: string;
  make: string;
  model: string;
  categoryName: string | null;
}

interface EligibleDriver {
  employeeId: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  jobTitle: string | null;
  departmentName: string | null;
  officeName: string | null;
  driverStatus: string;
  licenceNumber: string | null;
  licenceClass: string | null;
  licenceExpiry: string | null;
  eligible: boolean;
  compliance: {
    status: string;
    reasons: string[];
  };
}

interface ExistingAllocation {
  id: string;
  state: string;
  driverEmployeeId: string | null;
  vehicleId: string | null;
  licenceNumber: string;
  make: string;
  model: string;
  vehicleCategory: string | null;
}

export function TransportDecisionPanel({
  requestId,
  requestReference,
  requestTitle,
  activities,
  existingAllocation,
}: {
  requestId: string;
  requestReference: string;
  requestTitle: string;
  activities: Array<{ startDate: Date; endDate: Date }>;
  existingAllocation: ExistingAllocation | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [vehicles, setVehicles] = useState<EligibleVehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [vehicleQuery, setVehicleQuery] = useState('');
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<EligibleVehicle | null>(null);

  const [drivers, setDrivers] = useState<EligibleDriver[]>([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const [driverQuery, setDriverQuery] = useState('');
  const [driverOpen, setDriverOpen] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<EligibleDriver | null>(null);

  const [assigning, setAssigning] = useState(false);
  const [replacingDriver, setReplacingDriver] = useState(false);
  const [error, setError] = useState('');
  const fetched = useRef(false);

  // Trip window from the request's programme of activities.
  const windowDates = useMemo(() => {
    if (!activities.length) return null;
    const start = activities.reduce(
      (min, a) => (a.startDate < min ? a.startDate : min),
      activities[0].startDate,
    );
    const end = activities.reduce((max, a) => (a.endDate > max ? a.endDate : max), activities[0].endDate);
    return { start, end };
  }, [activities]);

  const loadVehicles = useCallback(async () => {
    setVehiclesLoading(true);
    try {
      const res = await fetch('/api/fleet?status=available&limit=50');
      const json = await res.json();
      const rows = json.rows || json.data?.vehicles || [];
      setVehicles(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error('[TransportDecision] vehicles failed:', err);
      setError('Unable to load eligible vehicles.');
    } finally {
      setVehiclesLoading(false);
    }
  }, []);

  const loadDrivers = useCallback(
    async (vehicleId: string) => {
      setDriversLoading(true);
      try {
        const res = await fetch(
          `/api/allocations/drivers?requestId=${encodeURIComponent(requestId)}&vehicleId=${encodeURIComponent(vehicleId)}&limit=50`,
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Unable to load drivers');
        setDrivers(json.data || []);
      } catch (err) {
        console.error('[TransportDecision] drivers failed:', err);
        setDrivers([]);
        setError(err instanceof Error ? err.message : 'Unable to load drivers.');
      } finally {
        setDriversLoading(false);
      }
    },
    [requestId],
  );

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    const loadInitial = () => {
      void loadVehicles();
      if (existingAllocation?.vehicleId) {
        void loadDrivers(existingAllocation.vehicleId);
      }
    };
    // Defer past the render commit so async setState never runs synchronously in the effect body.
    const timer = window.setTimeout(loadInitial, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleVehicles = useMemo(() => {
    if (!vehicleQuery.trim()) return vehicles;
    const q = vehicleQuery.toLowerCase();
    return vehicles.filter(
      (v) =>
        v.licenceNumber.toLowerCase().includes(q) ||
        v.make.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q),
    );
  }, [vehicles, vehicleQuery]);

  const visibleDrivers = useMemo(() => {
    if (!driverQuery.trim()) return drivers;
    const q = driverQuery.toLowerCase();
    return drivers.filter(
      (d) =>
        d.firstName.toLowerCase().includes(q) ||
        d.lastName.toLowerCase().includes(q) ||
        d.employeeNumber.toLowerCase().includes(q) ||
        (d.licenceClass ?? '').toLowerCase().includes(q),
    );
  }, [drivers, driverQuery]);

  const pickVehicle = useCallback(
    (vehicle: EligibleVehicle) => {
      setSelectedVehicle(vehicle);
      setVehicleOpen(false);
      setSelectedDriver(null);
      setError('');
      if (!existingAllocation) void loadDrivers(vehicle.id);
    },
    [existingAllocation, loadDrivers],
  );

  const assignAllocation = useCallback(async () => {
    if (!selectedVehicle) {
      setError('Select a vehicle to continue.');
      return;
    }
    setAssigning(true);
    setError('');
    try {
      const body: Record<string, string> = {
        requestId,
        vehicleId: selectedVehicle.id,
        startDate: windowDates ? windowDates.start.toISOString() : new Date().toISOString(),
      };
      if (windowDates) body.endDate = windowDates.end.toISOString();
      if (selectedDriver) body.driverEmployeeId = selectedDriver.employeeId;

      const res = await fetch('/api/allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json.compliance?.reasons?.length
            ? `${json.error} ${json.compliance.reasons.join(' · ')}`
            : json.error || 'Assignment failed',
        );
      }
      toast({
        title: 'Vehicle assigned',
        description: `${selectedVehicle.licenceNumber}${selectedDriver ? ` with ${selectedDriver.firstName} ${selectedDriver.lastName}` : ''} assigned to ${requestReference}.`,
        variant: 'success',
      });
      router.refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Assignment failed';
      setError(message);
      toast({ title: 'Assignment failed', description: message, variant: 'error' });
    } finally {
      setAssigning(false);
    }
  }, [requestId, requestReference, selectedVehicle, selectedDriver, windowDates, router, toast]);

  const replaceDriver = useCallback(async () => {
    if (!existingAllocation || !selectedDriver) {
      setError('Select a driver to continue.');
      return;
    }
    setReplacingDriver(true);
    setError('');
    try {
      const res = await fetch(`/api/allocations/${existingAllocation.id}/driver`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverEmployeeId: selectedDriver.employeeId }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json.compliance?.reasons?.length
            ? `${json.error} ${json.compliance.reasons.join(' · ')}`
            : json.error || 'Driver replacement failed',
        );
      }
      toast({
        title: 'Driver replaced',
        description: `${selectedDriver.firstName} ${selectedDriver.lastName} is now assigned to ${requestReference}.`,
        variant: 'success',
      });
      router.refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Driver replacement failed';
      setError(message);
      toast({ title: 'Replacement failed', description: message, variant: 'error' });
    } finally {
      setReplacingDriver(false);
    }
  }, [existingAllocation, selectedDriver, requestReference, router, toast]);

  const loadingDriverList =
    driversLoading || (!existingAllocation && selectedVehicle === null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Truck className="text-brand-700 h-5 w-5" aria-hidden="true" />
          Operational Decision — Vehicle &amp; Driver
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-ink-500 text-xs leading-5">
          Assign an available vehicle{existingAllocation ? '' : ' and an eligible driver'} to{' '}
          <strong className="text-ink-800">{requestReference}</strong> before advancing the
          workflow. Eligibility is validated live against licence class, professional
          authorisation and schedule conflicts.
        </p>

        <p className="overflow-wrap-anywhere text-ink-950 text-sm font-medium">{requestTitle}</p>

        {windowDates && (
          <p className="text-ink-500 text-xs">
            Trip window: {windowDates.start.toLocaleDateString('en-NA')} →{' '}
            {windowDates.end.toLocaleDateString('en-NA')}
          </p>
        )}

        {existingAllocation ? (
          <div className="border-status-success-bg bg-status-success-bg/10 rounded-[10px] border p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-ink-950 flex items-center gap-2 text-sm font-semibold">
                  <CheckCircle2 className="text-status-success-text h-4 w-4 shrink-0" aria-hidden="true" />
                  {existingAllocation.make} {existingAllocation.model}
                  <span className="text-ink-500 font-normal">({existingAllocation.licenceNumber})</span>
                </p>
                <p className="text-ink-500 mt-0.5 text-xs capitalize">
                  State: {existingAllocation.state.replaceAll('_', ' ')} · Driver:{' '}
                  {existingAllocation.driverEmployeeId ? 'assigned' : 'not yet assigned'}
                </p>
              </div>
              <Badge variant="success" size="sm">Allocated</Badge>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <label className="text-ink-500 text-xs font-semibold tracking-wider uppercase">
              Available Vehicle
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setVehicleOpen((open) => !open)}
                className="focus-ring border-border bg-surface text-ink-950 flex min-h-11 w-full items-center justify-between gap-2 rounded-[8px] border px-3 py-2 text-left text-sm disabled:opacity-60"
                aria-haspopup="listbox"
                aria-expanded={vehicleOpen}
              >
                <span className="min-w-0 flex-1 truncate">
                  {selectedVehicle ? (
                    <>
                      <span className="font-medium">{selectedVehicle.licenceNumber}</span>
                      <span className="text-ink-500">
                        {' '}· {selectedVehicle.make} {selectedVehicle.model}
                        {selectedVehicle.categoryName ? ` · ${selectedVehicle.categoryName}` : ''}
                      </span>
                    </>
                  ) : vehiclesLoading ? (
                    <span className="text-ink-500">Loading vehicles…</span>
                  ) : (
                    <span className="text-ink-500">Select an available vehicle…</span>
                  )}
                </span>
                <ChevronDown className="text-ink-400 h-4 w-4 shrink-0" aria-hidden="true" />
              </button>
              {vehicleOpen && (
                <div className="border-border bg-surface absolute z-20 mt-1 w-full rounded-[10px] border p-1 shadow-lg">
                  <div className="border-border relative border-b p-2">
                    <Search className="text-ink-400 absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2" />
                    <input
                      autoFocus
                      type="search"
                      value={vehicleQuery}
                      onChange={(event) => setVehicleQuery(event.target.value)}
                      placeholder="Search GRN, make, model…"
                      className="border-border bg-canvas text-ink-950 placeholder:text-ink-500 focus:ring-brand-600 h-10 w-full rounded-[8px] border pr-3 pl-9 text-sm focus:ring-2 focus:outline-none"
                    />
                  </div>
                  <div role="listbox" className="max-h-64 scrollbar-thin overflow-y-auto p-1">
                    {vehiclesLoading ? (
                      <p className="text-ink-500 flex items-center gap-2 px-3 py-6 text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                      </p>
                    ) : visibleVehicles.length === 0 ? (
                      <p className="text-ink-500 px-3 py-6 text-center text-sm">
                        No available vehicles found.
                      </p>
                    ) : (
                      visibleVehicles.map((vehicle) => (
                        <button
                          key={vehicle.id}
                          type="button"
                          role="option"
                          aria-selected={selectedVehicle?.id === vehicle.id}
                          onClick={() => pickVehicle(vehicle)}
                          className="focus-ring hover:bg-muted flex w-full items-start gap-3 rounded-[7px] px-3 py-2.5 text-left"
                        >
                          <span className="bg-brand-50 text-brand-700 flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px]">
                            <Truck className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="text-ink-950 block truncate text-sm font-medium">
                              {vehicle.licenceNumber}
                            </span>
                            <span className="text-ink-500 block truncate text-xs">
                              {vehicle.make} {vehicle.model}
                              {vehicle.categoryName ? ` · ${vehicle.categoryName}` : ''}
                            </span>
                          </span>
                          {selectedVehicle?.id === vehicle.id && (
                            <CheckCircle2 className="text-brand-700 mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-ink-500 text-xs font-semibold tracking-wider uppercase">
              {existingAllocation ? 'Replace Driver' : 'Driver'}
            </label>
            {!loadingDriverList && drivers.length > 0 && (
              <span className="text-ink-500 text-[11px]">
                {drivers.filter((d) => d.eligible).length} eligible
              </span>
            )}
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setDriverOpen((open) => !open)}
              disabled={loadingDriverList || (!existingAllocation && !selectedVehicle)}
              className="focus-ring border-border bg-surface text-ink-950 flex min-h-11 w-full items-center justify-between gap-2 rounded-[8px] border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60"
              aria-haspopup="listbox"
              aria-expanded={driverOpen}
            >
              <span className="min-w-0 flex-1 truncate">
                {selectedDriver ? (
                  <>
                    <span className="font-medium">
                      {selectedDriver.firstName} {selectedDriver.lastName}
                    </span>
                    <span className="text-ink-500">
                      {' '}· {selectedDriver.employeeNumber} · {selectedDriver.licenceClass ?? 'no class'}
                    </span>
                  </>
                ) : loadingDriverList ? (
                  <span className="text-ink-500 flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {!existingAllocation && !selectedVehicle
                      ? 'Select a vehicle first…'
                      : 'Loading drivers…'}
                  </span>
                ) : (
                  <span className="text-ink-500">
                    {existingAllocation ? 'Replace driver…' : 'Select a driver (optional)…'}
                  </span>
                )}
              </span>
              {selectedDriver ? (
                <X
                  className="text-ink-400 hover:text-ink-950 h-4 w-4 shrink-0"
                  aria-hidden="true"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedDriver(null);
                  }}
                />
              ) : (
                <ChevronDown className="text-ink-400 h-4 w-4 shrink-0" aria-hidden="true" />
              )}
            </button>
            {driverOpen && (
              <div className="border-border bg-surface absolute z-20 mt-1 w-full rounded-[10px] border p-1 shadow-lg">
                <div className="border-border relative border-b p-2">
                  <Search className="text-ink-400 absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2" />
                  <input
                    autoFocus
                    type="search"
                    value={driverQuery}
                    onChange={(event) => setDriverQuery(event.target.value)}
                    placeholder="Search name, employee no, class…"
                    className="border-border bg-canvas text-ink-950 placeholder:text-ink-500 focus:ring-brand-600 h-10 w-full rounded-[8px] border pr-3 pl-9 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>
                <div role="listbox" className="max-h-72 scrollbar-thin overflow-y-auto p-1">
                  {driversLoading ? (
                    <p className="text-ink-500 flex items-center gap-2 px-3 py-6 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                    </p>
                  ) : visibleDrivers.length === 0 ? (
                    <p className="text-ink-500 px-3 py-6 text-center text-sm">No drivers found.</p>
                  ) : (
                    visibleDrivers.map((driver) => (
                      <button
                        key={driver.employeeId}
                        type="button"
                        role="option"
                        aria-selected={selectedDriver?.employeeId === driver.employeeId}
                        onClick={() => {
                          setSelectedDriver(driver);
                          setDriverOpen(false);
                          setError('');
                        }}
                        className={cn(
                          'focus-ring hover:bg-muted flex w-full items-start gap-3 rounded-[7px] px-3 py-2.5 text-left',
                          !driver.eligible && 'opacity-70',
                        )}
                      >
                        <span className="bg-brand-50 text-brand-700 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                          <UserRound className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-ink-950 block truncate text-sm font-medium">
                            {driver.firstName} {driver.lastName}
                            {driver.departmentName ? ` · ${driver.departmentName}` : ''}
                          </span>
                          <span className="text-ink-500 block truncate text-xs">
                            {driver.employeeNumber}
                            {driver.licenceClass ? ` · Class ${driver.licenceClass}` : ''}
                            {driver.licenceExpiry
                              ? ` · Valid ${driver.licenceExpiry.slice(0, 10)}`
                              : ''}
                          </span>
                          {!driver.eligible && driver.compliance.reasons.length > 0 && (
                            <span className="text-status-error-text mt-0.5 block truncate text-[11px]">
                              {driver.compliance.reasons.join(' · ')}
                            </span>
                          )}
                        </span>
                        {driver.eligible ? (
                          <Badge variant="success" size="sm" className="mt-0.5 shrink-0">
                            Eligible
                          </Badge>
                        ) : (
                          <Badge variant="error" size="sm" className="mt-0.5 shrink-0">
                            Excluded
                          </Badge>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          <p className="text-ink-500 text-xs">
            Only drivers with a verified licence covering this vehicle&apos;s requirements are
            marked eligible — excluded drivers show the exact reason.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="border-status-error-bg bg-status-error-bg/15 flex items-start gap-2 rounded-[8px] border px-4 py-3"
          >
            <AlertTriangle className="text-status-error-text mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="text-status-error-text text-sm">{error}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {existingAllocation ? (
            <Button
              variant="primary"
              onClick={() => void replaceDriver()}
              disabled={!selectedDriver || replacingDriver}
            >
              {replacingDriver && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {replacingDriver ? 'Replacing…' : 'Replace Driver'}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void assignAllocation()}
              disabled={!selectedVehicle || assigning}
            >
              {assigning && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {assigning ? 'Assigning…' : 'Assign Vehicle'}
            </Button>
          )}
          <Button variant="secondary" onClick={() => void loadVehicles()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
