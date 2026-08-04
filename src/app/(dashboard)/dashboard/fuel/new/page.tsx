'use client';

import { useState, useCallback, useEffect } from 'react';
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
    employeeNumber: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [vehicleSearch, setVehicleSearch] = useState(searchParams.get('vehicle') || '');
  const [vehicles, setVehicles] = useState<Array<{ id: string; licenceNumber: string; make: string; model: string }>>([]);
  const [vehicleLoading, setVehicleLoading] = useState(false);
  const [vehicleDropdown, setVehicleDropdown] = useState(false);
  const [driverId, setDriverId] = useState('');
  const [driverOption, setDriverOption] = useState<EmployeeSearchOption | null>(null);
  const tripId = searchParams.get('tripId') || '';

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

  // Search vehicles dynamically
  useEffect(() => {
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
      } catch { /* ignore */ } finally { setVehicleLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [vehicleSearch]);

  // Auto-save draft for offline recovery
  const saveDraftLocally = useCallback(async () => {
    try {
      const draft = await saveDraft({
        id: draftId || undefined,
        draftType: 'fuel',
        formData: { ...formData, tripId, receiptFile } as unknown as Record<string, unknown>,
        userId: session?.user?.id || null,
        tenantId: profile?.tenantId || null,
        syncStatus: 'pending',
      });
      setDraftId(draft.id);
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save draft:', err);
    }
  }, [formData, session, profile, draftId, receiptFile, tripId]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    if (!isOnline) {
      // Save as offline draft
      try {
        await saveDraft({
          id: draftId || undefined,
          draftType: 'fuel',
          formData: { ...formData, tripId, receiptFile, employeeNumber: formData.employeeNumber } as unknown as Record<string, unknown>,
          userId: session?.user?.id || null,
          tenantId: profile?.tenantId || null,
          syncStatus: 'pending',
        });
        router.push('/dashboard/fuel');
      } catch (err) {
        console.error('Draft save failed:', err);
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
          tripId: tripId || undefined,
          tripRef: formData.tripRef || null,
          driverEmployeeId: driverId || undefined,
          clientSyncId: crypto.randomUUID(),
          transactionAt: formData.transactionDate,
          stationName: formData.stationName,
          fuelType: formData.fuelType,
          litres: formData.litres,
          amount: formData.amount,
          odometerReading: formData.odometerReading,
          paymentMethod: formData.paymentMethod,
          fillType: formData.fillType,
          employeeNumber: formData.paymentMethod === 'personal_reimbursement' ? formData.employeeNumber || undefined : undefined,
          recordedByUserId: session?.user?.id || 'system',
          tenantId: profile?.tenantId,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        // Partial success — transaction was created but reimbursement setup failed
        if (data.transactionCreated) {
          // Transaction saved, redirect with warning about reimbursement
          if (draftId) await deleteDraft(draftId);
          router.push('/dashboard/fuel?warning=reimbursement_pending');
          return;
        }
        throw new Error(data.error || 'Failed to record transaction');
      }
      if (receiptFile && data.data?.id) {
        const receiptForm = new FormData();
        receiptForm.append('file', receiptFile);
        receiptForm.append('transactionId', data.data.id);
        const receiptResponse = await fetch('/api/fuel/receipts', { method: 'POST', body: receiptForm });
        const receiptData = await receiptResponse.json();
        if (!receiptResponse.ok) throw new Error(receiptData.error || 'Fuel entry saved, but receipt OCR failed');
        toast({
          title: receiptData.manualEntryRequired ? 'Receipt saved — enter details manually' : 'Receipt OCR completed',
          description: receiptData.flags?.length
            ? `Review required: ${receiptData.flags.join(', ').replaceAll('_', ' ')}`
            : 'Extracted receipt fields are ready for confirmation.',
          variant: receiptData.flags?.length ? 'pending' : 'success',
        });
      }
      // Clean up draft if it exists
      if (draftId) await deleteDraft(draftId);
      toast({ title: 'Fuel entry recorded', description: `${formData.litres}L of ${formData.fuelType} for ${formData.vehicleGrn}`, variant: 'success' });
      router.push('/dashboard/fuel');
    } catch (err) {
      console.error('Fuel entry failed:', err);
      toast({ title: 'Failed to record', description: err instanceof Error ? err.message : 'Transaction could not be saved', variant: 'error' });
      setIsSubmitting(false);
    }
  }, [router, formData, session, profile, draftId, isOnline, receiptFile, toast, tripId, driverId]);

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
            <div className="space-y-1.5">
              <Label>Driver (on behalf of)</Label>
              <EmployeeCombobox
                kind="driver"
                value={driverId}
                selectedOption={driverOption}
                onSelect={(option) => {
                  setDriverId(option?.id || '');
                  setDriverOption(option);
                }}
                placeholder="Optional — attribute this entry to a driver"
              />
              <p className="text-ink-500 text-xs">
                Leave blank to attribute the entry to the trip&apos;s allocated driver.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label required>Transaction Date</Label><StyledDateInput type="datetime-local" value={formData.transactionDate} onChange={(e) => updateForm({ transactionDate: e.target.value })} required /></div>
              <div className="space-y-1.5"><Label>Station Name</Label><Input placeholder="e.g. Total Energies, Rundu" value={formData.stationName} onChange={(e) => updateForm({ stationName: e.target.value })} /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5"><Label required>Fuel Type</Label><StyledSelect value={formData.fuelType} onChange={(e) => updateForm({ fuelType: e.target.value })}><option value="diesel">Diesel</option><option value="petrol">Petrol</option><option value="unleaded">Unleaded</option></StyledSelect></div>
              <div className="space-y-1.5"><Label required>Litres</Label><Input type="number" step="0.01" placeholder="e.g. 45.5" value={formData.litres} onChange={(e) => updateForm({ litres: e.target.value })} required /></div>
              <div className="space-y-1.5"><Label required>Amount (NAD)</Label><Input type="number" step="0.01" placeholder="e.g. 850.00" value={formData.amount} onChange={(e) => updateForm({ amount: e.target.value })} required /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5"><Label>Odometer Reading</Label><Input type="number" placeholder="km" value={formData.odometerReading} onChange={(e) => updateForm({ odometerReading: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Receipt Reference</Label><Input placeholder="Receipt #" value={formData.referenceNumber} onChange={(e) => updateForm({ referenceNumber: e.target.value })} /></div>
              <div className="space-y-1.5"><Label required>Payment Method</Label><StyledSelect value={formData.paymentMethod} onChange={(e) => updateForm({ paymentMethod: e.target.value })}><option value="fuel_card">Fuel Card</option><option value="cash">Cash</option><option value="personal_reimbursement">Personal Reimbursement</option></StyledSelect></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label required>Fill Type</Label><StyledSelect value={formData.fillType} onChange={(e) => updateForm({ fillType: e.target.value })}><option value="full">Full Tank</option><option value="partial">Partial Fill</option></StyledSelect></div>
              {formData.paymentMethod === 'personal_reimbursement' && (
                <div className="space-y-1.5"><Label required>Employee Number</Label><Input placeholder="Your employee number for reimbursement" value={formData.employeeNumber} onChange={(e) => updateForm({ employeeNumber: e.target.value })} required={formData.paymentMethod === 'personal_reimbursement'} /></div>
              )}
            </div>
            <div className="space-y-1.5"><Label>Notes</Label><Textarea placeholder="Any additional notes..." value={formData.notes} onChange={(e) => updateForm({ notes: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Fuel receipt</Label>
              <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-canvas px-4 py-3 text-center hover:border-brand-400 dark:hover:border-brand-500">
                <Camera className="h-6 w-6 text-brand-700" />
                <span className="text-sm font-medium text-ink-800">{receiptFile ? receiptFile.name : 'Take photo or choose receipt image'}</span>
                <span className="text-xs text-ink-500">The original is preserved and OCR fields remain editable.</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(event) => setReceiptFile(event.target.files?.[0] || null)}
                />
              </label>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 flex items-center justify-end gap-3">
          <Button type="button" variant="secondary" size="sm" onClick={saveDraftLocally}>
            <Save className="h-4 w-4" />
            {draftSaved ? 'Saved!' : 'Save Draft'}
          </Button>
          <Button variant="secondary" size="sm" asChild><Link href="/dashboard/fuel">Cancel</Link></Button>
          <Button variant="primary" size="sm" type="submit" loading={isSubmitting}>
            {isOnline ? <><CheckCircle2 className="h-4 w-4" /> Record Transaction</> : <><Save className="h-4 w-4" /> Queue Offline</>}
          </Button>
        </div>
      </form>
    </div>
  );
}
