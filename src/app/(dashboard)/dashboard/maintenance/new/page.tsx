'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Wrench, ChevronLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';

interface Vehicle {
  id: string;
  licenceNumber: string;
  make: string;
  model: string;
}

export default function NewMaintenancePage() {
  const router = useRouter();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [vehicleId, setVehicleId] = useState('');

  // Pre-select vehicle from query param (e.g. ?vehicleId=xxx from vehicle detail page)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const vid = params.get('vehicleId');
      if (vid) setVehicleId(vid);
    }
  }, []);
  const [serviceDate, setServiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [serviceOdometer, setServiceOdometer] = useState('');
  const [serviceType, setServiceType] = useState('scheduled');
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [notes, setNotes] = useState('');
  const [nextServiceDate, setNextServiceDate] = useState('');
  const [nextServiceOdometer, setNextServiceOdometer] = useState('');

  useEffect(() => {
    fetchVehicles();
  }, []);

  async function fetchVehicles() {
    try {
      const res = await fetch('/api/fleet?limit=500');
      if (!res.ok) throw new Error('Failed to load vehicles');
      const json = await res.json();
      // Handle both array and { rows: [] } response formats
      const list = Array.isArray(json) ? json : (json.rows ?? []);
      setVehicles(list);
    } catch (err) {
      setError('Could not load vehicle list. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        vehicleId,
        serviceDate,
        serviceType,
        description,
      };

      if (serviceOdometer) body.serviceOdometer = Number(serviceOdometer);
      if (cost) body.cost = cost;
      if (vendorName) body.vendorName = vendorName;
      if (notes) body.notes = notes;
      if (nextServiceDate) body.nextServiceDate = nextServiceDate;
      if (nextServiceOdometer) body.nextServiceOdometer = Number(nextServiceOdometer);

      const res = await fetch('/api/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create maintenance event');
      }

      router.push('/dashboard/maintenance');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Maintenance', href: '/dashboard/maintenance' },
          { label: 'New Event' },
        ]} />
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-ink-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Maintenance', href: '/dashboard/maintenance' },
          { label: 'New Event' },
        ]}
      />
      <PageHeader
        title="Schedule Maintenance"
        description="Record a new service, repair, or inspection event"
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/maintenance">
            <ChevronLeft className="h-4 w-4" />
            Back to Maintenance
          </Link>
        </Button>
      </PageHeader>

      {error && (
        <div className="rounded-[10px] border border-status-error-bg bg-status-error-bg/20 px-4 py-3 text-sm text-status-error-text">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Vehicle Selection */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Vehicle</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="w-full max-w-md">
                <label className="block text-xs font-medium text-ink-500 mb-1.5">
                  Select Vehicle <span className="text-status-error-text">*</span>
                </label>
                <select
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  required
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                >
                  <option value="">Choose a vehicle...</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.licenceNumber} — {v.make} {v.model}
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>

          {/* Service Details */}
          <Card>
            <CardHeader>
              <CardTitle>Service Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1.5">
                  Service Date <span className="text-status-error-text">*</span>
                </label>
                <input
                  type="date"
                  value={serviceDate}
                  onChange={(e) => setServiceDate(e.target.value)}
                  required
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1.5">
                  Service Type <span className="text-status-error-text">*</span>
                </label>
                <select
                  value={serviceType}
                  onChange={(e) => setServiceType(e.target.value)}
                  required
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                >
                  <option value="scheduled">Scheduled Service</option>
                  <option value="repair">Repair</option>
                  <option value="inspection">Inspection</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1.5">
                  Description <span className="text-status-error-text">*</span>
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Oil change, brake pads replacement"
                  required
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1.5">
                  Odometer Reading (km)
                </label>
                <input
                  type="number"
                  value={serviceOdometer}
                  onChange={(e) => setServiceOdometer(e.target.value)}
                  placeholder="e.g. 45000"
                  min="0"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
            </CardContent>
          </Card>

          {/* Cost & Vendor */}
          <Card>
            <CardHeader>
              <CardTitle>Cost & Vendor</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1.5">
                  Cost (N$)
                </label>
                <input
                  type="number"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="e.g. 1250.00"
                  min="0"
                  step="0.01"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1.5">
                  Vendor / Service Centre
                </label>
                <input
                  type="text"
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  placeholder="e.g. Toyota Namibia, AutoWorld"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1.5">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional notes about the service..."
                  rows={3}
                  className="h-20 w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200 resize-none"
                />
              </div>
            </CardContent>
          </Card>

          {/* Next Service */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Next Service (Optional)</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1.5">
                  Next Service Date
                </label>
                <input
                  type="date"
                  value={nextServiceDate}
                  onChange={(e) => setNextServiceDate(e.target.value)}
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1.5">
                  Next Service Odometer (km)
                </label>
                <input
                  type="number"
                  value={nextServiceOdometer}
                  onChange={(e) => setNextServiceOdometer(e.target.value)}
                  placeholder="e.g. 50000"
                  min="0"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Submit */}
        <div className="mt-6 flex items-center justify-end gap-3">
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/maintenance">Cancel</Link>
          </Button>
          <Button variant="primary" size="sm" type="submit" loading={submitting}>
            <Wrench className="h-4 w-4" />
            {submitting ? 'Creating...' : 'Create Maintenance Event'}
          </Button>
        </div>
      </form>
    </div>
  );
}
