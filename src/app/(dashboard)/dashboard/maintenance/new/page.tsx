'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, CheckCircle2, Wrench, CalendarClock } from 'lucide-react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StyledSelect } from '@/components/ui/styled-select';
import { DatePicker } from '@/components/ui/date-picker';
import { VehicleCombobox, type VehicleSearchOption } from '@/components/ui/vehicle-combobox';
import { useToast } from '@/lib/use-toast';
import { currentNamibiaDate, validateMaintenanceServiceDate } from '@/lib/maintenance-record-validation';

export default function NewMaintenancePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const today = currentNamibiaDate();
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleSearchOption | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    vehicleId: searchParams.get('vehicleId') || '',
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
    const vehicleId = searchParams.get('vehicleId');
    if (!vehicleId || selectedVehicle?.id === vehicleId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/fleet/${vehicleId}`, { cache: 'no-store' });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || 'Vehicle could not be loaded');
        if (cancelled) return;
        const vehicle = json.vehicle as VehicleSearchOption;
        setSelectedVehicle(vehicle);
        setFormData((prev) => ({
          ...prev,
          vehicleId: vehicle.id,
          serviceOdometer: prev.serviceOdometer || String(vehicle.currentOdometer ?? ''),
        }));
      } catch (error) {
        if (!cancelled) {
          toast({
            title: 'Vehicle could not be preselected',
            description: error instanceof Error ? error.message : 'Search for the vehicle manually.',
            variant: 'error',
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [searchParams, selectedVehicle?.id, toast]);

  const handleSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!formData.vehicleId) {
      toast({ title: 'Vehicle required', description: 'Search for and select a vehicle before saving.', variant: 'error' });
      return;
    }
    const serviceDateError = validateMaintenanceServiceDate(formData.serviceDate);
    if (serviceDateError) {
      toast({ title: 'Invalid service date', description: serviceDateError, variant: 'error' });
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/maintenance', {
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
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create maintenance event');
      toast({
        title: 'Maintenance record created',
        description: `${formData.serviceType} — ${formData.description} for ${selectedVehicle?.licenceNumber || formData.vehicleId}`,
        variant: 'success',
      });
      router.push('/dashboard/maintenance');
    } catch (error) {
      toast({
        title: 'Failed to create maintenance record',
        description: error instanceof Error ? error.message : 'Maintenance event could not be saved',
        variant: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, router, selectedVehicle?.licenceNumber, toast]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Maintenance', href: '/dashboard/maintenance' },
        { label: 'Record Maintenance' },
      ]} />
      <PageHeader title="Record Maintenance" description="Record a completed or current vehicle service or repair event">
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/maintenance"><ChevronLeft className="h-4 w-4" /> Back to Maintenance</Link>
        </Button>
      </PageHeader>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-status-info-text" /> Vehicle &amp; Service Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label required>Vehicle</Label>
              <VehicleCombobox
                value={formData.vehicleId}
                selectedOption={selectedVehicle}
                onSelect={(vehicle) => {
                  setSelectedVehicle(vehicle);
                  updateForm({
                    vehicleId: vehicle?.id || '',
                    serviceOdometer: vehicle ? String(vehicle.currentOdometer ?? '') : '',
                  });
                }}
                placeholder="Search plate, register number, make or model…"
              />
              {selectedVehicle && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <Badge variant={selectedVehicle.status === 'available' ? 'success' : selectedVehicle.status === 'maintenance' ? 'pending' : 'info'} size="sm">
                    {selectedVehicle.status.replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-xs text-ink-400">Current odometer: {selectedVehicle.currentOdometer.toLocaleString()} km</span>
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <DatePicker
                label="Service Date"
                value={formData.serviceDate}
                onChange={(value) => updateForm({ serviceDate: value })}
                max={today}
                required
              />
              <div className="space-y-1.5">
                <Label required>Service Type</Label>
                <StyledSelect value={formData.serviceType} onChange={(event) => updateForm({ serviceType: event.target.value })}>
                  <option value="scheduled">Scheduled Service</option>
                  <option value="repair">Repair</option>
                  <option value="inspection">Inspection</option>
                </StyledSelect>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label required>Description</Label>
              <Input placeholder="e.g. Oil change, brake pad replacement" value={formData.description} onChange={(event) => updateForm({ description: event.target.value })} required />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Service Odometer (km)</Label>
                <Input type="number" min={0} placeholder="e.g. 45000" value={formData.serviceOdometer} onChange={(event) => updateForm({ serviceOdometer: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Cost (N$)</Label>
                <Input type="number" min={0} step="0.01" placeholder="e.g. 2500.00" value={formData.cost} onChange={(event) => updateForm({ cost: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Vendor Name</Label>
                <Input placeholder="e.g. Toyota Dealership, Rundu" value={formData.vendorName} onChange={(event) => updateForm({ vendorName: event.target.value })} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={3} value={formData.notes} onChange={(event) => updateForm({ notes: event.target.value })} placeholder="Any additional notes about the service…" />
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-status-pending-text" /> Next Service Reminder
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-ink-500">Optionally set the next service date or odometer. These are maintenance reminders, not a vehicle availability state.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <DatePicker
                label="Next Service Date"
                value={formData.nextServiceDate}
                onChange={(value) => updateForm({ nextServiceDate: value })}
                min={formData.serviceDate || undefined}
              />
              <div className="space-y-1.5">
                <Label>Next Service Odometer (km)</Label>
                <Input type="number" min={0} placeholder="e.g. 50000" value={formData.nextServiceOdometer} onChange={(event) => updateForm({ nextServiceOdometer: event.target.value })} />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 flex flex-wrap items-center justify-start gap-3 sm:justify-end">
          <Button variant="secondary" size="sm" asChild><Link href="/dashboard/maintenance">Cancel</Link></Button>
          <Button variant="primary" size="sm" type="submit" loading={isSubmitting}>
            <CheckCircle2 className="h-4 w-4" /> {isSubmitting ? 'Saving…' : 'Record Maintenance'}
          </Button>
        </div>
      </form>
    </div>
  );
}
