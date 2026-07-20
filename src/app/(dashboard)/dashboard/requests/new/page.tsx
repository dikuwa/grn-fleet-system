'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileText, ChevronLeft, ChevronRight, Check, Plus, Trash2, MapPin, Users, User, CalendarDays } from 'lucide-react';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/lib/use-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Activity {
  id: string;
  title: string;
  description: string;
  venue: string;
  startDate: string;
  endDate: string;
  estimatedKilometres: number;
}

interface Passenger {
  id: string;
  type: 'employee' | 'external';
  employeeId: string;
  externalName: string;
}

interface Driver {
  id: string;
  employeeId: string;
  driverType: 'nominated' | 'assigned' | 'additional';
  sortOrder: number;
}

interface Route {
  id: string;
  originName: string;
  destinationName: string;
  estimatedKm: number;
}

interface RequestFormData {
  purpose: string;
  department: string;
  scope: 'regional' | 'national';
  specialAuthorityRequired: boolean;
  specialAuthorityReason: string;
  activities: Activity[];
  passengers: Passenger[];
  drivers: Driver[];
  routes: Route[];
}

const STEPS = [
  { label: 'Basic Info', icon: FileText },
  { label: 'Activities', icon: CalendarDays },
  { label: 'Passengers & Drivers', icon: Users },
  { label: 'Route', icon: MapPin },
  { label: 'Review', icon: Check },
];

const EMPTY_FORM: RequestFormData = {
  purpose: '',
  department: '',
  scope: 'regional',
  specialAuthorityRequired: false,
  specialAuthorityReason: '',
  activities: [],
  passengers: [],
  drivers: [],
  routes: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;
function nextId() {
  return `new_${++idCounter}_${Date.now()}`;
}

function generateReference(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 900) + 100);
  return `GRN/TR/${date.getFullYear()}/${month}${day}/${seq}`;
}

// ---------------------------------------------------------------------------
// Step Components
// ---------------------------------------------------------------------------

function BasicInfoStep({
  data,
  onChange,
}: {
  data: RequestFormData;
  onChange: (patch: Partial<RequestFormData>) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-ink-500 mb-1">Trip Scope *</label>
        <div className="flex gap-4">
          {(['regional', 'national'] as const).map((s) => (
            <label
              key={s}
              className={`flex cursor-pointer items-center gap-2 rounded-[8px] border px-4 py-3 text-sm transition-colors ${
                data.scope === s
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-border text-ink-700 hover:border-ink-300'
              }`}
            >
              <input
                type="radio"
                name="scope"
                value={s}
                checked={data.scope === s}
                onChange={() => onChange({ scope: s })}
                className="sr-only"
              />
              <span className={`h-3 w-3 rounded-full border-2 ${
                data.scope === s ? 'border-brand-500 bg-brand-500' : 'border-ink-300'
              }`} />
              <span className="capitalize">{s}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-ink-500 mb-1">Purpose / Reason for Travel *</label>
        <textarea
          value={data.purpose}
          onChange={(e) => onChange({ purpose: e.target.value })}
          rows={3}
          placeholder="Describe the purpose of this transport request..."
          className="w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-ink-500 mb-1">Department / Directorate</label>
        <input
          type="text"
          value={data.department}
          onChange={(e) => onChange({ department: e.target.value })}
          placeholder="e.g. Technical Services, Community Development"
          className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
      </div>

      <div className="flex items-start gap-3 rounded-[8px] border border-border p-4">
        <input
          type="checkbox"
          id="specialAuthority"
          checked={data.specialAuthorityRequired}
          onChange={(e) => onChange({ specialAuthorityRequired: e.target.checked })}
          className="mt-0.5 h-4 w-4 rounded border-border text-brand-600 focus:ring-brand-200"
        />
        <div>
          <label htmlFor="specialAuthority" className="text-sm font-medium text-ink-950 cursor-pointer">
            Special Authority Required
          </label>
          <p className="text-xs text-ink-500">
            Check this if the trip requires special authority (e.g., out-of-region travel, VIP, high-profile events).
          </p>
        </div>
      </div>

      {data.specialAuthorityRequired && (
        <div>
          <label className="block text-xs font-medium text-ink-500 mb-1">Reason for Special Authority</label>
          <textarea
            value={data.specialAuthorityReason}
            onChange={(e) => onChange({ specialAuthorityReason: e.target.value })}
            rows={2}
            placeholder="Explain why special authority is needed..."
            className="w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </div>
      )}
    </div>
  );
}

function ActivitiesStep({
  activities,
  onChange,
}: {
  activities: Activity[];
  onChange: (activities: Activity[]) => void;
}) {
  const addActivity = () => {
    onChange([
      ...activities,
      {
        id: nextId(),
        title: '',
        description: '',
        venue: '',
        startDate: '',
        endDate: '',
        estimatedKilometres: 0,
      },
    ]);
  };

  const updateActivity = (id: string, patch: Partial<Activity>) => {
    onChange(activities.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };

  const removeActivity = (id: string) => {
    onChange(activities.filter((a) => a.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-500">
          Add the programme of activities for this trip.
        </p>
        <Button variant="secondary" size="sm" onClick={addActivity}>
          <Plus className="h-4 w-4" /> Add Activity
        </Button>
      </div>

      {activities.length === 0 ? (
        <div className="rounded-[8px] border border-dashed border-border p-8 text-center">
          <CalendarDays className="mx-auto mb-2 h-6 w-6 text-ink-300" />
          <p className="text-sm text-ink-500">No activities added yet. Click &ldquo;Add Activity&rdquo; to begin.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map((a, i) => (
            <Card key={a.id}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-ink-500">Activity {i + 1}</span>
                  <Button variant="secondary" size="sm" onClick={() => removeActivity(a.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-status-error-text" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-ink-500 mb-1">Title *</label>
                    <input
                      type="text"
                      value={a.title}
                      onChange={(e) => updateActivity(a.id, { title: e.target.value })}
                      placeholder="e.g. Field inspection — Divundu"
                      className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-500 mb-1">Venue</label>
                    <input
                      type="text"
                      value={a.venue}
                      onChange={(e) => updateActivity(a.id, { venue: e.target.value })}
                      placeholder="Venue name"
                      className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-500 mb-1">Est. Km</label>
                    <input
                      type="number"
                      value={a.estimatedKilometres || ''}
                      onChange={(e) => updateActivity(a.id, { estimatedKilometres: Number(e.target.value) })}
                      className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-500 mb-1">Start Date *</label>
                    <input
                      type="date"
                      value={a.startDate}
                      onChange={(e) => updateActivity(a.id, { startDate: e.target.value })}
                      className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-500 mb-1">End Date *</label>
                    <input
                      type="date"
                      value={a.endDate}
                      onChange={(e) => updateActivity(a.id, { endDate: e.target.value })}
                      className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-ink-500 mb-1">Description</label>
                    <textarea
                      value={a.description}
                      onChange={(e) => updateActivity(a.id, { description: e.target.value })}
                      rows={2}
                      placeholder="Optional description..."
                      className="w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function PeopleStep({
  passengers,
  drivers,
  onPassengersChange,
  onDriversChange,
}: {
  passengers: Passenger[];
  drivers: Driver[];
  onPassengersChange: (p: Passenger[]) => void;
  onDriversChange: (d: Driver[]) => void;
}) {
  const addPassenger = () => {
    onPassengersChange([
      ...passengers,
      { id: nextId(), type: 'external', employeeId: '', externalName: '' },
    ]);
  };

  const updatePassenger = (id: string, patch: Partial<Passenger>) => {
    onPassengersChange(passengers.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const removePassenger = (id: string) => {
    onPassengersChange(passengers.filter((p) => p.id !== id));
  };

  const addDriver = () => {
    onDriversChange([
      ...drivers,
      {
        id: nextId(),
        employeeId: '',
        driverType: 'nominated',
        sortOrder: drivers.length + 1,
      },
    ]);
  };

  const updateDriver = (id: string, patch: Partial<Driver>) => {
    onDriversChange(drivers.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const removeDriver = (id: string) => {
    onDriversChange(drivers.filter((d) => d.id !== id));
  };

  return (
    <div className="space-y-6">
      {/* Passengers */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-ink-950">Passengers</h3>
          <Button variant="secondary" size="sm" onClick={addPassenger}>
            <Plus className="h-4 w-4" /> Add Passenger
          </Button>
        </div>
        {passengers.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-border p-6 text-center">
            <Users className="mx-auto mb-2 h-5 w-5 text-ink-300" />
            <p className="text-sm text-ink-500">No passengers added.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {passengers.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-[8px] border border-border p-3">
                <div className="flex-1 flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={p.type === 'employee'}
                      onChange={() =>
                        updatePassenger(p.id, {
                          type: p.type === 'employee' ? 'external' : 'employee',
                          employeeId: '',
                          externalName: '',
                        })
                      }
                      className="h-4 w-4 rounded border-border text-brand-600"
                    />
                    <span className="text-xs text-ink-700">Employee</span>
                  </label>
                </div>
                <div className="flex-2">
                  {p.type === 'employee' ? (
                    <input
                      type="text"
                      value={p.employeeId}
                      onChange={(e) => updatePassenger(p.id, { employeeId: e.target.value })}
                      placeholder="Employee ID"
                      className="h-9 w-full rounded-[6px] border border-border bg-surface px-2 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    />
                  ) : (
                    <input
                      type="text"
                      value={p.externalName}
                      onChange={(e) => updatePassenger(p.id, { externalName: e.target.value })}
                      placeholder="External passenger name"
                      className="h-9 w-full rounded-[6px] border border-border bg-surface px-2 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    />
                  )}
                </div>
                <button
                  onClick={() => removePassenger(p.id)}
                  className="shrink-0 text-ink-400 hover:text-status-error-text transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Drivers */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-ink-950">Drivers</h3>
          <Button variant="secondary" size="sm" onClick={addDriver}>
            <Plus className="h-4 w-4" /> Add Driver
          </Button>
        </div>
        {drivers.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-border p-6 text-center">
            <User className="mx-auto mb-2 h-5 w-5 text-ink-300" />
            <p className="text-sm text-ink-500">No drivers assigned.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {drivers.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-[8px] border border-border p-3">
                <div className="flex-1">
                  <input
                    type="text"
                    value={d.employeeId}
                    onChange={(e) => updateDriver(d.id, { employeeId: e.target.value })}
                    placeholder="Driver Employee ID"
                    className="h-9 w-full rounded-[6px] border border-border bg-surface px-2 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                </div>
                <select
                  value={d.driverType}
                  onChange={(e) => updateDriver(d.id, { driverType: e.target.value as Driver['driverType'] })}
                  className="h-9 w-[130px] rounded-[6px] border border-border bg-surface px-2 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                >
                  <option value="nominated">Nominated</option>
                  <option value="assigned">Assigned</option>
                  <option value="additional">Additional</option>
                </select>
                <button
                  onClick={() => removeDriver(d.id)}
                  className="shrink-0 text-ink-400 hover:text-status-error-text transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RouteStep({
  routes,
  onChange,
}: {
  routes: Route[];
  onChange: (r: Route[]) => void;
}) {
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);

  const addRoute = () => {
    onChange([
      ...routes,
      { id: nextId(), originName: '', destinationName: '', estimatedKm: 0 },
    ]);
  };

  const updateRoute = (id: string, patch: Partial<Route>) => {
    onChange(routes.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRoute = (id: string) => {
    onChange(routes.filter((r) => r.id !== id));
  };

  const handleCalculateAll = async () => {
    const validRoutes = routes.filter((r) => r.originName.trim() && r.destinationName.trim());
    if (validRoutes.length === 0) {
      setCalcError('Add at least one route with origin and destination filled in.');
      return;
    }

    setCalculating(true);
    setCalcError(null);

    try {
      const legs = validRoutes.map((r) => ({
        origin: r.originName,
        destination: r.destinationName,
      }));

      const res = await fetch('/api/routes/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legs }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Route calculation failed');
      }

      const data = await res.json();

      if (data.routes && Array.isArray(data.routes)) {
        // Map the returned routes back to our form routes by matching origin/destination
        const updates = [...routes];
        for (const calc of data.routes) {
          const idx = updates.findIndex(
            (r) =>
              r.originName.toLowerCase().trim() === (calc.originName || '').toLowerCase().trim() &&
              r.destinationName.toLowerCase().trim() === (calc.destinationName || '').toLowerCase().trim(),
          );
          if (idx !== -1) {
            updates[idx] = { ...updates[idx], estimatedKm: Math.round(calc.distanceKm || 0) };
          }
        }
        onChange(updates);
      }
    } catch (err) {
      setCalcError(err instanceof Error ? err.message : 'Failed to calculate routes');
    } finally {
      setCalculating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-500">
          Define the travel route. Distances can be calculated automatically when Maps credentials are configured.
        </p>
        <div className="flex items-center gap-2">
          {routes.filter((r) => r.originName.trim() && r.destinationName.trim()).length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCalculateAll}
              disabled={calculating}
            >
              {calculating ? 'Calculating...' : 'Calculate Routes'}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={addRoute}>
            <Plus className="h-4 w-4" /> Add Route
          </Button>
        </div>
      </div>

      {calcError && (
        <div className="rounded-[8px] border border-status-error-bg bg-status-error-bg px-4 py-2 text-xs text-status-error-text">
          {calcError}
        </div>
      )}

      {routes.length === 0 ? (
        <div className="rounded-[8px] border border-dashed border-border p-8 text-center">
          <MapPin className="mx-auto mb-2 h-6 w-6 text-ink-300" />
          <p className="text-sm text-ink-500">No routes defined yet. Click &ldquo;Add Route&rdquo; to add origin and destination.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {routes.map((r, i) => (
            <Card key={r.id}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-ink-500">Route {i + 1}</span>
                  <Button variant="secondary" size="sm" onClick={() => removeRoute(r.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-status-error-text" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-ink-500 mb-1">Origin *</label>
                    <input
                      type="text"
                      value={r.originName}
                      onChange={(e) => updateRoute(r.id, { originName: e.target.value })}
                      placeholder="e.g. Rundu, Kavango East"
                      className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-500 mb-1">Destination *</label>
                    <input
                      type="text"
                      value={r.destinationName}
                      onChange={(e) => updateRoute(r.id, { destinationName: e.target.value })}
                      placeholder="e.g. Windhoek, Khomas Region"
                      className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-500 mb-1">Estimated Distance (km)</label>
                    <input
                      type="number"
                      value={r.estimatedKm || ''}
                      onChange={(e) => updateRoute(r.id, { estimatedKm: Number(e.target.value) })}
                      placeholder="e.g. 500"
                      className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    />
                  </div>
                  <div className="flex items-end">
                    <div className="rounded-[8px] border border-dashed border-border px-3 py-2 text-xs text-ink-500">
                      Distance calculation adapter — route distances will be calculated automatically when the routing service is configured.
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewStep({ data, reference }: { data: RequestFormData; reference: string }) {
  const totalKm = data.routes.reduce((sum, r) => sum + r.estimatedKm, 0);
  const totalActivityKm = data.activities.reduce((sum, a) => sum + a.estimatedKilometres, 0);
  const totalPassengers = data.passengers.length;

  return (
    <div className="space-y-4">
      <div className="rounded-[10px] border border-brand-200 bg-brand-50 px-4 py-3">
        <p className="text-sm font-medium text-brand-700">
          Reference: <span className="font-mono tabular-nums">{reference}</span>
        </p>
        <p className="text-xs text-brand-600 mt-0.5">
          This reference will be assigned when the request is submitted.
        </p>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-sm font-[650] text-ink-950">{totalActivityKm || totalKm} km</p>
            <p className="text-xs text-ink-500">Total Estimated</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-sm font-[650] text-ink-950">{data.activities.length}</p>
            <p className="text-xs text-ink-500">Activities</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-sm font-[650] text-ink-950">{totalPassengers}</p>
            <p className="text-xs text-ink-500">Passengers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-sm font-[650] text-ink-950">{data.drivers.length}</p>
            <p className="text-xs text-ink-500">Drivers</p>
          </CardContent>
        </Card>
      </div>

      {/* Details */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-ink-500">Scope</span>
            <span className="font-medium text-ink-950 capitalize">{data.scope}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-ink-500">Purpose</span>
            <span className="font-medium text-ink-950 text-right max-w-[60%]">{data.purpose || 'Not specified'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-ink-500">Department</span>
            <span className="font-medium text-ink-950">{data.department || 'Not specified'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-ink-500">Special Authority</span>
            <span className="font-medium text-ink-950">{data.specialAuthorityRequired ? 'Yes' : 'No'}</span>
          </div>
          {data.specialAuthorityRequired && (
            <div className="flex justify-between text-sm">
              <span className="text-ink-500">Special Authority Reason</span>
              <span className="font-medium text-ink-950 text-right max-w-[60%]">{data.specialAuthorityReason}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {(data.activities.length > 0 || data.routes.length > 0) && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <h4 className="text-sm font-semibold text-ink-950">Itinerary</h4>
            {data.activities.map((a, i) => (
              <div key={a.id} className="flex items-center justify-between text-sm">
                <span className="text-ink-700">{i + 1}. {a.title}</span>
                <span className="text-xs text-ink-500">
                  {a.startDate && formatDate(a.startDate)}
                  {a.estimatedKilometres > 0 && ` · ${a.estimatedKilometres} km`}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Wizard
// ---------------------------------------------------------------------------

export default function NewRequestPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState<RequestFormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reference = generateReference();
  const { toast } = useToast();

  const updateForm = useCallback((patch: Partial<RequestFormData>) => {
    setFormData((prev) => ({ ...prev, ...patch }));
  }, []);

  const canProceed = (): boolean => {
    if (step === 0) return formData.purpose.trim().length > 0;
    return true;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/transport-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose: formData.purpose,
          department: formData.department,
          scope: formData.scope,
          specialAuthorityRequired: formData.specialAuthorityRequired,
          specialAuthorityReason: formData.specialAuthorityReason,
          activities: formData.activities,
          passengers: formData.passengers,
          drivers: formData.drivers,
          routes: formData.routes,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to submit request');
      }

      const data = await res.json();
      router.push(`/dashboard/requests/${data.request.id}`);
      toast({ title: 'Request Submitted', description: 'Transport request has been created successfully.', variant: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to submit request. Please try again.';
      setError(msg);
      toast({ title: 'Submission Failed', description: msg, variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return <BasicInfoStep data={formData} onChange={updateForm} />;
      case 1:
        return (
          <ActivitiesStep
            activities={formData.activities}
            onChange={(activities) => setFormData((prev) => ({ ...prev, activities }))}
          />
        );
      case 2:
        return (
          <PeopleStep
            passengers={formData.passengers}
            drivers={formData.drivers}
            onPassengersChange={(passengers) => setFormData((prev) => ({ ...prev, passengers }))}
            onDriversChange={(drivers) => setFormData((prev) => ({ ...prev, drivers }))}
          />
        );
      case 3:
        return (
          <RouteStep
            routes={formData.routes}
            onChange={(routes) => setFormData((prev) => ({ ...prev, routes }))}
          />
        );
      case 4:
        return <ReviewStep data={formData} reference={reference} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Requests', href: '/dashboard/requests' },
          { label: 'New Request' },
        ]}
      />
      <PageHeader
        title="New Transport Request"
        description="Create a new transport request — all required fields marked with *"
      />

      {/* Step Indicator */}
      <div className="flex items-center gap-0.5 overflow-x-auto">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isActive = i === step;
          const isComplete = i < step;
          return (
            <div key={s.label} className="flex items-center">
              <button
                onClick={() => setStep(i)}
                className={`flex items-center gap-2 rounded-[8px] px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-brand-600 text-white'
                    : isComplete
                      ? 'bg-brand-50 text-brand-700'
                      : 'bg-muted text-ink-500 hover:text-ink-700'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {s.label}
              </button>
              {i < STEPS.length - 1 && (
                <div
                  className={`mx-1 h-px w-4 ${
                    i < step ? 'bg-brand-500' : 'bg-border'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Step Content */}
      <Card>
        <CardContent className="pt-4">{renderStep()}</CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="rounded-[8px] border border-status-error-bg bg-status-error-bg px-4 py-3 text-sm text-status-error-text">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/requests">Cancel</Link>
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setStep(Math.min(STEPS.length - 1, step + 1))}
              disabled={!canProceed()}
            >
              Continue <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? 'Submitting...' : 'Submit Request'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
