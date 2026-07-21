'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, CheckCircle2, Truck, Star, AlertTriangle } from 'lucide-react';
import { VehicleAvailabilityCheck } from './VehicleAvailabilityCheck';
import { useToast } from '@/lib/use-toast';
import Link from 'next/link';

interface RecommendationResult {
  vehicleId: string;
  score: number;
  licenceNumber: string;
  make: string;
  model: string;
  categoryName: string | null;
  passengerCapacity: number | null;
  fuelType: string;
  currentOdometer: number;
  status: string;
  reasons: string[];
  concerns: string[];
}

interface RecommendationData {
  requestId: string;
  requiredPassengers: number;
  recommendations: RecommendationResult[];
  topVariant: RecommendationResult | null;
  totalAvailable: number;
}

export default function NewAllocationPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [requestId, setRequestId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingRec, setIsLoadingRec] = useState(false);
  const [recommendation, setRecommendation] = useState<RecommendationData | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Fetch recommendation when request ID changes
  const fetchRecommendation = useCallback(async () => {
    if (!requestId.trim()) return;
    setIsLoadingRec(true);
    setError('');
    try {
      const res = await fetch('/api/allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: requestId.trim(),
          recommendAuto: true,
          startDate: startDate || new Date().toISOString(),
          endDate: endDate || undefined,
        }),
      });
      const data = await res.json();
      if (data.recommendation) {
        setRecommendation(data.recommendation);
        if (data.recommendation.topVariant) {
          setSelectedVehicleId(data.recommendation.topVariant.vehicleId);
        }
      }
      if (data.allocation) {
        // Allocation was auto-created on recommend
        router.push(`/dashboard/allocations/${data.allocation.id}`);
        return;
      }
    } catch {
      setError('Could not fetch vehicle recommendations. Please fill in details manually.');
    } finally {
      setIsLoadingRec(false);
    }
  }, [requestId, startDate, endDate, router]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      const payload: Record<string, string | boolean | undefined> = {
        requestId: requestId.trim(),
        startDate,
        endDate: endDate || undefined,
        recommendAuto: !selectedVehicleId,
      };
      if (selectedVehicleId) {
        payload.vehicleId = selectedVehicleId;
      }

      const res = await fetch('/api/allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create allocation');
      }
      const data = await res.json();
      toast({ title: 'Allocation created', description: `Vehicle assigned to request ${requestId}`, variant: 'success' });
      router.push(`/dashboard/allocations/${data.allocation.id}`);
    } catch (err) {
      toast({ title: 'Failed to create allocation', description: err instanceof Error ? err.message : 'An unexpected error occurred', variant: 'error' });
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  }, [requestId, startDate, endDate, selectedVehicleId, router]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Allocations', href: '/dashboard/allocations' },
        { label: 'New Allocation' },
      ]} />
      <PageHeader title="New Vehicle Allocation" description="Assign a vehicle to a transport request">
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/allocations"><ChevronLeft className="h-4 w-4" /> Back to Allocations</Link>
        </Button>
      </PageHeader>

      {error && (
        <div className="rounded-[8px] border border-status-error-bg bg-status-error-bg/20 px-4 py-3">
          <p className="text-sm font-medium text-status-error-text">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader><CardTitle>Allocation Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label required>Request ID</Label>
                <Input
                  placeholder="UUID of the transport request"
                  value={requestId}
                  onChange={(e) => setRequestId(e.target.value)}
                  required
                />
              </div>
              <div className="flex items-end">
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={fetchRecommendation}
                  loading={isLoadingRec}
                  disabled={!requestId.trim()}
                >
                  <Star className="h-4 w-4" /> Get Vehicle Recommendation
                </Button>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label required>Start Date</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label>End Date</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea placeholder="Any additional notes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {/* Vehicle Recommendation */}
        {recommendation && recommendation.recommendations.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="h-4 w-4 text-status-pending-text" />
                Vehicle Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-ink-500">
                {recommendation.totalAvailable} vehicle(s) available · {recommendation.requiredPassengers} passenger(s) needed
              </p>
              {recommendation.recommendations.map((v) => {
                const isSelected = selectedVehicleId === v.vehicleId;
                return (
                  <button
                    key={v.vehicleId}
                    type="button"
                    onClick={() => setSelectedVehicleId(v.vehicleId)}
                    className={`w-full text-left rounded-[10px] border-2 p-4 transition-all ${
                      isSelected
                        ? 'border-brand-500 bg-brand-50'
                        : 'border-border bg-surface hover:border-brand-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-[8px] ${
                          isSelected ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-700'
                        }`}>
                          <Truck className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-[650] text-ink-950">{v.make} {v.model}</p>
                            <Badge variant="info" size="sm">{v.licenceNumber}</Badge>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-ink-500">
                            {v.categoryName && <span>{v.categoryName}</span>}
                            <span className="tabular-nums">{v.currentOdometer.toLocaleString()} km</span>
                            <span>{v.fuelType}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-lg font-bold tabular-nums ${v.score >= 80 ? 'text-status-success-text' : v.score >= 60 ? 'text-status-pending-text' : 'text-ink-500'}`}>
                          {v.score}
                        </div>
                        <div className="text-[10px] text-ink-400">Score</div>
                      </div>
                    </div>
                    {v.reasons.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {v.reasons.map((r, i) => (
                          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-status-success-bg/30 px-2 py-0.5 text-[10px] text-status-success-text">
                            <CheckCircle2 className="h-2.5 w-2.5" />{r}
                          </span>
                        ))}
                      </div>
                    )}
                    {v.concerns.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {v.concerns.map((c, i) => (
                          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-status-error-bg/30 px-2 py-0.5 text-[10px] text-status-error-text">
                            <AlertTriangle className="h-2.5 w-2.5" />{c}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Vehicle Availability Check */}
        {selectedVehicleId && startDate && (
          <VehicleAvailabilityCheck
            vehicleId={selectedVehicleId}
            startDate={startDate}
            endDate={endDate}
          />
        )}

        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/allocations">Cancel</Link>
          </Button>
          <Button variant="primary" size="sm" type="submit" loading={isSubmitting}>
            <CheckCircle2 className="h-4 w-4" /> Create Allocation
          </Button>
        </div>
      </form>
    </div>
  );
}
