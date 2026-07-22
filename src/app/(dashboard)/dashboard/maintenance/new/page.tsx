'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, CheckCircle2, Wrench, CalendarClock } from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import Link from 'next/link';

interface Vehicle {
  id: string;
  licenceNumber: string;
  make: string;
  model: string;
  currentOdometer: number;
  status: string;
}

export default function NewMaintenancePage() {
  const router = useRouter();
  const { toast } = useToast();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loadingVehicles, setLoadingVehicles] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    vehicleId: '',
    serviceDate: '',
    serviceOdometer: '',
    serviceType: 'scheduled',
    description: '',
    cost: '',
    vendorName: '',
    notes: '',
    nextServiceDate: '',
    nextServiceOdometer: '',
  });

  const updateForm = useCallback((patch: Partial<typeof formData>) => {
    setFormData((prev) => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    fetchVehicles();
  }, []);

  async function fetchVehicles() {
    try {
      const res = await fetch('/api/fleet');
      if (!res.ok) throw new Error('Failed to load vehicles');
      const json = await res.json();
      const list = Array.isArray(json) ? json : (json.rows ?? []);
      setVehicles(list);
    } catch {
      toast({ title: 'Failed to load vehicles', description: 'Could not fetch vehicle data', variant: 'error' });
    } finally {
      setLoadingVehicles(false);
    }
  }

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const selectedVehicle = vehicles.find((v) => v.id === formData.vehicleId);

      const res = await fetch('/api/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId: formData.vehicleId,
          serviceDate: formData.serviceDate,
          serviceOdometer: formData.serviceOdometer || undefined,
          serviceType: formData.serviceType,
          description: formData.description,
          cost: formData.cost || undefined,
          vendorName: formData.vendorName || undefined,
          notes: formData.notes || undefined,
          nextServiceDate: formData.nextServiceDate || undefined,
          nextServiceOdometer: formData.nextServiceOdometer || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create maintenance event');
      }

      toast({
        title: 'Maintenance Event Created',
        description: `${formData.serviceType} — ${formData.description} for ${selectedVehicle?.licenceNumber || formData.vehicleId}`,
        variant: 'success',
      });
      router.push('/dashboard/maintenance');
    } catch (err) {
      console.error('Maintenance creation failed:', err);
      toast({
        title: 'Failed to Create',
        description: err instanceof Error ? err.message : 'Maintenance event could not be saved',
        variant: 'error',
      });
      setIsSubmitting(false);
    }
  }, [router, formData, vehicles]);

  const selectedVehicle = vehicles.find((v) => v.id === formData.vehicleId);

  const SERVICE_TYPE_OPTIONS = [
    { value: 'scheduled', label: 'Scheduled Service' },
    { value: 'repair', label: 'Repair' },
    { value: 'inspection', label: 'Inspection' },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Maintenance', href: '/dashboard/maintenance' },
          { label: 'Schedule Maintenance' },
        ]}
      />
      <PageHeader title="Schedule Maintenance" description="Record a vehicle service or repair event">
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/maintenance">
            <ChevronLeft className="h-4 w-4" /> Back to Maintenance
          </Link>
        </Button>
      </PageHeader>

      <form onSubmit={handleSubmit}>
        {/* Vehicle Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-status-info-text" />
              Vehicle & Service Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label required>Vehicle</Label>
              <select
                value={formData.vehicleId}
                onChange={(e) => {
                  const v = vehicles.find((veh) => veh.id === e.target.value);
                  updateForm({
                    vehicleId: e.target.value,
                    serviceOdometer: v?.currentOdometer ? String(v.currentOdometer) : formData.serviceOdometer,
                  });
                }}
                required
                disabled={loadingVehicles}
                className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-50"
              >
                <option value="">
                  {loadingVehicles ? 'Loading vehicles...' : 'Select vehicle...'}
                </option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.licenceNumber} — {v.make} {v.model} ({v.currentOdometer?.toLocaleString() || 0} km)
                  </option>
                ))}
              </select>
              {selectedVehicle && (
                <div className="mt-1.5 flex items-center gap-2">
                  <Badge variant={selectedVehicle.status === 'available' ? 'success' : 'info'} size="sm">
                    {selectedVehicle.status.replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-xs text-ink-400">
                    Current odometer: {selectedVehicle.currentOdometer?.toLocaleString() || 0} km
                  </span>
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label required>Service Date</Label>
                <Input
                  type="date"
                  value={formData.serviceDate}
                  onChange={(e) => updateForm({ serviceDate: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label required>Service Type</Label>
                <select
                  value={formData.serviceType}
                  onChange={(e) => updateForm({ serviceType: e.target.value })}
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                >
                  {SERVICE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label required>Description</Label>
              <Input
                placeholder="e.g. Oil change, brake pad replacement"
                value={formData.description}
                onChange={(e) => updateForm({ description: e.target.value })}
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Service Odometer (km)</Label>
                <Input
                  type="number"
                  placeholder="e.g. 45000"
                  value={formData.serviceOdometer}
                  onChange={(e) => updateForm({ serviceOdometer: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Cost (NAD)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 2500.00"
                  value={formData.cost}
                  onChange={(e) => updateForm({ cost: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Vendor Name</Label>
                <Input
                  placeholder="e.g. Toyota Dealership, Rundu"
                  value={formData.vendorName}
                  onChange={(e) => updateForm({ vendorName: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <textarea
                value={formData.notes}
                onChange={(e) => updateForm({ notes: e.target.value })}
                placeholder="Any additional notes about the service..."
                rows={3}
                className="h-20 w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200 resize-none"
              />
            </div>
          </CardContent>
        </Card>

        {/* Next Service Details */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-status-pending-text" />
              Next Service Reminder
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-ink-500">
              Optionally set a reminder for the next scheduled service. The system will alert you when this date approaches.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Next Service Date</Label>
                <Input
                  type="date"
                  value={formData.nextServiceDate}
                  onChange={(e) => updateForm({ nextServiceDate: e.target.value })}
                  min={formData.serviceDate || undefined}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Next Service Odometer (km)</Label>
                <Input
                  type="number"
                  placeholder="e.g. 50000"
                  value={formData.nextServiceOdometer}
                  onChange={(e) => updateForm({ nextServiceOdometer: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="mt-6 flex items-center justify-end gap-3">
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/maintenance">Cancel</Link>
          </Button>
          <Button variant="primary" size="sm" type="submit" loading={isSubmitting}>
            <CheckCircle2 className="h-4 w-4" />
            {isSubmitting ? 'Saving...' : 'Record Maintenance'}
          </Button>
        </div>
      </form>
    </div>
  );
}
