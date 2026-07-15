'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { ChevronLeft, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

export default function NewFuelEntryPage() {
  const router = useRouter();
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
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateForm = useCallback((patch: Partial<typeof formData>) => {
    setFormData((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsSubmitting(false);
    router.push('/dashboard/fuel');
  }, [router]);

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
            </div>
            <div className="space-y-1.5"><Label>Notes</Label><Textarea placeholder="Any additional notes..." value={formData.notes} onChange={(e) => updateForm({ notes: e.target.value })} /></div>
          </CardContent>
        </Card>

        <div className="mt-6 flex items-center justify-end gap-3">
          <Button variant="secondary" size="sm" asChild><Link href="/dashboard/fuel">Cancel</Link></Button>
          <Button variant="primary" size="sm" type="submit" loading={isSubmitting}><CheckCircle2 className="h-4 w-4" /> Record Transaction</Button>
        </div>
      </form>
    </div>
  );
}
