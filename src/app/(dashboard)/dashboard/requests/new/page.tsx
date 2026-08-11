'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  FileText,
  ChevronLeft,
  ChevronRight,
  Check,
  Plus,
  Trash2,
  MapPin,
  Users,
  User,
  CalendarDays,
} from 'lucide-react';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/lib/use-toast';
import { EmployeeCombobox, type EmployeeSearchOption } from '@/components/ui/employee-combobox';
import { EmployeeMultiSelect } from '@/components/ui/employee-multi-select';
import { DatePicker } from '@/components/ui/date-picker';
import { StyledSelect } from '@/components/ui/styled-select';
import { PlacesAutocomplete } from '@/components/map/places-autocomplete';
import { MobileActionBar, ResponsiveStepper } from '@/components/ui/responsive';
import {
  isRouteReadyForAutomaticCalculation,
  routeCalculationIdentity,
} from '@/lib/responsive-routing';

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
  employee: EmployeeSearchOption | null;
  externalName: string;
  externalOrganisation?: string;
  externalPhone?: string;
  externalEmail?: string;
  externalIdReference?: string;
  travellerRole?: string;
  reasonForTravel?: string;
}

interface Driver {
  id: string;
  employeeId: string;
  employee: EmployeeSearchOption | null;
  driverType: 'nominated';
  sortOrder: number;
}

interface Route {
  id: string;
  originName: string;
  destinationName: string;
  estimatedKm: number;
  originPlaceId?: string;
  destinationPlaceId?: string;
  originCoordinates?: { lat: number; lng: number };
  destinationCoordinates?: { lat: number; lng: number };
  estimatedMinutes?: number;
  routePolyline?: string;
  routeStatus?: 'idle' | 'calculating' | 'calculated' | 'failed' | 'manual';
  calculatedAt?: string;
}

interface RequestFormData {
  requesterEmployeeId: string;
  requesterEmployee: EmployeeSearchOption | null;
  assistedReason: string;
  purpose: string;
  department: string;
  scope: 'regional' | 'national';
  specialAuthorityRequired: boolean;
  specialAuthorityReason: string;
  activities: Activity[];
  passengers: Passenger[];
  drivers: Driver[];
  routes: Route[];
  driverPreference: string;
  programmeId: string;
}

const STEPS = [
  { label: 'Basic Info', icon: FileText },
  { label: 'Activities', icon: CalendarDays },
  { label: 'Passengers & Drivers', icon: Users },
  { label: 'Route', icon: MapPin },
  { label: 'Review', icon: Check },
];

const EMPTY_FORM: RequestFormData = {
  requesterEmployeeId: '',
  requesterEmployee: null,
  assistedReason: '',
  purpose: '',
  department: '',
  scope: 'regional',
  specialAuthorityRequired: false,
  specialAuthorityReason: '',
  activities: [],
  passengers: [],
  drivers: [],
  routes: [],
  driverPreference: 'transport_admin_assign',
  programmeId: '',
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

function ProgrammeSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [options, setOptions] = useState<{ id: string; reference: string; title: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/programmes?selectable=1&limit=50')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load'))))
      .then((json) => {
        if (!cancelled) setOptions(json.data || []);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Programmes are unavailable.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <label className="text-ink-500 mb-1 block text-xs font-medium">
        Link to an approved Programme (optional)
      </label>
      <StyledSelect value={value} onChange={(e) => onChange(e.target.value)} disabled={loading}>
        <option value="">No programme link</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.reference} — {p.title}
          </option>
        ))}
      </StyledSelect>
      <p className="text-ink-500 mt-1 text-xs">
        {loading
          ? 'Loading approved programmes…'
          : loadError
            ? loadError
            : 'Only approved or published, non-archived programmes can be linked.'}
      </p>
    </div>
  );
}

function BasicInfoStep({
  data,
  onChange,
}: {
  data: RequestFormData;
  onChange: (patch: Partial<RequestFormData>) => void;
}) {
  return (
    <div className="space-y-4">
      <ProgrammeSelector
        value={data.programmeId}
        onChange={(programmeId) => onChange({ programmeId })}
      />
      <div className="border-border rounded-[8px] border p-4">
        <label className="text-ink-500 mb-1 block text-xs font-medium">Requesting employee</label>
        <EmployeeCombobox
          kind="employee"
          value={data.requesterEmployeeId}
          selectedOption={data.requesterEmployee}
          onSelect={(employee) =>
            onChange({ requesterEmployeeId: employee?.id || '', requesterEmployee: employee })
          }
          placeholder="Self, or search employee for an assisted request"
        />
        <p className="text-ink-500 mt-1 text-xs">
          Leave blank to use your linked employee profile. Selecting another employee requires
          assisted-request permission.
        </p>
        {data.requesterEmployee && (
          <div className="mt-3">
            <label className="text-ink-500 mb-1 block text-xs font-medium">
              Reason for assisted submission *
            </label>
            <textarea
              value={data.assistedReason}
              onChange={(event) => onChange({ assistedReason: event.target.value })}
              rows={2}
              className="border-border bg-surface text-ink-950 focus:ring-brand-600 w-full rounded-[8px] border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
          </div>
        )}
      </div>

      <div>
        <label className="text-ink-500 mb-1 block text-xs font-medium">Trip Scope *</label>
        <div className="flex gap-4">
          {(['regional', 'national'] as const).map((s) => (
            <label
              key={s}
              className={`flex cursor-pointer items-center gap-2 rounded-[8px] border px-4 py-3 text-sm transition-colors ${
                data.scope === s
                  ? 'border-brand-600 bg-brand-50 text-brand-700'
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
              <span
                className={`h-3 w-3 rounded-full border-2 ${
                  data.scope === s ? 'border-brand-600 bg-brand-600' : 'border-ink-300'
                }`}
              />
              <span className="capitalize">{s}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="text-ink-500 mb-1 block text-xs font-medium">Driver preference</label>
        <StyledSelect
          value={data.driverPreference}
          onChange={(event) => onChange({ driverPreference: event.target.value })}
        >
          <option value="transport_admin_assign">Transport Administrator should assign</option>
          <option value="requester_qualified_driver">I am a qualified driver and may drive</option>
          <option value="preferred_driver">I will suggest a preferred driver</option>
          <option value="no_preference">No preference</option>
        </StyledSelect>
        <p className="text-ink-500 mt-1 text-xs">
          A preferred driver is a request only and remains subject to availability and compliance.
        </p>
      </div>

      <div>
        <label className="text-ink-500 mb-1 block text-xs font-medium">
          Purpose / Reason for Travel *
        </label>
        <textarea
          value={data.purpose}
          onChange={(e) => onChange({ purpose: e.target.value })}
          rows={3}
          placeholder="Describe the purpose of this transport request..."
          className="border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-600 w-full rounded-[8px] border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
        />
      </div>

      <div>
        <label className="text-ink-500 mb-1 block text-xs font-medium">
          Department / Directorate
        </label>
        <input
          type="text"
          value={data.department}
          onChange={(e) => onChange({ department: e.target.value })}
          placeholder="e.g. Technical Services, Community Development"
          className="border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-600 h-10 w-full rounded-[8px] border px-3 text-sm focus:ring-2 focus:outline-none"
        />
      </div>

      <div className="border-border flex items-start gap-3 rounded-[8px] border p-4">
        <input
          type="checkbox"
          id="specialAuthority"
          checked={data.specialAuthorityRequired}
          onChange={(e) => onChange({ specialAuthorityRequired: e.target.checked })}
          className="border-border text-brand-600 focus:ring-brand-600 mt-0.5 h-4 w-4 rounded"
        />
        <div>
          <label
            htmlFor="specialAuthority"
            className="text-ink-950 cursor-pointer text-sm font-medium"
          >
            Special Authority Required
          </label>
          <p className="text-ink-500 text-xs">
            Check this if the trip requires special authority (e.g., out-of-region travel, VIP,
            high-profile events).
          </p>
        </div>
      </div>

      {data.specialAuthorityRequired && (
        <div>
          <label className="text-ink-500 mb-1 block text-xs font-medium">
            Reason for Special Authority
          </label>
          <textarea
            value={data.specialAuthorityReason}
            onChange={(e) => onChange({ specialAuthorityReason: e.target.value })}
            rows={2}
            placeholder="Explain why special authority is needed..."
            className="border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-600 w-full rounded-[8px] border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
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
        <p className="text-ink-500 text-sm">Add the programme of activities for this trip.</p>
        <Button variant="secondary" size="sm" onClick={addActivity}>
          <Plus className="h-4 w-4" /> Add Activity
        </Button>
      </div>

      {activities.length === 0 ? (
        <div className="border-border rounded-[8px] border border-dashed p-8 text-center">
          <CalendarDays className="text-ink-300 mx-auto mb-2 h-6 w-6" />
          <p className="text-ink-500 text-sm">
            No activities added yet. Click &ldquo;Add Activity&rdquo; to begin.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map((a, i) => (
            <Card key={a.id}>
              <CardContent className="pt-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-ink-500 text-xs font-medium">Activity {i + 1}</span>
                  <Button variant="secondary" size="sm" onClick={() => removeActivity(a.id)}>
                    <Trash2 className="text-status-error-text h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="text-ink-500 mb-1 block text-xs font-medium">Title *</label>
                    <input
                      type="text"
                      value={a.title}
                      onChange={(e) => updateActivity(a.id, { title: e.target.value })}
                      placeholder="e.g. Field inspection — Divundu"
                      className="border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-600 h-10 w-full rounded-[8px] border px-3 text-sm focus:ring-2 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-ink-500 mb-1 block text-xs font-medium">Venue</label>
                    <input
                      type="text"
                      value={a.venue}
                      onChange={(e) => updateActivity(a.id, { venue: e.target.value })}
                      placeholder="Venue name"
                      className="border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-600 h-10 w-full rounded-[8px] border px-3 text-sm focus:ring-2 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-ink-500 mb-1 block text-xs font-medium">Est. Km</label>
                    <input
                      type="number"
                      value={a.estimatedKilometres || ''}
                      onChange={(e) =>
                        updateActivity(a.id, { estimatedKilometres: Number(e.target.value) })
                      }
                      className="border-border bg-surface text-ink-950 focus:ring-brand-600 h-10 w-full rounded-[8px] border px-3 text-sm focus:ring-2 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-ink-500 mb-1 block text-xs font-medium">
                      Start Date *
                    </label>
                    <DatePicker
                      value={a.startDate}
                      onChange={(value) => updateActivity(a.id, { startDate: value })}
                      placeholder="Select start date…"
                    />
                  </div>
                  <div>
                    <label className="text-ink-500 mb-1 block text-xs font-medium">
                      End Date *
                    </label>
                    <DatePicker
                      value={a.endDate}
                      onChange={(value) => updateActivity(a.id, { endDate: value })}
                      min={a.startDate || undefined}
                      placeholder="Select end date…"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-ink-500 mb-1 block text-xs font-medium">
                      Description
                    </label>
                    <textarea
                      value={a.description}
                      onChange={(e) => updateActivity(a.id, { description: e.target.value })}
                      rows={2}
                      placeholder="Optional description..."
                      className="border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-600 w-full rounded-[8px] border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
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
      {
        id: nextId(),
        type: 'external',
        employeeId: '',
        employee: null,
        externalName: '',
        travellerRole: 'passenger',
      },
    ]);
  };

  const updatePassenger = (id: string, patch: Partial<Passenger>) => {
    onPassengersChange(passengers.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const removePassenger = (id: string) => {
    onPassengersChange(passengers.filter((p) => p.id !== id));
  };

  const employeePassengers = passengers
    .filter((passenger) => passenger.type === 'employee' && passenger.employee)
    .map((passenger) => passenger.employee!);
  const setEmployeePassengers = (selected: EmployeeSearchOption[]) => {
    const external = passengers.filter((passenger) => passenger.type === 'external');
    onPassengersChange([
      ...selected.map((employee) => ({
        id: passengers.find((passenger) => passenger.employeeId === employee.id)?.id || nextId(),
        type: 'employee' as const,
        employeeId: employee.id,
        employee,
        externalName: '',
        travellerRole: 'passenger',
      })),
      ...external,
    ]);
  };

  const addDriver = () => {
    onDriversChange([
      ...drivers,
      {
        id: nextId(),
        employeeId: '',
        employee: null,
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
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-ink-950 text-sm font-semibold">
              Employees and external travellers
            </h3>
            <p className="text-ink-500 mt-0.5 text-xs">
              Select several employees at once, or add a person outside the employee directory.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={addPassenger}>
            <Plus className="h-4 w-4" /> Add external traveller
          </Button>
        </div>
        <EmployeeMultiSelect value={employeePassengers} onChange={setEmployeePassengers} />
        <p className="text-ink-500 mt-2 text-xs" aria-live="polite">
          {employeePassengers.length} employee{employeePassengers.length === 1 ? '' : 's'} selected
        </p>
        <div className="mt-3 space-y-3">
          {passengers
            .filter((passenger) => passenger.type === 'external')
            .map((passenger) => (
              <div key={passenger.id} className="border-border rounded-lg border p-3">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-ink-600 text-xs font-semibold tracking-wide uppercase">
                    External traveller
                  </p>
                  <button
                    type="button"
                    onClick={() => removePassenger(passenger.id)}
                    aria-label="Remove external traveller"
                    className="focus-ring text-ink-400 hover:text-status-error-text"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-ink-500 text-xs font-medium">
                    Full name *
                    <input
                      value={passenger.externalName}
                      onChange={(event) =>
                        updatePassenger(passenger.id, { externalName: event.target.value })
                      }
                      className="border-border bg-surface text-ink-950 mt-1 h-10 w-full rounded-lg border px-3 text-sm"
                    />
                  </label>
                  <label className="text-ink-500 text-xs font-medium">
                    Organisation
                    <input
                      value={passenger.externalOrganisation || ''}
                      onChange={(event) =>
                        updatePassenger(passenger.id, {
                          externalOrganisation: event.target.value,
                        })
                      }
                      className="border-border bg-surface text-ink-950 mt-1 h-10 w-full rounded-lg border px-3 text-sm"
                    />
                  </label>
                  <label className="text-ink-500 text-xs font-medium">
                    Phone
                    <input
                      value={passenger.externalPhone || ''}
                      onChange={(event) =>
                        updatePassenger(passenger.id, { externalPhone: event.target.value })
                      }
                      className="border-border bg-surface text-ink-950 mt-1 h-10 w-full rounded-lg border px-3 text-sm"
                    />
                  </label>
                  <label className="text-ink-500 text-xs font-medium">
                    Email
                    <input
                      type="email"
                      value={passenger.externalEmail || ''}
                      onChange={(event) =>
                        updatePassenger(passenger.id, { externalEmail: event.target.value })
                      }
                      className="border-border bg-surface text-ink-950 mt-1 h-10 w-full rounded-lg border px-3 text-sm"
                    />
                  </label>
                  <label className="text-ink-500 text-xs font-medium">
                    Role on trip
                    <input
                      value={passenger.travellerRole || ''}
                      onChange={(event) =>
                        updatePassenger(passenger.id, { travellerRole: event.target.value })
                      }
                      placeholder="Passenger, team lead…"
                      className="border-border bg-surface text-ink-950 mt-1 h-10 w-full rounded-lg border px-3 text-sm"
                    />
                  </label>
                  <label className="text-ink-500 text-xs font-medium">
                    Reason for travelling
                    <input
                      value={passenger.reasonForTravel || ''}
                      onChange={(event) =>
                        updatePassenger(passenger.id, { reasonForTravel: event.target.value })
                      }
                      className="border-border bg-surface text-ink-950 mt-1 h-10 w-full rounded-lg border px-3 text-sm"
                    />
                  </label>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Drivers */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-ink-950 text-sm font-semibold">Drivers</h3>
          <Button variant="secondary" size="sm" onClick={addDriver}>
            <Plus className="h-4 w-4" /> Add Driver
          </Button>
        </div>
        {drivers.length === 0 ? (
          <div className="border-border rounded-[8px] border border-dashed p-6 text-center">
            <User className="text-ink-300 mx-auto mb-2 h-5 w-5" />
            <p className="text-ink-500 text-sm">No drivers assigned.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {drivers.map((d) => (
              <div
                key={d.id}
                className="border-border flex items-center gap-3 rounded-[8px] border p-3"
              >
                <div className="flex-1">
                  <EmployeeCombobox
                    kind="driver"
                    value={d.employeeId}
                    selectedOption={d.employee}
                    onSelect={(employee) =>
                      updateDriver(d.id, {
                        employeeId: employee?.id || '',
                        employee,
                      })
                    }
                    placeholder="Search authorised drivers…"
                  />
                </div>
                <span className="bg-status-info-bg text-status-info-text rounded-full px-2.5 py-1 text-xs font-medium">
                  Nominated
                </span>
                <button
                  onClick={() => removeDriver(d.id)}
                  className="text-ink-400 hover:text-status-error-text shrink-0 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-ink-500 mt-2 text-xs">
          Driver selections are nominations. The Transport Administrator confirms or changes the
          final driver during allocation.
        </p>
      </div>
    </div>
  );
}

function RouteStep({ routes, onChange }: { routes: Route[]; onChange: (r: Route[]) => void }) {
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const routesRef = useRef(routes);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    routesRef.current = routes;
    onChangeRef.current = onChange;
  }, [routes, onChange]);

  const addRoute = () => {
    onChange([
      ...routes,
      {
        id: nextId(),
        originName: '',
        destinationName: '',
        estimatedKm: 0,
        originPlaceId: undefined,
        destinationPlaceId: undefined,
      },
    ]);
  };

  const updateRoute = (id: string, patch: Partial<Route>) => {
    onChange(routes.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRoute = (id: string) => {
    onChange(routes.filter((r) => r.id !== id));
  };

  const handleCalculateAll = useCallback(async (automatic = false, routeId?: string) => {
    const currentRoutes = routesRef.current;
    const validRoutes = currentRoutes.filter(
      (r) =>
        (!routeId || r.id === routeId) &&
        r.originName.trim() &&
        r.destinationName.trim() &&
        (!automatic || isRouteReadyForAutomaticCalculation(r)),
    );
    if (validRoutes.length === 0) {
      if (!automatic) setCalcError('Add at least one route with origin and destination filled in.');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setCalculating(true);
    setCalcError(null);
    onChangeRef.current(
      currentRoutes.map((route) =>
        validRoutes.some((valid) => valid.id === route.id)
          ? { ...route, routeStatus: 'calculating' as const }
          : route,
      ),
    );

    try {
      const legs = validRoutes.map((r) => ({
        origin: r.originName,
        destination: r.destinationName,
      }));

      const res = await fetch('/api/routes/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legs }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Route calculation failed');
      }

      const data = await res.json();

      if (data.routes && Array.isArray(data.routes)) {
        // Map the returned routes back to our form routes by matching origin/destination
        const updates = [...routesRef.current];
        for (const [resultIndex, calc] of data.routes.entries()) {
          const routeId = validRoutes[resultIndex]?.id;
          const idx = updates.findIndex((route) => route.id === routeId);
          if (idx !== -1) {
            const distance = Number(calc.distanceKm);
            if (!Number.isFinite(distance) || distance <= 0) continue;
            updates[idx] = {
              ...updates[idx],
              estimatedKm: Math.round(distance),
              estimatedMinutes: Number(calc.durationMinutes) || undefined,
              routePolyline: typeof calc.routePolyline === 'string' ? calc.routePolyline : undefined,
              originPlaceId: calc.originPlaceId || updates[idx]?.originPlaceId,
              destinationPlaceId: calc.destinationPlaceId || updates[idx]?.destinationPlaceId,
              originCoordinates: Number(calc.originLat) && Number(calc.originLng)
                ? { lat: Number(calc.originLat), lng: Number(calc.originLng) }
                : updates[idx]?.originCoordinates,
              destinationCoordinates: Number(calc.destLat) && Number(calc.destLng)
                ? { lat: Number(calc.destLat), lng: Number(calc.destLng) }
                : updates[idx]?.destinationCoordinates,
              routeStatus: 'calculated',
              calculatedAt: new Date().toISOString(),
            };
          }
        }
        onChangeRef.current(updates);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setCalcError(err instanceof Error ? err.message : 'Failed to calculate routes');
      onChangeRef.current(
        routesRef.current.map((route) =>
          validRoutes.some((valid) => valid.id === route.id)
            ? { ...route, routeStatus: 'failed' as const }
            : route,
        ),
      );
    } finally {
      if (abortRef.current === controller) setCalculating(false);
    }
  }, []);

  const calculationKey = routeCalculationIdentity(routes);
  const hasAutoReadyRoute = routes.some(isRouteReadyForAutomaticCalculation);

  useEffect(() => {
    if (!hasAutoReadyRoute) return;
    const timer = window.setTimeout(() => void handleCalculateAll(true), 500);
    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [calculationKey, handleCalculateAll, hasAutoReadyRoute]);

  return (
    <div className="space-y-4">
      <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-ink-500 text-sm">
          Define the travel route. Distances can be calculated automatically when Maps credentials
          are configured.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={addRoute}>
            <Plus className="h-4 w-4" /> Add Route
          </Button>
        </div>
      </div>

      {calcError && (
        <div className="border-status-error-bg bg-status-error-bg text-status-error-text rounded-[8px] border px-4 py-2 text-xs">
          {calcError}
        </div>
      )}

      {routes.length === 0 ? (
        <div className="border-border rounded-[8px] border border-dashed p-8 text-center">
          <MapPin className="text-ink-300 mx-auto mb-2 h-6 w-6" />
          <p className="text-ink-500 text-sm">
            No routes defined yet. Click &ldquo;Add Route&rdquo; to add origin and destination.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {routes.map((r, i) => (
            <Card key={r.id}>
              <CardContent className="pt-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-ink-500 text-xs font-medium">Route {i + 1}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {r.originName.trim() && r.destinationName.trim() && <Button variant="secondary" size="sm" onClick={() => void handleCalculateAll(false, r.id)} disabled={calculating}>{r.routeStatus === 'calculating' ? 'Calculating…' : 'Calculate distance'}</Button>}
                    <Button variant="ghost" size="sm" className="text-status-error-text" onClick={() => removeRoute(r.id)} aria-label={`Delete route ${i + 1}`}>
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-ink-500 mb-1 block text-xs font-medium">Origin *</label>
                    <PlacesAutocomplete
                      value={r.originName}
                      onTextChange={(text) => updateRoute(r.id, { originName: text })}
                      onSelect={(place) =>
                        updateRoute(r.id, {
                          originName: place.name,
                          originPlaceId: place.placeId || undefined,
                          originCoordinates:
                            place.lat && place.lng ? { lat: place.lat, lng: place.lng } : undefined,
                        })
                      }
                      placeholder="e.g. Rundu, Kavango East"
                      ariaLabel="Route origin"
                    />
                  </div>
                  <div>
                    <label className="text-ink-500 mb-1 block text-xs font-medium">
                      Destination *
                    </label>
                    <PlacesAutocomplete
                      value={r.destinationName}
                      onTextChange={(text) => updateRoute(r.id, { destinationName: text })}
                      onSelect={(place) =>
                        updateRoute(r.id, {
                          destinationName: place.name,
                          destinationPlaceId: place.placeId || undefined,
                          destinationCoordinates:
                            place.lat && place.lng ? { lat: place.lat, lng: place.lng } : undefined,
                        })
                      }
                      placeholder="e.g. Windhoek, Khomas Region"
                      ariaLabel="Route destination"
                    />
                  </div>
                  <div>
                    <label className="text-ink-500 mb-1 block text-xs font-medium">
                      Estimated Distance (km)
                    </label>
                    <input
                      type="number"
                      value={r.estimatedKm || ''}
                      onChange={(e) =>
                        updateRoute(r.id, {
                          estimatedKm: Number(e.target.value),
                          routeStatus: 'manual',
                          calculatedAt: new Date().toISOString(),
                        })
                      }
                      placeholder="e.g. 500"
                      className="border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-600 h-10 w-full rounded-[8px] border px-3 text-sm focus:ring-2 focus:outline-none"
                    />
                  </div>
                  <div className="flex items-end" aria-live="polite">
                    <div className="border-border text-ink-500 w-full rounded-[8px] border border-dashed px-3 py-2 text-xs">
                      {r.routeStatus === 'calculating'
                        ? 'Calculating driving distance and duration…'
                        : r.routeStatus === 'calculated'
                          ? `Automatic route · ${r.estimatedKm} km${r.estimatedMinutes ? ` · about ${Math.round(r.estimatedMinutes)} min` : ''}${r.calculatedAt ? ` · updated ${new Date(r.calculatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`
                          : r.routeStatus === 'failed'
                            ? 'Route could not be resolved. Check both selected places or use Calculate distance to retry.'
                            : r.routeStatus === 'manual'
                              ? 'Manually entered distance'
                              : 'Select an origin and destination to calculate automatically.'}
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
      <div className="border-brand-100 bg-brand-50 rounded-[10px] border px-4 py-3">
        <p className="text-brand-700 text-sm font-medium">
          Reference: <span className="font-mono tabular-nums">{reference}</span>
        </p>
        <p className="text-brand-600 mt-0.5 text-xs">
          This reference will be assigned when the request is submitted.
        </p>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-ink-950 text-sm font-[650]">{totalActivityKm || totalKm} km</p>
            <p className="text-ink-500 text-xs">Total Estimated</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-ink-950 text-sm font-[650]">{data.activities.length}</p>
            <p className="text-ink-500 text-xs">Activities</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-ink-950 text-sm font-[650]">{totalPassengers}</p>
            <p className="text-ink-500 text-xs">Passengers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-ink-950 text-sm font-[650]">{data.drivers.length}</p>
            <p className="text-ink-500 text-xs">Drivers</p>
          </CardContent>
        </Card>
      </div>

      {/* Details */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex justify-between text-sm">
            <span className="text-ink-500">Scope</span>
            <span className="text-ink-950 font-medium capitalize">{data.scope}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-ink-500">Purpose</span>
            <span className="text-ink-950 max-w-[60%] text-right font-medium">
              {data.purpose || 'Not specified'}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-ink-500">Department</span>
            <span className="text-ink-950 font-medium">{data.department || 'Not specified'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-ink-500">Special Authority</span>
            <span className="text-ink-950 font-medium">
              {data.specialAuthorityRequired ? 'Yes' : 'No'}
            </span>
          </div>
          {data.specialAuthorityRequired && (
            <div className="flex justify-between text-sm">
              <span className="text-ink-500">Special Authority Reason</span>
              <span className="text-ink-950 max-w-[60%] text-right font-medium">
                {data.specialAuthorityReason}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {(data.activities.length > 0 || data.routes.length > 0) && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <h4 className="text-ink-950 text-sm font-semibold">Itinerary</h4>
            {data.activities.map((a, i) => (
              <div key={a.id} className="flex items-center justify-between text-sm">
                <span className="text-ink-700">
                  {i + 1}. {a.title}
                </span>
                <span className="text-ink-500 text-xs">
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
  const [clientSubmissionId] = useState(() => crypto.randomUUID());
  const [reference] = useState(generateReference);
  const { toast } = useToast();

  const updateForm = useCallback((patch: Partial<RequestFormData>) => {
    setFormData((prev) => ({ ...prev, ...patch }));
  }, []);

  const canProceed = (): boolean => {
    if (step === 0)
      return (
        formData.purpose.trim().length > 0 &&
        (!formData.requesterEmployee || formData.assistedReason.trim().length > 0)
      );
    if (step === 1) {
      return formData.activities.every((activity) =>
        Boolean(activity.title.trim() && activity.startDate && activity.endDate),
      );
    }
    if (step === 2) {
      const employeePassengerIds = formData.passengers
        .filter((passenger) => passenger.type === 'employee')
        .map((passenger) => passenger.employeeId);
      const driverIds = formData.drivers.map((driver) => driver.employeeId);
      return (
        formData.passengers.every((passenger) =>
          passenger.type === 'employee'
            ? Boolean(passenger.employeeId)
            : Boolean(passenger.externalName.trim()),
        ) &&
        formData.drivers.every((driver) => Boolean(driver.employeeId)) &&
        new Set(employeePassengerIds).size === employeePassengerIds.length &&
        new Set(driverIds).size === driverIds.length
      );
    }
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
          programmeId: formData.programmeId || undefined,
          requesterEmployeeNumber: formData.requesterEmployee?.employeeNumber,
          assistedReason: formData.assistedReason,
          confirmationMethod: formData.requesterEmployee
            ? 'pending_employee_confirmation'
            : 'authenticated_submission',
          department: formData.department,
          scope: formData.scope,
          specialAuthorityRequired: formData.specialAuthorityRequired,
          specialAuthorityReason: formData.specialAuthorityReason,
          activities: formData.activities,
          passengers: formData.passengers,
          drivers: formData.drivers,
          driverPreference: formData.driverPreference,
          preferredDriverEmployeeId: formData.drivers[0]?.employeeId,
          routes: formData.routes,
          clientSubmissionId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to submit request');
      }

      const data = await res.json();
      router.push(`/dashboard/requests/${data.request.id}`);
      toast({
        title: 'Request Submitted',
        description: 'Transport request has been created successfully.',
        variant: 'success',
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to submit request. Please try again.';
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
      <ResponsiveStepper
        steps={STEPS}
        current={step}
        onStep={(index) => index < step && setStep(index)}
      />

      {/* Step Content */}
      <Card>
        <CardContent className="pt-4">{renderStep()}</CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="border-status-error-bg bg-status-error-bg text-status-error-text rounded-[8px] border px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Actions */}
      <MobileActionBar className="sm:justify-between">
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
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit Request'}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/requests">Cancel</Link>
        </Button>
      </MobileActionBar>
    </div>
  );
}
