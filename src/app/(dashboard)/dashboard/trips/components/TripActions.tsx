'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Play, RotateCcw, CheckSquare } from 'lucide-react';
import Link from 'next/link';

interface TripActionsProps {
  tripId: string;
  status: string;
  tenantId: string;
}

export function TripActions({ tripId, status, tenantId }: TripActionsProps) {
  const router = useRouter();
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState('');

  const handleStartTrip = useCallback(async () => {
    setIsWorking(true);
    setError('');
    try {
      // Departure inspection is the way to start a trip.
      // Navigate to the departure inspection page with trip and vehicle context.
      // First fetch trip details to get the vehicleId
      const res = await fetch(`/api/trips/${tripId}`);
      if (!res.ok) throw new Error('Failed to load trip details');
      const data = await res.json();
      const vehicleId = data.trip?.vehicleId || '';
      router.push(`/dashboard/inspections/departure?tripId=${tripId}&vehicleId=${vehicleId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start trip');
    } finally {
      setIsWorking(false);
    }
  }, [tripId, router]);

  const handleMarkReturned = useCallback(async () => {
    setIsWorking(true);
    setError('');
    try {
      // Navigate to return inspection with trip context
      const res = await fetch(`/api/trips/${tripId}`);
      if (!res.ok) throw new Error('Failed to load trip details');
      const data = await res.json();
      const vehicleId = data.trip?.vehicleId || '';
      router.push(`/dashboard/inspections/return?tripId=${tripId}&vehicleId=${vehicleId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark returned');
    } finally {
      setIsWorking(false);
    }
  }, [tripId, router]);

  if (status === 'pending') {
    return (
      <div>
        <Button variant="primary" size="sm" loading={isWorking} onClick={handleStartTrip}>
          <Play className="h-4 w-4" /> Start Trip
        </Button>
        {error && <p className="mt-1 text-xs text-status-error-text">{error}</p>}
      </div>
    );
  }

  if (status === 'in_progress') {
    return (
      <div>
        <Button variant="primary" size="sm" loading={isWorking} onClick={handleMarkReturned}>
          <RotateCcw className="h-4 w-4" /> Mark Returned
        </Button>
        {error && <p className="mt-1 text-xs text-status-error-text">{error}</p>}
      </div>
    );
  }

  if (status === 'return_inspection') {
    return (
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/dashboard/inspections/return?tripId=${tripId}`}>
            <CheckSquare className="h-4 w-4" /> Complete Return Inspection
          </Link>
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/dashboard/trips/closure-review`}>
            <CheckSquare className="h-4 w-4" /> Close Trip
          </Link>
        </Button>
      </div>
    );
  }

  if (status === 'closure_review') {
    return (
      <div className="flex gap-2">
        <Button variant="primary" size="sm" asChild>
          <Link href={`/dashboard/trips/${tripId}`}>
            <CheckSquare className="h-4 w-4" /> Close Trip
          </Link>
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/dashboard/inspections/return?tripId=${tripId}`}>
            <CheckSquare className="h-4 w-4" /> Return Inspection
          </Link>
        </Button>
      </div>
    );
  }

  return null;
}
