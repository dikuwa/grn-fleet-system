'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  CalendarDays,
  Loader2,
  MapPin,
  Plus,
  Send,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { StyledSelect } from '@/components/ui/styled-select';
import { EmployeeCombobox, type EmployeeSearchOption } from '@/components/ui/employee-combobox';
import { EmployeeMultiSelect } from '@/components/ui/employee-multi-select';
import { useToast } from '@/lib/use-toast';

type Activity = {
  id: string;
  title: string;
  description: string;
  venue: string;
  startDate: string;
  endDate: string;
  estimatedKilometres: number;
};

type Passenger = {
  id: string;
  type: 'employee' | 'external';
  employeeId: string;
  employee: EmployeeSearchOption | null;
  externalName: string;
  externalIdReference: string;
  externalOrganisation: string;
  externalPhone: string;
  externalEmail: string;
  travellerRole: string;
  reasonForTravel: string;
};

type Driver = {
  id: string;
  employeeId: string;
  employee: EmployeeSearchOption | null;
  sortOrder: number;
};

type RouteLeg = {
  id: string;
  originName: string;
  destinationName: string;
  estimatedKm: number;
  originPlaceId?: string;
  destinationPlaceId?: string;
  originCoordinates?: { lat: number; lng: number } | null;
  destinationCoordinates?: { lat: number; lng: number } | null;
};

type FormState = {
  reference: string;
  status: string;
  purpose: string;
  scope: 'regional' | 'national';
  programmeId: string;
  specialAuthorityRequired: boolean;
  specialAuthorityReason: string;
  driverPreference: string;
  activities: Activity[];
  passengers: Passenger[];
  drivers: Driver[];
  routes: RouteLeg[];
  reason: string;
};

type ProgrammeOption = { id: string; reference: string; title: string };

let localId = 0;
function nextId(prefix: string) {
  localId += 1;
  return `${prefix}_${Date.now()}_${localId}`;
}

function isoDate(value: string | Date | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function fieldClass() {
  return 'border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-600 min-h-11 w-full rounded-[8px] border px-3 py-2 text-sm focus:ring-2 focus:outline-none';
}

export default function EditAndResubmitRequestPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const requestId = params.id;

  const [form, setForm] = useState<FormState | null>(null);
  const [programmes, setProgrammes] = useState<ProgrammeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [requestResponse, programmeResponse] = await Promise.all([
          fetch(`/api/requests/${requestId}/resubmit`, { cache: 'no-store' }),
          fetch('/api/programmes?selectable=1&limit=100', { cache: 'no-store' }),
        ]);
        const requestJson = await requestResponse.json();
        const programmeJson = await programmeResponse.json().catch(() => ({ data: [] }));
        if (!requestResponse.ok) throw new Error(requestJson.error || 'Unable to load request corrections');
        if (cancelled) return;

        const data = requestJson.data;
        setProgrammes(programmeResponse.ok ? programmeJson.data || [] : []);
        setForm({
          reference: data.request.reference,
          status: data.request.status,
          purpose: data.request.purpose || '',
          scope: data.request.scope === 'national' ? 'national' : 'regional',
          programmeId: data.request.programmeId || '',
          specialAuthorityRequired: Boolean(data.request.specialAuthorityRequired),
          specialAuthorityReason: data.request.specialAuthorityReason || '',
          driverPreference: data.request.driverPreference || 'transport_admin_assign',
          reason: '',
          activities: (data.activities || []).map((activity: any) => ({
            id: activity.id || nextId('activity'),
            title: activity.title || '',
            description: activity.description || '',
            venue: activity.venue || '',
            startDate: isoDate(activity.startDate),
            endDate: isoDate(activity.endDate),
            estimatedKilometres: Number(activity.estimatedKilometres ?? activity.estimatedKm ?? 0),
          })),
          passengers: (data.passengers || []).map((passenger: any) => ({
            id: passenger.id || nextId('passenger'),
            type: passenger.type === 'external' ? 'external' : 'employee',
            employeeId: passenger.employeeId || '',
            employee: passenger.employee || null,
            externalName: passenger.externalName || '',
            externalIdReference: passenger.externalIdReference || '',
            externalOrganisation: passenger.externalOrganisation || '',
            externalPhone: passenger.externalPhone || '',
            externalEmail: passenger.externalEmail || '',
            travellerRole: passenger.travellerRole || 'passenger',
            reasonForTravel: passenger.reasonForTravel || '',
          })),
          drivers: (data.drivers || []).map((driver: any, index: number) => ({
            id: driver.id || nextId('driver'),
            employeeId: driver.employeeId || '',
            employee: driver.employee || null,
            sortOrder: Number(driver.sortOrder || index + 1),
          })),
          routes: (data.routes || []).map((route: any) => ({
            id: route.id || nextId('route'),
            originName: route.originName || '',
            destinationName: route.destinationName || '',
            estimatedKm: Number(route.estimatedKm ?? route.totalKilometres ?? 0),
            originPlaceId: route.originPlaceId || undefined,
            destinationPlaceId: route.destinationPlaceId || undefined,
            originCoordinates: route.originCoordinates || null,
            destinationCoordinates: route.destinationCoordinates || null,
          })),
        });
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load request');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const employeePassengers = useMemo(
    () => form?.passengers.filter((passenger) => passenger.type === 'employee' && passenger.employee).map((passenger) => passenger.employee!) || [],
    [form?.passengers],
  );

  function patch(patchValue: Partial<FormState>) {
    setForm((current) => (current ? { ...current, ...patchValue } : current));
  }

  function setEmployeePassengers(selected: EmployeeSearchOption[]) {
    if (!form) return;
    const external = form.passengers.filter((passenger) => passenger.type === 'external');
    const existingByEmployee = new Map(
      form.passengers
        .filter((passenger) => passenger.type === 'employee')
        .map((passenger) => [passenger.employeeId, passenger]),
    );
    patch({
      passengers: [
        ...selected.map((employee) => ({
          id: existingByEmployee.get(employee.id)?.id || nextId('passenger'),
          type: 'employee' as const,
          employeeId: employee.id,
          employee,
          externalName: '',
          externalIdReference: '',
          externalOrganisation: '',
          externalPhone: '',
          externalEmail: '',
          travellerRole: existingByEmployee.get(employee.id)?.travellerRole || 'passenger',
          reasonForTravel: existingByEmployee.get(employee.id)?.reasonForTravel || '',
        })),
        ...external,
      ],
    });
  }

  function updateActivity(id: string, value: Partial<Activity>) {
    if (!form) return;
    patch({ activities: form.activities.map((activity) => (activity.id === id ? { ...activity, ...value } : activity)) });
  }

  function updatePassenger(id: string, value: Partial<Passenger>) {
    if (!form) return;
    patch({ passengers: form.passengers.map((passenger) => (passenger.id === id ? { ...passenger, ...value } : passenger)) });
  }

  function updateDriver(id: string, value: Partial<Driver>) {
    if (!form) return;
    patch({ drivers: form.drivers.map((driver) => (driver.id === id ? { ...driver, ...value } : driver)) });
  }

  function updateRoute(id: string, value: Partial<RouteLeg>) {
    if (!form) return;
    patch({ routes: form.routes.map((route) => (route.id === id ? { ...route, ...value } : route)) });
  }

  async function submit() {
    if (!form || saving) return;
    setError(null);
    if (!form.purpose.trim()) return setError('Purpose is required.');
    if (form.specialAuthorityRequired && !form.specialAuthorityReason.trim()) {
      return setError('Explain why special authority is required.');
    }
    if (form.activities.some((activity) => !activity.title.trim() || !activity.startDate || !activity.endDate)) {
      return setError('Each activity needs a title, start date and end date.');
    }
    if (form.routes.some((route) => !route.originName.trim() || !route.destinationName.trim())) {
      return setError('Each route needs an origin and destination.');
    }
    if (form.passengers.some((passenger) => passenger.type === 'external' && !passenger.externalName.trim())) {
      return setError('Each external traveller needs a full name.');
    }
    if (form.drivers.some((driver) => !driver.employeeId)) {
      return setError('Remove blank driver rows or select an authorised driver.');
    }
    if (form.reason.trim().length < 3) {
      return setError('Summarise what you corrected before resubmitting.');
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/requests/${requestId}/resubmit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: form.reason.trim(),
          purpose: form.purpose.trim(),
          scope: form.scope,
          programmeId: form.programmeId || null,
          specialAuthorityRequired: form.specialAuthorityRequired,
          specialAuthorityReason: form.specialAuthorityReason.trim(),
          driverPreference: form.driverPreference,
          activities: form.activities.map((activity) => ({
            title: activity.title.trim(),
            description: activity.description.trim(),
            venue: activity.venue.trim(),
            startDate: activity.startDate,
            endDate: activity.endDate,
            estimatedKilometres: Number(activity.estimatedKilometres || 0),
          })),
          passengers: form.passengers.map((passenger) => ({
            type: passenger.type,
            employeeId: passenger.type === 'employee' ? passenger.employeeId : undefined,
            externalName: passenger.type === 'external' ? passenger.externalName.trim() : undefined,
            externalIdReference: passenger.externalIdReference.trim(),
            externalOrganisation: passenger.externalOrganisation.trim(),
            externalPhone: passenger.externalPhone.trim(),
            externalEmail: passenger.externalEmail.trim(),
            travellerRole: passenger.travellerRole.trim(),
            reasonForTravel: passenger.reasonForTravel.trim(),
          })),
          drivers: form.drivers.map((driver, index) => ({
            employeeId: driver.employeeId,
            sortOrder: index + 1,
          })),
          routes: form.routes.map((route) => ({
            originName: route.originName.trim(),
            destinationName: route.destinationName.trim(),
            estimatedKm: Number(route.estimatedKm || 0),
            originPlaceId: route.originPlaceId,
            destinationPlaceId: route.destinationPlaceId,
            originCoordinates: route.originCoordinates,
            destinationCoordinates: route.destinationCoordinates,
          })),
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Unable to resubmit request');
      toast({
        title: 'Request resubmitted',
        description: `Revision ${json.revision} is awaiting supervisor review.`,
        variant: 'success',
      });
      router.push(`/dashboard/requests/${requestId}`);
      router.refresh();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Unable to resubmit request';
      setError(message);
      toast({ title: 'Resubmission failed', description: message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-ink-500" role="status">
        <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />
        Loading returned request…
      </div>
    );
  }

  if (!form) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Requests', href: '/dashboard/requests' }, { label: 'Edit & Resubmit' }]} />
        <PageHeader title="Edit & Resubmit" description="Returned transport request" />
        <div className="border-status-error-border bg-status-error-bg text-status-error-text rounded-[8px] border p-4 text-sm" role="alert">
          {error || 'This request cannot be edited.'}
        </div>
        <Button variant="secondary" asChild>
          <Link href="/dashboard/requests"><ArrowLeft className="h-4 w-4" /> Back to Requests</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-24 sm:space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Requests', href: '/dashboard/requests' }, { label: form.reference, href: `/dashboard/requests/${requestId}` }, { label: 'Edit & Resubmit' }]} />
      <PageHeader
        title="Edit & Resubmit"
        description={`${form.reference} · review the returned request, make corrections, then restart approval`}
      >
        <Button variant="secondary" size="sm" asChild className="w-full sm:w-auto">
          <Link href={`/dashboard/requests/${requestId}`}>
            <ArrowLeft className="h-4 w-4" /> Back to Request
          </Link>
        </Button>
      </PageHeader>

      <div className="border-status-pending-border bg-status-pending-bg text-status-pending-text rounded-[8px] border px-4 py-3 text-sm">
        Your previous submitted revision is preserved in the audit history. Changes below affect the next revision only.
      </div>

      {error && (
        <div className="border-status-error-border bg-status-error-bg text-status-error-text rounded-[8px] border px-4 py-3 text-sm" role="alert">
          {error}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Request details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-ink-500 mb-1 block text-xs font-medium">Purpose / Reason for Travel *</label>
            <textarea value={form.purpose} onChange={(event) => patch({ purpose: event.target.value })} rows={4} className={fieldClass()} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-ink-500 mb-1 block text-xs font-medium">Trip scope *</label>
              <StyledSelect value={form.scope} onChange={(event) => patch({ scope: event.target.value as 'regional' | 'national' })}>
                <option value="regional">Regional</option>
                <option value="national">National</option>
              </StyledSelect>
            </div>
            <div>
              <label className="text-ink-500 mb-1 block text-xs font-medium">Approved programme (optional)</label>
              <StyledSelect value={form.programmeId} onChange={(event) => patch({ programmeId: event.target.value })}>
                <option value="">No programme link</option>
                {programmes.map((programme) => (
                  <option key={programme.id} value={programme.id}>{programme.reference} — {programme.title}</option>
                ))}
              </StyledSelect>
            </div>
            <div className="sm:col-span-2">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Driver preference</label>
              <StyledSelect value={form.driverPreference} onChange={(event) => patch({ driverPreference: event.target.value })}>
                <option value="transport_admin_assign">Transport Administrator should assign</option>
                <option value="requester_qualified_driver">I am a qualified driver and may drive</option>
                <option value="preferred_driver">I will suggest a preferred driver</option>
                <option value="no_preference">No preference</option>
              </StyledSelect>
            </div>
          </div>
          <label className="border-border flex items-start gap-3 rounded-[8px] border p-4">
            <input type="checkbox" checked={form.specialAuthorityRequired} onChange={(event) => patch({ specialAuthorityRequired: event.target.checked })} className="border-border text-brand-600 focus:ring-brand-600 mt-0.5 h-4 w-4 rounded" />
            <span>
              <span className="text-ink-950 block text-sm font-medium">Special authority required</span>
              <span className="text-ink-500 text-xs">Use this for exceptional travel requiring additional authority.</span>
            </span>
          </label>
          {form.specialAuthorityRequired && (
            <div>
              <label className="text-ink-500 mb-1 block text-xs font-medium">Reason for special authority *</label>
              <textarea value={form.specialAuthorityReason} onChange={(event) => patch({ specialAuthorityReason: event.target.value })} rows={3} className={fieldClass()} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><CalendarDays className="h-4 w-4" /> Activities</CardTitle>
              <p className="text-ink-500 mt-1 text-xs">Correct dates, venues or activity details requested by the reviewer.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => patch({ activities: [...form.activities, { id: nextId('activity'), title: '', description: '', venue: '', startDate: '', endDate: '', estimatedKilometres: 0 }] })}>
              <Plus className="h-4 w-4" /> Add Activity
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {form.activities.length === 0 ? (
            <p className="border-border text-ink-500 rounded-[8px] border border-dashed p-6 text-center text-sm">No activities recorded.</p>
          ) : form.activities.map((activity, index) => (
            <div key={activity.id} className="border-border rounded-[10px] border p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-ink-500 text-xs font-semibold">Activity {index + 1}</span>
                <Button variant="ghost" size="icon-sm" aria-label="Remove activity" onClick={() => patch({ activities: form.activities.filter((item) => item.id !== activity.id) })}>
                  <Trash2 className="text-status-error-text h-4 w-4" />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-ink-500 text-xs font-medium sm:col-span-2">Title *<input value={activity.title} onChange={(event) => updateActivity(activity.id, { title: event.target.value })} className={`${fieldClass()} mt-1`} /></label>
                <label className="text-ink-500 text-xs font-medium">Venue<input value={activity.venue} onChange={(event) => updateActivity(activity.id, { venue: event.target.value })} className={`${fieldClass()} mt-1`} /></label>
                <label className="text-ink-500 text-xs font-medium">Estimated km<input type="number" min="0" value={activity.estimatedKilometres || ''} onChange={(event) => updateActivity(activity.id, { estimatedKilometres: Number(event.target.value) })} className={`${fieldClass()} mt-1`} /></label>
                <div><label className="text-ink-500 mb-1 block text-xs font-medium">Start date *</label><DatePicker value={activity.startDate} onChange={(value) => updateActivity(activity.id, { startDate: value })} /></div>
                <div><label className="text-ink-500 mb-1 block text-xs font-medium">End date *</label><DatePicker value={activity.endDate} onChange={(value) => updateActivity(activity.id, { endDate: value })} min={activity.startDate || undefined} /></div>
                <label className="text-ink-500 text-xs font-medium sm:col-span-2">Description<textarea value={activity.description} onChange={(event) => updateActivity(activity.id, { description: event.target.value })} rows={2} className={`${fieldClass()} mt-1`} /></label>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" /> Travellers</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div>
            <label className="text-ink-500 mb-2 block text-xs font-medium">Employee travellers</label>
            <EmployeeMultiSelect value={employeePassengers} onChange={setEmployeePassengers} />
          </div>
          <div>
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-ink-500 text-xs font-medium">External travellers</p>
              <Button variant="secondary" size="sm" onClick={() => patch({ passengers: [...form.passengers, { id: nextId('passenger'), type: 'external', employeeId: '', employee: null, externalName: '', externalIdReference: '', externalOrganisation: '', externalPhone: '', externalEmail: '', travellerRole: 'passenger', reasonForTravel: '' }] })}>
                <Plus className="h-4 w-4" /> Add External Traveller
              </Button>
            </div>
            <div className="space-y-3">
              {form.passengers.filter((passenger) => passenger.type === 'external').map((passenger) => (
                <div key={passenger.id} className="border-border rounded-[8px] border p-3">
                  <div className="mb-3 flex items-center justify-between"><span className="text-ink-500 text-xs font-semibold">External traveller</span><Button variant="ghost" size="icon-sm" aria-label="Remove traveller" onClick={() => patch({ passengers: form.passengers.filter((item) => item.id !== passenger.id) })}><Trash2 className="text-status-error-text h-4 w-4" /></Button></div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-ink-500 text-xs font-medium">Full name *<input value={passenger.externalName} onChange={(event) => updatePassenger(passenger.id, { externalName: event.target.value })} className={`${fieldClass()} mt-1`} /></label>
                    <label className="text-ink-500 text-xs font-medium">Organisation<input value={passenger.externalOrganisation} onChange={(event) => updatePassenger(passenger.id, { externalOrganisation: event.target.value })} className={`${fieldClass()} mt-1`} /></label>
                    <label className="text-ink-500 text-xs font-medium">Phone<input value={passenger.externalPhone} onChange={(event) => updatePassenger(passenger.id, { externalPhone: event.target.value })} className={`${fieldClass()} mt-1`} /></label>
                    <label className="text-ink-500 text-xs font-medium">Email<input type="email" value={passenger.externalEmail} onChange={(event) => updatePassenger(passenger.id, { externalEmail: event.target.value })} className={`${fieldClass()} mt-1`} /></label>
                    <label className="text-ink-500 text-xs font-medium">Role on trip<input value={passenger.travellerRole} onChange={(event) => updatePassenger(passenger.id, { travellerRole: event.target.value })} className={`${fieldClass()} mt-1`} /></label>
                    <label className="text-ink-500 text-xs font-medium">Reason for travel<input value={passenger.reasonForTravel} onChange={(event) => updatePassenger(passenger.id, { reasonForTravel: event.target.value })} className={`${fieldClass()} mt-1`} /></label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><CardTitle className="flex items-center gap-2"><UserRound className="h-4 w-4" /> Preferred drivers</CardTitle><p className="text-ink-500 mt-1 text-xs">These remain nominations; Transport Administration makes the final assignment.</p></div>
            <Button variant="secondary" size="sm" onClick={() => patch({ drivers: [...form.drivers, { id: nextId('driver'), employeeId: '', employee: null, sortOrder: form.drivers.length + 1 }] })}><Plus className="h-4 w-4" /> Add Driver</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {form.drivers.length === 0 ? <p className="border-border text-ink-500 rounded-[8px] border border-dashed p-5 text-center text-sm">No preferred driver nominated.</p> : form.drivers.map((driver) => (
            <div key={driver.id} className="border-border flex flex-col gap-2 rounded-[8px] border p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1"><EmployeeCombobox kind="driver" value={driver.employeeId} selectedOption={driver.employee} onSelect={(employee) => updateDriver(driver.id, { employeeId: employee?.id || '', employee })} placeholder="Search authorised drivers…" /></div>
              <Button variant="ghost" size="icon-sm" aria-label="Remove driver" onClick={() => patch({ drivers: form.drivers.filter((item) => item.id !== driver.id) })}><Trash2 className="text-status-error-text h-4 w-4" /></Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><CardTitle className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Route</CardTitle><p className="text-ink-500 mt-1 text-xs">Correct the requested route and distance. Transport Administration verifies final routing.</p></div>
            <Button variant="secondary" size="sm" onClick={() => patch({ routes: [...form.routes, { id: nextId('route'), originName: '', destinationName: '', estimatedKm: 0 }] })}><Plus className="h-4 w-4" /> Add Route</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {form.routes.length === 0 ? <p className="border-border text-ink-500 rounded-[8px] border border-dashed p-5 text-center text-sm">No route legs recorded.</p> : form.routes.map((route, index) => (
            <div key={route.id} className="border-border rounded-[8px] border p-3">
              <div className="mb-3 flex items-center justify-between"><span className="text-ink-500 text-xs font-semibold">Route {index + 1}</span><Button variant="ghost" size="icon-sm" aria-label="Remove route" onClick={() => patch({ routes: form.routes.filter((item) => item.id !== route.id) })}><Trash2 className="text-status-error-text h-4 w-4" /></Button></div>
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_9rem]">
                <label className="text-ink-500 text-xs font-medium">Origin *<input value={route.originName} onChange={(event) => updateRoute(route.id, { originName: event.target.value, originPlaceId: undefined, originCoordinates: null })} className={`${fieldClass()} mt-1`} /></label>
                <label className="text-ink-500 text-xs font-medium">Destination *<input value={route.destinationName} onChange={(event) => updateRoute(route.id, { destinationName: event.target.value, destinationPlaceId: undefined, destinationCoordinates: null })} className={`${fieldClass()} mt-1`} /></label>
                <label className="text-ink-500 text-xs font-medium">Estimated km<input type="number" min="0" value={route.estimatedKm || ''} onChange={(event) => updateRoute(route.id, { estimatedKm: Number(event.target.value) })} className={`${fieldClass()} mt-1`} /></label>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Correction summary</CardTitle></CardHeader>
        <CardContent>
          <label className="text-ink-500 block text-xs font-medium">What did you correct? *</label>
          <textarea value={form.reason} onChange={(event) => patch({ reason: event.target.value })} rows={4} placeholder="Briefly describe the changes you made in response to the review…" className={`${fieldClass()} mt-1`} />
          <p className="text-ink-500 mt-2 text-xs">This note is stored with the revision history and helps the next reviewer understand what changed.</p>
        </CardContent>
      </Card>

      <div className="border-border bg-canvas/95 fixed inset-x-0 bottom-0 z-40 border-t px-4 py-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
        <div className="mx-auto flex max-w-5xl flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" asChild className="w-full sm:w-auto"><Link href={`/dashboard/requests/${requestId}`}>Cancel</Link></Button>
          <Button onClick={submit} loading={saving} disabled={saving} className="w-full sm:w-auto"><Send className="h-4 w-4" /> Resubmit Corrected Request</Button>
        </div>
      </div>
    </div>
  );
}
