'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { ChevronLeft, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

interface AllocationFormData {
  requestReference: string;
  vehicleGrn: string;
  driverName: string;
  startDate: string;
  endDate: string;
  notes: string;
}

export default function NewAllocationPage() {
  const router = useRouter();
  const [formData, setFormData] = useState<AllocationFormData>({
    requestReference: '',
    vehicleGrn: '',
    driverName: '',
    startDate: '',
    endDate: '',
    notes: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateForm = useCallback((patch: Partial<AllocationFormData>) => {
    setFormData((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestReference: formData.requestReference,
          vehicleGrn: formData.vehicleGrn,
          startDate: formData.startDate,
          endDate: formData.endDate,
          notes: formData.notes,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create allocation');
      }
      const data = await res.json();
      router.push(`/dashboard/allocations/${data.allocation.id}`);
    } catch (err) {
      console.error('Allocation failed:', err);
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, router]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Allocations', href: '/dashboard/allocations' },
        { label: 'New Allocation' },
      ]} />
      <PageHeader title="New Vehicle Allocation" description="Assign a vehicle to a transport request">
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/allocations"><ChevronLeft className="h-4 w-4" /> Back to Allocations</Link>
        </Button>
      </PageHeader>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader><CardTitle>Allocation Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label required>Request Reference</Label>
                <Input placeholder="e.g. REQ-001" value={formData.requestReference} onChange={(e) => updateForm({ requestReference: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label required>Vehicle GRN</Label>
                <Input placeholder="e.g. GRN-001" value={formData.vehicleGrn} onChange={(e) => updateForm({ vehicleGrn: e.target.value })} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Driver Name</Label>
              <Input placeholder="e.g. John Doe" value={formData.driverName} onChange={(e) => updateForm({ driverName: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label required>Start Date</Label>
                <Input type="date" value={formData.startDate} onChange={(e) => updateForm({ startDate: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label required>End Date</Label>
                <Input type="date" value={formData.endDate} onChange={(e) => updateForm({ endDate: e.target.value })} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea placeholder="Any additional notes..." value={formData.notes} onChange={(e) => updateForm({ notes: e.target.value })} />
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 flex items-center justify-end gap-3">
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/allocations">Cancel</Link>
          </Button>
          <Button variant="primary" size="sm" type="submit" loading={isSubmitting}>
            <CheckCircle2 className="h-4 w-4" /> Create Allocation
          </Button>
        </div>
      </form>
    </div>
  );
}
