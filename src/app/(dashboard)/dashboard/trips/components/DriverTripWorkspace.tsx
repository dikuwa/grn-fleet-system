'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileText,
  MapPin,
  Navigation,
  Phone,
  Play,
  RotateCcw,
  ShieldCheck,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { saveDraft } from '@/lib/offline-drafts';
import { fetchUserProfile, userProfileQueryKey } from '@/lib/user-profile';
import { useToast } from '@/lib/use-toast';
import { computeSha256 } from '@/lib/storage-dedup';

type Action = 'accept' | 'start' | 'return' | 'progress' | 'incident' | null;

interface WorkspaceData {
  trip: {
    id: string;
    status: string;
    vehicleId: string;
    licenceNumber: string;
    make: string;
    model: string;
    requestReference: string;
  };
  authority: {
    id: string;
    authorityNumber: string;
    status: string;
    validFrom: string;
    validUntil: string;
    purpose: string | null;
    origin: string | null;
    destination: string | null;
    approvedRoute: string | null;
    specialConditions: string | null;
    beginningOdometer: number | null;
    endingOdometer: number | null;
  };
  passengers: Array<{ id: string; fullName: string; passengerType: string }>;
  progress: Array<{ id: string; entryType: string; occurredAt: string; location: string | null; note: string | null }>;
  incidents: Array<{ id: string; incidentType: string; occurredAt: string; description: string; safeToContinue: boolean }>;
}

const groupLabels: Record<string, string> = {
  vehicle: 'Vehicle and mechanical',
  route_safety: 'Route and safety',
  security: 'Security',
  other: 'Other',
};

const confirmations = [
  ['vehicleConfirmed', 'The allocated vehicle is correct'],
  ['authorityConfirmed', 'The Trip Authority details are correct'],
  ['routeUnderstood', 'I understand the approved route'],
  ['passengersUnderstood', 'I reviewed the passenger manifest'],
  ['licenceValidConfirmed', 'My driver licence remains valid'],
  ['responsibilityAccepted', 'I accept responsibility for this official trip'],
  ['conditionsReviewed', 'I reviewed all special conditions'],
] as const;

export function DriverTripWorkspace({ tripId }: { tripId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { data: profile } = useQuery({
    queryKey: userProfileQueryKey,
    queryFn: ({ signal }) => fetchUserProfile(signal),
  });

  // Fetch tenant-configurable incident categories
  const { data: categoriesData } = useQuery({
    queryKey: ['incident-categories'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/incident-categories', { signal });
      if (!res.ok) return { data: [] };
      return res.json();
    },
  });

  const categoryGroups = useMemo(() => {
    const map = new Map<string, Array<{ code: string; name: string }>>();
    for (const cat of categoriesData?.data ?? []) {
      const list = map.get(cat.group) || [];
      list.push({ code: cat.code, name: cat.name });
      map.set(cat.group, list);
    }
    return map;
  }, [categoriesData]);

  // Fetch cached emergency contacts for the incident form
  const { data: emergencyContactsData } = useQuery({
    queryKey: ['emergency-contacts'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/emergency-contacts', { signal });
      if (!res.ok) return { data: [] };
      return res.json();
    },
  });

  const contactsByRole = useMemo(() => {
    const map = new Map<string, Array<{ name: string; phone: string }>>();
    for (const contact of emergencyContactsData?.data ?? []) {
      const list = map.get(contact.role) || [];
      list.push({ name: contact.name, phone: contact.phone });
      map.set(contact.role, list);
    }
    return map;
  }, [emergencyContactsData]);

  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [error, setError] = useState('');
  const [incidentFiles, setIncidentFiles] = useState<File[]>([]);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [form, setForm] = useState<Record<string, string | boolean>>({
    fuelLevel: 'half',
    entryType: 'official_stop',
    incidentType: 'mechanical_defect',
    severity: 'minor',
    continuationState: 'safe_to_continue',
    vehicleSafe: true,
    passengerSafe: true,
  });

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/trips/${tripId}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not load active trip');
      setData(json);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load active trip');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const primaryAction = useMemo(() => {
    if (!data?.authority) return null;
    if (data.authority.status === 'awaiting_driver_acceptance') return 'accept';
    // Phase 32: drivers do not perform official inspections — departure and
    // arrival inspections are performed by Inspectors and Release Officers.
    // While the vehicle awaits the pre-trip or arrival inspection the driver
    // waits; incident/defect reporting remains available from the console.
    if (data.authority.status === 'ready_for_departure') return 'start';
    if (['in_progress', 'delayed', 'route_deviation_pending_review', 'incident_reported'].includes(data.authority.status)) return 'return';
    return null;
  }, [data]);

  const patch = (key: string, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

  const submit = useCallback(async () => {
    if (!action || !data) return;
    setWorking(true);
    setError('');
    try {
      let endpoint = `/api/trips/${tripId}/operations`;
      let payload: Record<string, unknown> = { ...form };
      if (action === 'accept') {
        endpoint = `/api/trips/${tripId}/acknowledge`;
      } else if (action === 'start') {
        endpoint = `/api/trips/${tripId}/start`;
        payload = {
          beginningOdometer: Number(form.beginningOdometer),
          fuelLevel: form.fuelLevel,
          passengersConfirmed: form.passengersConfirmed === true,
        };
      } else if (action === 'return') {
        endpoint = `/api/trips/${tripId}/return`;
        payload = {
          endingOdometer: Number(form.endingOdometer),
          fuelLevel: form.fuelLevel,
          returnLocation: form.returnLocation,
          incidentDeclared: form.incidentDeclared === true,
          outstandingReceiptsDeclared: form.outstandingReceiptsDeclared === true,
          comments: form.comments,
        };
      } else {
        payload = {
          ...form,
          action,
          odometerReading: form.odometerReading ? Number(form.odometerReading) : null,
          occurredAt: new Date().toISOString(),
          clientSyncId: crypto.randomUUID(),
          offlineCreatedAt: online ? null : new Date().toISOString(),
        };
      }

      if (!online && (action === 'progress' || action === 'incident')) {
        await saveDraft({
          draftType: action === 'progress' ? 'trip_progress' : 'trip_incident',
          formData: { tripId, ...payload, ...(action === 'incident' ? { attachmentFiles: incidentFiles } : {}) },
          userId: profile?.id || null,
          tenantId: profile?.tenantId || null,
          syncStatus: 'pending',
        });
        toast({ title: 'Saved for sync', description: 'This update will be sent when connectivity returns.', variant: 'success' });
        setAction(null);
        return;
      }

      if (action === 'incident' && incidentFiles.length > 0) {
        const attachmentKeys: string[] = [];
        const attachmentHashes: Record<string, string> = {};
        for (const file of incidentFiles) {
          // Compute SHA-256 client-side so identical photo bytes already in
          // storage are not uploaded a second time.
          const sha256 = await computeSha256(file);

          const dedupRes = await fetch('/api/storage/check-dup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sha256, category: 'trip-incident' }),
          });
          const dedup = dedupRes.ok
            ? await dedupRes.json().catch(() => null)
            : null;
          const existingKey = dedup?.data?.keys?.[0];

          let key: string;
          if (existingKey) {
            key = existingKey;
          } else {
            const uploadBody = new FormData();
            uploadBody.append('file', file);
            uploadBody.append('category', 'trip-incident');
            uploadBody.append('sha256', sha256);
            const upload = await fetch('/api/upload', { method: 'POST', body: uploadBody });
            const uploaded = await upload.json().catch(() => ({}));
            if (!upload.ok || !uploaded.data?.key) throw new Error(uploaded.error || 'Incident attachment upload failed');
            key = uploaded.data.key;
          }

          attachmentKeys.push(key);
          attachmentHashes[key] = sha256;
        }
        payload.attachmentKeys = attachmentKeys;
        payload.attachmentHashes = attachmentHashes;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'The trip update could not be saved');
      toast({ title: 'Trip updated', description: 'The official timeline and audit trail were updated.', variant: 'success' });
      setAction(null);
      setIncidentFiles([]);
      setForm({ fuelLevel: 'half', entryType: 'official_stop', incidentType: 'mechanical_defect', severity: 'minor', continuationState: 'safe_to_continue', vehicleSafe: true, passengerSafe: true });
      await load();
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The trip update could not be saved');
    } finally {
      setWorking(false);
    }
  }, [action, data, form, incidentFiles, load, online, profile, router, toast, tripId]);

  if (loading) return <div className="h-48 animate-pulse rounded-xl border border-border bg-muted" />;
  if (!data?.authority) return null;

  return (
    <>
      <Card className="overflow-hidden border-brand-200">
        <CardHeader className="bg-brand-50/70">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">My Active Trip</p>
              <CardTitle className="mt-1">{data.authority.authorityNumber}</CardTitle>
              <p className="mt-1 text-sm text-ink-600">{data.trip.licenceNumber} · {data.trip.make} {data.trip.model}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={online ? 'success' : 'pending'}>{online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}{online ? 'Online' : 'Offline'}</Badge>
              <Badge variant="info">{data.authority.status.replaceAll('_', ' ')}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-canvas p-3">
              <p className="text-xs text-ink-500">Route</p>
              <p className="mt-1 flex items-center gap-2 text-sm font-medium text-ink-950"><Navigation className="h-4 w-4 text-brand-600" />{data.authority.approvedRoute || 'Approved route'}</p>
            </div>
            <div className="rounded-lg border border-border bg-canvas p-3">
              <p className="text-xs text-ink-500">Expected return</p>
              <p className="mt-1 text-sm font-medium text-ink-950">{new Date(data.authority.validUntil).toLocaleString('en-NA')}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Button variant="secondary" className="w-full sm:w-auto" asChild>
              <Link href={`/dashboard/trips/${tripId}/authority`}><FileText className="h-4 w-4" />Show Authority</Link>
            </Button>
            {primaryAction === 'accept' && <Button className="w-full sm:w-auto" onClick={() => setAction('accept')}><ShieldCheck className="h-4 w-4" />Accept Trip</Button>}
            {primaryAction === 'start' && <Button className="w-full sm:w-auto" onClick={() => setAction('start')}><Play className="h-4 w-4" />Start Trip</Button>}
            {primaryAction === 'return' && <Button className="w-full sm:w-auto" onClick={() => setAction('return')}><RotateCcw className="h-4 w-4" />Complete Trip</Button>}
            {data.trip.status === 'in_progress' && (
              <>
                <Button variant="secondary" className="w-full sm:w-auto" onClick={() => setAction('progress')}><MapPin className="h-4 w-4" />Add Stop</Button>
                <Button variant="secondary" className="w-full sm:w-auto" asChild><Link href={`/dashboard/fuel/new?tripId=${tripId}&vehicle=${encodeURIComponent(data.trip.licenceNumber)}`}><Camera className="h-4 w-4" />Fuel Receipt</Link></Button>
                <Button variant="emergency" className="w-full sm:w-auto" onClick={() => setAction('incident')}><AlertTriangle className="h-4 w-4" />Report incident, damage or defect</Button>
              </>
            )}
          </div>
          {error && <p role="alert" className="rounded-lg border border-status-error-border bg-status-error-bg px-3 py-2 text-sm text-status-error-text">{error}</p>}
        </CardContent>
      </Card>

      <Dialog open={action !== null} onOpenChange={(open) => !open && setAction(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{actionTitle(action)}</DialogTitle>
            <DialogDescription>Required information is recorded in the official Trip Authority audit trail.</DialogDescription>
          </DialogHeader>

          {action === 'accept' && (
            <div className="space-y-3">
              {confirmations.map(([key, label]) => (
                <label key={key} className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm text-ink-800">
                  <input type="checkbox" checked={form[key] === true} onChange={(event) => patch(key, event.target.checked)} className="h-5 w-5 accent-brand-700" />
                  {label}
                </label>
              ))}
              <div>
                <Label>Signature / full name</Label>
                <Input value={String(form.signature || '')} onChange={(event) => patch('signature', event.target.value)} autoComplete="name" />
                {form.signature && String(form.signature).length > 1 && (
                  <div className="mt-2 rounded-[8px] border border-border bg-white p-4 text-center dark:bg-white/5">
                    <p className="font-signature text-3xl text-gray-900 dark:text-ink-100">{String(form.signature)}</p>
                    <p className="mt-1 text-xs text-ink-400">Signature preview — rendered in Allura font</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {action === 'start' && (
            <div className="space-y-4">
              <div><Label required>Beginning odometer</Label><Input inputMode="numeric" type="number" className="h-14 text-xl" value={String(form.beginningOdometer || '')} onChange={(event) => patch('beginningOdometer', event.target.value)} /></div>
              <FuelLevel value={String(form.fuelLevel)} onChange={(value) => patch('fuelLevel', value)} />
              <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-brand-700" checked={form.passengersConfirmed === true} onChange={(event) => patch('passengersConfirmed', event.target.checked)} />Actual passengers match the approved manifest</label>
            </div>
          )}

          {action === 'return' && (
            <div className="space-y-4">
              <div><Label required>Ending odometer</Label><Input inputMode="numeric" type="number" className="h-14 text-xl" value={String(form.endingOdometer || '')} onChange={(event) => patch('endingOdometer', event.target.value)} /></div>
              <FuelLevel value={String(form.fuelLevel)} onChange={(value) => patch('fuelLevel', value)} />
              <div><Label required>Return location</Label><Input value={String(form.returnLocation || '')} onChange={(event) => patch('returnLocation', event.target.value)} /></div>
              <BooleanDeclaration label="Any incident or accident to declare?" value={form.incidentDeclared === true} onChange={(value) => patch('incidentDeclared', value)} />
              <BooleanDeclaration label="Any outstanding receipts?" value={form.outstandingReceiptsDeclared === true} onChange={(value) => patch('outstandingReceiptsDeclared', value)} />
              <div><Label>Driver comments</Label><Textarea value={String(form.comments || '')} onChange={(event) => patch('comments', event.target.value)} /></div>
            </div>
          )}

          {action === 'progress' && (
            <div className="space-y-4">
              <div><Label required>Stop type</Label><StyledSelect value={String(form.entryType)} onChange={(event) => patch('entryType', event.target.value)}><option value="official_stop">Official stop</option><option value="passenger_pickup">Passenger pickup</option><option value="passenger_drop_off">Passenger drop-off</option><option value="fuel_stop">Fuel stop</option><option value="destination_reached">Destination reached</option><option value="route_deviation">Route deviation</option><option value="breakdown">Breakdown</option></StyledSelect></div>
              <div><Label>Location</Label><Input value={String(form.location || '')} onChange={(event) => patch('location', event.target.value)} /></div>
              <div><Label>Odometer</Label><Input inputMode="numeric" type="number" value={String(form.odometerReading || '')} onChange={(event) => patch('odometerReading', event.target.value)} /></div>
              {form.entryType === 'route_deviation' && <div><Label required>Deviation reason</Label><Textarea value={String(form.routeDeviationReason || '')} onChange={(event) => patch('routeDeviationReason', event.target.value)} /></div>}
              <div><Label>Note</Label><Textarea value={String(form.note || '')} onChange={(event) => patch('note', event.target.value)} /></div>
            </div>
          )}

          {action === 'incident' && (
            <div className="space-y-4">
              {form.severity === 'critical' && (
                <div role="alert" className="rounded-lg border-2 border-status-error-text bg-status-error-bg p-3 text-sm font-semibold text-status-error-text">
                  Stop the vehicle safely where possible. Do not continue driving. Contact emergency services and the Transport Office using the approved contact details.
                </div>
              )}
              {contactsByRole.size > 0 && (
                <div className="rounded-lg border border-border bg-surface-hover p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
                    <Phone className="h-3.5 w-3.5" /> Emergency contacts
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {Array.from(contactsByRole.entries()).map(([role, contacts]) => (
                      <div key={role} className="text-xs">
                        <p className="font-medium text-ink-700">
                          {role === 'hospital' ? 'Hospital / Ambulance'
                            : role === 'police' ? 'Police'
                            : role === 'towing' ? 'Towing / Recovery'
                            : role === 'fire' ? 'Fire / Rescue'
                            : role === 'insurance' ? 'Insurance'
                            : role === 'internal' ? 'Transport Office'
                            : role}
                        </p>
                        {contacts.map((contact) => (
                          <p key={contact.phone + contact.name} className="text-ink-500">
                            <a href={`tel:${contact.phone.replace(/\s/g, '')}`} className="text-brand-700 underline-offset-2 hover:underline">
                              {contact.phone}
                            </a>{' '}
                            · {contact.name}
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div><Label required>Event type</Label><StyledSelect value={String(form.incidentType)} onChange={(event) => patch('incidentType', event.target.value)}>
                {categoryGroups.size > 0 ? (
                  Array.from(categoryGroups.entries()).map(([group, cats]) => (
                    <optgroup key={group} label={groupLabels[group] ?? group}>
                      {cats.map((cat) => <option key={cat.code} value={cat.code}>{cat.name}</option>)}
                    </optgroup>
                  ))
                ) : (
                  <>
                    <optgroup label="Vehicle and mechanical"><option value="mechanical_defect">Mechanical defect</option><option value="electrical_defect">Electrical defect</option><option value="tyre_failure">Tyre failure</option><option value="breakdown">Breakdown</option><option value="physical_vehicle_damage">Physical vehicle damage</option><option value="warning_light">Warning light</option><option value="fuel_leak_issue">Fuel leak or fuel issue</option><option value="fire_smoke">Fire or smoke</option></optgroup>
                    <optgroup label="Accident and people"><option value="accident_collision">Accident or collision</option><option value="near_miss">Near miss</option><option value="passenger_injury">Passenger injury</option><option value="driver_injury">Driver injury</option><option value="third_party_injury">Third-party injury</option><option value="third_party_vehicle_damage">Third-party vehicle damage</option><option value="property_damage">Property damage</option></optgroup>
                    <optgroup label="Route and safety"><option value="unsafe_road_condition">Unsafe road condition</option><option value="route_obstruction">Route obstruction</option><option value="weather_hazard">Weather hazard</option><option value="security_incident">Security incident</option><option value="theft_attempted_theft">Theft or attempted theft</option><option value="traffic_offence">Traffic offence</option><option value="police_intervention">Police intervention</option><option value="other_safety_incident">Other safety incident</option></optgroup>
                  </>
                )}
              </StyledSelect></div>
              <div><Label required>Severity</Label><StyledSelect value={String(form.severity)} onChange={(event) => patch('severity', event.target.value)}><option value="minor">Minor</option><option value="moderate">Moderate</option><option value="serious">Serious</option><option value="critical">Critical</option></StyledSelect></div>
              <div><Label required>Description</Label><Textarea value={String(form.description || '')} onChange={(event) => patch('description', event.target.value)} /></div>
              <div><Label>Location</Label><Input value={String(form.location || '')} onChange={(event) => patch('location', event.target.value)} /></div>
              <div><Label>Odometer reading</Label><Input inputMode="numeric" type="number" placeholder="Odometer at the time of the event" value={String(form.odometerReading || '')} onChange={(event) => patch('odometerReading', event.target.value)} /></div>
              <div><Label required>Journey continuation</Label><StyledSelect value={String(form.continuationState)} onChange={(event) => patch('continuationState', event.target.value)}><option value="safe_to_continue">Safe to continue</option><option value="continue_with_caution">Safe to continue with caution</option><option value="temporary_repair_completed">Temporary repair completed</option><option value="waiting_for_assistance">Waiting for assistance</option><option value="recovery_required">Recovery required</option><option value="replacement_vehicle_required">Replacement vehicle required</option><option value="trip_suspended">Trip suspended</option><option value="trip_terminated">Trip terminated</option></StyledSelect></div>
              <BooleanDeclaration label="Vehicle safe?" value={form.vehicleSafe === true} onChange={(value) => patch('vehicleSafe', value)} />
              <BooleanDeclaration label="Passengers safe?" value={form.passengerSafe === true} onChange={(value) => patch('passengerSafe', value)} />
              <BooleanDeclaration label="Any injuries?" value={form.injuries === true} onChange={(value) => patch('injuries', value)} />
              {form.injuries === true && <div><Label required>Number injured</Label><Input inputMode="numeric" type="number" min="1" value={String(form.numberInjured || '1')} onChange={(event) => patch('numberInjured', event.target.value)} /></div>}
              <BooleanDeclaration label="Vehicle damage?" value={form.vehicleDamage === true} onChange={(value) => patch('vehicleDamage', value)} />
              <div>
                <Label>Photos or supporting files</Label>
                <Input type="file" accept="image/*,.pdf" multiple onChange={(event) => setIncidentFiles(Array.from(event.target.files || []))} />
                {incidentFiles.length > 0 && <p className="mt-1 text-xs text-ink-500">{incidentFiles.length} file{incidentFiles.length === 1 ? '' : 's'} retained {online ? 'for upload' : 'on this device until sync succeeds'}.</p>}
              </div>
              <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-brand-700" checked={form.rapidReport === true} onChange={(event) => patch('rapidReport', event.target.checked)} />Emergency report — save now and complete additional details later</label>
            </div>
          )}

          <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 bg-surface px-6 py-4">
            <Button variant="secondary" onClick={() => setAction(null)}>Cancel</Button>
            <Button variant={action === 'incident' ? 'emergency' : 'primary'} loading={working} onClick={submit}>
              {online ? <CheckCircle2 className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
              {online ? 'Save Update' : 'Save for Sync'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function actionTitle(action: Action) {
  return {
    accept: 'Accept Trip Authority',
    start: 'Start Official Trip',
    return: 'Record Vehicle Return',
    progress: 'Add Trip Progress',
    incident: 'Report incident, damage or defect',
  }[action ?? 'progress'];
}

function FuelLevel({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div><Label required>Fuel level</Label><StyledSelect value={value} onChange={(event) => onChange(event.target.value)}><option value="empty">Empty</option><option value="quarter">¼ tank</option><option value="half">½ tank</option><option value="three_quarters">¾ tank</option><option value="full">Full</option></StyledSelect></div>;
}

function BooleanDeclaration({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-ink-700">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant={value ? 'primary' : 'secondary'} onClick={() => onChange(true)}>Yes</Button>
        <Button type="button" variant={!value ? 'primary' : 'secondary'} onClick={() => onChange(false)}>No</Button>
      </div>
    </fieldset>
  );
}
