'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  ArrowRight,
  CircleDot,
} from 'lucide-react';

interface ReadinessGate {
  key: string;
  label: string;
  status: 'pass' | 'fail' | 'blocking' | 'pending';
  detail: string;
  required: boolean;
}

interface ReadinessData {
  driver?: {
    kind: 'internal' | 'external' | 'unassigned';
    accepted: boolean;
    assignmentState?: string | null;
  };
  gates: ReadinessGate[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    pending: number;
    ready: boolean;
    locked: boolean;
  };
}

interface ReleaseReadinessCheckProps {
  tripId: string;
  status: string;
}

const OPERATIONAL_GATE_ORDER = [
  'request_approvals',
  'releasing_officer_acted',
  'vehicle_allocated',
  'driver_allocated',
  'driver_active_employee',
  'driver_licence_valid',
  'driver_licence_class_match',
  'vehicle_no_blocking_defects',
  'trip_authority',
  'driver_acknowledged',
  'departure_inspection',
  'authority_validity',
  'vehicle_documents',
  'vehicle_issued',
] as const;

function departureStep(data: ReadinessData) {
  return data.driver?.kind === 'external'
    ? 'Transport Office records external-driver departure'
    : 'Driver starts the authorised trip';
}

function resolveOperatorSteps(data: ReadinessData, tripStatus: string) {
  const rank = new Map<string, number>(
    OPERATIONAL_GATE_ORDER.map((key, index) => [key, index]),
  );
  const ordered = [...data.gates].sort(
    (a, b) => (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999),
  );
  const unresolved = ordered.filter((gate) => gate.status !== 'pass');
  const current = unresolved.find((gate) => gate.required) ?? unresolved[0];

  if (current) {
    const currentPosition = ordered.findIndex((gate) => gate.key === current.key);
    const next = ordered
      .slice(currentPosition + 1)
      .find((gate) => gate.required && gate.status !== 'pass');

    return {
      current: current.label,
      currentDetail: current.detail,
      currentState: current.status === 'blocking' || current.status === 'fail' ? 'blocked' : 'pending',
      next:
        next?.label ??
        (current.key === 'vehicle_issued' ? departureStep(data) : 'Complete release and issue vehicle'),
    };
  }

  if (tripStatus === 'in_progress') {
    return {
      current: 'Trip is in progress',
      currentDetail: 'Release is complete. Monitor the active trip and any incidents or route changes.',
      currentState: 'complete',
      next: 'Driver returns vehicle for arrival inspection',
    };
  }

  return {
    current: 'Release conditions complete',
    currentDetail:
      data.driver?.kind === 'external'
        ? 'All required release checks have passed for the current vehicle and external driver. Transport Office must record the actual departure after physical issue.'
        : 'All required release checks have passed for the current vehicle and driver.',
    currentState: 'complete',
    next: departureStep(data),
  };
}

export function ReleaseReadinessCheck({ tripId, status }: ReleaseReadinessCheckProps) {
  const [data, setData] = useState<ReadinessData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState('');

  const fetchReadiness = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/trips/${tripId}/readiness`, { cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to check readiness');
      const json = (await res.json()) as ReadinessData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check readiness');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    if (tripId && (status === 'pending' || status === 'in_progress')) {
      const fetchTimer = setTimeout(fetchReadiness, 0);
      return () => clearTimeout(fetchTimer);
    }
    const clearTimer = setTimeout(() => setData(null), 0);
    return () => clearTimeout(clearTimer);
  }, [tripId, status, fetchReadiness]);

  if (!['pending', 'in_progress'].includes(status)) {
    return null;
  }

  const isReady = data?.summary.ready;
  const isBlocked = data?.summary.locked;
  const blockingGates = data?.gates.filter((g) => g.status === 'blocking') || [];
  const pendingGates = data?.gates.filter((g) => g.status === 'pending') || [];
  const operatorSteps = data ? resolveOperatorSteps(data, status) : null;

  return (
    <Card className="border-2 border-brand-200">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-brand-700" />
          <CardTitle className="text-base">Release Readiness</CardTitle>
          {data && (
            <Badge
              variant={isReady ? 'success' : isBlocked ? 'error' : 'pending'}
              size="sm"
            >
              {isReady ? 'Ready' : isBlocked ? 'Blocked' : 'In Progress'}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={fetchReadiness}
            loading={loading}
            className="h-8"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="rounded-[6px] p-1.5 text-ink-500 transition-colors hover:bg-muted"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {data && (
          <div
            className={`mb-4 rounded-[8px] border p-3 ${
              isReady
                ? 'border-status-success-bg/50 bg-status-success-bg/10'
                : isBlocked
                  ? 'border-status-error-bg/50 bg-status-error-bg/10'
                  : 'border-status-pending-bg/50 bg-status-pending-bg/10'
            }`}
          >
            <div className="flex items-start gap-2">
              {isReady ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-status-success-text" />
              ) : isBlocked ? (
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-status-error-text" />
              ) : (
                <Clock className="mt-0.5 h-5 w-5 shrink-0 text-status-pending-text" />
              )}
              <div>
                <p className="text-sm font-semibold text-ink-950">
                  {isReady
                    ? 'All release conditions met'
                    : isBlocked
                      ? `${data.summary.failed} condition${data.summary.failed !== 1 ? 's' : ''} blocking release`
                      : `${data.summary.pending} condition${data.summary.pending !== 1 ? 's' : ''} pending completion`}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {data.summary.passed} of {data.summary.total} conditions met
                  {blockingGates.length > 0 && ` · ${blockingGates.length} blocking`}
                  {pendingGates.length > 0 && ` · ${pendingGates.length} pending`}
                </p>
              </div>
            </div>
          </div>
        )}

        {operatorSteps && (
          <div className="mb-4 grid gap-2 rounded-[10px] border border-border bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                <CircleDot className="h-3.5 w-3.5" />
                Current step
              </div>
              <p
                className={`mt-1 text-sm font-semibold ${
                  operatorSteps.currentState === 'blocked'
                    ? 'text-status-error-text'
                    : operatorSteps.currentState === 'complete'
                      ? 'text-status-success-text'
                      : 'text-ink-950'
                }`}
              >
                {operatorSteps.current}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-ink-500">{operatorSteps.currentDetail}</p>
            </div>
            <ArrowRight className="hidden h-4 w-4 text-ink-400 sm:block" aria-hidden="true" />
            <div className="min-w-0 border-t border-border pt-2 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">Next step</p>
              <p className="mt-1 text-sm font-semibold text-ink-950">{operatorSteps.next}</p>
              <p className="mt-0.5 text-xs leading-5 text-ink-500">
                This becomes actionable when the current required step is completed.
              </p>
            </div>
          </div>
        )}

        {data && (
          <div className="mb-4">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="bg-status-success-text transition-all duration-500"
                style={{
                  width: `${data.summary.total > 0 ? (data.summary.passed / data.summary.total) * 100 : 0}%`,
                }}
              />
              {data.summary.failed > 0 && (
                <div
                  className="bg-status-error-text transition-all duration-500"
                  style={{
                    width: `${data.summary.total > 0 ? (data.summary.failed / data.summary.total) * 100 : 0}%`,
                  }}
                />
              )}
            </div>
          </div>
        )}

        {expanded && data && (
          <div className="space-y-2">
            {data.gates.map((gate) => {
              const isBlockedOrFailed = gate.status === 'blocking' || gate.status === 'fail';
              return (
                <div
                  key={gate.key}
                  className={`flex items-start gap-3 rounded-[8px] border p-3 transition-colors ${
                    isBlockedOrFailed
                      ? 'border-status-error-bg/30 bg-status-error-bg/5'
                      : gate.status === 'pending'
                        ? 'border-status-pending-bg/30 bg-status-pending-bg/5'
                        : 'border-border bg-surface'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {gate.status === 'pass' ? (
                      <CheckCircle2 className="h-4 w-4 text-status-success-text" />
                    ) : isBlockedOrFailed ? (
                      <XCircle className="h-4 w-4 text-status-error-text" />
                    ) : (
                      <Clock className="h-4 w-4 text-status-pending-text" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p
                        className={`text-sm font-medium ${
                          isBlockedOrFailed
                            ? 'text-status-error-text'
                            : gate.status === 'pending'
                              ? 'text-ink-600'
                              : 'text-ink-950'
                        }`}
                      >
                        {gate.label}
                      </p>
                      {gate.required && (
                        <Badge variant="info" size="sm" className="shrink-0">
                          Required
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-500">{gate.detail}</p>
                  </div>
                  <Badge
                    variant={
                      gate.status === 'pass'
                        ? 'success'
                        : isBlockedOrFailed
                          ? 'error'
                          : 'pending'
                    }
                    size="sm"
                    className="shrink-0"
                  >
                    {gate.status === 'pass'
                      ? 'Pass'
                      : isBlockedOrFailed
                        ? 'Fail'
                        : 'Pending'}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center py-8">
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Checking release readiness...
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-[8px] border border-status-error-bg/30 bg-status-error-bg/10 p-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-status-error-text" />
            <div>
              <p className="text-sm font-medium text-status-error-text">Failed to check readiness</p>
              <p className="text-xs text-ink-500">{error}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
