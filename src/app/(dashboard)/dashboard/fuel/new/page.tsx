'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/auth-client';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { StyledSelect, StyledDateInput } from '@/components/ui/styled-select';
import { EmployeeCombobox, type EmployeeSearchOption } from '@/components/ui/employee-combobox';
import { Camera, ChevronLeft, CheckCircle2, Save, WifiOff } from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import Link from 'next/link';
import { saveDraft, deleteDraft } from '@/lib/offline-drafts';
import { fetchUserProfile, userProfileQueryKey } from '@/lib/user-profile';
import { useQuery } from '@tanstack/react-query';

type ReceiptScanFields = {
  supplier?: string;
  stationLocation?: string;
  transactionDate?: string;
  transactionTime?: string;
  transactionReference?: string;
  fuelType?: string;
  amount?: number;
  litres?: number;
  odometer?: number;
  registrationNumber?: string;
  receiptNumber?: string;
};

type ReceiptScanResult = {
  status?: string;
  engine?: string;
  manualEntryRequired?: boolean;
  fields?: ReceiptScanFields;
  extractionConfidence?: number;
  flags?: string[];
  matchedVehicle?: { id: string; licenceNumber: string } | null;
};

type AssignedTrip = {
  id: string;
  status: string;
  reference?: string | null;
  requestReference?: string | null;
  vehicleId?: string | null;
  licenceNumber?: string | null;
  vehicleLicence?: string | null;
  make?: string | null;
  model?: string | null;
  purpose?: string | null;
};

type StationSuggestion = {
  name: string;
  uses: number;
  source: 'tenant_history';
};

function toLocalDateTime(dateValue?: string, timeValue?: string) {
  if (!dateValue) return '';
  const raw = dateValue.trim();
  let date = '';
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  const local = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (iso) date = `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  else if (local) date = `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
  if (!date) return '';
  const time = timeValue?.match(/([0-2]?\d):([0-5]\d)/);
  return `${date}T${time ? `${time[1].padStart(2, '0')}:${time[2]}` : '00:00'}`;
}

function normaliseFuelType(value?: string) {
  const fuel = value?.toLowerCase() || '';
  if (fuel.includes('diesel')) return 'diesel';
  if (fuel.includes('unleaded') || fuel.includes('ulp')) return 'unleaded';
  if (fuel.includes('petrol')) return 'petrol';
  return '';
}

function differs(extracted: unknown, confirmed: string | number) {
  if (extracted === undefined || extracted === null) return true;
  if (typeof confirmed === 'number') return Number(extracted) !== confirmed;
  return String(extracted).trim().toLowerCase() !== confirmed.trim().toLowerCase();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = window.setTimeout(() => {
        window.clearTimeout(timer);
        reject(new Error(message));
      }, timeoutMs);
    }),
  ]);
}

export default function NewFuelEntryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { data: profile } = useQuery({
    queryKey: userProfileQueryKey,
    queryFn: ({ signal }) => fetchUserProfile(signal),
  });
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    vehicleGrn: searchParams.get('vehicle') || '',
    vehicleId: '',
    tripRef: '',
    transactionDate: '',
    stationName: '',
    fuelType: 'diesel',
    litres: '',
    amount: '',
    odometerReading: '',
    referenceNumber: '',
    paymentMethod: 'fuel_card',
    fillType: 'full',
    notes: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptScan, setReceiptScan] = useState<ReceiptScanResult | null>(null);
  const [isScanningReceipt, setIsScanningReceipt] = useState(false);
  const [vehicleSearch, setVehicleSearch] = useState(searchParams.get('vehicle') || '');
  const [vehicles, setVehicles] = useState<Array<{ id: string; licenceNumber: string; make: string; model: string }>>([]);
  const [vehicleLoading, setVehicleLoading] = useState(false);
  const [vehicleDropdown, setVehicleDropdown] = useState(false);
  const [driverId, setDriverId] = useState('');
  const [driverOption, setDriverOption] = useState<EmployeeSearchOption | null>(null);
  const [claimantId, setClaimantId] = useState('');
  const [claimantOption, setClaimantOption] = useState<EmployeeSearchOption | null>(null);
  const [selectedTripId, setSelectedTripId] = useState(searchParams.get('tripId') || '');
  const [activeTrips, setActiveTrips] = useState<AssignedTrip[]>([]);
  const [tripLoading, setTripLoading] = useState(false);
  const [stationSuggestions, setStationSuggestions] = useState<StationSuggestion[]>([]);
  const [stationRouteHints, setStationRouteHints] = useState<string[]>([]);
  const [stationDropdown, setStationDropdown] = useState(false);
  const [stationLoading, setStationLoading] = useState(false);

  const roleNames = useMemo(
    () => (profile?.roles || []).map((role) => role.roleName.trim().toLowerCase()),
    [profile?.roles],
  );
  const canRecordOnBehalf = roleNames.some(
    (role) => role.includes('transport administrator') || role.includes('transport officer'),
  );
  const isDriverSelfEntry = roleNames.some((role) => role === 'driver' || role.endsWith(' driver')) && !canRecordOnBehalf;

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const updateForm = useCallback((patch: Partial<typeof formData>) => {
    setFormData((prev) => ({ ...prev, ...patch }));
    setDraftSaved(false);
  }, []);

  const applyAssignedTrip = useCallback((trip: AssignedTrip) => {
    const licenceNumber = trip.licenceNumber || trip.vehicleLicence || '';
    const reference = trip.reference || trip.requestReference || '';
    setSelectedTripId(trip.id);
    setFormData((prev) => ({
      ...prev,
      vehicleId: trip.vehicleId || prev.vehicleId,
      vehicleGrn: licenceNumber || prev.vehicleGrn,
      tripRef: reference || prev.tripRef,
    }));
    if (licenceNumber) {
      setVehicleSearch(`${licenceNumber}${trip.make || trip.model ? ` — ${trip.make || ''} ${trip.model || ''}`.trimEnd() : ''}`);
    }
    setDraftSaved(false);
  }, []);

  useEffect(() => {
    if (!isDriverSelfEntry || !profile) return;
    let cancelled = false;
    setTripLoading(true);
    void (async () => {
      try {
        const response = await fetch('/api/trips?driver_assigned=true&limit=20', { cache: 'no-store' });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || 'Could not load assigned trips');
        const rows = (json.data || json.rows || []) as AssignedTrip[];
        const active = rows.filter((trip) => trip.status === 'in_progress' || trip.status === 'return_due');
        if (cancelled) return;
        setActiveTrips(active);
        const requestedTrip = active.find((trip) => trip.id === selectedTripId);
        if (requestedTrip) applyAssignedTrip(requestedTrip);
        else if (active.length === 1) applyAssignedTrip(active[0]);
      } catch (error) {
        if (!cancelled) {
          toast({
            title: 'Could not load your active trip',
            description: error instanceof Error ? error.message : 'Select the trip from Assigned Trips and try again.',
            variant: 'error',
          });
        }
      } finally {
        if (!cancelled) setTripLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDriverSelfEntry, profile, selectedTripId, applyAssignedTrip, toast]);

  const scanReceipt = useCallback(async (file: File) => {
    if (!isOnline) return;
    setIsScanningReceipt(true);
    try {
      const scanForm = new FormData();
      scanForm.append('file', file);
      const response = await fetch('/api/fuel/receipts/scan', { method: 'POST', body: scanForm });
      const result = (await response.json()) as ReceiptScanResult & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Receipt scan failed');
      setReceiptScan(result);

      const fields = result.fields || {};
      const scannedDate = toLocalDateTime(fields.transactionDate, fields.transactionTime);
      const scannedFuel = normaliseFuelType(fields.fuelType);
      setFormData((prev) => ({
        ...prev,
        vehicleGrn: prev.vehicleGrn || result.matchedVehicle?.licenceNumber || '',
        vehicleId: prev.vehicleId || result.matchedVehicle?.id || '',
        transactionDate: prev.transactionDate || scannedDate,
        stationName: prev.stationName || fields.stationLocation || fields.supplier || '',
        fuelType: prev.fuelType === 'diesel' && scannedFuel && scannedFuel !== 'diesel' ? scannedFuel : prev.fuelType,
        litres: prev.litres || (fields.litres === undefined ? '' : String(fields.litres)),
        amount: prev.amount || (fields.amount === undefined ? '' : String(fields.amount)),
        odometerReading: prev.odometerReading || (fields.odometer === undefined ? '' : String(fields.odometer)),
        referenceNumber: prev.referenceNumber || fields.receiptNumber || fields.transactionReference || '',
      }));
      if (!vehicleSearch && result.matchedVehicle?.licenceNumber) setVehicleSearch(result.matchedVehicle.licenceNumber);

      toast({
        title: result.manualEntryRequired ? 'Receipt scan needs manual entry' : 'Receipt scanned — review the fields',
        description: result.flags?.length
          ? `Check: ${result.flags.join(', ').replaceAll('_', ' ')}`
          : 'Extracted values were applied only where the form was still blank.',
        variant: result.flags?.length || result.manualEntryRequired ? 'pending' : 'success',
      });
    } catch (error) {
      setReceiptScan({ status: 'ocr_failed', manualEntryRequired: true, flags: [] });
      toast({
        title: 'Receipt scan unavailable',
        description: `${error instanceof Error ? error.message : 'OCR could not read this receipt'}. You can still enter the values manually and save the original image.`,
        variant: 'pending',
      });
    } finally {
      setIsScanningReceipt(false);
    }
  }, [isOnline, toast, vehicleSearch]);

  useEffect(() => {
    if (isDriverSelfEntry) {
      setVehicles([]);
      setVehicleDropdown(false);
      return;
    }
    const timer = setTimeout(async () => {
      if (vehicleSearch.length < 2) {
        setVehicles([]);
        return;
      }
      setVehicleLoading(true);
      try {
        const res = await fetch(`/api/fleet?search=${encodeURIComponent(vehicleSearch)}&limit=10`);
        const json = await res.json();
        const list = json.vehicles || json.data?.vehicles || json.rows || json.data || [];
        setVehicles(Array.isArray(list) ? list : []);
        setVehicleDropdown(true);
      } catch {
        // Search failures are surfaced by an empty result state; form submission remains server-validated.
      } finally {
        setVehicleLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [vehicleSearch, isDriverSelfEntry]);

  useEffect(() => {
    if (!isOnline) return;
    const timer = window.setTimeout(async () => {
      setStationLoading(true);
      try {
        const params = new URLSearchParams();
        if (formData.stationName.trim()) params.set('search', formData.stationName.trim());
        if (selectedTripId) params.set('tripId', selectedTripId);
        const response = await fetch(`/api/fuel/stations?${params.toString()}`, { cache: 'no-store' });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || 'Could not load station suggestions');
        setStationSuggestions(Array.isArray(json.suggestions) ? json.suggestions : []);
        setStationRouteHints(Array.isArray(json.routeHints) ? json.routeHints : []);
      } catch {
        setStationSuggestions([]);
        setStationRouteHints([]);
      } finally {
        setStationLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [formData.stationName, selectedTripId, isOnline]);

  const buildDraftFormData = useCallback(
    () => ({
      ...formData,
      tripId: selectedTripId,
      claimantEmployeeId: claimantId || null,
      driverEmployeeId: canRecordOnBehalf ? driverId || null : null,
      receiptFile,
    }) as unknown as Record<string, unknown>,
    [formData, selectedTripId, claimantId, canRecordOnBehalf, driverId, receiptFile],
  );

  const saveDraftLocally = useCallback(async () => {
    if (isDraftSaving) return;
    setIsDraftSaving(true);
    try {
      const draft = await withTimeout(
        saveDraft({
          id: draftId || undefined,
          draftType: 'fuel',
          formData: buildDraftFormData(),
          userId: session?.user?.id || null,
          tenantId: profile?.tenantId || null,
          syncStatus: 'pending',
        }),
        8000,
        'Local draft storage did not respond. Please try again.',
      );
      setDraftId(draft.id);
      setDraftSaved(true);
      toast({
        title: isOnline ? 'Draft saved locally' : 'Draft saved offline',
        description: isOnline ? 'You can continue editing or return to it from Offline Drafts.' : 'It will be available for sync when the device reconnects.',
        variant: 'success',
      });
      window.setTimeout(() => setDraftSaved(false), 2500);
    } catch (err) {
      console.error('Failed to save draft:', err);
      toast({
        title: 'Draft was not saved',
        description: err instanceof Error ? err.message : 'Local draft storage is unavailable.',
        variant: 'error',
      });
    } finally {
      setIsDraftSaving(false);
    }
  }, [buildDraftFormData, draftId, isDraftSaving, isOnline, profile?.tenantId, session?.user?.id, toast]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    if (!isOnline) {
      try {
        await withTimeout(
          saveDraft({
            id: draftId || undefined,
            draftType: 'fuel',
            formData: buildDraftFormData(),
            userId: session?.user?.id || null,
            tenantId: profile?.tenantId || null,
            syncStatus: 'pending',
          }),
          8000,
          'Local draft storage did not respond. Please try again.',
        );
        toast({ title: 'Fuel entry queued offline', description: 'The draft will remain on this device until it syncs.', variant: 'success' });
        router.push('/dashboard/fuel');
      } catch (err) {
        console.error('Draft save failed:', err);
        toast({ title: 'Could not queue offline entry', description: err instanceof Error ? err.message : 'Draft storage failed.', variant: 'error' });
        setIsSubmitting(false);
      }
      return;
    }

    try {
      const res = await fetch('/api/fuel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleGrn: formData.vehicleGrn,
          vehicleId: formData.vehicleId || undefined,
          tripId: selectedTripId || undefined,
          tripRef: formData.tripRef || null,
          driverEmployeeId: canRecordOnBehalf ? driverId || undefined : undefined,
          claimantEmployeeId:
            formData.paymentMethod === 'personal_reimbursement' ? claimantId || undefined : undefined,
          clientSyncId: crypto.randomUUID(),
          transactionAt: formData.transactionDate,
          stationName: formData.stationName,
          fuelType: formData.fuelType,
          litres: formData.litres,
          amount: formData.amount,
          odometerReading: formData.odometerReading,
          referenceNumber: formData.referenceNumber || null,
          paymentMethod: formData.paymentMethod,
          fillType: formData.fillType,
          notes: formData.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record transaction');

      if (receiptFile && data.data?.id) {
        const receiptForm = new FormData();
        receiptForm.append('file', receiptFile);
        receiptForm.append('transactionId', data.data.id);
        const receiptResponse = await fetch('/api/fuel/receipts', { method: 'POST', body: receiptForm });
        const receiptData = await receiptResponse.json();
        if (!receiptResponse.ok) throw new Error(receiptData.error || 'Fuel entry saved, but receipt OCR failed');

        const receiptId = receiptData.data?.id as string | undefined;
        if (receiptId) {
          const extracted = (receiptData.fields || {}) as Record<string, unknown>;
          const [transactionDate, transactionTime] = formData.transactionDate.split('T');
          const candidates: Record<string, string | number> = {};
          if (formData.stationName) candidates.stationLocation = formData.stationName;
          if (transactionDate) candidates.transactionDate = transactionDate;
          if (transactionTime) candidates.transactionTime = transactionTime.slice(0, 5);
          if (formData.referenceNumber) candidates.receiptNumber = formData.referenceNumber;
          if (formData.fuelType) candidates.fuelType = formData.fuelType;
          if (formData.amount) candidates.amount = Number(formData.amount);
          if (formData.litres) candidates.litres = Number(formData.litres);
          if (formData.odometerReading) candidates.odometer = Number(formData.odometerReading);
          if (formData.vehicleGrn) candidates.registrationNumber = formData.vehicleGrn;

          const corrections = Object.fromEntries(
            Object.entries(candidates).filter(([field, value]) => differs(extracted[field], value)),
          );
          if (Object.keys(corrections).length > 0) {
            const correctionResponse = await fetch('/api/fuel/receipts', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ receiptId, action: 'correct', corrections }),
            });
            const correctionData = await correctionResponse.json();
            if (!correctionResponse.ok) throw new Error(correctionData.error || 'Receipt correction could not be saved');
          }

          const confirmResponse = await fetch('/api/fuel/receipts', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ receiptId, action: 'confirm' }),
          });
          const confirmData = await confirmResponse.json();
          if (!confirmResponse.ok) throw new Error(confirmData.error || 'Receipt confirmation could not be saved');
        }

        toast({
          title: receiptData.manualEntryRequired ? 'Receipt saved with confirmed manual values' : 'Receipt OCR reviewed and confirmed',
          description: receiptData.flags?.length
            ? `Evidence saved; Transport Office should review: ${receiptData.flags.join(', ').replaceAll('_', ' ')}`
            : 'The original image and your confirmed receipt values were preserved.',
          variant: receiptData.flags?.length ? 'pending' : 'success',
        });
      }

      if (draftId) await deleteDraft(draftId);
      if (data.reimbursement?.id) {
        toast({
          title: 'Fuel entry and reimbursement recorded',
          description: `N$${Number(formData.amount).toFixed(2)} claim is pending Transport Office review.`,
          variant: 'success',
        });
        router.push(`/dashboard/fuel/${data.data.id}`);
        return;
      }

      toast({ title: 'Fuel entry recorded', description: `${formData.litres}L of ${formData.fuelType} for ${formData.vehicleGrn}`, variant: 'success' });
      router.push(`/dashboard/fuel/${data.data.id}`);
    } catch (err) {
      console.error('Fuel entry failed:', err);
      toast({ title: 'Failed to record', description: err instanceof Error ? err.message : 'Transaction could not be saved', variant: 'error' });
      setIsSubmitting(false);
    }
  }, [router, formData, session, profile, draftId, isOnline, receiptFile, toast, selectedTripId, driverId, claimantId, canRecordOnBehalf, buildDraftFormData]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Fuel Records', href: '/dashboard/fuel' },
        { label: 'New Entry' },
      ]} />
      <PageHeader title="New Fuel Entry" description="Record a fuel transaction">
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/fuel"><ChevronLeft className="h-4 w-4" /> Back</Link>
        </Button>
      </PageHeader>

      {!isOnline && (
        <div className="flex items-center gap-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300">
          <WifiOff className="h-3.5 w-3.5" />
          You are offline. This entry will be saved as a local draft and synced when connected.
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader><CardTitle>Transaction Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {isDriverSelfEntry ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label required>Active Trip</Label>
                    <StyledSelect
                      value={selectedTripId}
                      onChange={(event) => {
                        const trip = activeTrips.find((item) => item.id === event.target.value);
                        if (trip) applyAssignedTrip(trip);
                      }}
                      required
                      disabled={tripLoading || activeTrips.length === 0}
                    >
                      <option value="">{tripLoading ? 'Loading assigned trip…' : activeTrips.length ? 'Select active trip' : 'No active assigned trip'}</option>
                      {activeTrips.map((trip) => (
                        <option key={trip.id} value={trip.id}>
                          {(trip.reference || trip.requestReference || 'Trip')} · {(trip.licenceNumber || trip.vehicleLicence || 'Vehicle')} {trip.purpose ? `· ${trip.purpose}` : ''}
                        </option>
                      ))}
                    </StyledSelect>
                    <p className="text-ink-500 text-xs">Drivers record fuel only for their own active assigned trip.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label required>Vehicle</Label>
                    <Input value={vehicleSearch} readOnly placeholder="Vehicle is linked from the selected trip" required />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Trip Reference</Label>
                  <Input value={formData.tripRef} readOnly placeholder="Linked from the selected trip" />
                </div>
                {activeTrips.length === 0 && !tripLoading && (
                  <div className="rounded-[8px] border border-status-pending-border bg-status-pending-bg/20 px-3 py-2 text-xs text-status-pending-text">
                    No active assigned trip is available for fuel recording. Open Assigned Trips and start the correct trip first.
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5 relative">
                    <Label required>Vehicle</Label>
                    <Input
                      placeholder="Search vehicle GRN, make or model..."
                      value={vehicleSearch}
                      onChange={(e) => {
                        setVehicleSearch(e.target.value);
                        updateForm({ vehicleGrn: e.target.value, vehicleId: '' });
                      }}
                      onFocus={() => vehicles.length > 0 && setVehicleDropdown(true)}
                      onBlur={() => setTimeout(() => setVehicleDropdown(false), 200)}
                      required
                    />
                    {vehicleLoading && <p className="text-xs text-ink-400 mt-1">Searching...</p>}
                    {vehicleDropdown && vehicles.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-[8px] border border-border bg-surface shadow-lg max-h-48 overflow-y-auto">
                        {vehicles.map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                            onMouseDown={() => {
                              updateForm({ vehicleGrn: v.licenceNumber, vehicleId: v.id });
                              setVehicleSearch(`${v.licenceNumber} — ${v.make} ${v.model}`);
                              setVehicleDropdown(false);
                            }}
                          >
                            <span className="font-medium">{v.licenceNumber}</span>
                            <span className="text-ink-500 ml-2">{v.make} {v.model}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5"><Label>Trip Reference</Label><Input placeholder="Optional trip ref" value={formData.tripRef} onChange={(e) => updateForm({ tripRef: e.target.value })} /></div>
                </div>

                {canRecordOnBehalf && (
                  <div className="space-y-1.5">
                    <Label>Record fuel for driver</Label>
                    <EmployeeCombobox
                      kind="driver"
                      value={driverId}
                      selectedOption={driverOption}
                      onSelect={(option) => {
                        setDriverId(option?.id || '');
                        setDriverOption(option);
                      }}
                      placeholder="Optional — select the driver this fuel belongs to"
                    />
                    <p className="text-ink-500 text-xs">Use this when Transport Office is capturing a receipt or fuel record for a driver. If a trip is linked, the server keeps attribution aligned to the trip&apos;s allocated driver.</p>
                  </div>
                )}
              </>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label required>Transaction Date</Label><StyledDateInput type="datetime-local" value={formData.transactionDate} onChange={(e) => updateForm({ transactionDate: e.target.value })} required /></div>
              <div className="space-y-1.5 relative">
                <Label>Station Name</Label>
                <Input
                  placeholder="Start typing a fuel station name…"
                  value={formData.stationName}
                  onChange={(e) => {
                    updateForm({ stationName: e.target.value });
                    setStationDropdown(true);
                  }}
                  onFocus={() => setStationDropdown(true)}
                  onBlur={() => window.setTimeout(() => setStationDropdown(false), 200)}
                  autoComplete="off"
                />
                {stationLoading && <p className="text-xs text-ink-400 mt-1">Finding recent stations…</p>}
                {stationDropdown && stationSuggestions.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto rounded-[8px] border border-border bg-surface shadow-lg">
                    {stationSuggestions.map((station) => (
                      <button
                        key={station.name}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                        onMouseDown={() => {
                          updateForm({ stationName: station.name });
                          setStationDropdown(false);
                        }}
                      >
                        <span className="font-medium text-ink-900">{station.name}</span>
                        <span className="ml-2 text-xs text-ink-500">Previously used</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-ink-500">
                  {stationRouteHints.length > 0 ? `Trip corridor: ${stationRouteHints.join(' → ')}. ` : ''}
                  Choose a previous station or keep typing a manual name.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5"><Label required>Fuel Type</Label><StyledSelect value={formData.fuelType} onChange={(e) => updateForm({ fuelType: e.target.value })}><option value="diesel">Diesel</option><option value="petrol">Petrol</option><option value="unleaded">Unleaded</option></StyledSelect></div>
              <div className="space-y-1.5"><Label required>Litres</Label><Input type="number" step="0.01" placeholder="e.g. 45.5" value={formData.litres} onChange={(e) => updateForm({ litres: e.target.value })} required /></div>
              <div className="space-y-1.5"><Label required>Amount (NAD)</Label><Input type="number" step="0.01" placeholder="e.g. 850.00" value={formData.amount} onChange={(e) => updateForm({ amount: e.target.value })} required /></div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5"><Label>Odometer Reading</Label><Input type="number" placeholder="km" value={formData.odometerReading} onChange={(e) => updateForm({ odometerReading: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Receipt Reference</Label><Input placeholder="Receipt #" value={formData.referenceNumber} onChange={(e) => updateForm({ referenceNumber: e.target.value })} /></div>
              <div className="space-y-1.5"><Label required>Payment Method</Label><StyledSelect value={formData.paymentMethod} onChange={(e) => {
                const paymentMethod = e.target.value;
                updateForm({ paymentMethod });
                if (paymentMethod !== 'personal_reimbursement') {
                  setClaimantId('');
                  setClaimantOption(null);
                }
              }}><option value="fuel_card">Fuel Card</option><option value="cash">Cash</option><option value="personal_reimbursement">Personal Reimbursement</option></StyledSelect></div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label required>Fill Type</Label><StyledSelect value={formData.fillType} onChange={(e) => updateForm({ fillType: e.target.value })}><option value="full">Full Tank</option><option value="partial">Partial Fill</option></StyledSelect></div>
              {formData.paymentMethod === 'personal_reimbursement' && canRecordOnBehalf && (
                <div className="space-y-1.5">
                  <Label>Employee who paid personally</Label>
                  <EmployeeCombobox
                    kind="employee"
                    value={claimantId}
                    selectedOption={claimantOption}
                    onSelect={(option) => {
                      setClaimantId(option?.id || '');
                      setClaimantOption(option);
                    }}
                    placeholder="Search employee by name or number…"
                  />
                  <p className="text-xs text-ink-500">Transport staff must select the employee who paid personally.</p>
                </div>
              )}
            </div>

            {formData.paymentMethod === 'personal_reimbursement' && (
              <div className="rounded-[8px] border border-status-pending-border bg-status-pending-bg/20 px-3 py-2 text-xs text-status-pending-text">
                Current step: record the personal fuel purchase. Next step: the reimbursement claim is created with this fuel entry and appears in Transport Office review as Pending.
              </div>
            )}

            <div className="space-y-1.5"><Label>Notes</Label><Textarea placeholder="Any additional notes..." value={formData.notes} onChange={(e) => updateForm({ notes: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Fuel receipt</Label>
              <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-canvas px-4 py-3 text-center hover:border-brand-400 dark:hover:border-brand-500">
                <Camera className="h-6 w-6 text-brand-700" />
                <span className="text-sm font-medium text-ink-800">{receiptFile ? receiptFile.name : 'Take photo or choose receipt image'}</span>
                <span className="text-xs text-ink-500">The original is preserved. OCR only fills blank values; review and edit the transaction fields before saving.</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    setReceiptFile(file);
                    setReceiptScan(null);
                    if (file && isOnline) void scanReceipt(file);
                  }}
                />
              </label>
              {receiptFile && isOnline && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => void scanReceipt(receiptFile)} loading={isScanningReceipt}>
                    <Camera className="h-4 w-4" /> Rescan receipt
                  </Button>
                  {receiptScan && (
                    <span className="text-xs text-ink-500">
                      {receiptScan.manualEntryRequired
                        ? 'OCR unavailable — manual values will be saved with the original image.'
                        : `${receiptScan.engine || 'OCR'} · ${Math.round((receiptScan.extractionConfidence || 0) * 100)}% confidence`}
                    </span>
                  )}
                </div>
              )}
              {receiptScan?.flags?.length ? (
                <div className="rounded-[8px] border border-status-pending-border bg-status-pending-bg/20 px-3 py-2 text-xs text-status-pending-text">
                  Review before saving: {receiptScan.flags.join(', ').replaceAll('_', ' ')}. These flags do not block manual correction.
                </div>
              ) : null}
              {receiptScan && !receiptScan.manualEntryRequired && (
                <div className="rounded-[8px] border border-border bg-muted/30 px-3 py-2 text-xs text-ink-600">
                  OCR is provisional. The editable transaction fields above are the values that will be treated as your confirmation; the stored receipt keeps the original extraction plus an audit trail of any corrections.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 flex items-center justify-end gap-3">
          <Button type="button" variant="secondary" size="sm" onClick={saveDraftLocally} loading={isDraftSaving} disabled={isDraftSaving}>
            <Save className="h-4 w-4" />
            {draftSaved ? 'Saved!' : 'Save Draft'}
          </Button>
          <Button variant="secondary" size="sm" asChild><Link href="/dashboard/fuel">Cancel</Link></Button>
          <Button variant="primary" size="sm" type="submit" loading={isSubmitting} disabled={isScanningReceipt || (isDriverSelfEntry && !selectedTripId)}>
            {isOnline ? <><CheckCircle2 className="h-4 w-4" /> Record Transaction</> : <><Save className="h-4 w-4" /> Queue Offline</>}
          </Button>
        </div>
      </form>
    </div>
  );
}
