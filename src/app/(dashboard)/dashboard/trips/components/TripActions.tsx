'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Play, RotateCcw, CheckSquare, KeyRound, UserCheck } from 'lucide-react';
import Link from 'next/link';

interface TripActionsProps {
  tripId: string;
  status: string;
  hasIssue?: boolean;
  hasAcknowledge?: boolean;
  hasDepartureInspection?: boolean;
  vehicleId: string;
  canManage: boolean;
  canDrive: boolean;
  canInspect: boolean;
  currentOdometer?: number;
}

export function TripActions({ tripId, status, hasIssue, hasAcknowledge, hasDepartureInspection, vehicleId, canManage, canDrive, canInspect, currentOdometer }: TripActionsProps) {
  const router = useRouter();
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState('');

  const handleStartTrip = useCallback(async () => {
    setIsWorking(true);
    setError('');
    try {
      const res = await fetch(`/api/trips/${tripId}/start`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to start trip');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trip');
    } finally {
      setIsWorking(false);
    }
  }, [tripId, router]);

  const handleDepartureInspection = useCallback(() => {
    router.push(`/dashboard/inspections/new?type=departure&tripId=${tripId}&vehicleId=${vehicleId}`);
  }, [tripId, vehicleId, router]);

  const handleMarkReturned = useCallback(async () => {
    setIsWorking(true);
    setError('');
    try {
      const res = await fetch(`/api/trips/${tripId}`);
      if (!res.ok) throw new Error('Failed to load trip details');
      const data = await res.json();
      const vehicleId = data.trip?.vehicleId || '';
      router.push(`/dashboard/inspections/new?type=return&tripId=${tripId}&vehicleId=${vehicleId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark returned');
    } finally {
      setIsWorking(false);
    }
  }, [tripId, router]);

  const handleIssueVehicle = useCallback(async () => {
    setIsWorking(true);
    setError('');
    try {
      const res = await fetch(`/api/trips/${tripId}/issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keysIssued: true, fuelCardIssued: true, issueOdometer: currentOdometer }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to issue vehicle');
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue vehicle');
    } finally {
      setIsWorking(false);
    }
  }, [tripId, currentOdometer, router]);

  const handleAcknowledge = useCallback(async () => {
    setIsWorking(true);
    setError('');
    try {
      const res = await fetch(`/api/trips/${tripId}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to acknowledge');
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to acknowledge');
    } finally {
      setIsWorking(false);
    }
  }, [tripId, router]);

  if (status === 'pending') {
    return (
      <div className="flex flex-wrap gap-2">
        {canDrive && !hasAcknowledge && (
          <Button variant="secondary" size="sm" loading={isWorking} onClick={handleAcknowledge}>
            <UserCheck className="h-4 w-4" /> Driver Acknowledge
          </Button>
        )}
        {canInspect && !hasDepartureInspection && (
          <Button variant="secondary" size="sm" onClick={handleDepartureInspection}>
            <CheckSquare className="h-4 w-4" /> Departure Inspection
          </Button>
        )}
        {canManage && hasAcknowledge && hasDepartureInspection && !hasIssue && (
          <Button variant="secondary" size="sm" loading={isWorking} onClick={handleIssueVehicle}>
            <KeyRound className="h-4 w-4" /> Issue Vehicle
          </Button>
        )}
        {canDrive && hasIssue && <Button variant="primary" size="sm" loading={isWorking} onClick={handleStartTrip}>
          <Play className="h-4 w-4" /> Start Trip
        </Button>}
        {error && <p className="mt-1 w-full text-xs text-status-error-text">{error}</p>}
      </div>
    );
  }

  if (status === 'in_progress') {
    return (
      <div>
        {canDrive && <Button variant="primary" size="sm" loading={isWorking} onClick={handleMarkReturned}>
          <RotateCcw className="h-4 w-4" /> Mark Returned
        </Button>}
        {error && <p className="mt-1 text-xs text-status-error-text">{error}</p>}
      </div>
    );
  }

  if (status === 'return_inspection') {
    return (
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/dashboard/inspections/new?type=return&tripId=${tripId}`}>
            <CheckSquare className="h-4 w-4" /> Complete Return Inspection
          </Link>
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/dashboard/trips/${tripId}`}>
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
          <Link href={`/dashboard/inspections/new?type=return&tripId=${tripId}`}>
            <CheckSquare className="h-4 w-4" /> Return Inspection
          </Link>
        </Button>
      </div>
    );
  }

  return null;
}
