'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';

interface Blocker {
  type: string;
  detail: string;
  severity: 'error' | 'warning';
}

interface AvailabilityData {
  available: boolean;
  hasWarnings: boolean;
  blockers: Blocker[];
}

interface Props {
  vehicleId: string | null;
  startDate: string;
  endDate: string;
}

export function VehicleAvailabilityCheck({ vehicleId, startDate, endDate }: Props) {
  const [availability, setAvailability] = useState<AvailabilityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkAvailability = useCallback(async () => {
    if (!vehicleId || !startDate) {
      setAvailability(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ start: startDate });
      if (endDate) params.set('end', endDate);

      const res = await fetch(`/api/vehicles/${vehicleId}/availability?${params}`);
      if (!res.ok) throw new Error('Failed to check availability');

      const data = await res.json();
      setAvailability(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Availability check failed');
      setAvailability(null);
    } finally {
      setLoading(false);
    }
  }, [vehicleId, startDate, endDate]);

  useEffect(() => {
    if (vehicleId && startDate) {
      checkAvailability();
    } else {
      setAvailability(null);
    }
  }, [vehicleId, startDate, endDate, checkAvailability]);

  if (!vehicleId || !startDate) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-[8px] border border-border bg-muted/30 px-4 py-2">
        <Loader2 className="h-4 w-4 animate-spin text-ink-400" />
        <span className="text-xs text-ink-500">Checking availability...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-[8px] border border-status-error-bg bg-status-error-bg/20 px-4 py-2">
        <XCircle className="h-4 w-4 text-status-error-text shrink-0" />
        <span className="text-xs text-status-error-text">{error}</span>
      </div>
    );
  }

  if (!availability) return null;

  // Count severity levels
  const errors = availability.blockers.filter((b) => b.severity === 'error');
  const warnings = availability.blockers.filter((b) => b.severity === 'warning');

  return (
    <div className={`rounded-[8px] border p-3 ${
      errors.length > 0
        ? 'border-status-error-bg bg-status-error-bg/10'
        : warnings.length > 0
          ? 'border-status-warning-bg bg-status-warning-bg/10'
          : 'border-status-success-bg bg-status-success-bg/10'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        {errors.length > 0 ? (
          <XCircle className="h-4 w-4 text-status-error-text shrink-0" />
        ) : warnings.length > 0 ? (
          <AlertTriangle className="h-4 w-4 text-status-warning-text shrink-0" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-status-success-text shrink-0" />
        )}
        <span className={`text-xs font-medium ${
          errors.length > 0
            ? 'text-status-error-text'
            : warnings.length > 0
              ? 'text-status-warning-text'
              : 'text-status-success-text'
        }`}>
          {errors.length > 0
            ? 'Vehicle not available'
            : warnings.length > 0
              ? 'Vehicle available with warnings'
              : 'Vehicle is available for this period'}
        </span>
      </div>
      {availability.blockers.length > 0 && (
        <div className="space-y-1">
          {availability.blockers.map((blocker, idx) => (
            <div key={idx} className="flex items-start gap-2">
              {blocker.severity === 'error' ? (
                <XCircle className="h-3 w-3 text-status-error-text shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-3 w-3 text-status-warning-text shrink-0 mt-0.5" />
              )}
              <span className={`text-xs ${blocker.severity === 'error' ? 'text-status-error-text' : 'text-status-warning-text'}`}>
                {blocker.detail}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
