'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth-client';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { ChevronLeft, CheckCircle2, Save, WifiOff, User } from 'lucide-react';
import Link from 'next/link';
import { saveDraft, deleteDraft } from '@/lib/offline-drafts';
import { DEFAULT_TENANT_ID } from '@/lib/constants';

export default function NewFuelEntryPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [formData, setFormData] = useState({
    vehicleGrn: '',
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

  // Auto-save draft for offline recovery
  const saveDraftLocally = useCallback(async () => {
    try {
      const draft = await saveDraft({
        id: draftId || undefined,
        draftType: 'fuel',
        formData: formData as unknown as Record<string, unknown>,
        userId: session?.user?.id || null,
        tenantId: DEFAULT_TENANT_ID,
        syncStatus: 'pending',
      });
      setDraftId(draft.id);
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save draft:', err);
    }
  }, [formData, session, draftId, isOnline]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    if (!isOnline) {
      // Save as offline draft
      try {
        await saveDraft({
          id: draftId || undefined,
          draftType: 'fuel',
          formData: { ...formData, employeeNumber: formData.employeeNumber } as unknown as Record<string, unknown>,
          userId: session?.user?.id || null,
          tenantId: DEFAULT_TENANT_ID,
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
          tripId: null,
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
          tenantId: DEFAULT_TENANT_ID,
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
      // Clean up draft if it exists
      if (draftId) await deleteDraft(draftId);
      router.push('/dashboard/fuel');
    } catch (err) {
      console.error('Fuel entry failed:', err);
      setIsSubmitting(false);
    }
  }, [router, formData, session, draftId, isOnline]);

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
        <div className="flex items-center gap-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          <WifiOff className="h-3.5 w-3.5" />
          You are offline. This entry will be saved as a local draft and synced when connected.
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader><CardTitle>Transaction Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label required>Vehicle GRN</Label><Input placeholder="e.g. GRN-001" value={formData.vehicleGrn} onChange={(e) => updateForm({ vehicleGrn: e.target.value })} required /></div>
              <div className="space-y-1.5"><Label>Trip Reference</Label><Input placeholder="Optional trip ref" value={formData.tripRef} onChange={(e) => updateForm({ tripRef: e.target.value })} /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label required>Transaction Date</Label><Input type="datetime-local" value={formData.transactionDate} onChange={(e) => updateForm({ transactionDate: e.target.value })} required /></div>
              <div className="space-y-1.5"><Label>Station Name</Label><Input placeholder="e.g. Total Energies, Rundu" value={formData.stationName} onChange={(e) => updateForm({ stationName: e.target.value })} /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5"><Label required>Fuel Type</Label><select value={formData.fuelType} onChange={(e) => updateForm({ fuelType: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"><option value="diesel">Diesel</option><option value="petrol">Petrol</option><option value="unleaded">Unleaded</option></select></div>
              <div className="space-y-1.5"><Label required>Litres</Label><Input type="number" step="0.01" placeholder="e.g. 45.5" value={formData.litres} onChange={(e) => updateForm({ litres: e.target.value })} required /></div>
              <div className="space-y-1.5"><Label required>Amount (NAD)</Label><Input type="number" step="0.01" placeholder="e.g. 850.00" value={formData.amount} onChange={(e) => updateForm({ amount: e.target.value })} required /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5"><Label>Odometer Reading</Label><Input type="number" placeholder="km" value={formData.odometerReading} onChange={(e) => updateForm({ odometerReading: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Receipt Reference</Label><Input placeholder="Receipt #" value={formData.referenceNumber} onChange={(e) => updateForm({ referenceNumber: e.target.value })} /></div>
              <div className="space-y-1.5"><Label required>Payment Method</Label><select value={formData.paymentMethod} onChange={(e) => updateForm({ paymentMethod: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"><option value="fuel_card">Fuel Card</option><option value="cash">Cash</option><option value="personal_reimbursement">Personal Reimbursement</option></select></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label required>Fill Type</Label><select value={formData.fillType} onChange={(e) => updateForm({ fillType: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"><option value="full">Full Tank</option><option value="partial">Partial Fill</option></select></div>
              {formData.paymentMethod === 'personal_reimbursement' && (
                <div className="space-y-1.5"><Label required>Employee Number</Label><Input placeholder="Your employee number for reimbursement" value={formData.employeeNumber} onChange={(e) => updateForm({ employeeNumber: e.target.value })} required={formData.paymentMethod === 'personal_reimbursement'} /></div>
              )}
            </div>
            <div className="space-y-1.5"><Label>Notes</Label><Textarea placeholder="Any additional notes..." value={formData.notes} onChange={(e) => updateForm({ notes: e.target.value })} /></div>
          </CardContent>
        </Card>

        <div className="mt-6 flex items-center justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={saveDraftLocally}>
            <Save className="h-4 w-4" />
            {draftSaved ? 'Saved!' : 'Save Draft'}
          </Button>
          <Button variant="secondary" size="sm" asChild><Link href="/dashboard/fuel">Cancel</Link></Button>
          <Button variant="primary" size="sm" type="submit" loading={isSubmitting}>
            {isOnline ? <><CheckCircle2 className="h-4 w-4" /> Record Transaction</> : <><Save className="h-4 w-4" /> Save Offline</>}
          </Button>
        </div>
      </form>
    </div>
  );
}
