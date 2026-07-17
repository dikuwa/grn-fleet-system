'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VehicleFormData {
  licenceNumber: string;
  vehicleRegisterNumber: string;
  vin: string;
  engineNumber: string;
  make: string;
  model: string;
  seriesName: string;
  manufactureYear: number | '';
  vehicleCategory: string;
  vehicleDescription: string;
  driveType: string;
  colour: string;
  fuelType: string;
  transmission: string;
  tareKg: number | '';
  grossVehicleMassKg: number | '';
  seatedCapacity: number | '';
  standingCapacity: number | '';
  registeringAuthority: string;
  nationalVehicleClassification: string;
  roadworthyTestDate: string;
  licenceExpiryDate: string;
  status: string;
  currentOdometer: number | '';
  fuelCardNumber: string;
  notes: string;
}

// ---------------------------------------------------------------------------
// Field helper
// ---------------------------------------------------------------------------

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-ink-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [form, setForm] = useState<VehicleFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vehicleId = React.use(params).id;

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/fleet/${vehicleId}`);
        if (!res.ok) throw new Error('Vehicle not found');
        const data = await res.json();
        const v = data.vehicle;
        setForm({
          licenceNumber: v.licenceNumber || '',
          vehicleRegisterNumber: v.vehicleRegisterNumber || '',
          vin: v.vin || '',
          engineNumber: v.engineNumber || '',
          make: v.make || '',
          model: v.model || '',
          seriesName: v.seriesName || '',
          manufactureYear: v.manufactureYear ?? '',
          vehicleCategory: v.vehicleCategory || '',
          vehicleDescription: v.vehicleDescription || '',
          driveType: v.driveType || '',
          colour: v.colour || '',
          fuelType: v.fuelType || 'petrol',
          transmission: v.transmission || 'manual',
          tareKg: v.tareKg ?? '',
          grossVehicleMassKg: v.grossVehicleMassKg ?? '',
          seatedCapacity: v.seatedCapacity ?? '',
          standingCapacity: v.standingCapacity ?? '',
          registeringAuthority: v.registeringAuthority || '',
          nationalVehicleClassification: v.nationalVehicleClassification || '',
          roadworthyTestDate: v.roadworthyTestDate || '',
          licenceExpiryDate: v.licenceExpiryDate || '',
          status: v.status || 'available',
          currentOdometer: v.currentOdometer ?? 0,
          fuelCardNumber: v.fuelCardNumber || '',
          notes: v.notes || '',
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load vehicle');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [vehicleId]);

  const update = (patch: Partial<VehicleFormData>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/fleet/${vehicleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          manufactureYear: form.manufactureYear || undefined,
          tareKg: form.tareKg || undefined,
          grossVehicleMassKg: form.grossVehicleMassKg || undefined,
          seatedCapacity: form.seatedCapacity || undefined,
          standingCapacity: form.standingCapacity || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update vehicle');
      }

      router.push(`/dashboard/fleet/${vehicleId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update vehicle');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fleet', href: '/dashboard/fleet' }, { label: 'Edit Vehicle' }]} />
        <PageHeader title="Edit Vehicle" description="Loading vehicle data..." />
        <Card><CardContent className="pt-4"><p className="text-sm text-ink-500">Loading...</p></CardContent></Card>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fleet', href: '/dashboard/fleet' }, { label: 'Edit Vehicle' }]} />
        <PageHeader title="Edit Vehicle" description="Vehicle not found" />
        <Card><CardContent className="pt-4"><p className="text-sm text-status-error-text">Vehicle could not be loaded.</p></CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Fleet', href: '/dashboard/fleet' },
          { label: form.licenceNumber || 'Edit Vehicle' },
        ]}
      />
      <PageHeader
        title={`Edit ${form.make} ${form.model}`}
        description={`${form.licenceNumber} — Update vehicle details`}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/dashboard/fleet/${vehicleId}`}>
            <ChevronLeft className="h-4 w-4" /> Back to Vehicle
          </Link>
        </Button>
      </PageHeader>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-[8px] border border-status-error-bg bg-status-error-bg px-4 py-3 text-sm text-status-error-text">
            {error}
          </div>
        )}

        {/* Section A — Identity */}
        <Card>
          <CardContent className="pt-4">
            <h3 className="mb-4 text-sm font-semibold text-ink-950">Vehicle Identity</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Licence / Plate Number">
                <input type="text" value={form.licenceNumber} onChange={(e) => update({ licenceNumber: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              </Field>
              <Field label="Register Number">
                <input type="text" value={form.vehicleRegisterNumber} onChange={(e) => update({ vehicleRegisterNumber: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              </Field>
              <Field label="VIN">
                <input type="text" value={form.vin} onChange={(e) => update({ vin: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              </Field>
              <Field label="Engine Number">
                <input type="text" value={form.engineNumber} onChange={(e) => update({ engineNumber: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* Section B — Description */}
        <Card>
          <CardContent className="pt-4">
            <h3 className="mb-4 text-sm font-semibold text-ink-950">Vehicle Description</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Make"><input type="text" value={form.make} onChange={(e) => update({ make: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" /></Field>
              <Field label="Model"><input type="text" value={form.model} onChange={(e) => update({ model: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" /></Field>
              <Field label="Series"><input type="text" value={form.seriesName} onChange={(e) => update({ seriesName: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" /></Field>
              <Field label="Year"><input type="number" value={form.manufactureYear} onChange={(e) => update({ manufactureYear: e.target.value ? Number(e.target.value) : '' })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" /></Field>
              <Field label="Vehicle Category"><input type="text" value={form.vehicleCategory} onChange={(e) => update({ vehicleCategory: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" /></Field>
              <Field label="Body Style"><input type="text" value={form.vehicleDescription} onChange={(e) => update({ vehicleDescription: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" /></Field>
              <Field label="Drive Type">
                <select value={form.driveType} onChange={(e) => update({ driveType: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200">
                  <option value="">Select...</option>
                  <option value="Self-propelled">Self-propelled</option>
                  <option value="4x2">4x2</option>
                  <option value="4x4">4x4</option>
                  <option value="AWD">AWD</option>
                </select>
              </Field>
              <Field label="Colour"><input type="text" value={form.colour} onChange={(e) => update({ colour: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" /></Field>
              <Field label="Fuel Type">
                <select value={form.fuelType} onChange={(e) => update({ fuelType: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200">
                  <option value="petrol">Petrol</option>
                  <option value="diesel">Diesel</option>
                  <option value="electric">Electric</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </Field>
              <Field label="Transmission">
                <select value={form.transmission} onChange={(e) => update({ transmission: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200">
                  <option value="manual">Manual</option>
                  <option value="automatic">Automatic</option>
                </select>
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* Section C — Weight & Capacity */}
        <Card>
          <CardContent className="pt-4">
            <h3 className="mb-4 text-sm font-semibold text-ink-950">Weight &amp; Capacity</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Tare (kg)"><input type="number" value={form.tareKg} onChange={(e) => update({ tareKg: e.target.value ? Number(e.target.value) : '' })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" /></Field>
              <Field label="GVM (kg)"><input type="number" value={form.grossVehicleMassKg} onChange={(e) => update({ grossVehicleMassKg: e.target.value ? Number(e.target.value) : '' })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" /></Field>
              <Field label="Seated Capacity"><input type="number" value={form.seatedCapacity} onChange={(e) => update({ seatedCapacity: e.target.value ? Number(e.target.value) : '' })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" /></Field>
              <Field label="Standing Capacity"><input type="number" value={form.standingCapacity} onChange={(e) => update({ standingCapacity: e.target.value ? Number(e.target.value) : '' })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" /></Field>
            </div>
          </CardContent>
        </Card>

        {/* Section D — Registration & Compliance */}
        <Card>
          <CardContent className="pt-4">
            <h3 className="mb-4 text-sm font-semibold text-ink-950">Registration &amp; Compliance</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Registering Authority"><input type="text" value={form.registeringAuthority} onChange={(e) => update({ registeringAuthority: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" /></Field>
              <Field label="National Classification"><input type="text" value={form.nationalVehicleClassification} onChange={(e) => update({ nationalVehicleClassification: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" /></Field>
              <Field label="Roadworthy Date"><input type="date" value={form.roadworthyTestDate} onChange={(e) => update({ roadworthyTestDate: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" /></Field>
              <Field label="Licence Expiry"><input type="date" value={form.licenceExpiryDate} onChange={(e) => update({ licenceExpiryDate: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" /></Field>
            </div>
          </CardContent>
        </Card>

        {/* Section E — Fleet Assignment */}
        <Card>
          <CardContent className="pt-4">
            <h3 className="mb-4 text-sm font-semibold text-ink-950">Fleet Assignment</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Status">
                <select value={form.status} onChange={(e) => update({ status: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200">
                  <option value="available">Available</option>
                  <option value="provisional">Provisional</option>
                  <option value="allocated">Allocated</option>
                  <option value="issued">Issued</option>
                  <option value="maintenance">In Maintenance</option>
                  <option value="out_of_service">Out of Service</option>
                </select>
              </Field>
              <Field label="Current Odometer (km)"><input type="number" value={form.currentOdometer} onChange={(e) => update({ currentOdometer: e.target.value ? Number(e.target.value) : 0 })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" /></Field>
              <Field label="Fuel Card Number"><input type="text" value={form.fuelCardNumber} onChange={(e) => update({ fuelCardNumber: e.target.value })} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" /></Field>
            </div>
            <div className="mt-4">
              <Field label="Notes">
                <textarea value={form.notes} onChange={(e) => update({ notes: e.target.value })} rows={3} className="w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/dashboard/fleet/${vehicleId}`}>Cancel</Link>
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </div>
  );
}
