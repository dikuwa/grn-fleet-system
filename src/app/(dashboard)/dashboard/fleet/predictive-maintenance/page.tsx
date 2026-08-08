'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { fetchWithRetry } from '@/lib/fetch-with-retry';
import {
  AlertTriangle,
  BrainCircuit,
  CalendarClock,
  Car,
  Gauge,
  Loader2,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';

interface Prediction {
  vehicleId: string;
  licenceNumber: string;
  make: string;
  model: string;
  currentOdometer: number;
  status: string;
  urgencyScore: number;
  predictedServiceDate: string | null;
  predictedServiceOdometer: number | null;
  kmSinceLastService: number | null;
  daysSinceLastService: number | null;
  averageKmPerDay: number | null;
  nextScheduledDate: string | null;
  nextScheduledOdometer: number | null;
  complianceFlags: string[];
  recommendations: string[];
  factors: Array<{ name: string; score: number; weight: number; detail: string }>;
}

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'soon', label: 'Service Soon' },
  { value: 'normal', label: 'Normal' },
];

const urgencyTone = (score: number) =>
  score >= 70
    ? 'text-status-error-text'
    : score >= 40
      ? 'text-status-warning-text'
      : 'text-status-success-text';

const urgencySurface = (score: number) =>
  score >= 70
    ? 'bg-status-error-bg'
    : score >= 40
      ? 'bg-status-warning-bg'
      : 'bg-status-success-bg';

export default function PredictiveMaintenancePage() {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [summary, setSummary] = useState({ total: 0, urgent: 0, soon: 0, normal: 0, averageUrgency: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterUrgency, setFilterUrgency] = useState('all');
  const fetched = useRef(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithRetry('/api/fleet/predictive-maintenance');
      if (!res.ok) throw new Error('Failed to load predictions');
      const json = await res.json();
      setPredictions(json.predictions || []);
      setSummary(json.summary || { total: 0, urgent: 0, soon: 0, normal: 0, averageUrgency: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    void fetchData();
  }, [fetchData]);

  const filtered = filterUrgency === 'all'
    ? predictions
    : filterUrgency === 'urgent'
      ? predictions.filter((prediction) => prediction.urgencyScore >= 70)
      : filterUrgency === 'soon'
        ? predictions.filter((prediction) => prediction.urgencyScore >= 40 && prediction.urgencyScore < 70)
        : predictions.filter((prediction) => prediction.urgencyScore < 40);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Fleet', href: '/dashboard/fleet' },
        { label: 'Predictive Maintenance' },
      ]} />
      <PageHeader
        title="Predictive Maintenance"
        description="Rules-based maintenance risk scoring from service history, usage and compliance signals."
      >
        <Badge variant="info">
          <BrainCircuit className="h-3.5 w-3.5" aria-hidden="true" /> Rules Engine
        </Badge>
        <Button variant="secondary" size="sm" onClick={() => void fetchData()} loading={loading}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
        </Button>
      </PageHeader>

      {loading ? (
        <div className="text-ink-500 flex items-center justify-center gap-2 py-14 text-sm">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Calculating maintenance risk…
        </div>
      ) : error ? (
        <EmptyState icon={<AlertTriangle className="h-6 w-6" />} title="Unable to load maintenance predictions" description={error} action={{ label: 'Retry', onClick: fetchData }} />
      ) : predictions.length === 0 ? (
        <EmptyState icon={<BrainCircuit className="h-8 w-8" />} title="No maintenance predictions yet" description="Add vehicle usage and maintenance history to generate risk scores." />
      ) : (
        <>
          <div className="border-border grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border bg-border lg:grid-cols-4">
            <div className="bg-surface p-4"><p className="text-ink-950 text-xl font-semibold tabular-nums sm:text-2xl">{summary.averageUrgency}</p><p className="text-ink-500 mt-1 text-xs">Average urgency</p></div>
            <div className="bg-surface p-4"><p className="text-status-error-text text-xl font-semibold tabular-nums sm:text-2xl">{summary.urgent}</p><p className="text-ink-500 mt-1 text-xs">Urgent (70+)</p></div>
            <div className="bg-surface p-4"><p className="text-status-warning-text text-xl font-semibold tabular-nums sm:text-2xl">{summary.soon}</p><p className="text-ink-500 mt-1 text-xs">Service soon (40–69)</p></div>
            <div className="bg-surface p-4"><p className="text-status-success-text text-xl font-semibold tabular-nums sm:text-2xl">{summary.normal}</p><p className="text-ink-500 mt-1 text-xs">Normal (&lt;40)</p></div>
          </div>

          <div className="border-border flex flex-wrap gap-1 border-y py-3" role="group" aria-label="Maintenance urgency filter">
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilterUrgency(option.value)}
                aria-pressed={filterUrgency === option.value}
                className={`focus-ring min-h-9 rounded-[7px] px-3 text-xs font-medium transition-colors motion-reduce:transition-none ${filterUrgency === option.value ? 'bg-brand-800 text-white' : 'text-ink-500 hover:bg-muted hover:text-ink-800'}`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon={<Car className="h-6 w-6" />} title="No vehicles in this urgency range" description="Choose another maintenance risk filter." />
          ) : (
            <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
              {filtered.map((prediction) => (
                <article key={prediction.vehicleId} className="border-border border-b p-4 last:border-b-0 sm:p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Car className="text-ink-400 h-4 w-4" aria-hidden="true" />
                        <Link href={`/dashboard/fleet/${prediction.vehicleId}`} className="text-ink-950 focus-ring rounded text-sm font-semibold hover:text-brand-700">
                          {prediction.make} {prediction.model}
                        </Link>
                        <Badge variant="info" size="sm">{prediction.licenceNumber}</Badge>
                        <StatusBadge
                          status={prediction.status === 'available' ? 'success' : prediction.status === 'maintenance' ? 'pending' : prediction.status === 'out_of_service' ? 'error' : 'info'}
                          label={prediction.status.replace(/_/g, ' ')}
                        />
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_64px] sm:items-center">
                        <div className="bg-muted h-2 overflow-hidden rounded-full" aria-label={`Urgency score ${prediction.urgencyScore} out of 100`}>
                          <div className={`h-full rounded-full ${urgencySurface(prediction.urgencyScore)}`} style={{ width: `${Math.max(0, Math.min(prediction.urgencyScore, 100))}%` }} />
                        </div>
                        <div><p className={`text-xl font-semibold tabular-nums ${urgencyTone(prediction.urgencyScore)}`}>{prediction.urgencyScore}</p><p className="text-ink-400 text-[10px]">urgency</p></div>
                      </div>

                      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {prediction.factors.map((factor) => (
                          <div key={factor.name} className="border-border rounded-[8px] border p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-ink-500 truncate text-xs font-medium">{factor.name}</p>
                              <span className={`text-sm font-semibold tabular-nums ${urgencyTone(factor.score)}`}>{factor.score}</span>
                            </div>
                            <p className="text-ink-400 mt-1 line-clamp-2 text-[11px]" title={factor.detail}>{factor.detail}</p>
                          </div>
                        ))}
                      </div>

                      <div className="text-ink-500 mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs">
                        {prediction.predictedServiceDate && <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />Next service: {prediction.predictedServiceDate}</span>}
                        {prediction.predictedServiceOdometer && <span className="flex items-center gap-1"><Gauge className="h-3.5 w-3.5" aria-hidden="true" />At {prediction.predictedServiceOdometer.toLocaleString()} km</span>}
                        {prediction.averageKmPerDay != null && <span className="flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />{prediction.averageKmPerDay} km/day</span>}
                      </div>

                      {prediction.recommendations.length > 0 && (
                        <div className="mt-4 border-t border-border pt-3">
                          <p className="text-ink-500 mb-2 text-xs font-medium">Recommendations</p>
                          <ul className="space-y-1.5">
                            {prediction.recommendations.map((recommendation, index) => (
                              <li key={`${prediction.vehicleId}-recommendation-${index}`} className="text-ink-700 flex items-start gap-2 text-xs leading-relaxed">
                                <span className="bg-brand-600 mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden="true" />{recommendation}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {prediction.complianceFlags.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {prediction.complianceFlags.map((flag) => <Badge key={flag} variant="emergency" size="sm">{flag}</Badge>)}
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
