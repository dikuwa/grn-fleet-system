'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ClipboardCheck, ChevronLeft, CheckCircle2, XCircle, Loader2, Camera, Trash2 } from 'lucide-react';
import Link from 'next/link';

interface Vehicle {
  id: string;
  licenceNumber: string;
  make: string;
  model: string;
}

interface Trip {
  id: string;
  make: string;
  model: string;
  licenceNumber: string;
}

interface ChecklistItem {
  id: string;
  category: string;
  label: string;
  result: 'pass' | 'fail' | 'not_applicable';
  comment: string;
  isCritical: boolean;
}

const DEFAULT_DEPARTURE_CHECKLIST: Omit<ChecklistItem, 'id'>[] = [
  { category: 'exterior', label: 'Body panels and paint condition', result: 'pass', comment: '', isCritical: false },
  { category: 'exterior', label: 'Windshield and windows (no cracks)', result: 'pass', comment: '', isCritical: true },
  { category: 'exterior', label: 'Mirrors (both sides, rearview)', result: 'pass', comment: '', isCritical: false },
  { category: 'tyres', label: 'Tyre tread depth and pressure', result: 'pass', comment: '', isCritical: true },
  { category: 'tyres', label: 'Spare tyre present and secure', result: 'pass', comment: '', isCritical: false },
  { category: 'lights', label: 'Headlights (high/low beam)', result: 'pass', comment: '', isCritical: true },
  { category: 'lights', label: 'Tail lights and brake lights', result: 'pass', comment: '', isCritical: true },
  { category: 'lights', label: 'Indicators and hazard lights', result: 'pass', comment: '', isCritical: true },
  { category: 'interior', label: 'Seat belts (all positions)', result: 'pass', comment: '', isCritical: true },
  { category: 'interior', label: 'Horn working', result: 'pass', comment: '', isCritical: false },
  { category: 'interior', label: 'Wipers and washer fluid', result: 'pass', comment: '', isCritical: false },
  { category: 'safety', label: 'Fire extinguisher present', result: 'pass', comment: '', isCritical: true },
  { category: 'safety', label: 'First aid kit present', result: 'pass', comment: '', isCritical: false },
  { category: 'safety', label: 'Warning triangle/reflectors', result: 'pass', comment: '', isCritical: false },
  { category: 'documents', label: 'Vehicle licence disc valid', result: 'pass', comment: '', isCritical: true },
  { category: 'documents', label: 'Roadworthy certificate valid', result: 'pass', comment: '', isCritical: true },
];

const DEFAULT_RETURN_CHECKLIST: Omit<ChecklistItem, 'id'>[] = [
  { category: 'exterior', label: 'Body panels and paint condition', result: 'pass', comment: '', isCritical: false },
  { category: 'exterior', label: 'Windshield and windows intact', result: 'pass', comment: '', isCritical: true },
  { category: 'tyres', label: 'Tyre condition (no damage)', result: 'pass', comment: '', isCritical: true },
  { category: 'lights', label: 'All lights functional', result: 'pass', comment: '', isCritical: false },
  { category: 'interior', label: 'Interior clean and undamaged', result: 'pass', comment: '', isCritical: false },
  { category: 'interior', label: 'Tool kit and jack present', result: 'pass', comment: '', isCritical: false },
  { category: 'safety', label: 'Fire extinguisher still present', result: 'pass', comment: '', isCritical: true },
  { category: 'safety', label: 'First aid kit present', result: 'pass', comment: '', isCritical: false },
  { category: 'fuel', label: 'Fuel level matches trip records', result: 'pass', comment: '', isCritical: false },
];

const CATEGORY_LABELS: Record<string, string> = {
  exterior: 'Exterior',
  interior: 'Interior',
  tyres: 'Tyres & Wheels',
  lights: 'Lights & Electrical',
  documents: 'Documents & Compliance',
  safety: 'Safety Equipment',
  fuel: 'Fuel',
};

export default function NewInspectionPage() {
  const router = useRouter();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [vehicleId, setVehicleId] = useState('');
  const [tripId, setTripId] = useState('');
  const [type, setType] = useState<'departure' | 'return'>('departure');
  const [odometerReading, setOdometerReading] = useState('');
  const [fuelLevel, setFuelLevel] = useState('');
  const [notes, setNotes] = useState('');
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [photos, setPhotos] = useState<Array<{ file: File; preview: string; key?: string; uploading: boolean }>>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('type');
    if (t === 'departure' || t === 'return') setType(t);
    const vid = params.get('vehicleId');
    if (vid) setVehicleId(vid);
    const tid = params.get('tripId');
    if (tid) setTripId(tid);
  }, []);

  useEffect(() => {
    Promise.all([fetchVehicles(), fetchTrips()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Reset checklist when type changes
    const items = (type === 'departure' ? DEFAULT_DEPARTURE_CHECKLIST : DEFAULT_RETURN_CHECKLIST);
    setChecklist(items.map((item, i) => ({ ...item, id: `item-${i}` })));
  }, [type]);

  async function fetchVehicles() {
    try {
      const res = await fetch('/api/fleet');
      if (!res.ok) throw new Error('Failed to load vehicles');
      const json = await res.json();
      const list = Array.isArray(json) ? json : (json.rows ?? []);
      setVehicles(list);
    } catch { /* silent */ }
  }

  async function fetchTrips() {
    try {
      const res = await fetch('/api/trips?status=in_progress,pending');
      if (!res.ok) return;
      const json = await res.json();
      const list = Array.isArray(json) ? json : (json.rows ?? []);
      setTrips(list);
    } catch { /* silent */ }
  }

  function handleChecklistResult(id: string, result: 'pass' | 'fail' | 'not_applicable') {
    setChecklist((prev) => prev.map((item) => (item.id === id ? { ...item, result } : item)));
  }

  function handleChecklistComment(id: string, comment: string) {
    setChecklist((prev) => prev.map((item) => (item.id === id ? { ...item, comment } : item)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    setUploadError(null);

    try {
      // Upload photos first (best-effort), collect keys
      const photoKeys: string[] = [];
      for (const photo of photos) {
        if (photo.uploading) continue;
        try {
          const formData = new FormData();
          formData.append('file', photo.file);
          formData.append('category', 'inspection');
          const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
          if (uploadRes.ok) {
            const uploadJson = await uploadRes.json();
            if (uploadJson.data?.key) photoKeys.push(uploadJson.data.key);
          }
        } catch {
          // Photo upload is best-effort
        }
      }

      const body: Record<string, unknown> = {
        vehicleId,
        type,
        odometerReading: Number(odometerReading),
        checklist: checklist.map((item) => ({
          label: item.label,
          result: item.result,
          comment: item.comment || null,
          isCritical: item.isCritical,
        })),
        photoKeys: photoKeys.length > 0 ? photoKeys : undefined,
      };

      if (tripId) body.tripId = tripId;
      if (fuelLevel) body.fuelLevel = fuelLevel;
      if (notes) body.notes = notes;

      const res = await fetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to submit inspection');
      }

      router.push('/dashboard/inspections');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setSubmitting(false);
    }
  }

  const groupedItems = checklist.reduce(
    (acc, item) => {
      (acc[item.category] ??= []).push(item);
      return acc;
    },
    {} as Record<string, ChecklistItem[]>,
  );

  const hasFailedItems = checklist.some((item) => item.result === 'fail');
  const hasCriticalFails = checklist.some((item) => item.isCritical && item.result === 'fail');

  if (loading) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Inspections', href: '/dashboard/inspections' },
          { label: 'New Inspection' },
        ]} />
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-ink-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Inspections', href: '/dashboard/inspections' },
          { label: 'New Inspection' },
        ]}
      />
      <PageHeader
        title={type === 'departure' ? 'Departure Inspection' : 'Return Inspection'}
        description={`${type === 'departure' ? 'Pre-trip' : 'Post-trip'} vehicle inspection checklist`}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/inspections">
            <ChevronLeft className="h-4 w-4" />
            Back to Inspections
          </Link>
        </Button>
      </PageHeader>

      {error && (
        <div className="rounded-[10px] border border-status-error-bg bg-status-error-bg/20 px-4 py-3 text-sm text-status-error-text">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Vehicle & Trip Selection */}
          <Card>
            <CardHeader><CardTitle>Vehicle</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1.5">
                  Vehicle <span className="text-status-error-text">*</span>
                </label>
                <select
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  required
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                >
                  <option value="">Select vehicle...</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>{v.licenceNumber} — {v.make} {v.model}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1.5">
                  Trip (optional)
                </label>
                <select
                  value={tripId}
                  onChange={(e) => setTripId(e.target.value)}
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                >
                  <option value="">No linked trip</option>
                  {trips.map((t) => (
                    <option key={t.id} value={t.id}>{t.make} {t.model} ({t.licenceNumber})</option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>

          {/* Inspection Details */}
          <Card>
            <CardHeader><CardTitle>Inspection Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1.5">
                  Inspection Type <span className="text-status-error-text">*</span>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setType('departure')}
                    className={`flex-1 rounded-[8px] border px-3 py-2 text-sm font-medium transition-colors ${
                      type === 'departure'
                        ? 'border-brand-600 bg-brand-50 text-brand-700'
                        : 'border-border bg-surface text-ink-600 hover:bg-muted'
                    }`}
                  >
                    Departure
                  </button>
                  <button
                    type="button"
                    onClick={() => setType('return')}
                    className={`flex-1 rounded-[8px] border px-3 py-2 text-sm font-medium transition-colors ${
                      type === 'return'
                        ? 'border-brand-600 bg-brand-50 text-brand-700'
                        : 'border-border bg-surface text-ink-600 hover:bg-muted'
                    }`}
                  >
                    Return
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1.5">
                  Odometer Reading (km) <span className="text-status-error-text">*</span>
                </label>
                <input
                  type="number"
                  value={odometerReading}
                  onChange={(e) => setOdometerReading(e.target.value)}
                  placeholder="e.g. 45000"
                  required
                  min="0"
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1.5">
                  Fuel Level
                </label>
                <select
                  value={fuelLevel}
                  onChange={(e) => setFuelLevel(e.target.value)}
                  className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                >
                  <option value="">Select level...</option>
                  <option value="full">Full</option>
                  <option value="three_quarters">¾</option>
                  <option value="half">½</option>
                  <option value="quarter">¼</option>
                  <option value="empty">Empty</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1.5">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional observations..."
                  rows={3}
                  className="h-20 w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200 resize-none"
                />
              </div>
            </CardContent>
          </Card>

          {/* Photos */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Photos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {photos.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {photos.map((photo, idx) => (
                    <div key={idx} className="relative rounded-[8px] border border-border overflow-hidden group">
                      <img src={photo.preview} alt={`Photo ${idx + 1}`} className="h-24 w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                        className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                      {photo.uploading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <Loader2 className="h-5 w-5 animate-spin text-white" />
                        </div>
                      )}
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
                  const newPhotos = files.map((file) => ({
                    file,
                    preview: URL.createObjectURL(file),
                    uploading: false,
                  }));
                  setPhotos((prev) => [...prev, ...newPhotos]);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="h-4 w-4" />
                  {photos.length > 0 ? 'Add More Photos' : 'Take / Upload Photos'}
                </Button>
                {photos.length > 0 && (
                  <span className="text-xs text-ink-500">{photos.length} photo{photos.length !== 1 ? 's' : ''} selected</span>
                )}
              </div>
              {uploadError && <p className="text-xs text-status-error-text">{uploadError}</p>}
            </CardContent>
          </Card>

          {/* Checklist */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Inspection Checklist</span>
                {hasFailedItems && (
                  <Badge variant={hasCriticalFails ? 'emergency' : 'error'} size="sm">
                    {hasCriticalFails ? 'Critical items failed' : `${checklist.filter((i) => i.result === 'fail').length} failed`}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {Object.entries(groupedItems).map(([category, items]) => (
                <div key={category}>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
                    {CATEGORY_LABELS[category] ?? category}
                  </h4>
                  <div className="space-y-2">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className={`rounded-[8px] border p-3 transition-colors ${
                          item.result === 'fail'
                            ? 'border-status-error-bg bg-status-error-bg/20'
                            : item.result === 'pass'
                              ? 'border-status-success-bg/50 bg-status-success-bg/10'
                              : 'border-border bg-surface'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-ink-950">{item.label}</p>
                              {item.isCritical && (
                                <Badge variant="emergency" size="sm">Critical</Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleChecklistResult(item.id, 'pass')}
                              className={`flex items-center gap-1 rounded-[6px] px-2.5 py-1.5 text-xs font-medium transition-colors ${
                                item.result === 'pass'
                                  ? 'bg-status-success-bg text-status-success-text'
                                  : 'bg-muted text-ink-500 hover:bg-status-success-bg/50'
                              }`}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Pass
                            </button>
                            <button
                              type="button"
                              onClick={() => handleChecklistResult(item.id, 'fail')}
                              className={`flex items-center gap-1 rounded-[6px] px-2.5 py-1.5 text-xs font-medium transition-colors ${
                                item.result === 'fail'
                                  ? 'bg-status-error-bg text-status-error-text'
                                  : 'bg-muted text-ink-500 hover:bg-status-error-bg/50'
                              }`}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Fail
                            </button>
                            <button
                              type="button"
                              onClick={() => handleChecklistResult(item.id, 'not_applicable')}
                              className={`rounded-[6px] px-2 py-1.5 text-xs font-medium transition-colors ${
                                item.result === 'not_applicable'
                                  ? 'bg-muted text-ink-950'
                                  : 'bg-muted text-ink-500 hover:bg-muted/80'
                              }`}
                            >
                              N/A
                            </button>
                          </div>
                        </div>
                        {item.result === 'fail' && (
                          <input
                            type="text"
                            value={item.comment}
                            onChange={(e) => handleChecklistComment(item.id, e.target.value)}
                            placeholder="Describe the defect..."
                            className="mt-2 h-8 w-full max-w-md rounded-[6px] border border-border bg-white px-2.5 text-xs text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Submit */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <div className="text-xs text-ink-500">
            {checklist.filter((i) => i.result === 'pass').length} passed ·{' '}
            {checklist.filter((i) => i.result === 'fail').length} failed ·{' '}
            {checklist.filter((i) => i.result === 'not_applicable').length} N/A
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" size="sm" asChild>
              <Link href="/dashboard/inspections">Cancel</Link>
            </Button>
            <Button variant="primary" size="sm" type="submit" loading={submitting}>
              <ClipboardCheck className="h-4 w-4" />
              {submitting ? 'Submitting...' : 'Submit Inspection'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
