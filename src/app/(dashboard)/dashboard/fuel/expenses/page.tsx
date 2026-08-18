'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/lib/use-toast';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { Camera, CreditCard, Loader2, Plus, Receipt, RefreshCw, Search, X } from 'lucide-react';

const CATEGORY_LABELS: Record<string, string> = {
  fuel: 'Fuel',
  oil: 'Oil / lubricants',
  parking: 'Parking',
  toll: 'Toll / road fee',
  car_wash: 'Car wash',
  minor_consumables: 'Minor consumables',
  emergency_repair: 'Emergency repair',
  tyre_service: 'Tyre service',
  accommodation: 'Accommodation',
  driver_subsistence: 'Driver subsistence',
  other: 'Other',
};

const PAYMENT_LABELS: Record<string, string> = {
  fleet_payment: 'Fleet payment',
  cash: 'Cash',
  eft: 'EFT / bank transfer',
  personal_reimbursement: 'Personal reimbursement',
  other: 'Other',
  unspecified: 'Not specified',
};

type ExpenseRow = {
  id: string;
  tripId: string | null;
  vehicleId: string;
  category: string;
  supplier: string | null;
  transactionAt: string;
  referenceNumber: string | null;
  amount: string;
  currency: string;
  odometerReading: number | null;
  receiptKey: string | null;
  paymentMethod: string;
  paymentInstrumentId: string | null;
  paymentProviderName: string | null;
  paymentInstrumentMasked: string | null;
  verificationStatus: string;
  notes: string | null;
  vehicleLicence: string;
  vehicleRegisterNumber: string | null;
  vehicleMake: string;
  vehicleModel: string;
  tripReference: string | null;
};

type FleetPayment = {
  providerId: string;
  providerName: string;
  providerType: string;
  instrumentId: string;
  instrumentType: string;
  maskedIdentifier: string;
  displayName: string | null;
};

type VehicleOption = { id: string; licenceNumber: string; make: string; model: string };
type TripOption = {
  id: string;
  vehicleId?: string | null;
  licenceNumber?: string | null;
  vehicleLicence?: string | null;
  reference?: string | null;
  requestReference?: string | null;
  status: string;
};

const EMPTY_FORM = {
  vehicleId: '',
  tripId: '',
  category: 'car_wash',
  supplier: '',
  transactionAt: '',
  referenceNumber: '',
  amount: '',
  currency: 'NAD',
  odometerReading: '',
  paymentMethod: 'fleet_payment',
  notes: '',
};

export default function OperationalExpensesPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ search: '', category: '', from: '', to: '', verificationStatus: '' });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [vehicleOptions, setVehicleOptions] = useState<VehicleOption[]>([]);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleOption | null>(null);
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [fleetPayment, setFleetPayment] = useState<FleetPayment | null>(null);
  const [fleetPaymentLoading, setFleetPaymentLoading] = useState(false);

  const availableTrips = useMemo(
    () => trips.filter((trip) => !form.vehicleId || trip.vehicleId === form.vehicleId),
    [trips, form.vehicleId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => value && params.set(key, value));
      const response = await fetch(`/api/expenses?${params.toString()}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not load operational expenses');
      setRows(Array.isArray(json.data) ? json.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load operational expenses');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!showForm) return;
    void (async () => {
      try {
        const response = await fetch('/api/trips?limit=100', { cache: 'no-store' });
        const json = await response.json();
        if (!response.ok) return;
        const list = json.data || json.rows || [];
        setTrips(Array.isArray(list) ? list : []);
      } catch {
        setTrips([]);
      }
    })();
  }, [showForm]);

  useEffect(() => {
    if (!showForm || vehicleSearch.trim().length < 2) {
      setVehicleOptions([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/fleet?search=${encodeURIComponent(vehicleSearch.trim())}&limit=10`);
        const json = await response.json();
        const list = json.vehicles || json.data?.vehicles || json.rows || json.data || [];
        setVehicleOptions(Array.isArray(list) ? list : []);
        setVehicleOpen(true);
      } catch {
        setVehicleOptions([]);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [showForm, vehicleSearch]);

  useEffect(() => {
    if (!showForm || !form.vehicleId) {
      setFleetPayment(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setFleetPaymentLoading(true);
        try {
          const params = form.tripId
            ? new URLSearchParams({ tripId: form.tripId })
            : new URLSearchParams({ vehicleId: form.vehicleId });
          const response = await fetch(`/api/fleet-payments/resolve?${params}`, { cache: 'no-store' });
          const json = await response.json();
          if (!cancelled) setFleetPayment(response.ok ? json.data || null : null);
        } catch {
          if (!cancelled) setFleetPayment(null);
        } finally {
          if (!cancelled) setFleetPaymentLoading(false);
        }
      })();
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [showForm, form.vehicleId, form.tripId]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setVehicleSearch('');
    setSelectedVehicle(null);
    setReceiptFile(null);
    setFleetPayment(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.vehicleId) {
      toast({ title: 'Vehicle required', description: 'Select the vehicle this expense belongs to.', variant: 'error' });
      return;
    }
    if (form.paymentMethod === 'fleet_payment' && !fleetPayment) {
      toast({
        title: 'Fleet payment not available',
        description: 'This vehicle has no active fleet card/tag. Choose Cash, EFT, reimbursement or Other, or register the instrument first.',
        variant: 'error',
      });
      return;
    }
    setSaving(true);
    try {
      let receiptKey: string | undefined;
      if (receiptFile) {
        const upload = new FormData();
        upload.append('file', receiptFile);
        upload.append('vehicleId', form.vehicleId);
        if (form.tripId) upload.append('tripId', form.tripId);
        const receiptResponse = await fetch('/api/expenses/receipts', { method: 'POST', body: upload });
        const receiptJson = await receiptResponse.json();
        if (!receiptResponse.ok) throw new Error(receiptJson.error || 'Could not upload expense receipt');
        receiptKey = receiptJson.data?.key;
      }

      const response = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          paymentInstrumentId: form.paymentMethod === 'fleet_payment' ? fleetPayment?.instrumentId : undefined,
          tripId: form.tripId || undefined,
          receiptKey,
          clientSyncId: crypto.randomUUID(),
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not record expense');

      toast({
        title: 'Operational expense recorded',
        description:
          form.paymentMethod === 'fleet_payment' && fleetPayment
            ? `Recorded against ${fleetPayment.providerName} ${fleetPayment.maskedIdentifier}.`
            : form.tripId
              ? 'The cost is linked to the selected trip and vehicle.'
              : 'The cost is linked to the vehicle without creating a fake trip.',
        variant: 'success',
      });
      resetForm();
      setShowForm(false);
      await load();
    } catch (err) {
      toast({
        title: 'Unable to record expense',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  function openReceipt(key: string) {
    window.open(`/api/files?key=${encodeURIComponent(key)}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Fuel Records', href: '/dashboard/fuel' },
        { label: 'Operational Expenses' },
      ]} />
      <PageHeader
        title="Operational Expenses"
        description="One ledger for trip-linked and legitimate vehicle-only operating costs."
      >
        <Button size="sm" onClick={() => setShowForm((value) => !value)}>
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? 'Close' : 'Record expense'}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </PageHeader>

      {showForm && (
        <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-border bg-surface p-4">
          <div>
            <h2 className="text-sm font-semibold text-ink-950">New operational expense</h2>
            <p className="mt-1 text-xs text-ink-500">Link a trip when relevant. Leave Trip blank for costs such as a vehicle wash outside a scheduled journey.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="relative space-y-1.5">
              <Label required>Vehicle</Label>
              <Input
                value={vehicleSearch}
                placeholder="Search GRN, registration, make or model…"
                onChange={(event) => {
                  setVehicleSearch(event.target.value);
                  setSelectedVehicle(null);
                  setFleetPayment(null);
                  setForm((value) => ({ ...value, vehicleId: '', tripId: '' }));
                }}
                onFocus={() => vehicleOptions.length && setVehicleOpen(true)}
                onBlur={() => window.setTimeout(() => setVehicleOpen(false), 200)}
                required
              />
              {vehicleOpen && vehicleOptions.length > 0 && (
                <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-[8px] border border-border bg-surface shadow-lg">
                  {vehicleOptions.map((vehicle) => (
                    <button
                      type="button"
                      key={vehicle.id}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      onMouseDown={() => {
                        setSelectedVehicle(vehicle);
                        setVehicleSearch(`${vehicle.licenceNumber} — ${vehicle.make} ${vehicle.model}`);
                        setForm((value) => ({ ...value, vehicleId: vehicle.id, tripId: '' }));
                        setVehicleOpen(false);
                      }}
                    >
                      <span className="font-medium text-ink-900">{vehicle.licenceNumber}</span>
                      <span className="ml-2 text-ink-500">{vehicle.make} {vehicle.model}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedVehicle && <p className="text-xs text-ink-500">Selected: {selectedVehicle.make} {selectedVehicle.model}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Trip (optional)</Label>
              <StyledSelect
                value={form.tripId}
                onChange={(event) => setForm((value) => ({ ...value, tripId: event.target.value }))}
                disabled={!form.vehicleId}
              >
                <option value="">No trip — vehicle operating cost</option>
                {availableTrips.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {(trip.reference || trip.requestReference || trip.id.slice(0, 8))} · {trip.status.replaceAll('_', ' ')}
                  </option>
                ))}
              </StyledSelect>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label required>Category</Label>
              <StyledSelect value={form.category} onChange={(event) => setForm((value) => ({ ...value, category: event.target.value }))}>
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </StyledSelect>
            </div>
            <div className="space-y-1.5"><Label required>Date & time</Label><Input type="datetime-local" value={form.transactionAt} onChange={(event) => setForm((value) => ({ ...value, transactionAt: event.target.value }))} required /></div>
            <div className="space-y-1.5"><Label required>Amount</Label><Input type="number" step="0.01" min="0.01" value={form.amount} onChange={(event) => setForm((value) => ({ ...value, amount: event.target.value }))} required /></div>
            <div className="space-y-1.5"><Label>Currency</Label><Input value={form.currency} maxLength={3} onChange={(event) => setForm((value) => ({ ...value, currency: event.target.value.toUpperCase() }))} /></div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label required>Payment method</Label>
              <StyledSelect
                value={form.paymentMethod}
                onChange={(event) => setForm((value) => ({ ...value, paymentMethod: event.target.value }))}
              >
                <option value="fleet_payment">Fleet payment card / tag</option>
                <option value="cash">Cash</option>
                <option value="eft">EFT / bank transfer</option>
                <option value="personal_reimbursement">Personal reimbursement</option>
                <option value="other">Other</option>
              </StyledSelect>
            </div>
            <div className="space-y-1.5">
              <Label>Assigned fleet payment</Label>
              <div className="flex min-h-10 items-center gap-2 rounded-[8px] border border-border bg-canvas px-3 py-2 text-sm">
                <CreditCard className="h-4 w-4 shrink-0 text-brand-700" />
                {!form.vehicleId ? (
                  <span className="text-ink-500">Select a vehicle first</span>
                ) : fleetPaymentLoading ? (
                  <span className="flex items-center gap-2 text-ink-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…</span>
                ) : fleetPayment ? (
                  <span className="text-ink-900">{fleetPayment.providerName} · {fleetPayment.maskedIdentifier}</span>
                ) : (
                  <span className="text-ink-500">No active vehicle card/tag registered</span>
                )}
              </div>
              <p className="text-xs text-ink-500">Auto-selected from the vehicle/trip. No PIN or full card number is stored.</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5"><Label>Supplier</Label><Input value={form.supplier} onChange={(event) => setForm((value) => ({ ...value, supplier: event.target.value }))} placeholder="Supplier / service provider" /></div>
            <div className="space-y-1.5"><Label>Reference</Label><Input value={form.referenceNumber} onChange={(event) => setForm((value) => ({ ...value, referenceNumber: event.target.value }))} placeholder="Receipt / invoice no." /></div>
            <div className="space-y-1.5"><Label>Odometer</Label><Input type="number" min="0" step="1" value={form.odometerReading} onChange={(event) => setForm((value) => ({ ...value, odometerReading: event.target.value }))} placeholder="km" /></div>
          </div>

          <div className="space-y-1.5"><Label>Notes</Label><Textarea value={form.notes} onChange={(event) => setForm((value) => ({ ...value, notes: event.target.value }))} placeholder="Why this cost was necessary…" /></div>

          <div className="space-y-1.5">
            <Label>Receipt / proof</Label>
            <label className="flex min-h-20 cursor-pointer items-center justify-center gap-2 rounded-[8px] border border-dashed border-border bg-canvas px-4 py-3 text-sm text-ink-700 hover:border-brand-400">
              <Camera className="h-5 w-5 text-brand-700" />
              {receiptFile ? receiptFile.name : 'Take photo or choose receipt / PDF'}
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" className="sr-only" onChange={(event) => setReceiptFile(event.target.files?.[0] || null)} />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={saving} disabled={saving}>Save expense</Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => { resetForm(); setShowForm(false); }} disabled={saving}>Cancel</Button>
          </div>
        </form>
      )}

      <div className="rounded-[10px] border border-border bg-surface p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="space-y-1.5 xl:col-span-2">
            <Label>Search</Label>
            <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" /><Input className="pl-9" value={filters.search} onChange={(event) => setFilters((value) => ({ ...value, search: event.target.value }))} placeholder="Vehicle, supplier, payment, reference or trip…" /></div>
          </div>
          <div className="space-y-1.5"><Label>From</Label><Input type="date" value={filters.from} onChange={(event) => setFilters((value) => ({ ...value, from: event.target.value }))} /></div>
          <div className="space-y-1.5"><Label>To</Label><Input type="date" value={filters.to} onChange={(event) => setFilters((value) => ({ ...value, to: event.target.value }))} /></div>
          <div className="space-y-1.5"><Label>Category</Label><StyledSelect value={filters.category} onChange={(event) => setFilters((value) => ({ ...value, category: event.target.value }))}><option value="">All categories</option>{Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</StyledSelect></div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StyledSelect className="max-w-xs" value={filters.verificationStatus} onChange={(event) => setFilters((value) => ({ ...value, verificationStatus: event.target.value }))}>
            <option value="">All verification states</option>
            <option value="awaiting_verification">Awaiting verification</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
          </StyledSelect>
          <Button variant="ghost" size="sm" onClick={() => setFilters({ search: '', category: '', from: '', to: '', verificationStatus: '' })}><X className="h-4 w-4" /> Clear filters</Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-500"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" /> Loading expenses…</div>
      ) : error ? (
        <EmptyState icon={<Receipt className="h-6 w-6" />} title="Unable to load expenses" description={error} action={{ label: 'Retry', onClick: load }} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Receipt className="h-6 w-6" />} title="No matching expenses" description="Record a legitimate operating cost or adjust the filters." />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-ink-500">{rows.length} expense{rows.length === 1 ? '' : 's'} found</p>
          {rows.map((row) => (
            <article key={row.id} className="rounded-[10px] border border-border bg-surface p-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink-950">{CATEGORY_LABELS[row.category] || row.category.replaceAll('_', ' ')}</p>
                    <Badge variant={row.verificationStatus === 'verified' ? 'success' : row.verificationStatus === 'rejected' ? 'error' : 'pending'} size="sm">{row.verificationStatus.replaceAll('_', ' ')}</Badge>
                    <Badge variant={row.tripId ? 'info' : 'default'} size="sm">{row.tripId ? 'Trip expense' : 'Vehicle expense'}</Badge>
                    {row.paymentProviderName && <Badge variant="info" size="sm">{row.paymentProviderName} {row.paymentInstrumentMasked || ''}</Badge>}
                  </div>
                  <div className="mt-2 grid gap-x-6 gap-y-1 text-xs text-ink-500 sm:grid-cols-2 xl:grid-cols-4">
                    <span>{row.vehicleLicence} · {row.vehicleMake} {row.vehicleModel}</span>
                    <span>{formatDateTime(row.transactionAt)}</span>
                    <span>{row.supplier || 'Supplier not recorded'}</span>
                    <span className="font-medium text-ink-800">{formatCurrency(Number(row.amount), row.currency)}</span>
                    <span>Trip: {row.tripReference || 'Not linked'}</span>
                    <span>Reference: {row.referenceNumber || '—'}</span>
                    <span>Payment: {row.paymentProviderName ? `${row.paymentProviderName} ${row.paymentInstrumentMasked || ''}` : PAYMENT_LABELS[row.paymentMethod] || row.paymentMethod}</span>
                    <span>Odometer: {row.odometerReading ? `${row.odometerReading.toLocaleString()} km` : '—'}</span>
                    <span>{row.receiptKey ? 'Receipt attached' : 'No receipt attached'}</span>
                  </div>
                  {row.notes && <p className="mt-2 text-xs text-ink-700">{row.notes}</p>}
                </div>
                {row.receiptKey && (
                  <Button variant="secondary" size="sm" onClick={() => openReceipt(row.receiptKey!)}>
                    <Receipt className="h-4 w-4" /> Open receipt
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
