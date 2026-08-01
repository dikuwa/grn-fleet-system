'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { ChevronLeft, CheckCircle2, AlertTriangle, WifiOff, Truck, Camera, Trash2, History } from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import Link from 'next/link';
import { saveDraft } from '@/lib/offline-drafts';
import { fetchUserProfile, userProfileQueryKey } from '@/lib/user-profile';

interface ChecklistItem {
  id: string;
  category: string;
  label: string;
  isCritical: boolean;
  result: 'pass' | 'fail' | 'na';
  defectDescription: string;
  defectSeverity: 'informational' | 'minor' | 'major' | 'critical';
  isBlocking: boolean;
}

const DEFAULT_CHECKLIST: ChecklistItem[] = [
  // Exterior
  { id: 'ret-ext-1', category: 'exterior', label: 'Body panels — check for new damage', isCritical: false, result: 'na' as const, defectDescription: '', defectSeverity: 'minor', isBlocking: false },
  { id: 'ret-ext-2', category: 'exterior', label: 'Windscreen — no new cracks', isCritical: true, result: 'na' as const, defectDescription: '', defectSeverity: 'major', isBlocking: false },
  { id: 'ret-ext-3', category: 'exterior', label: 'Mirrors — present and undamaged', isCritical: false, result: 'na' as const, defectDescription: '', defectSeverity: 'minor', isBlocking: false },
  // Tyres
  { id: 'ret-tyr-1', category: 'tyres', label: 'Tyre condition — no new damage', isCritical: true, result: 'na' as const, defectDescription: '', defectSeverity: 'critical', isBlocking: false },
  { id: 'ret-tyr-2', category: 'tyres', label: 'Spare wheel — still present', isCritical: false, result: 'na' as const, defectDescription: '', defectSeverity: 'minor', isBlocking: false },
  // Interior
  { id: 'ret-int-1', category: 'interior', label: 'Interior — clean, no damage', isCritical: false, result: 'na' as const, defectDescription: '', defectSeverity: 'minor', isBlocking: false },
  { id: 'ret-int-2', category: 'interior', label: 'Seat belts — all functional', isCritical: true, result: 'na' as const, defectDescription: '', defectSeverity: 'critical', isBlocking: false },
  // Equipment
  { id: 'ret-eq-1', category: 'equipment', label: 'Fire extinguisher — present', isCritical: true, result: 'na' as const, defectDescription: '', defectSeverity: 'critical', isBlocking: false },
  { id: 'ret-eq-2', category: 'equipment', label: 'First aid kit — present', isCritical: false, result: 'na' as const, defectDescription: '', defectSeverity: 'minor', isBlocking: false },
  { id: 'ret-eq-3', category: 'equipment', label: 'Warning triangle — present', isCritical: false, result: 'na' as const, defectDescription: '', defectSeverity: 'minor', isBlocking: false },
  { id: 'ret-eq-4', category: 'equipment', label: 'Tools and jack — present', isCritical: false, result: 'na' as const, defectDescription: '', defectSeverity: 'minor', isBlocking: false },
  // Documents
  { id: 'ret-doc-1', category: 'documents', label: 'Trip logbook — completed', isCritical: false, result: 'na' as const, defectDescription: '', defectSeverity: 'minor', isBlocking: false },
  { id: 'ret-doc-2', category: 'documents', label: 'Fuel receipts — collected', isCritical: false, result: 'na' as const, defectDescription: '', defectSeverity: 'minor', isBlocking: false },
];

const CATEGORY_LABELS: Record<string, string> = {
  exterior: 'Exterior',
  tyres: 'Tyres & Wheels',
  interior: 'Interior',
  equipment: 'Equipment',
  documents: 'Documents & Paperwork',
};

export default function ReturnInspectionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tripIdParam = searchParams.get('tripId') || '';
  const [tripId, setTripId] = useState(tripIdParam);
  const [vehicleId, setVehicleId] = useState(searchParams.get('vehicleId') || '');
  const [odometer, setOdometer] = useState('');
  const [fuelLevel, setFuelLevel] = useState('half');
  const [checklist, setChecklist] = useState<ChecklistItem[]>(DEFAULT_CHECKLIST);
  const [notes, setNotes] = useState('');
  const [tripInfo, setTripInfo] = useState<{ make: string; model: string; licenceNumber: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [offlineSaved, setOfflineSaved] = useState(false);
  const [inspectorAcknowledged, setInspectorAcknowledged] = useState(false);
  const [driverAcknowledged, setDriverAcknowledged] = useState(false);
  const { toast } = useToast();
  const { data: profile } = useQuery({
    queryKey: userProfileQueryKey,
    queryFn: ({ signal }) => fetchUserProfile(signal),
  });
  const [photos, setPhotos] = useState<Array<{ file: File; preview: string }>>([]);
  const [departurePhotos, setDeparturePhotos] = useState<Array<{ id: string; signedUrl: string | null; caption: string | null; inspectionId: string }>>([]);
  const [departurePhotosLoading, setDeparturePhotosLoading] = useState(false);
  const [damageClassifications, setDamageClassifications] = useState<Record<number, string>>({});

  const DAMAGE_CLASSIFICATIONS = [
    { value: 'pre-existing', label: 'Pre-existing', color: 'text-blue-600 bg-blue-50 border-blue-200' },
    { value: 'new_damage', label: 'New Damage', color: 'text-red-600 bg-red-50 border-red-200' },
    { value: 'normal_wear', label: 'Normal Wear', color: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
    { value: 'unclear', label: 'Unclear', color: 'text-gray-600 bg-gray-50 border-gray-200' },
    { value: 'accident', label: 'Accident', color: 'text-orange-600 bg-orange-50 border-orange-200' },
  ] as const;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [vehicles, setVehicles] = useState<Array<{ id: string; licenceNumber: string; make: string; model: string }>>([]);
  const [vehicleLoading, setVehicleLoading] = useState(false);
  const [vehicleDropdown, setVehicleDropdown] = useState(false);
  const [trips, setTrips] = useState<Array<{ id: string; reference: string; status: string }>>([]);
  const [tripLoading, setTripLoading] = useState(false);

  // Search vehicles dynamically
  useEffect(() => {
    if (vehicleSearch.length < 2) { setVehicles([]); return; }
    const timer = setTimeout(async () => {
      setVehicleLoading(true);
      try {
        const res = await fetch(`/api/fleet?search=${encodeURIComponent(vehicleSearch)}&limit=10`);
        const json = await res.json();
        const list = json.vehicles || json.data?.vehicles || json.rows || json.data || [];
        setVehicles(Array.isArray(list) ? list : []);
        setVehicleDropdown(true);
      } catch { /* ignore */ } finally { setVehicleLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [vehicleSearch]);

  // Fetch available trips
  useEffect(() => {
    fetch('/api/trips?status=pending,issued,in_progress,completed&limit=20')
      .then((r) => r.json())
      .then((json) => {
        const list = json.trips || json.data?.trips || json.rows || [];
        setTrips(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
  }, []);

  // Fetch trip/vehicle info if tripId is provided
  useEffect(() => {
    if (!tripId) {
      setTripInfo(null);
      return;
    }
    fetch(`/api/trips/${tripId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.trip) {
          setTripInfo({
            make: data.trip.make || '',
            model: data.trip.model || '',
            licenceNumber: data.trip.licenceNumber || '',
          });
        }
      })
      .catch(() => {});

    // Fetch departure photos for comparison
    setDeparturePhotosLoading(true);
    fetch(`/api/trips/${tripId}/departure-photos`)
      .then((r) => r.json())
      .then((data) => {
        if (data.photos && data.photos.length > 0) {
          setDeparturePhotos(
            data.photos.map((p: { id: string; signedUrl: string | null; caption: string | null; inspectionId: string }) => ({
              id: p.id,
              signedUrl: p.signedUrl,
              caption: p.caption,
              inspectionId: p.inspectionId,
            })),
          );
        } else {
          setDeparturePhotos([]);
        }
      })
      .catch(() => setDeparturePhotos([]))
      .finally(() => setDeparturePhotosLoading(false));
  }, [tripId, vehicleId]);

  const updateResult = (id: string, result: 'pass' | 'fail' | 'na') => {
    setChecklist((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, result, defectDescription: result === 'fail' ? item.defectDescription || 'Defect found' : '', isBlocking: result === 'fail' && item.isCritical ? true : item.isBlocking } : item,
      ),
    );
  };

  const updateDefect = (id: string, field: 'defectDescription' | 'defectSeverity' | 'isBlocking', value: string | boolean) => {
    setChecklist((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
  };

  const grouped = checklist.reduce(
    (acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    },
    {} as Record<string, ChecklistItem[]>,
  );

  const criticalFails = checklist.filter((i) => i.isCritical && i.result === 'fail').length;
  const failsNeedingDescription = checklist.filter((i) => i.result === 'fail' && !i.defectDescription.trim());
  const canComplete = odometer.length > 0 && criticalFails === 0 && failsNeedingDescription.length === 0 && inspectorAcknowledged && driverAcknowledged && photos.length >= 3;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Try online submission first
    try {
      // Upload photos first (best-effort)
      const photoKeys: string[] = [];
      for (const photo of photos) {
        try {
          const fd = new FormData();
          fd.append('file', photo.file);
          fd.append('category', 'inspection');
          const uploadRes = await fetch('/api/upload', { method: 'POST', body: fd });
          if (uploadRes.ok) {
            const uploadJson = await uploadRes.json();
            if (uploadJson.data?.key) photoKeys.push(uploadJson.data.key);
          }
        } catch { /* best-effort */ }
      }

      const res = await fetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'return',
          odometerReading: Number(odometer),
          fuelLevel,
          tripId: tripId || undefined,
          vehicleId: vehicleId || '',
          checklist: checklist.map((item) => ({
            label: item.label,
            result: item.result,
            isCritical: item.isCritical,
            defectDescription: item.defectDescription,
            defectSeverity: item.defectSeverity,
            isBlocking: item.isBlocking,
          })),
          notes,
          photoKeys: photoKeys.length > 0 ? photoKeys : undefined,
          inspectorAcknowledged,
          driverAcknowledged,
        }),
      });
      if (res.ok) {
        router.push('/dashboard/inspections');
        toast({ title: 'Return Inspection Complete', description: 'Post-trip inspection recorded successfully.', variant: 'success' });
        return;
      }
    } catch {
      // Network error — save as offline draft
    }

    // Save as offline draft
    try {
      await saveDraft({
        draftType: 'inspection_return',
        formData: {
          odometerReading: odometer,
          fuelLevel,
          vehicleId,
          tripRef: tripId,
          checklist: checklist.map((item) => ({
            label: item.label,
            result: item.result,
            isCritical: item.isCritical,
            defectDescription: item.defectDescription,
            defectSeverity: item.defectSeverity,
            isBlocking: item.isBlocking,
          })),
          notes,
          photos: photos.map((photo) => photo.file),
          inspectorAcknowledged,
          driverAcknowledged,
        },
        userId: profile?.id || null,
        tenantId: profile?.tenantId || null,
        syncStatus: 'pending',
      });
      setOfflineSaved(true);
    } catch (err) {
      console.error('Failed to save offline draft:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Inspections', href: '/dashboard/inspections' },
        { label: 'Return Inspection' },
      ]} />
      <PageHeader title="Return Inspection" description="Post-trip vehicle inspection and defect reporting">
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/inspections"><ChevronLeft className="h-4 w-4" /> Back</Link>
        </Button>
      </PageHeader>

      <form onSubmit={handleSubmit}>
        {/* Vehicle Info — Odometer & Fuel */}
        <Card>
          <CardHeader><CardTitle>Odometer & Fuel</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label required>Odometer Reading (km)</Label><Input type="number" placeholder="e.g. 46200" value={odometer} onChange={(e) => setOdometer(e.target.value)} required /></div>
              <div className="space-y-1.5"><Label required>Fuel Level</Label><StyledSelect value={fuelLevel} onChange={(e) => setFuelLevel(e.target.value)} placeholder="Select fuel level"><option value="full">Full</option><option value="three_quarters">¾</option><option value="half">½</option><option value="quarter">¼</option><option value="empty">Empty</option></StyledSelect></div>
            </div>
          </CardContent>
        </Card>

        {/* Vehicle Selection */}
        <Card>
          <CardHeader><CardTitle>Vehicle & Trip Selection</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {tripInfo && (
              <div className="rounded-[8px] border border-brand-100 bg-brand-50/30 p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-brand-100">
                    <Truck className="h-5 w-5 text-brand-700" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-ink-950">{tripInfo.make} {tripInfo.model}</p>
                    <p className="text-xs text-ink-500">{tripInfo.licenceNumber} · Trip ID: {tripId}</p>
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-1.5 relative">
              <Label>Search Vehicle</Label>
              <Input
                placeholder="Type vehicle GRN, make or model..."
                value={vehicleSearch}
                onChange={(e) => { setVehicleSearch(e.target.value); setVehicleId(''); }}
                onFocus={() => vehicles.length > 0 && setVehicleDropdown(true)}
                onBlur={() => setTimeout(() => setVehicleDropdown(false), 200)}
              />
              {vehicleLoading && <p className="text-xs text-ink-400 mt-1">Searching...</p>}
              {vehicleDropdown && vehicles.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-[8px] border border-border bg-surface shadow-lg max-h-48 overflow-y-auto">
                  {vehicles.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                      onMouseDown={() => {
                        setVehicleId(v.id);
                        setVehicleSearch(`${v.licenceNumber} — ${v.make} ${v.model}`);
                        setVehicleDropdown(false);
                      }}
                    >
                      <span className="font-medium">{v.licenceNumber}</span>
                      <span className="text-ink-500 ml-2">{v.make} {v.model}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Trip Reference</Label>
              <StyledSelect
                value={tripId}
                onChange={(e) => setTripId(e.target.value)}
              >
                <option value="">No trip linked (standalone inspection)</option>
                {trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.reference || t.id.slice(0, 8)} — {t.status.replace(/_/g, ' ')}
                  </option>
                ))}
              </StyledSelect>
              {tripLoading && <p className="text-xs text-ink-400">Loading trips...</p>}
            </div>
            <input type="hidden" name="tripId" value={tripId} />
            <input type="hidden" name="vehicleId" value={vehicleId} />
          </CardContent>
        </Card>

        {/* Pre-Departure vs Return Photo Comparison */}
        {departurePhotos.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-4 w-4" />
                Pre-Departure vs Return Photo Comparison
              </CardTitle>
              <p className="text-xs text-ink-500">
                Compare departure photos ({departurePhotos.length}) with current vehicle condition.
                Classify any visual changes below.
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Departure Photos Grid */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-status-info-text">
                    Pre-Departure Photos
                  </p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                    {departurePhotos.map((photo) => (
                      <div key={photo.id} className="relative group">
                        <a
                          href={photo.signedUrl || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block aspect-square w-full overflow-hidden rounded-[8px] border-2 border-brand-200 bg-muted"
                        >
                          {photo.signedUrl ? (
                            <img
                              src={photo.signedUrl}
                              alt={photo.caption || 'Departure photo'}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center">
                              <Camera className="h-6 w-6 text-ink-300" />
                            </div>
                          )}
                        </a>
                        {photo.caption && (
                          <p className="mt-1 text-[10px] text-ink-400 truncate text-center">{photo.caption}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Return Photos Section (inline) with Damage Classification */}
                {photos.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-status-emergency-text">
                      Return / Current Photos
                    </p>
                    <div className="space-y-4">
                      {photos.map((photo, idx) => (
                        <div key={idx} className="rounded-[8px] border border-border p-3">
                          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                            <div className="relative group">
                              <button
                                type="button"
                                onClick={() => setLightboxPhoto(photo.preview)}
                                className="block aspect-square w-full overflow-hidden rounded-[8px] border-2 border-status-warning-bg bg-muted"
                              >
                                <img src={photo.preview} alt={`Return photo ${idx + 1}`} className="h-full w-full object-cover" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                                className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                          {/* Damage Classification */}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-medium text-ink-500 mr-1">Classify:</span>
                            {DAMAGE_CLASSIFICATIONS.map((dc) => (
                              <button
                                key={dc.value}
                                type="button"
                                onClick={() =>
                                  setDamageClassifications((prev) => ({
                                    ...prev,
                                    [idx]: prev[idx] === dc.value ? '' : dc.value,
                                  }))
                                }
                                className={`rounded-[4px] border px-2 py-0.5 text-[11px] font-medium transition-all active:scale-95 ${
                                  damageClassifications[idx] === dc.value
                                    ? `${dc.color} ring-1 ring-inset ring-current`
                                    : 'text-ink-400 border-border hover:border-ink-300 hover:text-ink-600'
                                }`}
                              >
                                {dc.label}
                              </button>
                            ))}
                          </div>
                          {/* Damage Action Triggers — shown when new damage or accident is marked */}
                          {(damageClassifications[idx] === 'new_damage' || damageClassifications[idx] === 'accident') && (
                            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                              <span className="text-[11px] font-medium text-ink-500 mr-1">Actions:</span>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const res = await fetch('/api/incidents', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        tripId,
                                        incidentType: 'damage',
                                        description: `Damage detected during return inspection (classified as ${damageClassifications[idx].replace(/_/g, ' ')}). Photo index: ${idx}.`,
                                        vehicleDamage: true,
                                      }),
                                    });
                                    if (res.ok) {
                                      toast({ title: 'Incident Report Created', description: 'Damage flagged for investigation.', variant: 'success' });
                                    } else {
                                      toast({ title: 'Failed to Create Incident', description: 'Try again.', variant: 'error' });
                                    }
                                  } catch {
                                    toast({ title: 'Failed to Create Incident', description: 'Check your connection.', variant: 'error' });
                                  }
                                }}
                                className="rounded-[4px] border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700 transition-all hover:bg-red-100 active:scale-95 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/50"
                              >
                                <AlertTriangle className="mr-1 inline h-3 w-3" />
                                Create Incident Report
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!vehicleId) {
                                    toast({ title: 'Select a vehicle first', description: 'A vehicle must be linked to create a maintenance request.', variant: 'default' });
                                    return;
                                  }
                                  try {
                                    await fetch('/api/maintenance', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        vehicleId,
                                        serviceDate: new Date().toISOString().split('T')[0],
                                        serviceType: 'repair',
                                        description: `Damage detected during return inspection (classified as ${damageClassifications[idx].replace(/_/g, ' ')}). Photo index: ${idx}.`,
                                      }),
                                    });
                                    toast({ title: 'Maintenance Request Created', description: 'Vehicle flagged for maintenance.', variant: 'success' });
                                  } catch {
                                    toast({ title: 'Failed to Create Maintenance Request', description: 'Check your connection and try again.', variant: 'error' });
                                  }
                                }}
                                className="rounded-[4px] border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 transition-all hover:bg-amber-100 active:scale-95 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/50"
                              >
                                <Truck className="mr-1 inline h-3 w-3" />
                                Create Maintenance Request
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!vehicleId) {
                                    toast({ title: 'Select a vehicle first', description: 'A vehicle must be linked to hold it.', variant: 'default' });
                                    return;
                                  }
                                  try {
                                    const res = await fetch('/api/fleet', {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        id: vehicleId,
                                        status: 'out_of_service',
                                        reason: `Vehicle held pending investigation of return inspection damage (${damageClassifications[idx].replace(/_/g, ' ')}). Photo index: ${idx}.`,
                                      }),
                                    });
                                    if (res.ok) {
                                      toast({ title: 'Vehicle Held', description: 'Vehicle set to out of service pending investigation.', variant: 'success' });
                                    } else {
                                      toast({ title: 'Failed to Hold Vehicle', description: 'Check permissions.', variant: 'error' });
                                    }
                                  } catch {
                                    toast({ title: 'Failed to Hold Vehicle', description: 'Check your connection.', variant: 'error' });
                                  }
                                }}
                                className="rounded-[4px] border border-orange-200 bg-orange-50 px-2 py-1 text-[11px] font-medium text-orange-700 transition-all hover:bg-orange-100 active:scale-95"
                              >
                                <CheckCircle2 className="mr-1 inline h-3 w-3" />
                                Hold Vehicle
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const res = await fetch('/api/notifications', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        recipientUserId: profile?.id,
                                        type: 'incident_notification',
                                        title: 'Damage Incident Requires Attention',
                                        body: `A return inspection has classified damage as ${damageClassifications[idx].replace(/_/g, ' ')}. Trip: ${tripId || 'Unknown'}. Vehicle: ${vehicleSearch}`,
                                        entityType: 'trip',
                                        entityId: tripId,
                                        actionUrl: `/dashboard/trips/${tripId || ''}`,
                                        priority: 'high',
                                      }),
                                    });
                                    if (res.ok) {
                                      toast({ title: 'Supervisor Notified', description: 'Notification sent.', variant: 'success' });
                                    }
                                  } catch {
                                    toast({ title: 'Failed to Notify', description: 'Check your connection.', variant: 'error' });
                                  }
                                }}
                                className="rounded-[4px] border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 transition-all hover:bg-blue-100 active:scale-95 dark:border-blue-800/50 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/50"
                              >
                                <svg className="mr-1 inline h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                </svg>
                                Notify Supervisor
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Loading state for departure photos */}
        {departurePhotosLoading && tripId && (
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-sm text-ink-500">
                <History className="h-4 w-4 animate-pulse" />
                Loading departure photos for comparison...
              </div>
            </CardContent>
          </Card>
        )}

        {/* Checklist Categories */}
        {Object.entries(grouped).map(([category, items]) => {
          const categoryFails = items.filter((i) => i.result === 'fail').length;
          return (
            <Card key={category}>
              <CardHeader>
                <CardTitle>{CATEGORY_LABELS[category] ?? category}</CardTitle>
                {categoryFails > 0 && <span className="text-xs text-status-error-text">{categoryFails} defect{categoryFails > 1 ? 's' : ''}</span>}
              </CardHeader>
              <CardContent className="space-y-3">
                {items.map((item) => (
                  <div key={item.id}>
                    <div className="flex items-center justify-between rounded-[8px] border border-border p-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm text-ink-700">{item.label}</span>
                        {item.isCritical && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-status-emergency-text" aria-label="Critical item" />}
                      </div>
                      <div className="flex items-center gap-1 shrink-0 touch-manipulation">
                        {(['pass', 'fail', 'na'] as const).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => updateResult(item.id, opt)}
                            className={`min-h-[36px] sm:min-h-0 px-3 py-1.5 text-xs rounded-[6px] font-medium transition-colors active:scale-95 ${
                              item.result === opt
                                ? opt === 'pass' ? 'bg-status-success-bg text-status-success-text ring-1 ring-status-success-text'
                                : opt === 'fail' ? 'bg-status-error-bg text-status-error-text ring-1 ring-status-error-text'
                                : 'bg-muted text-ink-500'
                                : 'text-ink-400 hover:bg-muted hover:text-ink-700'
                            }`}
                          >
                            {opt === 'pass' ? 'Pass' : opt === 'fail' ? 'Fail' : 'N/A'}
                          </button>
                        ))}
                      </div>
                    </div>
                    {item.result === 'fail' && (
                      <div className="mt-2 ml-4 pl-4 border-l-2 border-status-error-bg space-y-2 py-2">
                        <div className="space-y-1.5">
                          <Label required>Defect Description</Label>
                          <Input placeholder="Describe the defect..." value={item.defectDescription} onChange={(e) => updateDefect(item.id, 'defectDescription', e.target.value)} />
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>Severity</Label>
                            <StyledSelect value={item.defectSeverity} onChange={(e) => updateDefect(item.id, 'defectSeverity', e.target.value)} placeholder="Select severity">
                              <option value="informational">Informational</option>
                              <option value="minor">Minor</option>
                              <option value="major">Major</option>
                              <option value="critical">Critical</option>
                            </StyledSelect>
                          </div>
                          <div className="space-y-1.5 flex items-end pb-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input type="checkbox" checked={item.isBlocking} onChange={(e) => updateDefect(item.id, 'isBlocking', e.target.checked)} className="h-4 w-4 rounded border-border text-brand-800 focus:ring-brand-600" />
                              <span className="text-sm text-ink-700">Blocking — vehicle should not be used</span>
                            </label>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}

        {/* Critical Fails Warning */}
        {criticalFails > 0 && (
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-status-emergency-text" />
                <div>
                  <p className="text-sm font-medium text-status-emergency-text">Critical Defects Detected</p>
                  <p className="text-xs text-ink-500">{criticalFails} critical item{criticalFails > 1 ? 's' : ''} failed — flag for immediate maintenance.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {failsNeedingDescription.length > 0 && (
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-status-pending-text" />
                <p className="text-sm text-ink-500">{failsNeedingDescription.length} defect{failsNeedingDescription.length > 1 ? 's' : ''} need description before completing.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Photos — Square Thumbnails + Lightbox */}
        <Card>
          <CardHeader><CardTitle>Photos</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {photos.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {photos.map((photo, idx) => (
                  <div key={idx} className="relative group">
                    <button
                      type="button"
                      onClick={() => setLightboxPhoto(photo.preview)}
                      className="block aspect-square w-full overflow-hidden rounded-[8px] border border-border bg-muted"
                    >
                      <img src={photo.preview} alt={`Photo ${idx + 1}`} className="h-full w-full object-cover" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                const newPhotos = files.map((file) => ({ file, preview: URL.createObjectURL(file) }));
                setPhotos((prev) => [...prev, ...newPhotos]);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            />
            <Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Camera className="h-4 w-4" />
              {photos.length > 0 ? 'Add More Photos' : 'Take / Upload Photos'}
            </Button>
            {photos.length > 0 && <span className="text-xs text-ink-500 ml-2">{photos.length} photo{photos.length !== 1 ? 's' : ''} selected</span>}
          </CardContent>
        </Card>

        {/* Lightbox */}
        {lightboxPhoto && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            onClick={() => setLightboxPhoto(null)}
          >
            <button
              onClick={() => setLightboxPhoto(null)}
              className="absolute top-4 right-4 rounded-full bg-white/20 p-2 text-white hover:bg-white/40 transition-colors"
              aria-label="Close lightbox"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const idx = photos.findIndex((p) => p.preview === lightboxPhoto);
                if (idx > 0) setLightboxPhoto(photos[idx - 1].preview);
              }}
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/20 p-2 text-white hover:bg-white/40 transition-colors"
              aria-label="Previous photo"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <img
              src={lightboxPhoto}
              alt="Inspection photo enlarged"
              className="max-h-[85vh] max-w-full rounded-[8px] object-contain"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                const idx = photos.findIndex((p) => p.preview === lightboxPhoto);
                if (idx < photos.length - 1) setLightboxPhoto(photos[idx + 1].preview);
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/20 p-2 text-white hover:bg-white/40 transition-colors"
              aria-label="Next photo"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <p className="absolute bottom-4 text-sm text-white/80">
              {photos.findIndex((p) => p.preview === lightboxPhoto) + 1} of {photos.length}
            </p>
          </div>
        )}

        {/* Notes */}
        <Card>
          <CardHeader><CardTitle>Additional Notes</CardTitle></CardHeader>
          <CardContent>
            <Textarea placeholder="Any additional observations or handover notes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Return Acknowledgements</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={inspectorAcknowledged} onChange={(event) => setInspectorAcknowledged(event.target.checked)} /> I confirm that I performed and recorded this return inspection.</label>
            <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={driverAcknowledged} onChange={(event) => setDriverAcknowledged(event.target.checked)} /> The assigned driver confirms the returned vehicle condition.</label>
            <p className="text-xs text-ink-500">Both acknowledgements and at least three inspection photos are required.</p>
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" size="sm" asChild><Link href="/dashboard/inspections">Cancel</Link></Button>
          {offlineSaved ? (
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <WifiOff className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">Saved Offline</p>
                    <p className="text-xs text-ink-500">This inspection was saved as a local draft and will sync when connectivity is restored.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Button variant="primary" size="sm" type="submit" loading={isSubmitting} disabled={!canComplete}>
              <CheckCircle2 className="h-4 w-4" /> Complete Return Inspection
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
