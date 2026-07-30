'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, AlertTriangle, Clock, RefreshCw, ChevronDown, ChevronUp, ClipboardCheck } from 'lucide-react';

interface ReadinessGate {
  key: string;
  label: string;
  status: 'pass' | 'fail' | 'blocking' | 'pending';
  detail: string;
  required: boolean;
}

interface ReadinessData {
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

export function ReleaseReadinessCheck({ tripId, status }: ReleaseReadinessCheckProps) {
  const [data, setData] = useState<ReadinessData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState('');

  const fetchReadiness = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/trips/${tripId}/readiness`);
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to check readiness');
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check readiness');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    if (tripId && (status === 'pending' || status === 'in_progress')) {
      fetchReadiness();
    } else {
      // Clear stale data when status leaves scope
      setData(null);
    }
  }, [tripId, status, fetchReadiness]);

  // Don't render for closed/completed trips
  if (!['pending', 'in_progress'].includes(status)) {
    return null;
  }

  const isReady = data?.summary.ready;
  const isBlocked = data?.summary.locked;
  const blockingGates = data?.gates.filter((g) => g.status === 'blocking') || [];
  const pendingGates = data?.gates.filter((g) => g.status === 'pending') || [];
  const passedGates = data?.gates.filter((g) => g.status === 'pass') || [];

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
            className="rounded-[6px] p-1.5 text-ink-500 hover:bg-muted transition-colors"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Overall Status Banner */}
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

        {/* Progress Bar */}
        {data && (
          <div className="mb-4">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="bg-status-success-text transition-all duration-500"
                style={{
                  width: `${(data.summary.passed / data.summary.total) * 100}%`,
                }}
              />
              {data.summary.failed > 0 && (
                <div
                  className="bg-status-error-text transition-all duration-500"
                  style={{
                    width: `${(data.summary.failed / data.summary.total) * 100}%`,
                  }}
                />
              )}
            </div>
          </div>
        )}

        {/* Gate Checklist */}
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

        {/* Loading State */}
        {loading && !data && (
          <div className="flex items-center justify-center py-8">
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Checking release readiness...
            </div>
          </div>
        )}

        {/* Error State */}
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
