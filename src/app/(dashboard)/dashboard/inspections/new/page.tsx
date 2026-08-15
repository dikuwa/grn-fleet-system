'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { StyledSelect } from '@/components/ui/styled-select';
import { Camera, CheckCircle2, ChevronLeft, ClipboardCheck, Loader2, Trash2, XCircle } from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { saveDraft } from '@/lib/offline-drafts';
import { fetchUserProfile, userProfileQueryKey } from '@/lib/user-profile';

type InspectionType = 'departure' | 'return';
type Result = '' | 'pass' | 'fail' | 'not_applicable';

type ContextTrip = {
  id: string;
  status: string;
  vehicleId: string;
  requestReference: string;
  make: string;
  model: string;
  licenceNumber: string;
  currentOdometer: number;
  driverKind: 'internal' | 'external';
};

type ContextVehicle = {
  id: string;
  licenceNumber: string;
  make: string;
  model: string;
  currentOdometer: number;
};

type ChecklistItem = {
  id: string;
  sortOrder: number;
  category: string;
  label: string;
  requiresPhoto: boolean;
  isCritical: boolean;
  result: Result;
  comment: string;
};

type InspectionContext = {
  type: InspectionType;
  template: {
    id: string;
    name: string;
    version: number;
    items: Array<Omit<ChecklistItem, 'result' | 'comment'>>;
  };
  requiredPhotoCount: number;
  trips: ContextTrip[];
  vehicles: ContextVehicle[];
};

const CATEGORY_LABELS: Record<string, string> = {
  exterior: 'Exterior',
  interior: 'Interior',
  tyres: 'Tyres & Wheels',
  lights: 'Lights & Electrical',
  documents: 'Documents & Compliance',
  safety: 'Safety Equipment',
  fuel: 'Fuel',
  equipment: 'Equipment',
};

export default function NewInspectionPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { data: profile } = useQuery({
    queryKey: userProfileQueryKey,
    queryFn: ({ signal }) => fetchUserProfile(signal),
  });

  const [type, setType] = useState<InspectionType>('departure');
  const [context, setContext] = useState<InspectionContext | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [vehicleId, setVehicleId] = useState('');
  const [tripId, setTripId] = useState('');
  const [odometerReading, setOdometerReading] = useState('');
  const [fuelLevel, setFuelLevel] = useState('');
  const [notes, setNotes] = useState('');
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [photos, setPhotos] = useState<Array<{ file: File; preview: string }>>([]);
  const [inspectorAcknowledged, setInspectorAcknowledged] = useState(false);
  const [driverAcknowledged, setDriverAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedType = params.get('type');
    if (requestedType === 'departure' || requestedType === 'return') setType(requestedType);
    const requestedTrip = params.get('tripId');
    if (requestedTrip) setTripId(requestedTrip);
    const requestedVehicle = params.get('vehicleId');
    if (requestedVehicle) setVehicleId(requestedVehicle);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setContextLoading(true);
    setError(null);
    fetch(`/api/inspections/context?type=${type}`, { cache: 'no-store' })
      .then(async (response) => {
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json.error || 'Unable to load inspection context');
        return json as InspectionContext;
      })
      .then((json) => {
        if (cancelled) return;
        setContext(json);
        setChecklist(
          json.template.items.map((item) => ({
            ...item,
            result: '' as const,
            comment: '',
          })),
        );
        setPhotos((current) => {
          current.forEach((photo) => URL.revokeObjectURL(photo.preview));
          return [];
        });
        setInspectorAcknowledged(false);
        setDriverAcknowledged(false);
      })
      .catch((reason) => {
        if (!cancelled) {
          setContext(null);
          setChecklist([]);
          setError(reason instanceof Error ? reason.message : 'Unable to load inspection context');
        }
      })
      .finally(() => {
        if (!cancelled) setContextLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [type]);

  useEffect(() => {
    const trip = context?.trips.find((candidate) => candidate.id === tripId);
    if (!trip) return;
    setVehicleId(trip.vehicleId);
    setOdometerReading((current) => current || String(trip.currentOdometer));
  }, [context, tripId]);

  useEffect(() => () => photos.forEach((photo) => URL.revokeObjectURL(photo.preview)), [photos]);

  const groupedItems = useMemo(() => {
    return checklist.reduce<Record<string, ChecklistItem[]>>((groups, item) => {
      (groups[item.category] ??= []).push(item);
      return groups;
    }, {});
  }, [checklist]);

  const failedCount = checklist.filter((item) => item.result === 'fail').length;
  const criticalFailed = checklist.some((item) => item.isCritical && item.result === 'fail');
  const unassessedCount = checklist.filter((item) => !item.result).length;
  const assessedCount = checklist.length - unassessedCount;
  const requiredPhotoCount = context?.requiredPhotoCount ?? 0;
  const selectedTrip = context?.trips.find((trip) => trip.id === tripId) ?? null;

  function updateResult(id: string, result: Result) {
    setChecklist((items) => items.map((item) => (
      item.id === id ? { ...item, result, comment: result === 'fail' ? item.comment : '' } : item
    )));
  }

  function updateComment(id: string, comment: string) {
    setChecklist((items) => items.map((item) => item.id === id ? { ...item, comment } : item));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const draftData = {
      vehicleId,
      tripRef: tripId,
      odometerReading,
      fuelLevel,
      checklist: checklist.map(({ label, result, comment }) => ({ label, result, comment })),
      notes,
      photos: photos.map((photo) => photo.file),
      inspectorAcknowledged,
      driverAcknowledged,
    };

    try {
      if (!context) throw new Error('Inspection context is not available');
      if (!tripId || !vehicleId) throw new Error('Select an eligible trip before submitting');
      if (unassessedCount > 0) {
        throw new Error(`Assess every checklist item before submitting. ${unassessedCount} item${unassessedCount === 1 ? '' : 's'} remaining.`);
      }
      if (photos.length < requiredPhotoCount) {
        throw new Error(`At least ${requiredPhotoCount} evidence photo${requiredPhotoCount === 1 ? '' : 's'} required`);
      }
      const failedWithoutComment = checklist.find((item) => item.result === 'fail' && !item.comment.trim());
      if (failedWithoutComment) throw new Error(`Describe the defect for “${failedWithoutComment.label}”`);

      const photoKeys: string[] = [];
      for (const photo of photos) {
        const form = new FormData();
        form.append('file', photo.file);
        form.append('category', 'inspection');
        const upload = await fetch('/api/upload', { method: 'POST', body: form });
        const uploaded = await upload.json().catch(() => ({}));
        if (!upload.ok || !uploaded.data?.key) {
          throw new Error(uploaded.error || 'An inspection photo could not be uploaded');
        }
        photoKeys.push(uploaded.data.key);
      }

      const response = await fetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId,
          tripId,
          type,
          odometerReading: Number(odometerReading),
          fuelLevel: fuelLevel || null,
          checklist: checklist.map(({ label, result, comment }) => ({
            label,
            result,
            comment: comment.trim() || null,
          })),
          notes: notes.trim() || null,
          photoKeys,
          inspectorAcknowledged,
          driverAcknowledged,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Failed to submit inspection');

      toast({
        title: 'Inspection submitted',
        description: `${checklist.length - failedCount} clear · ${failedCount} failed`,
        variant: criticalFailed ? 'error' : 'success',
      });
      router.push('/dashboard/inspections');
    } catch (reason) {
      const networkFailure = !navigator.onLine || reason instanceof TypeError;
      if (networkFailure) {
        await saveDraft({
          draftType: type === 'departure' ? 'inspection_departure' : 'inspection_return',
          formData: draftData,
          userId: profile?.id || null,
          tenantId: profile?.tenantId || null,
          syncStatus: 'pending',
        });
        toast({
          title: 'Inspection saved offline',
          description: 'It will sync automatically when connectivity returns.',
          variant: 'success',
        });
        router.push('/dashboard/offline');
      } else {
        const message = reason instanceof Error ? reason.message : 'Could not submit inspection';
        setError(message);
        toast({ title: 'Inspection failed', description: message, variant: 'error' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Inspections', href: '/dashboard/inspections' },
        { label: 'Perform Inspection' },
      ]} />
      <PageHeader
        title={type === 'departure' ? 'Departure Inspection' : 'Return Inspection'}
        description={context ? `${context.template.name} · version ${context.template.version}` : 'Official vehicle inspection'}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/inspections"><ChevronLeft className="h-4 w-4" /> Back to Inspections</Link>
        </Button>
      </PageHeader>

      {error && <div className="rounded-[10px] border border-status-error-bg bg-status-error-bg/20 px-4 py-3 text-sm text-status-error-text">{error}</div>}

      {contextLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-ink-400" /></div>
      ) : !context ? (
        <Card><CardContent className="py-10 text-center text-sm text-ink-500">Inspection setup is unavailable. Ask the Transport Administrator to verify the active inspection template.</CardContent></Card>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Inspection Assignment</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-500">Inspection Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['departure', 'return'] as const).map((value) => (
                    <button key={value} type="button" onClick={() => { setType(value); setTripId(''); setVehicleId(''); setOdometerReading(''); }} className={`focus-ring rounded-[8px] border px-3 py-2 text-sm font-medium capitalize transition-colors ${type === value ? 'border-brand-700 bg-brand-50 text-brand-700 dark:bg-brand-950/30' : 'border-border bg-surface text-ink-600 hover:bg-muted'}`}>{value}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-500">Eligible Trip <span className="text-status-error-text">*</span></label>
                <StyledSelect value={tripId} onChange={(event) => setTripId(event.target.value)} required placeholder="Select an eligible trip…">
                  {context.trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.requestReference} — {trip.licenceNumber} — {trip.make} {trip.model} — {trip.driverKind === 'external' ? 'External driver' : 'Internal driver'}</option>)}
                </StyledSelect>
                {selectedTrip && (
                  <p className="mt-1.5 text-xs text-ink-500">
                    Driver type: <span className="font-medium text-ink-700">{selectedTrip.driverKind === 'external' ? 'External driver' : 'Internal driver'}</span>
                  </p>
                )}
                {context.trips.length === 0 && <p className="mt-1.5 text-xs text-ink-500">No trips currently satisfy the {type} inspection lifecycle.</p>}
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-500">Vehicle</label>
                <StyledSelect value={vehicleId} disabled placeholder="Selected from trip">
                  {context.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.licenceNumber} — {vehicle.make} {vehicle.model}</option>)}
                </StyledSelect>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-500">Odometer (km) <span className="text-status-error-text">*</span></label>
                <input type="number" min="0" required value={odometerReading} onChange={(event) => setOdometerReading(event.target.value)} className="focus-ring h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-500">Fuel Level</label>
                <StyledSelect value={fuelLevel} onChange={(event) => setFuelLevel(event.target.value)} placeholder="Select level…">
                  <option value="full">Full</option><option value="three_quarters">¾</option><option value="half">½</option><option value="quarter">¼</option><option value="empty">Empty</option>
                </StyledSelect>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-500">Notes</label>
                <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} className="focus-ring min-h-20 w-full resize-y rounded-[8px] border border-border bg-surface px-3 py-2 text-sm text-ink-950" placeholder="Additional observations…" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                <span>Checklist</span>
                <span className="flex flex-wrap items-center gap-2">
                  {unassessedCount > 0 && <Badge variant="pending" size="sm">{unassessedCount} remaining</Badge>}
                  {failedCount > 0 && <Badge variant={criticalFailed ? 'emergency' : 'error'} size="sm">{failedCount} failed</Badge>}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-[8px] border border-border bg-muted/30 px-3 py-2 text-xs text-ink-600">
                Assess every checklist item explicitly as Pass, Fail, or N/A. Items are intentionally left unselected when the form opens.
              </div>
              {Object.entries(groupedItems).map(([category, items]) => (
                <section key={category}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">{CATEGORY_LABELS[category] ?? category}</h3>
                  <div className="space-y-2">
                    {items.map((item) => (
                      <div key={item.id} className={`rounded-[8px] border p-3 ${item.result === 'fail' ? 'border-status-error-bg bg-status-error-bg/10' : !item.result ? 'border-status-pending-border bg-status-pending-bg/10' : 'border-border bg-surface'}`}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0"><p className="text-sm font-medium text-ink-950">{item.label}</p><div className="mt-1 flex gap-1.5">{item.isCritical && <Badge variant="emergency" size="sm">Critical</Badge>}{item.requiresPhoto && <Badge variant="info" size="sm">Photo evidence</Badge>}{!item.result && <Badge variant="pending" size="sm">Assessment required</Badge>}</div></div>
                          <div className="flex flex-wrap gap-1.5">
                            <button type="button" onClick={() => updateResult(item.id, 'pass')} className={`focus-ring inline-flex items-center gap-1 rounded-[6px] px-2.5 py-1.5 text-xs font-medium ${item.result === 'pass' ? 'bg-status-success-bg text-status-success-text' : 'bg-muted text-ink-500'}`}><CheckCircle2 className="h-3.5 w-3.5" /> Pass</button>
                            <button type="button" onClick={() => updateResult(item.id, 'fail')} className={`focus-ring inline-flex items-center gap-1 rounded-[6px] px-2.5 py-1.5 text-xs font-medium ${item.result === 'fail' ? 'bg-status-error-bg text-status-error-text' : 'bg-muted text-ink-500'}`}><XCircle className="h-3.5 w-3.5" /> Fail</button>
                            <button type="button" onClick={() => updateResult(item.id, 'not_applicable')} className={`focus-ring rounded-[6px] px-2.5 py-1.5 text-xs font-medium ${item.result === 'not_applicable' ? 'bg-muted text-ink-950 ring-1 ring-border' : 'bg-muted/60 text-ink-500'}`}>N/A</button>
                          </div>
                        </div>
                        {item.result === 'fail' && <input value={item.comment} onChange={(event) => updateComment(item.id, event.target.value)} required placeholder="Describe the defect…" className="focus-ring mt-3 h-9 w-full rounded-[6px] border border-border bg-surface px-2.5 text-xs text-ink-950" />}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Evidence Photos</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {photos.length > 0 && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{photos.map((photo, index) => <div key={`${photo.file.name}-${index}`} className="group relative overflow-hidden rounded-[8px] border border-border"><img src={photo.preview} alt={`Inspection evidence ${index + 1}`} className="h-24 w-full object-cover" /><button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => setPhotos((items) => { const target = items[index]; if (target) URL.revokeObjectURL(target.preview); return items.filter((_, itemIndex) => itemIndex !== index); })} className="focus-ring absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white"><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div>}
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(event) => { const files = Array.from(event.target.files || []); setPhotos((items) => [...items, ...files.map((file) => ({ file, preview: URL.createObjectURL(file) }))]); if (fileInputRef.current) fileInputRef.current.value = ''; }} />
              <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}><Camera className="h-4 w-4" /> {photos.length ? 'Add Photos' : 'Take / Upload Photos'}</Button><span className="text-xs text-ink-500">{photos.length} selected · minimum {requiredPhotoCount}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-4">
              <p className="text-sm font-medium text-ink-950">Required acknowledgements</p>
              <label className="flex items-start gap-2 text-sm text-ink-700"><input className="mt-1" type="checkbox" checked={inspectorAcknowledged} onChange={(event) => setInspectorAcknowledged(event.target.checked)} /><span>I confirm that I performed this inspection and the recorded results are accurate.</span></label>
              <label className="flex items-start gap-2 text-sm text-ink-700"><input className="mt-1" type="checkbox" checked={driverAcknowledged} onChange={(event) => setDriverAcknowledged(event.target.checked)} /><span>The assigned driver is present and has reviewed the recorded vehicle condition. This is witnessed by the Inspector and is not an authenticated Driver signature.</span></label>
            </CardContent>
          </Card>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-ink-500">{assessedCount}/{checklist.length} assessed · {checklist.filter((item) => item.result === 'pass').length} passed · {failedCount} failed · {checklist.filter((item) => item.result === 'not_applicable').length} N/A</p>
            <div className="flex items-center gap-2"><Button variant="secondary" size="sm" asChild><Link href="/dashboard/inspections">Cancel</Link></Button><Button variant="primary" size="sm" type="submit" loading={submitting} disabled={submitting || !tripId || unassessedCount > 0 || !inspectorAcknowledged || !driverAcknowledged || photos.length < requiredPhotoCount}><ClipboardCheck className="h-4 w-4" /> Submit Inspection</Button></div>
          </div>
        </form>
      )}
    </div>
  );
}