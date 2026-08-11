'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { StyledDateInput } from '@/components/ui/styled-select';
import { Badge } from '@/components/ui/badge';
import {
  ChevronLeft,
  CheckCircle2,
  Truck,
  Star,
  AlertTriangle,
  Search,
  UserRound,
  Loader2,
  XCircle,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { VehicleAvailabilityCheck } from './VehicleAvailabilityCheck';
import { useToast } from '@/lib/use-toast';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface EligibleRequest {
  id: string;
  reference: string;
  status: string;
  scope: string;
  purpose: string | null;
  requesterName: string | null;
  requesterEmployeeNumber: string | null;
  origin: string | null;
  destination: string | null;
  estimatedKm: number | null;
  startDate: string | null;
  endDate: string | null;
  passengerCount: number;
  preferredDriverEmployeeId: string | null;
  nominatedDriverName: string | null;
  urgency: string;
  overnight: boolean;
  specialRequirements: string | null;
  vehicleRequirements: string | null;
}

interface VehicleRow {
  id: string;
  licenceNumber: string;
  vehicleRegisterNumber: string | null;
  make: string;
  model: string;
  fuelType: string;
  currentOdometer: number;
  status: string;
  categoryName: string | null;
}

interface RecommendationVariant {
  vehicleId: string;
  score: number;
  licenceNumber: string;
  make: string;
  model: string;
  categoryName: string | null;
  passengerCapacity: number | null;
  fuelType: string;
  currentOdometer: number;
  status: string;
  reasons: string[];
  concerns: string[];
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
  driverStatus: string;
  licenceNumber: string | null;
  licenceClass: string | null;
  licenceExpiry: string | null;
  licenceClassCompatible: boolean;
  eligible: boolean;
  compliance: {
    status: string;
    reasons: string[];
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-NA', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function NewAllocationPage() {
  const router = useRouter();
  const { toast } = useToast();

  /* Request selection */
  const [requestQuery, setRequestQuery] = useState('');
  const [requestResults, setRequestResults] = useState<EligibleRequest[]>([]);
  const [requestSearching, setRequestSearching] = useState(false);
  const [requestDropdownOpen, setRequestDropdownOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<EligibleRequest | null>(null);

  /* Vehicle selection */
  const [vehicleQuery, setVehicleQuery] = useState('');
  const [vehicleResults, setVehicleResults] = useState<VehicleRow[]>([]);
  const [vehicleSearching, setVehicleSearching] = useState(false);
  const [vehicleDropdownOpen, setVehicleDropdownOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleRow | null>(null);

  /* Driver selection */
  const [drivers, setDrivers] = useState<DriverEligibility[]>([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

  /* Recommendations (advisory only) */
  const [recommendations, setRecommendations] = useState<RecommendationVariant[]>([]);
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState('');

  /* Dates + notes */
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const requestTimer = useRef<number | null>(null);
  const vehicleTimer = useRef<number | null>(null);

  /* ------------------- Request search ------------------- */

  const searchRequests = useCallback(async (q: string) => {
    const params = new URLSearchParams({ limit: '10' });
    if (q.trim()) params.set('q', q.trim());
    setRequestSearching(true);
    try {
      const res = await fetch(`/api/allocations/requests?${params}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load requests');
      setRequestResults(json.data || []);
      setRequestDropdownOpen(true);
    } catch (err) {
      setRequestResults([]);
      setError(err instanceof Error ? err.message : 'Could not load eligible requests');
    } finally {
      setRequestSearching(false);
    }
  }, []);

  const handleRequestQueryChange = useCallback(
    (value: string) => {
      setRequestQuery(value);
      if (requestTimer.current) window.clearTimeout(requestTimer.current);
      requestTimer.current = window.setTimeout(() => {
        if (value.trim().length >= 2) void searchRequests(value);
        else {
          setRequestResults([]);
          setRequestDropdownOpen(false);
        }
      }, 300);
    },
    [searchRequests],
  );

  const selectRequest = useCallback(
    (request: EligibleRequest) => {
      setSelectedRequest(request);
      setRequestDropdownOpen(false);
      setRequestQuery(request.reference);
      setError('');
      // Auto-populate operational fields from the authoritative request.
      if (request.startDate) setStartDate(request.startDate.slice(0, 10));
      if (request.endDate) setEndDate(request.endDate.slice(0, 10));
      setDrivers([]);
      setSelectedDriverId(null);
      setRecommendations([]);
    },
    [],
  );

  /* ------------------- Vehicle search ------------------- */

  const searchVehicles = useCallback(async (q: string) => {
    const params = new URLSearchParams({ limit: '10' });
    if (q.trim()) params.set('search', q.trim());
    setVehicleSearching(true);
    try {
      const res = await fetch(`/api/fleet?${params}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load vehicles');
      const rows = Array.isArray(json.rows) ? json.rows : [];
      setVehicleResults(rows);
      setVehicleDropdownOpen(true);
    } catch (err) {
      setVehicleResults([]);
      setError(err instanceof Error ? err.message : 'Could not load vehicles');
    } finally {
      setVehicleSearching(false);
    }
  }, []);

  const handleVehicleQueryChange = useCallback(
    (value: string) => {
      setVehicleQuery(value);
      if (vehicleTimer.current) window.clearTimeout(vehicleTimer.current);
      vehicleTimer.current = window.setTimeout(() => {
        if (value.trim().length >= 2) void searchVehicles(value);
        else {
          setVehicleResults([]);
          setVehicleDropdownOpen(false);
        }
      }, 300);
    },
    [searchVehicles],
  );

  const selectVehicle = useCallback((vehicle: VehicleRow) => {
    setSelectedVehicle(vehicle);
    setVehicleDropdownOpen(false);
    setVehicleQuery(`${vehicle.licenceNumber} · ${vehicle.make} ${vehicle.model}`);
    setError('');
    setRecommendations([]);
  }, []);

  /* ------------------- Driver eligibility ------------------- */

  const loadDrivers = useCallback(async () => {
    if (!selectedRequest) return;
    setDriversLoading(true);
    try {
      const params = new URLSearchParams({ requestId: selectedRequest.id, limit: '50' });
      if (selectedVehicle) params.set('vehicleId', selectedVehicle.id);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const res = await fetch(`/api/allocations/drivers?${params}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load driver eligibility');
      setDrivers(json.data || []);
      const preferred = (json.data || []).find(
        (driver: DriverEligibility) => driver.employeeId === selectedRequest.preferredDriverEmployeeId && driver.eligible,
      );
      setSelectedDriverId((current) => {
        const currentStillEligible = (json.data || []).some(
          (driver: DriverEligibility) => driver.employeeId === current && driver.eligible,
        );
        return currentStillEligible ? current : preferred?.employeeId ?? null;
      });
    } catch (err) {
      setDrivers([]);
      setError(err instanceof Error ? err.message : 'Could not load drivers');
    } finally {
      setDriversLoading(false);
    }
  }, [selectedRequest, selectedVehicle, startDate, endDate]);

  useEffect(() => {
    if (!selectedRequest) return;
    const timer = window.setTimeout(() => void loadDrivers(), 150);
    return () => window.clearTimeout(timer);
  }, [loadDrivers, selectedRequest]);

  /* ------------------- Advisory recommendation ------------------- */

  const fetchRecommendations = useCallback(async () => {
    if (!selectedRequest) {
      toast({ title: 'Select a request first', description: 'Choose the transport request you are allocating for.', variant: 'pending' });
      return;
    }
    setRecLoading(true);
    setRecError('');
    try {
      const res = await fetch('/api/allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: selectedRequest.id,
          recommendOnly: true,
          startDate: startDate || new Date().toISOString().slice(0, 10),
          endDate: endDate || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Recommendation failed');
      const variants = Array.isArray(data.recommendation?.recommendations)
        ? data.recommendation.recommendations
        : [];
      setRecommendations(variants);
      toast({
        title: variants.length ? `${variants.length} vehicle(s) recommended` : 'No vehicles available',
        description: variants.length
          ? 'Recommendations are advisory — confirm the vehicle before allocating.'
          : 'No eligible vehicle is available for this request right now.',
        variant: variants.length ? 'success' : 'pending',
      });
    } catch (err) {
      setRecError(err instanceof Error ? err.message : 'Could not fetch recommendations');
    } finally {
      setRecLoading(false);
    }
  }, [selectedRequest, startDate, endDate, toast]);

  const adoptRecommendation = useCallback(
    (variant: RecommendationVariant) => {
      setSelectedVehicle({
        id: variant.vehicleId,
        licenceNumber: variant.licenceNumber,
        vehicleRegisterNumber: null,
        make: variant.make,
        model: variant.model,
        fuelType: variant.fuelType,
        currentOdometer: variant.currentOdometer,
        status: variant.status,
        categoryName: variant.categoryName,
      });
      setVehicleQuery(`${variant.licenceNumber} · ${variant.make} ${variant.model}`);
      toast({
        title: 'Recommendation adopted',
        description: 'Vehicle loaded from recommendation — confirm availability before creating the allocation.',
        variant: 'success',
      });
    },
    [toast],
  );

  /* ------------------- Submit ------------------- */

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedRequest) {
        setError('Select the transport request you are allocating for.');
        return;
      }
      if (!selectedVehicle) {
        setError('Select an eligible vehicle for this allocation.');
        return;
      }
      if (!startDate) {
        setError('Start date is required.');
        return;
      }
      setIsSubmitting(true);
      setError('');
      try {
        const payload: Record<string, string | boolean | undefined> = {
          requestId: selectedRequest.id,
          startDate,
          endDate: endDate || undefined,
          notes,
        };
        payload.vehicleId = selectedVehicle.id;
        if (selectedDriverId) payload.driverEmployeeId = selectedDriverId;

        const res = await fetch('/api/allocations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || (data.compliance?.reasons?.length ? data.compliance.reasons.join('; ') : 'Failed to create allocation'));
        }
        toast({
          title: 'Allocation created',
          description: `${selectedVehicle.licenceNumber} assigned to ${selectedRequest.reference}${selectedDriverId ? ' with driver' : ''}`,
          variant: 'success',
        });
        router.push(`/dashboard/allocations/${data.allocation.id}`);
      } catch (err) {
        toast({
          title: 'Failed to create allocation',
          description: err instanceof Error ? err.message : 'An unexpected error occurred',
          variant: 'error',
        });
        setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      } finally {
        setIsSubmitting(false);
      }
    },
    [selectedRequest, selectedVehicle, selectedDriverId, startDate, endDate, notes, router, toast],
  );

  /* ------------------- Render ------------------- */

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Allocations', href: '/dashboard/allocations' },
          { label: 'New Allocation' },
        ]}
      />
      <PageHeader title="New Vehicle Allocation" description="Select an approved request, then assign an eligible vehicle and driver">
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/allocations">
            <ChevronLeft className="h-4 w-4" /> Back to Allocations
          </Link>
        </Button>
      </PageHeader>

      {error && (
        <div className="rounded-[8px] border border-status-error-bg bg-status-error-bg/20 px-4 py-3">
          <p className="text-sm font-medium text-status-error-text">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Request selector — human-readable, never a UUID */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-4 w-4 text-ink-400" />
              Transport Request
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Label required>Search for the request to allocate</Label>
              <div className="relative mt-1.5">
                <Search className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <Input
                  placeholder="Search by request number, requester, route…"
                  value={requestQuery}
                  onChange={(e) => handleRequestQueryChange(e.target.value)}
                  onFocus={() => {
                    if (requestResults.length) setRequestDropdownOpen(true);
                  }}
                  className="pl-9"
                />
                {requestSearching && (
                  <Loader2 className="text-ink-400 absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
                )}
              </div>
              {requestDropdownOpen && (
                <div className="border-border bg-surface z-30 mt-1.5 max-h-80 overflow-y-auto rounded-[10px] border p-1 shadow-lg">
                  {requestResults.length === 0 && !requestSearching && (
                    <p className="text-ink-500 px-3 py-4 text-center text-sm">
                      Type at least 2 characters to search eligible requests.
                    </p>
                  )}
                  {requestResults.map((request) => (
                    <button
                      key={request.id}
                      type="button"
                      onClick={() => selectRequest(request)}
                      className="focus-ring hover:bg-muted w-full rounded-[8px] px-3 py-2.5 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-ink-950 text-sm font-semibold">{request.reference}</span>
                        <Badge variant="info" size="sm">{request.status.replace(/_/g, ' ')}</Badge>
                        {request.urgency === 'urgent' && (
                          <Badge variant="emergency" size="sm">Urgent</Badge>
                        )}
                      </div>
                      <div className="text-ink-500 mt-0.5 text-xs">
                        {request.requesterName ?? 'Unknown requester'}
                        {request.requesterEmployeeNumber ? ` · ${request.requesterEmployeeNumber}` : ''}
                        {request.passengerCount > 0 ? ` · ${request.passengerCount} passenger${request.passengerCount === 1 ? '' : 's'}` : ''}
                      </div>
                      <div className="text-ink-500 mt-0.5 text-xs">
                        {request.origin || 'Origin'} → {request.destination || 'Destination'}
                        {request.estimatedKm ? ` · ${Math.round(request.estimatedKm)} km` : ''}
                        {request.startDate ? ` · ${formatDate(request.startDate)}${request.endDate ? ` – ${formatDate(request.endDate)}` : ''}` : ''}
                      </div>
                      {request.nominatedDriverName && (
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-ink-500">
                          <UserRound className="h-3 w-3" /> Nominated driver: {request.nominatedDriverName}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedRequest && (
              <div className="rounded-[10px] border border-brand-200 bg-brand-50/40 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-ink-950">{selectedRequest.reference}</p>
                  <Badge variant="success" size="sm">Selected</Badge>
                </div>
                <div className="mt-2 grid gap-x-6 gap-y-1.5 text-xs text-ink-600 sm:grid-cols-2">
                  <div><span className="text-ink-400">Requester:</span> {selectedRequest.requesterName ?? '—'}</div>
                  <div><span className="text-ink-400">Route:</span> {selectedRequest.origin ?? '—'} → {selectedRequest.destination ?? '—'}</div>
                  <div><span className="text-ink-400">Dates:</span> {formatDate(selectedRequest.startDate)}{selectedRequest.endDate ? ` – ${formatDate(selectedRequest.endDate)}` : ''}</div>
                  <div><span className="text-ink-400">Passengers:</span> {selectedRequest.passengerCount}</div>
                  {selectedRequest.vehicleRequirements && (
                    <div><span className="text-ink-400">Vehicle needs:</span> {selectedRequest.vehicleRequirements}</div>
                  )}
                  {selectedRequest.specialRequirements && (
                    <div><span className="text-ink-400">Special:</span> {selectedRequest.specialRequirements}</div>
                  )}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  className="mt-3"
                  onClick={() => {
                    setSelectedRequest(null);
                    setRequestQuery('');
                    setStartDate('');
                    setEndDate('');
                    setSelectedVehicle(null);
                    setSelectedDriverId(null);
                    setDrivers([]);
                    setRecommendations([]);
                  }}
                >
                  Change request
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {selectedRequest && (
          <>
            {/* Dates */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-ink-400" />
                  Allocation Period
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label required>Start Date</Label>
                  <StyledDateInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label>End Date</Label>
                  <StyledDateInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Allocation Notes</Label>
                  <Textarea placeholder="Operational notes, release instructions…" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </CardContent>
            </Card>

            {/* Vehicle */}
            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Truck className="h-4 w-4 text-ink-400" /> Vehicle
                  </span>
                  <span className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" type="button" onClick={fetchRecommendations} loading={recLoading}>
                      <Star className="h-4 w-4" /> Get Vehicle Recommendation
                    </Button>
                    {selectedRequest && (
                      <Button variant="secondary" size="sm" type="button" onClick={() => void loadDrivers()}>
                        Refresh driver eligibility
                      </Button>
                    )}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <Label required>Search vehicle</Label>
                  <div className="relative mt-1.5">
                    <Search className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                    <Input
                      placeholder="Search by GRN number, fleet number, make or model…"
                      value={vehicleQuery}
                      onChange={(e) => handleVehicleQueryChange(e.target.value)}
                      onFocus={() => {
                        if (vehicleResults.length) setVehicleDropdownOpen(true);
                      }}
                      className="pl-9"
                    />
                    {vehicleSearching && (
                      <Loader2 className="text-ink-400 absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
                    )}
                  </div>
                  {vehicleDropdownOpen && (
                    <div className="border-border bg-surface z-30 mt-1.5 max-h-80 overflow-y-auto rounded-[10px] border p-1 shadow-lg">
                      {vehicleResults.length === 0 && !vehicleSearching && (
                        <p className="text-ink-500 px-3 py-4 text-center text-sm">
                          Type at least 2 characters to search the fleet.
                        </p>
                      )}
                      {vehicleResults.map((vehicle) => {
                        const isSelected = selectedVehicle?.id === vehicle.id;
                        const unavailable = vehicle.status !== 'available' && vehicle.status !== 'allocated';
                        return (
                          <button
                            key={vehicle.id}
                            type="button"
                            disabled={unavailable}
                            onClick={() => selectVehicle(vehicle)}
                            className={`focus-ring hover:bg-muted flex w-full items-center gap-3 rounded-[8px] px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60`}
                          >
                            <span className="bg-brand-50 text-brand-700 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]">
                              <Truck className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="text-ink-950 block truncate text-sm font-medium">
                                {vehicle.licenceNumber} · {vehicle.make} {vehicle.model}
                              </span>
                              <span className="text-ink-500 block truncate text-xs">
                                {vehicle.categoryName ?? 'Vehicle'} · {vehicle.fuelType} · {vehicle.currentOdometer.toLocaleString()} km
                              </span>
                            </span>
                            {unavailable ? (
                              <Badge variant="error" size="sm">{vehicle.status.replace(/_/g, ' ')}</Badge>
                            ) : isSelected ? (
                              <CheckCircle2 className="text-brand-700 h-4 w-4 shrink-0" />
                            ) : (
                              <Badge variant="success" size="sm">{vehicle.status}</Badge>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {recError && (
                  <div className="flex items-start gap-2 rounded-[8px] border border-status-error-bg bg-status-error-bg/20 px-3 py-2">
                    <AlertTriangle className="text-status-error-text mt-0.5 h-4 w-4 shrink-0" />
                    <p className="text-xs text-status-error-text">{recError}</p>
                  </div>
                )}

                {recommendations.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-ink-500">
                      Recommendations are advisory — confirm availability before creating the allocation.
                    </p>
                    {recommendations.map((vehicle) => {
                      const isSelected = selectedVehicle?.id === vehicle.vehicleId;
                      return (
                        <button
                          key={vehicle.vehicleId}
                          type="button"
                          onClick={() => adoptRecommendation(vehicle)}
                          className={`w-full rounded-[10px] border-2 p-4 text-left transition-all ${
                            isSelected
                              ? 'border-brand-500 bg-brand-50'
                              : 'border-border bg-surface hover:border-brand-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <div className={`flex h-10 w-10 items-center justify-center rounded-[8px] ${isSelected ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-700'}`}>
                                <Truck className="h-5 w-5" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-[650] text-ink-950">{vehicle.make} {vehicle.model}</p>
                                  <Badge variant="info" size="sm">{vehicle.licenceNumber}</Badge>
                                </div>
                                <div className="text-ink-500 flex items-center gap-3 text-xs">
                                  {vehicle.categoryName && <span>{vehicle.categoryName}</span>}
                                  <span className="tabular-nums">{vehicle.currentOdometer.toLocaleString()} km</span>
                                  <span>{vehicle.fuelType}</span>
                                </div>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className={`text-lg font-bold tabular-nums ${vehicle.score >= 80 ? 'text-status-success-text' : vehicle.score >= 60 ? 'text-status-pending-text' : 'text-ink-500'}`}>
                                {vehicle.score}
                              </div>
                              <div className="text-ink-400 text-[10px]">Score</div>
                            </div>
                          </div>
                          {vehicle.reasons.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {vehicle.reasons.map((reason, index) => (
                                <span key={index} className="inline-flex items-center gap-1 rounded-full bg-status-success-bg/30 px-2 py-0.5 text-[10px] text-status-success-text">
                                  <CheckCircle2 className="h-2.5 w-2.5" />{reason}
                                </span>
                              ))}
                            </div>
                          )}
                          {vehicle.concerns.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {vehicle.concerns.map((concern, index) => (
                                <span key={index} className="inline-flex items-center gap-1 rounded-full bg-status-error-bg/30 px-2 py-0.5 text-[10px] text-status-error-text">
                                  <AlertTriangle className="h-2.5 w-2.5" />{concern}
                                </span>
                              ))}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {selectedVehicle && startDate && (
                  <VehicleAvailabilityCheck
                    vehicleId={selectedVehicle.id}
                    startDate={startDate}
                    endDate={endDate}
                  />
                )}
              </CardContent>
            </Card>

            {/* Driver */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-ink-400" /> Driver
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {drivers.length === 0 && !driversLoading && (
                  <div className="flex flex-col items-start gap-2 rounded-[8px] border border-dashed border-border p-4">
                    <p className="text-sm text-ink-700">Assign an eligible driver to this allocation.</p>
                    <Button variant="secondary" size="sm" type="button" onClick={() => void loadDrivers()}>
                      <Search className="h-4 w-4" /> Load eligible drivers
                    </Button>
                  </div>
                )}
                {driversLoading && (
                  <div className="flex items-center gap-2 py-4 text-sm text-ink-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking driver eligibility…
                  </div>
                )}
                {drivers.length > 0 && (
                  <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                    {drivers.map((driver) => {
                      const isSelected = selectedDriverId === driver.employeeId;
                      const reasons = driver.compliance?.reasons ?? [];
                      return (
                        <button
                          key={driver.employeeId}
                          type="button"
                          disabled={!driver.eligible}
                          onClick={() => setSelectedDriverId(driver.eligible ? driver.employeeId : null)}
                          className={`focus-ring w-full rounded-[10px] border-2 p-3 text-left transition-all disabled:cursor-not-allowed ${
                            isSelected
                              ? 'border-brand-500 bg-brand-50'
                              : driver.eligible
                                ? 'border-border bg-surface hover:border-brand-200'
                                : 'border-border bg-muted/30 opacity-70'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="bg-brand-50 text-brand-700 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                                {driver.firstName.charAt(0)}{driver.lastName.charAt(0)}
                              </div>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-medium text-ink-950">{driver.firstName} {driver.lastName}</p>
                                  {driver.eligible ? (
                                    <Badge variant="success" size="sm" className="gap-1">
                                      <ShieldCheck className="h-3 w-3" /> Eligible
                                    </Badge>
                                  ) : (
                                    <Badge variant="error" size="sm" className="gap-1">
                                      <ShieldAlert className="h-3 w-3" /> Ineligible
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-ink-500 mt-0.5 truncate text-xs">
                                  {driver.employeeNumber}
                                  {driver.departmentName ? ` · ${driver.departmentName}` : ''}
                                  {driver.officeName ? ` · ${driver.officeName}` : ''}
                                </div>
                                <div className="text-ink-500 mt-0.5 text-xs">
                                  {driver.licenceClass ? `Class ${driver.licenceClass}` : 'No licence'}
                                  {driver.licenceExpiry ? ` · valid to ${driver.licenceExpiry}` : ''}
                                  {driver.licenceNumber ? ` · ${driver.licenceNumber.slice(-4).padStart(4, '•')}` : ''}
                                </div>
                              </div>
                            </div>
                            {isSelected && <CheckCircle2 className="text-brand-700 h-5 w-5 shrink-0" />}
                          </div>
                          {!driver.eligible && reasons.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {reasons.map((reason, index) => (
                                <span key={index} className="inline-flex items-center gap-1 rounded-full bg-status-error-bg/30 px-2 py-0.5 text-[10px] text-status-error-text">
                                  <XCircle className="h-2.5 w-2.5" />{reason}
                                </span>
                              ))}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/allocations">Cancel</Link>
          </Button>
          <Button variant="primary" size="sm" type="submit" loading={isSubmitting} disabled={!selectedRequest || !selectedVehicle}>
            <CheckCircle2 className="h-4 w-4" /> Create Allocation
          </Button>
        </div>
      </form>
    </div>
  );
}
