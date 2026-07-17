'use client';

import { useState } from 'react';
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
  // Section A — Identity
  licenceNumber: string;
  vehicleRegisterNumber: string;
  vin: string;
  engineNumber: string;

  // Section B — Description
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

  // Section C — Weight & capacity
  tareKg: number | '';
  grossVehicleMassKg: number | '';
  seatedCapacity: number | '';
  standingCapacity: number | '';

  // Section D — Registration & compliance
  registeringAuthority: string;
  nationalVehicleClassification: string;
  roadworthyTestDate: string;
  licenceExpiryDate: string;

  // Section E — Fleet assignment
  status: string;
  currentOdometer: number | '';
  fuelCardNumber: string;
  notes: string;
}

const EMPTY_FORM: VehicleFormData = {
  licenceNumber: '',
  vehicleRegisterNumber: '',
  vin: '',
  engineNumber: '',
  make: '',
  model: '',
  seriesName: '',
  manufactureYear: '',
  vehicleCategory: '',
  vehicleDescription: '',
  driveType: '',
  colour: '',
  fuelType: 'petrol',
  transmission: 'manual',
  tareKg: '',
  grossVehicleMassKg: '',
  seatedCapacity: '',
  standingCapacity: '',
  registeringAuthority: '',
  nationalVehicleClassification: '',
  roadworthyTestDate: '',
  licenceExpiryDate: '',
  status: 'available',
  currentOdometer: 0,
  fuelCardNumber: '',
  notes: '',
};

// ---------------------------------------------------------------------------
// Field helper
// ---------------------------------------------------------------------------

function Field({
  label,
  required,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-ink-500 mb-1">
        {label}
        {required && <span className="text-status-error-text ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NewVehiclePage() {
  const router = useRouter();
  const [form, setForm] = useState<VehicleFormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<VehicleFormData>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (!form.licenceNumber.trim()) throw new Error('Licence number is required');
      if (!form.make.trim()) throw new Error('Make is required');
      if (!form.model.trim()) throw new Error('Model is required');

      const res = await fetch('/api/fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          manufactureYear: form.manufactureYear || undefined,
          tareKg: form.tareKg || undefined,
          grossVehicleMassKg: form.grossVehicleMassKg || undefined,
          seatedCapacity: form.seatedCapacity || undefined,
          standingCapacity: form.standingCapacity || undefined,
          currentOdometer: form.currentOdometer || 0,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create vehicle');
      }

      const data = await res.json();
      router.push(`/dashboard/fleet/${data.vehicle.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create vehicle');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Fleet', href: '/dashboard/fleet' },
          { label: 'New Vehicle' },
        ]}
      />
      <PageHeader
        title="New Vehicle"
        description="Register a new vehicle in the fleet. Fields marked * are required."
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/fleet">
            <ChevronLeft className="h-4 w-4" /> Back to Fleet
          </Link>
        </Button>
      </PageHeader>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-[8px] border border-status-error-bg bg-status-error-bg px-4 py-3 text-sm text-status-error-text">
            {error}
          </div>
        )}

        {/* Section A — Vehicle Identity */}
        <Card>
          <CardContent className="pt-4">
            <h3 className="mb-4 text-sm font-semibold text-ink-950">Vehicle Identity</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Licence / Plate Number" required>
                <input
                  type="text"
                  value={form.licenceNumber}
                  onChange={(e) => update({ licenceNumber: e.target.value })}
                  placeholder="e.g. GRN 1234"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
              <Field label="Register Number">
                <input
                  type="text"
                  value={form.vehicleRegisterNumber}
                  onChange={(e) => update({ vehicleRegisterNumber: e.target.value })}
                  placeholder="NaTIS register number"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
              <Field label="VIN">
                <input
                  type="text"
                  value={form.vin}
                  onChange={(e) => update({ vin: e.target.value })}
                  placeholder="17-char VIN"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
              <Field label="Engine Number">
                <input
                  type="text"
                  value={form.engineNumber}
                  onChange={(e) => update({ engineNumber: e.target.value })}
                  placeholder="Engine serial number"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* Section B — Vehicle Description */}
        <Card>
          <CardContent className="pt-4">
            <h3 className="mb-4 text-sm font-semibold text-ink-950">Vehicle Description</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Make" required>
                <input
                  type="text"
                  value={form.make}
                  onChange={(e) => update({ make: e.target.value })}
                  placeholder="e.g. Toyota"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
              <Field label="Model" required>
                <input
                  type="text"
                  value={form.model}
                  onChange={(e) => update({ model: e.target.value })}
                  placeholder="e.g. Hilux"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
              <Field label="Series">
                <input
                  type="text"
                  value={form.seriesName}
                  onChange={(e) => update({ seriesName: e.target.value })}
                  placeholder="e.g. 2.8 GD-6"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
              <Field label="Manufacture Year">
                <input
                  type="number"
                  value={form.manufactureYear}
                  onChange={(e) => update({ manufactureYear: e.target.value ? Number(e.target.value) : '' })}
                  placeholder="e.g. 2024"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
              <Field label="Vehicle Category">
                <input
                  type="text"
                  value={form.vehicleCategory}
                  onChange={(e) => update({ vehicleCategory: e.target.value })}
                  placeholder="e.g. Light passenger motor vehicle"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
              <Field label="Body Style">
                <input
                  type="text"
                  value={form.vehicleDescription}
                  onChange={(e) => update({ vehicleDescription: e.target.value })}
                  placeholder="e.g. Double Cab, Sedan, Bus"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
              <Field label="Drive Type">
                <select
                  value={form.driveType}
                  onChange={(e) => update({ driveType: e.target.value })}
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                >
                  <option value="">Select...</option>
                  <option value="Self-propelled">Self-propelled</option>
                  <option value="4x2">4x2</option>
                  <option value="4x4">4x4</option>
                  <option value="AWD">AWD</option>
                </select>
              </Field>
              <Field label="Colour">
                <input
                  type="text"
                  value={form.colour}
                  onChange={(e) => update({ colour: e.target.value })}
                  placeholder="e.g. White"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
              <Field label="Fuel Type">
                <select
                  value={form.fuelType}
                  onChange={(e) => update({ fuelType: e.target.value })}
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                >
                  <option value="petrol">Petrol</option>
                  <option value="diesel">Diesel</option>
                  <option value="electric">Electric</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </Field>
              <Field label="Transmission">
                <select
                  value={form.transmission}
                  onChange={(e) => update({ transmission: e.target.value })}
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                >
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
              <Field label="Tare (kg)">
                <input
                  type="number"
                  value={form.tareKg}
                  onChange={(e) => update({ tareKg: e.target.value ? Number(e.target.value) : '' })}
                  placeholder="Empty vehicle weight"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
              <Field label="GVM (kg)">
                <input
                  type="number"
                  value={form.grossVehicleMassKg}
                  onChange={(e) => update({ grossVehicleMassKg: e.target.value ? Number(e.target.value) : '' })}
                  placeholder="Maximum loaded weight"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
              <Field label="Seated Capacity">
                <input
                  type="number"
                  value={form.seatedCapacity}
                  onChange={(e) => update({ seatedCapacity: e.target.value ? Number(e.target.value) : '' })}
                  placeholder="Number of seats"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
              <Field label="Standing Capacity">
                <input
                  type="number"
                  value={form.standingCapacity}
                  onChange={(e) => update({ standingCapacity: e.target.value ? Number(e.target.value) : '' })}
                  placeholder="Standing passengers"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* Section D — Registration & Compliance */}
        <Card>
          <CardContent className="pt-4">
            <h3 className="mb-4 text-sm font-semibold text-ink-950">Registration &amp; Compliance</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Registering Authority">
                <input
                  type="text"
                  value={form.registeringAuthority}
                  onChange={(e) => update({ registeringAuthority: e.target.value })}
                  placeholder="e.g. NaTIS, MVA"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
              <Field label="National Classification">
                <input
                  type="text"
                  value={form.nationalVehicleClassification}
                  onChange={(e) => update({ nationalVehicleClassification: e.target.value })}
                  placeholder="e.g. LDV, M1, N1"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
              <Field label="Roadworthy Test Date">
                <input
                  type="date"
                  value={form.roadworthyTestDate}
                  onChange={(e) => update({ roadworthyTestDate: e.target.value })}
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
              <Field label="Licence Expiry Date">
                <input
                  type="date"
                  value={form.licenceExpiryDate}
                  onChange={(e) => update({ licenceExpiryDate: e.target.value })}
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* Section E — Fleet Assignment */}
        <Card>
          <CardContent className="pt-4">
            <h3 className="mb-4 text-sm font-semibold text-ink-950">Fleet Assignment</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Initial Status">
                <select
                  value={form.status}
                  onChange={(e) => update({ status: e.target.value })}
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                >
                  <option value="available">Available</option>
                  <option value="provisional">Provisional</option>
                  <option value="maintenance">In Maintenance</option>
                </select>
              </Field>
              <Field label="Current Odometer">
                <input
                  type="number"
                  value={form.currentOdometer}
                  onChange={(e) => update({ currentOdometer: e.target.value ? Number(e.target.value) : 0 })}
                  placeholder="Kilometres"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
              <Field label="Fuel Card Number">
                <input
                  type="text"
                  value={form.fuelCardNumber}
                  onChange={(e) => update({ fuelCardNumber: e.target.value })}
                  placeholder="Fuel card number"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Notes">
                <textarea
                  value={form.notes}
                  onChange={(e) => update({ notes: e.target.value })}
                  rows={3}
                  placeholder="Any additional notes about this vehicle..."
                  className="w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/fleet">Cancel</Link>
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={submitting}>
            {submitting ? 'Creating...' : 'Create Vehicle'}
          </Button>
        </div>
      </form>
    </div>
  );
}
