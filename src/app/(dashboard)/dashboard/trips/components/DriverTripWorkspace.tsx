'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  MapPin,
  Navigation,
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
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [form, setForm] = useState<Record<string, string | boolean>>({
    fuelLevel: 'half',
    entryType: 'official_stop',
    incidentType: 'breakdown',
    safeToContinue: true,
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
    if (['driver_accepted', 'awaiting_pre_trip_inspection'].includes(data.authority.status)) return 'inspection';
    if (data.authority.status === 'ready_for_departure') return 'start';
    if (['in_progress', 'delayed', 'route_deviation_pending_review', 'incident_reported'].includes(data.authority.status)) return 'return';
    if (data.authority.status === 'awaiting_arrival_inspection') return 'arrival';
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
          formData: { tripId, ...payload },
          userId: profile?.id || null,
          tenantId: profile?.tenantId || null,
          syncStatus: 'pending',
        });
        toast({ title: 'Saved for sync', description: 'This update will be sent when connectivity returns.', variant: 'success' });
        setAction(null);
        return;
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
      setForm({ fuelLevel: 'half', entryType: 'official_stop', incidentType: 'breakdown', safeToContinue: true });
      await load();
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The trip update could not be saved');
    } finally {
      setWorking(false);
    }
  }, [action, data, form, load, online, profile, router, toast, tripId]);

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
            {primaryAction === 'inspection' && <Button className="w-full sm:w-auto" asChild><Link href={`/dashboard/inspections/new?type=departure&tripId=${tripId}&vehicleId=${data.trip.vehicleId}`}><ClipboardCheck className="h-4 w-4" />Start Inspection</Link></Button>}
            {primaryAction === 'start' && <Button className="w-full sm:w-auto" onClick={() => setAction('start')}><Play className="h-4 w-4" />Start Trip</Button>}
            {primaryAction === 'return' && <Button className="w-full sm:w-auto" onClick={() => setAction('return')}><RotateCcw className="h-4 w-4" />Complete Trip</Button>}
            {primaryAction === 'arrival' && <Button className="w-full sm:w-auto" asChild><Link href={`/dashboard/inspections/new?type=return&tripId=${tripId}&vehicleId=${data.trip.vehicleId}`}><ClipboardCheck className="h-4 w-4" />Arrival Inspection</Link></Button>}
            {data.trip.status === 'in_progress' && (
              <>
                <Button variant="secondary" className="w-full sm:w-auto" onClick={() => setAction('progress')}><MapPin className="h-4 w-4" />Add Stop</Button>
                <Button variant="secondary" className="w-full sm:w-auto" asChild><Link href={`/dashboard/fuel/new?tripId=${tripId}&vehicle=${encodeURIComponent(data.trip.licenceNumber)}`}><Camera className="h-4 w-4" />Fuel Receipt</Link></Button>
                <Button variant="emergency" className="w-full sm:w-auto" onClick={() => setAction('incident')}><AlertTriangle className="h-4 w-4" />Report Incident</Button>
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
              <div><Label>Signature / full name</Label><Input value={String(form.signature || '')} onChange={(event) => patch('signature', event.target.value)} autoComplete="name" /></div>
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
              <div><Label required>Incident type</Label><StyledSelect value={String(form.incidentType)} onChange={(event) => patch('incidentType', event.target.value)}><option value="accident">Accident</option><option value="breakdown">Breakdown</option><option value="tyre_damage">Tyre damage</option><option value="vehicle_defect">Vehicle defect</option><option value="passenger_emergency">Passenger emergency</option><option value="road_closure">Road closure</option><option value="other">Other</option></StyledSelect></div>
              <div><Label required>Description</Label><Textarea value={String(form.description || '')} onChange={(event) => patch('description', event.target.value)} /></div>
              <div><Label>Location</Label><Input value={String(form.location || '')} onChange={(event) => patch('location', event.target.value)} /></div>
              <BooleanDeclaration label="Vehicle remains safe to continue?" value={form.safeToContinue === true} onChange={(value) => patch('safeToContinue', value)} />
              <BooleanDeclaration label="Any injuries?" value={form.injuries === true} onChange={(value) => patch('injuries', value)} />
              <BooleanDeclaration label="Vehicle damage?" value={form.vehicleDamage === true} onChange={(value) => patch('vehicleDamage', value)} />
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
    incident: 'Report Incident',
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
