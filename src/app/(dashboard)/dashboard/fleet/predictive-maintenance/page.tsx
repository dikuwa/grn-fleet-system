'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDate } from '@/lib/utils';
import {
  Wrench, AlertTriangle, Loader2, RefreshCw,
  Gauge, CalendarClock, Car, TrendingUp,
  ChevronRight, Clock, BrainCircuit,
} from 'lucide-react';
import Link from 'next/link';

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

export default function PredictiveMaintenancePage() {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [summary, setSummary] = useState({ total: 0, urgent: 0, soon: 0, normal: 0, averageUrgency: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterUrgency, setFilterUrgency] = useState<string>('all');
  const [expandedVehicle, setExpandedVehicle] = useState<string | null>(null);
  const fetched = useRef(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/fleet/predictive-maintenance');
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
    fetchData();
  }, [fetchData]);

  const filtered = filterUrgency === 'all'
    ? predictions
    : filterUrgency === 'urgent'
      ? predictions.filter((p) => p.urgencyScore >= 70)
      : filterUrgency === 'soon'
        ? predictions.filter((p) => p.urgencyScore >= 40 && p.urgencyScore < 70)
        : predictions.filter((p) => p.urgencyScore < 40);

  const urgencyColor = (score: number): string => {
    if (score >= 70) return 'text-red-600';
    if (score >= 40) return 'text-amber-600';
    return 'text-green-600';
  };

  const urgencyBg = (score: number): string => {
    if (score >= 70) return 'bg-red-50 border-red-200';
    if (score >= 40) return 'bg-amber-50 border-amber-200';
    return 'bg-green-50 border-green-200';
  };

  const urgencyBar = (score: number): string => {
    if (score >= 70) return 'bg-red-500';
    if (score >= 40) return 'bg-amber-500';
    return 'bg-green-500';
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Fleet', href: '/dashboard/fleet' },
        { label: 'Predictive Maintenance' },
      ]} />
      <PageHeader
        title="Predictive Maintenance"
        description="AI-powered maintenance predictions and service recommendations"
      >
        <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700">
          <BrainCircuit className="h-3 w-3" />
          Rules Engine
        </span>
        <Button variant="secondary" size="sm" onClick={fetchData} loading={loading}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </PageHeader>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-ink-400" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <AlertTriangle className="h-8 w-8 text-status-error-text" />
          <p className="text-sm text-ink-500">{error}</p>
          <Button variant="secondary" size="sm" onClick={fetchData}>Retry</Button>
        </div>
      ) : predictions.length === 0 ? (
        <EmptyState icon={<BrainCircuit className="h-8 w-8" />} title="No predictions yet" description="Add maintenance records and vehicles to generate predictions." />
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid gap-4 sm:grid-cols-4">
            <Card><CardContent className="pt-4">
              <div className="text-center">
                <p className="text-2xl font-[650] tabular-nums">{summary.averageUrgency}</p>
                <p className="text-xs text-ink-500">Avg Urgency Score</p>
              </div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-center">
                <p className="text-2xl font-[650] tabular-nums text-red-600">{summary.urgent}</p>
                <p className="text-xs text-ink-500">Urgent (&ge;70)</p>
              </div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-center">
                <p className="text-2xl font-[650] tabular-nums text-amber-600">{summary.soon}</p>
                <p className="text-xs text-ink-500">Service Soon (40–69)</p>
              </div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-center">
                <p className="text-2xl font-[650] tabular-nums text-green-600">{summary.normal}</p>
                <p className="text-xs text-ink-500">Normal (&lt;40)</p>
              </div>
            </CardContent></Card>
          </div>

          {/* Filter */}
          <div className="flex items-center gap-2">
            {[
              { value: 'all', label: 'All' },
              { value: 'urgent', label: 'Urgent' },
              { value: 'soon', label: 'Service Soon' },
              { value: 'normal', label: 'Normal' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilterUrgency(opt.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  filterUrgency === opt.value ? 'bg-ink-950 text-white' : 'bg-canvas text-ink-500 hover:bg-ink-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Predictions List */}
          <div className="space-y-3">
            {filtered.map((p) => (
              <Card key={p.vehicleId} className={`border-l-4 ${urgencyBg(p.urgencyScore).split(' ')[1]} ${urgencyBg(p.urgencyScore).split(' ')[0]}`}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Car className="h-5 w-5 text-ink-400" />
                        <Link href={`/dashboard/fleet/${p.vehicleId}`} className="text-sm font-[650] text-ink-950 hover:text-brand-700">
                          {p.make} {p.model}
                        </Link>
                        <Badge variant="info" size="sm">{p.licenceNumber}</Badge>
                      </div>

                      {/* Urgency Bar */}
                      <div className="mt-3 flex items-center gap-3">
                        <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${urgencyBar(p.urgencyScore)}`}
                            style={{ width: `${p.urgencyScore}%` }}
                          />
                        </div>
                        <span className={`text-lg font-[650] tabular-nums ${urgencyColor(p.urgencyScore)}`}>
                          {p.urgencyScore}
                        </span>
                      </div>

                      {/* Factors */}
                      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {p.factors.map((f) => (
                          <div key={f.name} className="rounded-[6px] bg-canvas p-2">
                            <p className="text-[10px] font-medium text-ink-500">{f.name}</p>
                            <p className={`text-sm font-[650] ${f.score >= 60 ? 'text-red-600' : f.score >= 30 ? 'text-amber-600' : 'text-green-600'}`}>
                              {f.score}
                            </p>
                            <p className="text-[10px] text-ink-400 truncate" title={f.detail}>
                              {f.detail.length > 50 ? f.detail.slice(0, 50) + '...' : f.detail}
                            </p>
                          </div>
                        ))}
                      </div>

                      {/* Key Info */}
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
                        {p.predictedServiceDate && (
                          <span className="flex items-center gap-1">
                            <CalendarClock className="h-3.5 w-3.5" />
                            Next service: {p.predictedServiceDate}
                          </span>
                        )}
                        {p.predictedServiceOdometer && (
                          <span className="flex items-center gap-1">
                            <Gauge className="h-3.5 w-3.5" />
                            At {p.predictedServiceOdometer.toLocaleString()} km
                          </span>
                        )}
                        {p.averageKmPerDay != null && (
                          <span className="flex items-center gap-1">
                            <TrendingUp className="h-3.5 w-3.5" />
                            {p.averageKmPerDay} km/day
                          </span>
                        )}
                        <StatusBadge
                          status={p.status === 'available' ? 'success' : p.status === 'maintenance' ? 'pending' : p.status === 'out_of_service' ? 'error' : 'info'}
                          label={p.status.replace(/_/g, ' ')}
                        />
                      </div>

                      {/* Recommendations */}
                      {p.recommendations.length > 0 && (
                        <div className="mt-3 space-y-1">
                          {p.recommendations.map((rec, i) => (
                            <p key={i} className="flex items-start gap-1.5 text-xs text-ink-600">
                              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                              {rec}
                            </p>
                          ))}
                        </div>
                      )}

                      {/* Compliance Flags */}
                      {p.complianceFlags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {p.complianceFlags.map((flag) => (
                            <Badge key={flag} variant="emergency" size="sm">{flag}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
