'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { ChevronLeft, CheckCircle2, AlertTriangle, WifiOff, Truck, Camera, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { saveDraft } from '@/lib/offline-drafts';

interface ChecklistItem {
  id: string;
  category: string;
  label: string;
  isCritical: boolean;
  result: 'pass' | 'fail' | 'na';
}

const DEFAULT_CHECKLIST: ChecklistItem[] = [
  // Exterior
  { id: 'ext-1', category: 'exterior', label: 'Body panels — no visible damage', isCritical: false, result: 'na' as const },
  { id: 'ext-2', category: 'exterior', label: 'Windscreen — no cracks or chips', isCritical: true, result: 'na' as const },
  { id: 'ext-3', category: 'exterior', label: 'Windows — all operate correctly', isCritical: false, result: 'na' as const },
  { id: 'ext-4', category: 'exterior', label: 'Mirrors — present and adjusted', isCritical: false, result: 'na' as const },
  { id: 'ext-5', category: 'exterior', label: 'Number plates — fitted and legible', isCritical: false, result: 'na' as const },
  // Tyres
  { id: 'tyr-1', category: 'tyres', label: 'Tyre pressure — all wheels checked', isCritical: true, result: 'na' as const },
  { id: 'tyr-2', category: 'tyres', label: 'Tread depth — above minimum (1.6mm)', isCritical: true, result: 'na' as const },
  { id: 'tyr-3', category: 'tyres', label: 'No visible cuts, bulges or foreign objects', isCritical: true, result: 'na' as const },
  { id: 'tyr-4', category: 'tyres', label: 'Spare wheel — present and secured', isCritical: false, result: 'na' as const },
  // Lights
  { id: 'lgt-1', category: 'lights', label: 'Headlights — high and low beam', isCritical: true, result: 'na' as const },
  { id: 'lgt-2', category: 'lights', label: 'Tail lights — both operational', isCritical: true, result: 'na' as const },
  { id: 'lgt-3', category: 'lights', label: 'Brake lights — illuminate on pedal press', isCritical: true, result: 'na' as const },
  { id: 'lgt-4', category: 'lights', label: 'Indicators — all four corners', isCritical: true, result: 'na' as const },
  { id: 'lgt-5', category: 'lights', label: 'Hazard lights — functional', isCritical: true, result: 'na' as const },
  // Interior
  { id: 'int-1', category: 'interior', label: 'Seat belts — all positions functional', isCritical: true, result: 'na' as const },
  { id: 'int-2', category: 'interior', label: 'Seats — secure and adjustable', isCritical: false, result: 'na' as const },
  { id: 'int-3', category: 'interior', label: 'Dashboard warning lights — normal', isCritical: true, result: 'na' as const },
  { id: 'int-4', category: 'interior', label: 'Horn — operational', isCritical: false, result: 'na' as const },
  { id: 'int-5', category: 'interior', label: 'Wipers and washers — functional', isCritical: true, result: 'na' as const },
  // Documents
  { id: 'doc-1', category: 'documents', label: 'Vehicle licence disc — valid and displayed', isCritical: true, result: 'na' as const },
  { id: 'doc-2', category: 'documents', label: 'Roadworthy certificate — current', isCritical: true, result: 'na' as const },
  { id: 'doc-3', category: 'documents', label: 'Insurance certificate — in vehicle', isCritical: true, result: 'na' as const },
  // Safety
  { id: 'saf-1', category: 'safety', label: 'Fire extinguisher — present and charged', isCritical: true, result: 'na' as const },
  { id: 'saf-2', category: 'safety', label: 'First aid kit — present', isCritical: false, result: 'na' as const },
  { id: 'saf-3', category: 'safety', label: 'Warning triangle — present', isCritical: false, result: 'na' as const },
  { id: 'saf-4', category: 'safety', label: 'Reflective vest — present', isCritical: false, result: 'na' as const },
];

const CATEGORY_LABELS: Record<string, string> = {
  exterior: 'Exterior',
  tyres: 'Tyres & Wheels',
  lights: 'Lights & Indicators',
  interior: 'Interior',
  documents: 'Documents',
  safety: 'Safety Equipment',
};

export default function DepartureInspectionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tripId = searchParams.get('tripId') || '';
  const vehicleId = searchParams.get('vehicleId') || '';
  const [odometer, setOdometer] = useState('');
  const [fuelLevel, setFuelLevel] = useState('full');
  const [checklist, setChecklist] = useState<ChecklistItem[]>(DEFAULT_CHECKLIST);
  const [notes, setNotes] = useState('');
  const [tripInfo, setTripInfo] = useState<{ make: string; model: string; licenceNumber: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [offlineSaved, setOfflineSaved] = useState(false);
  const [photos, setPhotos] = useState<Array<{ file: File; preview: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch trip/vehicle info if tripId is provided
  useEffect(() => {
    if (!tripId) return;
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
  }, [tripId]);

  const updateResult = (id: string, result: 'pass' | 'fail' | 'na') => {
    setChecklist((prev) => prev.map((item) => (item.id === id ? { ...item, result } : item)));
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
  const canComplete = odometer.length > 0 && criticalFails === 0;

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
          type: 'departure',
          odometerReading: Number(odometer),
          fuelLevel,
          tripId: tripId || undefined,
          vehicleId: vehicleId || '',
          checklist: checklist.map((item) => ({
            label: item.label,
            result: item.result,
            isCritical: item.isCritical,
          })),
          notes,
          photoKeys: photoKeys.length > 0 ? photoKeys : undefined,
        }),
      });
      if (res.ok) {
        router.push('/dashboard/inspections');
        return;
      }
      // If the error is a network issue, fall through to offline save
    } catch {
      // Network error — save as offline draft
    }

    // Save as offline draft
    try {
      await saveDraft({
        draftType: 'inspection_departure',
        formData: {
          odometerReading: odometer,
          fuelLevel,
          vehicleId: '',
          checklist: checklist.map((item) => ({
            label: item.label,
            result: item.result,
            isCritical: item.isCritical,
          })),
          notes,
        },
        userId: null,
        tenantId: null,
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
        { label: 'Departure Inspection' },
      ]} />
      <PageHeader title="Departure Inspection" description="Pre-trip vehicle inspection checklist">
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/inspections"><ChevronLeft className="h-4 w-4" /> Back</Link>
        </Button>
      </PageHeader>

      <form onSubmit={handleSubmit}>
        {/* Vehicle Info */}
        <Card>
          <CardHeader><CardTitle>Vehicle & Trip Information</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {tripInfo && (
              <div className="rounded-[8px] border border-brand-100 bg-brand-50/30 p-3 mb-3">
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
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5"><Label required>Odometer Reading (km)</Label><Input type="number" placeholder="e.g. 45200" value={odometer} onChange={(e) => setOdometer(e.target.value)} required /></div>
              <div className="space-y-1.5"><Label required>Fuel Level</Label><select value={fuelLevel} onChange={(e) => setFuelLevel(e.target.value)} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"><option value="full">Full</option><option value="three_quarters">¾</option><option value="half">½</option><option value="quarter">¼</option><option value="empty">Empty</option></select></div>
              <input type="hidden" name="tripId" value={tripId} />
              <input type="hidden" name="vehicleId" value={vehicleId} />
            </div>
          </CardContent>
        </Card>

        {/* Checklist Categories */}
        {Object.entries(grouped).map(([category, items]) => {
          const categoryFails = items.filter((i) => i.result === 'fail').length;
          return (
            <Card key={category}>
              <CardHeader>
                <CardTitle>{CATEGORY_LABELS[category] ?? category}</CardTitle>
                {categoryFails > 0 && <span className="text-xs text-status-error-text">{categoryFails} fail{categoryFails > 1 ? 's' : ''}</span>}
              </CardHeader>
              <CardContent className="space-y-2">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-[8px] border border-border p-3">
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
                  <p className="text-sm font-medium text-status-emergency-text">Critical Items Failed</p>
                  <p className="text-xs text-ink-500">{criticalFails} critical item{criticalFails > 1 ? 's' : ''} failed — resolve before departure.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Photos */}
        <Card>
          <CardHeader><CardTitle>Photos</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {photos.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {photos.map((photo, idx) => (
                  <div key={idx} className="relative rounded-[8px] border border-border overflow-hidden group">
                    <img src={photo.preview} alt={`Photo ${idx + 1}`} className="h-24 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute top-1 right-1 rounded-full bg-black/60 p-1.5 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity active:scale-90"
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

        {/* Notes */}
        <Card>
          <CardHeader><CardTitle>Additional Notes</CardTitle></CardHeader>
          <CardContent>
            <Textarea placeholder="Any defects, concerns, or observations..." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" size="sm" asChild><Link href="/dashboard/inspections">Cancel</Link></Button>
          {offlineSaved && (
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <WifiOff className="h-5 w-5 text-amber-600" />
                <div>
                  <p className="text-sm font-medium text-amber-800">Saved Offline</p>
                  <p className="text-xs text-ink-500">This inspection was saved as a local draft and will sync when connectivity is restored.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {!offlineSaved && (
          <Button variant="primary" size="sm" type="submit" loading={isSubmitting} disabled={!canComplete}>
            <CheckCircle2 className="h-4 w-4" /> Complete Departure Inspection
          </Button>
        )}
        </div>
      </form>
    </div>
  );
}
