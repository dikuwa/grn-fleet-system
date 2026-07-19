'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { ChevronLeft, CheckCircle2, AlertTriangle, WifiOff, Truck } from 'lucide-react';
import Link from 'next/link';
import { saveDraft } from '@/lib/offline-drafts';

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
  const tripId = searchParams.get('tripId') || '';
  const vehicleId = searchParams.get('vehicleId') || '';
  const [odometer, setOdometer] = useState('');
  const [fuelLevel, setFuelLevel] = useState('half');
  const [checklist, setChecklist] = useState<ChecklistItem[]>(DEFAULT_CHECKLIST);
  const [notes, setNotes] = useState('');
  const [tripInfo, setTripInfo] = useState<{ make: string; model: string; licenceNumber: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [offlineSaved, setOfflineSaved] = useState(false);

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
  const canComplete = odometer.length > 0 && criticalFails === 0 && failsNeedingDescription.length === 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Try online submission first
    try {
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
        }),
      });
      if (res.ok) {
        router.push('/dashboard/inspections');
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
          vehicleId: '',
          checklist: checklist.map((item) => ({
            label: item.label,
            result: item.result,
            isCritical: item.isCritical,
            defectDescription: item.defectDescription,
            defectSeverity: item.defectSeverity,
            isBlocking: item.isBlocking,
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
        { label: 'Return Inspection' },
      ]} />
      <PageHeader title="Return Inspection" description="Post-trip vehicle inspection and defect reporting">
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
              <div className="space-y-1.5"><Label required>Odometer Reading (km)</Label><Input type="number" placeholder="e.g. 46200" value={odometer} onChange={(e) => setOdometer(e.target.value)} required /></div>
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
                      <div className="flex items-center gap-1 shrink-0">
                        {(['pass', 'fail', 'na'] as const).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => updateResult(item.id, opt)}
                            className={`px-3 py-1.5 text-xs rounded-[6px] font-medium transition-colors ${
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
                            <select value={item.defectSeverity} onChange={(e) => updateDefect(item.id, 'defectSeverity', e.target.value)} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200">
                              <option value="informational">Informational</option>
                              <option value="minor">Minor</option>
                              <option value="major">Major</option>
                              <option value="critical">Critical</option>
                            </select>
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

        {/* Notes */}
        <Card>
          <CardHeader><CardTitle>Additional Notes</CardTitle></CardHeader>
          <CardContent>
            <Textarea placeholder="Any additional observations or handover notes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
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
            <CheckCircle2 className="h-4 w-4" /> Complete Return Inspection
          </Button>
        )}
        </div>
      </form>
    </div>
  );
}
