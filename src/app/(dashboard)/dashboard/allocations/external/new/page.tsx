'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldWrapper, Input, Textarea } from '@/components/ui/input';
import { StyledDateInput, StyledSelect } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';
import { ArrowLeft, Car, Loader2, Search, ShieldCheck, UserRound } from 'lucide-react';

type EligibleRequest = {
  id: string;
  reference: string;
  status: string;
  requesterType: 'internal' | 'external';
  requesterName: string | null;
  requesterOrganisation: string | null;
  purpose: string | null;
  origin: string | null;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  preferredDriverExternalPartyId: string | null;
  nominatedDriverName: string | null;
  nominatedDriverExternal: boolean;
};

type Vehicle = {
  id: string;
  licenceNumber: string;
  vehicleRegisterNumber: string | null;
  make: string;
  model: string;
  status: string;
  requiredLicenceClass?: string | null;
  professionalAuthorisationRequired?: boolean;
};

type ExternalDriver = {
  id: string;
  fullName: string;
  organisationName: string;
  latestLicence?: { licenceClass?: string; expiryDate?: string } | null;
};

export default function ExternalDriverAllocationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const initialRequestId = searchParams.get('requestId') || '';

  const [requests, setRequests] = useState<EligibleRequest[]>([]);
  const [requestQuery, setRequestQuery] = useState('');
  const [selectedRequestId, setSelectedRequestId] = useState(initialRequestId);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleQuery, setVehicleQuery] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [drivers, setDrivers] = useState<ExternalDriver[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedRequest = useMemo(
    () => requests.find((item) => item.id === selectedRequestId) ?? null,
    [requests, selectedRequestId],
  );
  const selectedVehicle = useMemo(
    () => vehicles.find((item) => item.id === selectedVehicleId) ?? null,
    [vehicles, selectedVehicleId],
  );
  const selectedDriver = useMemo(
    () => drivers.find((item) => item.id === selectedDriverId) ?? null,
    [drivers, selectedDriverId],
  );

  const loadRequests = useCallback(async (query = '') => {
    const params = new URLSearchParams({ limit: '50' });
    if (query.trim()) params.set('q', query.trim());
    const response = await fetch(`/api/allocations/requests?${params}`, { cache: 'no-store' });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || 'Could not load eligible requests');
    const rows = (Array.isArray(json.data) ? json.data : []).filter(
      (item: EligibleRequest) => item.requesterType === 'external',
    );
    setRequests(rows);
    if (initialRequestId && rows.some((item: EligibleRequest) => item.id === initialRequestId)) {
      setSelectedRequestId(initialRequestId);
    }
  }, [initialRequestId]);

  const loadDrivers = useCallback(async () => {
    const response = await fetch('/api/external-parties?driverReady=true&limit=100', { cache: 'no-store' });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || 'Could not load verified external drivers');
    setDrivers(Array.isArray(json.data) ? json.data : []);
  }, []);

  const searchVehicles = useCallback(async (query = '') => {
    setSearching(true);
    try {
      const params = new URLSearchParams({ limit: '25' });
      if (query.trim()) params.set('search', query.trim());
      const response = await fetch(`/api/fleet?${params}`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Could not load vehicles');
      setVehicles(Array.isArray(json.rows) ? json.rows : []);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadRequests(), loadDrivers(), searchVehicles()])
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load allocation data'))
      .finally(() => setLoading(false));
  }, [loadDrivers, loadRequests, searchVehicles]);

  useEffect(() => {
    if (!selectedRequest) return;
    if (selectedRequest.startDate) setStartDate(selectedRequest.startDate.slice(0, 10));
    if (selectedRequest.endDate) setEndDate(selectedRequest.endDate.slice(0, 10));
    if (selectedRequest.preferredDriverExternalPartyId) {
      setSelectedDriverId(selectedRequest.preferredDriverExternalPartyId);
    }
  }, [selectedRequest]);

  async function createAllocation() {
    if (!selectedRequest || !selectedVehicle || !selectedDriver || !startDate) {
      setError('Select an external request, vehicle, verified external driver and start date.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/allocations/external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: selectedRequest.id,
          vehicleId: selectedVehicle.id,
          externalDriverPartyId: selectedDriver.id,
          startDate,
          endDate: endDate || undefined,
          notes,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'External driver allocation could not be created');
      toast({
        title: 'External driver assigned',
        description: `${selectedDriver.fullName} is pending recorded acceptance for ${selectedRequest.reference}.`,
        variant: 'success',
      });
      router.push(`/dashboard/allocations/external/${json.externalDriverAssignment.id}`);
      router.refresh();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'External allocation failed';
      setError(message);
      toast({ title: 'Allocation failed', description: message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Allocations', href: '/dashboard/allocations' },
        { label: 'External Driver Allocation' },
      ]} />
      <PageHeader
        title="External Driver Allocation"
        description="Assign a verified external driver without adding them to the tenant employee directory."
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/allocations"><ArrowLeft className="h-4 w-4" /> Back to allocations</Link>
        </Button>
      </PageHeader>

      <div className="bg-status-info-bg text-status-info-text rounded-[8px] px-4 py-3 text-sm">
        External assignments remain separate from employee driver records. The driver must still have verified licence evidence valid for the complete trip period, and Transport Office must record acceptance before departure.
      </div>

      {error && <div role="alert" className="bg-status-error-bg text-status-error-text rounded-[8px] px-4 py-3 text-sm">{error}</div>}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>1. External transport request</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={requestQuery}
                onChange={(event) => setRequestQuery(event.target.value)}
                placeholder="Reference, external requester or organisation"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void loadRequests(requestQuery).catch((e) => setError(e.message));
                }}
              />
              <Button variant="secondary" type="button" onClick={() => void loadRequests(requestQuery).catch((e) => setError(e.message))}>
                <Search className="h-4 w-4" /> Search
              </Button>
            </div>
            <StyledSelect value={selectedRequestId} onChange={(event) => setSelectedRequestId(event.target.value)} disabled={loading}>
              <option value="">Select external request</option>
              {requests.map((request) => (
                <option key={request.id} value={request.id}>
                  {request.reference} · {request.requesterName || 'External requester'} · {request.requesterOrganisation || 'External organisation'}
                </option>
              ))}
            </StyledSelect>
            {selectedRequest && (
              <div className="border-border rounded-[8px] border p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{selectedRequest.reference}</strong><Badge variant="info" size="sm">External</Badge>
                </div>
                <p className="text-ink-600 mt-2">{selectedRequest.requesterName} · {selectedRequest.requesterOrganisation}</p>
                <p className="text-ink-500 mt-1 text-xs">{selectedRequest.origin || 'Origin'} → {selectedRequest.destination || 'Destination'}</p>
                {selectedRequest.purpose && <p className="text-ink-600 mt-2">{selectedRequest.purpose}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Car className="h-4 w-4" /> 2. Vehicle</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input value={vehicleQuery} onChange={(event) => setVehicleQuery(event.target.value)} placeholder="Registration, make or model" />
              <Button variant="secondary" type="button" onClick={() => void searchVehicles(vehicleQuery).catch((e) => setError(e.message))}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
              </Button>
            </div>
            <StyledSelect value={selectedVehicleId} onChange={(event) => setSelectedVehicleId(event.target.value)}>
              <option value="">Select available vehicle</option>
              {vehicles.filter((vehicle) => vehicle.status === 'available').map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>{vehicle.licenceNumber} · {vehicle.make} {vehicle.model}</option>
              ))}
            </StyledSelect>
            {selectedVehicle?.professionalAuthorisationRequired && (
              <p className="text-status-warning-text text-xs">This vehicle requires professional authorisation. External allocation will remain blocked until verified professional-authorisation evidence is supported for this driver.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><UserRound className="h-4 w-4" /> 3. Verified external driver</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <StyledSelect value={selectedDriverId} onChange={(event) => setSelectedDriverId(event.target.value)} disabled={loading}>
              <option value="">Select verified external driver</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.fullName} · {driver.organisationName}{driver.latestLicence?.licenceClass ? ` · ${driver.latestLicence.licenceClass}` : ''}
                </option>
              ))}
            </StyledSelect>
            {selectedDriver && (
              <div className="border-status-success-text/20 bg-status-success-bg rounded-[8px] border px-4 py-3 text-sm">
                <p className="text-status-success-text flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4" /> Licence evidence verified</p>
                <p className="text-ink-600 mt-1">{selectedDriver.fullName} · {selectedDriver.organisationName}</p>
                {selectedDriver.latestLicence?.expiryDate && <p className="text-ink-500 mt-1 text-xs">Licence expiry: {selectedDriver.latestLicence.expiryDate}</p>}
              </div>
            )}
            <Button variant="secondary" size="sm" asChild><Link href="/dashboard/drivers/external">Manage external drivers</Link></Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>4. Period and assignment note</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldWrapper label="Start date" required><StyledDateInput value={startDate} onChange={(e) => setStartDate(e.target.value)} /></FieldWrapper>
              <FieldWrapper label="End date"><StyledDateInput value={endDate} onChange={(e) => setEndDate(e.target.value)} /></FieldWrapper>
            </div>
            <FieldWrapper label="Transport note"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional operational note" /></FieldWrapper>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap justify-start gap-2">
        <Button variant="secondary" asChild><Link href="/dashboard/allocations">Cancel</Link></Button>
        <Button loading={saving} disabled={loading} onClick={() => void createAllocation()}>Create external assignment</Button>
      </div>
    </div>
  );
}
